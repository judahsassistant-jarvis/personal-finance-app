/**
 * Cloud Functions for Personal Finance App.
 *
 * Region: europe-west2. Node 20 runtime.
 *
 * Functions:
 * - refreshBankHolidays        weekly cron, fetches gov.uk/bank-holidays.json →
 *                              system/bank_holidays doc.
 * - generateBtCliffAlerts      daily cron, emails users whose promo buckets
 *                              cross 90/60/30/14-day expiry thresholds.
 * - generatePaymentReminders   daily cron, emails users ahead of payment
 *                              due days; suppressed once debt_id-tagged
 *                              transactions are observed in the cycle.
 *
 * Mail delivery uses the Firebase Email Extension (`firestore-send-email`)
 * which watches /mail/{id} and dispatches via SendGrid/SMTP. Until the
 * extension is installed in prod, /mail/{id} docs queue up as dry-run
 * evidence; the functions themselves are idempotent via notification_log.
 *
 * Planned (future sprints):
 * - deleteUserData           (2b)
 * - scheduledFirestoreBackup (2b)
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const {
  classifyCliffThreshold,
  classifyReminderTrigger,
  cycleIdForDueDate,
  paymentReminderLogKey,
  btCliffLogKey,
  buildBtCliffMail,
  buildPaymentReminderMail,
  daysUntil,
} = require('./helpers/notifications.js');

setGlobalOptions({ region: 'europe-west2', maxInstances: 10 });
initializeApp();

const BANK_HOLIDAYS_URL = 'https://www.gov.uk/bank-holidays.json';

/**
 * Fetches the gov.uk bank-holidays feed and writes it to system/bank_holidays.
 * Runs weekly (schedule is generous — the feed rarely changes).
 */
exports.refreshBankHolidays = onSchedule(
  {
    schedule: 'every monday 03:00',
    timeZone: 'Europe/London',
    retryCount: 2,
  },
  async () => {
    const res = await fetch(BANK_HOLIDAYS_URL);
    if (!res.ok) {
      throw new Error(`gov.uk bank-holidays.json returned ${res.status}`);
    }
    const data = await res.json();
    const db = getFirestore();
    await db.doc('system/bank_holidays').set({
      ...data,
      fetched_at: FieldValue.serverTimestamp(),
      source: BANK_HOLIDAYS_URL,
    });
    console.log(
      `Bank holidays updated: eng-wales=${data['england-and-wales']?.events?.length ?? 0} events, ` +
      `scotland=${data.scotland?.events?.length ?? 0}, ni=${data['northern-ireland']?.events?.length ?? 0}`,
    );
  },
);

/**
 * Callable trigger — manual refresh for development / first deploy.
 * Same logic as the scheduled job; exposed so we don't have to wait a week.
 */
exports.refreshBankHolidaysNow = onRequest(async (req, res) => {
  try {
    const response = await fetch(BANK_HOLIDAYS_URL);
    if (!response.ok) {
      res.status(502).json({ ok: false, error: `gov.uk returned ${response.status}` });
      return;
    }
    const data = await response.json();
    const db = getFirestore();
    await db.doc('system/bank_holidays').set({
      ...data,
      fetched_at: FieldValue.serverTimestamp(),
      source: BANK_HOLIDAYS_URL,
    });
    res.json({
      ok: true,
      counts: {
        'england-and-wales': data['england-and-wales']?.events?.length ?? 0,
        scotland: data.scotland?.events?.length ?? 0,
        'northern-ireland': data['northern-ireland']?.events?.length ?? 0,
      },
    });
  } catch (err) {
    console.error('refreshBankHolidaysNow failed', err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// ---------------------------------------------------------------------------
// Notifications — shared helpers
// ---------------------------------------------------------------------------

/**
 * Return a Date representing "today" in Europe/London. Cloud Function runtime
 * is UTC; this keeps day-boundary decisions aligned with the user's timezone
 * so a 00:05 UTC run on a Tuesday isn't treated as Wednesday's notification
 * pass for a user in London summertime.
 */
function londonToday() {
  const now = new Date();
  // Pull local parts via Intl — Europe/London handles BST/GMT automatically.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

/**
 * Load and cache user profile docs during a single run. Both scheduled
 * functions need to look up users/{uid} for email + display_name.
 */
async function loadUserCache(db, userIds) {
  const cache = {};
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return cache;
  const snaps = await Promise.all(unique.map((uid) => db.doc(`users/${uid}`).get()));
  for (const snap of snaps) {
    if (snap.exists) cache[snap.id] = snap.data();
  }
  return cache;
}

/**
 * Write a mail doc + idempotent log entry atomically. Returns true if the
 * notification was sent (i.e. the log was freshly written). Returns false
 * if the log already existed — caller should not re-send.
 */
async function tryDispatchNotification(db, { logKey, logFields, mailDoc }) {
  const logRef = db.doc(`notification_log/${logKey}`);
  const existed = (await logRef.get()).exists;
  if (existed) return false;
  const batch = db.batch();
  batch.set(logRef, { ...logFields, sent_at: FieldValue.serverTimestamp() });
  batch.set(db.collection('mail').doc(), mailDoc);
  await batch.commit();
  return true;
}

// ---------------------------------------------------------------------------
// generateBtCliffAlerts — daily cron
// ---------------------------------------------------------------------------

/**
 * Extracted scan so integration tests can run it deterministically with an
 * injected `today`. The scheduled + HTTP wrappers just call this.
 */
async function runBtCliffScan({ db, today }) {
    // 90 days out is the outermost threshold. Anything further is ignored.
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + 90);

    const snap = await db.collectionGroup('card_buckets')
      .where('is_promo', '==', true)
      .where('promo_end', '<=', Timestamp.fromDate(cutoff))
      .get();

    if (snap.empty) {
      console.log('btCliffAlerts: no promo buckets within 90 days');
      return { sent: 0, skipped: 0, candidates: 0 };
    }

    // Prefetch user profiles and parent debts.
    const userIds = snap.docs.map((d) => d.data().user_id).filter(Boolean);
    const userCache = await loadUserCache(db, userIds);

    const debtIds = [...new Set(snap.docs.map((d) => d.data().debt_id).filter(Boolean))];
    const debtSnaps = await Promise.all(debtIds.map((id) => db.doc(`debts/${id}`).get()));
    const debtCache = Object.fromEntries(debtSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));

    let sent = 0;
    let skipped = 0;

    for (const bucketSnap of snap.docs) {
      const bucket = bucketSnap.data();
      const user = userCache[bucket.user_id];
      const debt = debtCache[bucket.debt_id];
      if (!user?.email || !debt) { skipped += 1; continue; }

      const promoEnd = bucket.promo_end?.toDate?.();
      if (!promoEnd) { skipped += 1; continue; }
      const daysLeft = daysUntil(today, promoEnd);
      const threshold = classifyCliffThreshold(daysLeft);
      if (!threshold) { skipped += 1; continue; }

      const promoEndIso = promoEnd.toISOString().slice(0, 10);
      const logKey = btCliffLogKey(bucket.user_id, bucketSnap.id, threshold.key, promoEndIso);

      const dispatched = await tryDispatchNotification(db, {
        logKey,
        logFields: {
          user_id: bucket.user_id,
          type: 'bt_cliff',
          entity_id: bucketSnap.id,
          threshold_key: threshold.key,
          promo_end: Timestamp.fromDate(promoEnd),
        },
        mailDoc: buildBtCliffMail({
          toEmail: user.email,
          displayName: user.display_name,
          debtName: debt.name,
          bucketName: bucket.name,
          daysUntilCliff: daysLeft,
          thresholdLabel: threshold.label,
          promoEndIso,
        }),
      });
      if (dispatched) sent += 1; else skipped += 1;
    }
    console.log(`btCliffAlerts: sent=${sent}, skipped=${skipped}, candidates=${snap.size}`);
    return { sent, skipped, candidates: snap.size };
}

exports.generateBtCliffAlerts = onSchedule(
  {
    schedule: 'every day 08:00',
    timeZone: 'Europe/London',
    retryCount: 2,
  },
  async () => {
    await runBtCliffScan({ db: getFirestore(), today: londonToday() });
  },
);

// ---------------------------------------------------------------------------
// generatePaymentReminders — daily cron
// ---------------------------------------------------------------------------

async function runPaymentReminderScan({ db, today }) {
    const snap = await db.collectionGroup('debts')
      .where('reminders_enabled', '==', true)
      .where('payment_due_day', '>=', 1)
      .get();
    if (snap.empty) {
      console.log('paymentReminders: no debts eligible');
      return { sent: 0, skipped: 0, candidates: 0 };
    }

    const userIds = snap.docs.map((d) => d.data().user_id).filter(Boolean);
    const userCache = await loadUserCache(db, userIds);

    // Debt-config (for per-user reminder_days_before override). Cache per run.
    const configSnaps = await Promise.all(
      [...new Set(userIds)].map(async (uid) => {
        const q = await db.collection('debt_config').where('user_id', '==', uid).limit(1).get();
        return [uid, q.empty ? null : q.docs[0].data()];
      }),
    );
    const configCache = Object.fromEntries(configSnaps);

    let sent = 0;
    let skipped = 0;

    for (const debtSnap of snap.docs) {
      const debt = debtSnap.data();
      const user = userCache[debt.user_id];
      if (!user?.email) { skipped += 1; continue; }
      const reminderDaysBefore = configCache[debt.user_id]?.reminder_days_before ?? 3;

      const trigger = classifyReminderTrigger({
        today,
        paymentDueDay: debt.payment_due_day,
        reminderDaysBefore,
      });
      if (!trigger) { skipped += 1; continue; }

      const cycleId = cycleIdForDueDate(trigger.dueDate);

      // Suppression: if any transaction for this debt has been observed in the
      // current cycle, don't remind. Simple cycle-start heuristic: the last
      // instance of payment_due_day on or before `today`. (Pay-cycle bounds
      // are available in the client service but duplicating them here keeps
      // the Cloud Function self-contained; close enough for suppression.)
      const cycleStart = cycleStartFromDueDate(trigger.dueDate);
      const paidSnap = await db.collectionGroup('transactions')
        .where('user_id', '==', debt.user_id)
        .where('debt_id', '==', debtSnap.id)
        .where('date', '>=', Timestamp.fromDate(cycleStart))
        .limit(1)
        .get();
      if (!paidSnap.empty) { skipped += 1; continue; }

      const logKey = paymentReminderLogKey(debt.user_id, debtSnap.id, cycleId, trigger.type);
      const dispatched = await tryDispatchNotification(db, {
        logKey,
        logFields: {
          user_id: debt.user_id,
          type: 'payment_reminder',
          entity_id: debtSnap.id,
          cycle_id: cycleId,
          trigger_type: trigger.type,
          due_date: Timestamp.fromDate(trigger.dueDate),
        },
        mailDoc: buildPaymentReminderMail({
          toEmail: user.email,
          displayName: user.display_name,
          debtName: debt.name,
          dueDateIso: trigger.dueDate.toISOString().slice(0, 10),
          triggerType: trigger.type,
          paymentDueDay: debt.payment_due_day,
        }),
      });
      if (dispatched) sent += 1; else skipped += 1;
    }
    console.log(`paymentReminders: sent=${sent}, skipped=${skipped}, candidates=${snap.size}`);
    return { sent, skipped, candidates: snap.size };
}

exports.generatePaymentReminders = onSchedule(
  {
    schedule: 'every day 08:15',
    timeZone: 'Europe/London',
    retryCount: 2,
  },
  async () => {
    await runPaymentReminderScan({ db: getFirestore(), today: londonToday() });
  },
);

// Expose scan functions to integration tests (not a published API).
exports._runBtCliffScan = runBtCliffScan;
exports._runPaymentReminderScan = runPaymentReminderScan;

/**
 * Given a reminder's upcoming due date, the cycle it belongs to starts one
 * month earlier on the same due day (clamped to month-length). We use this
 * as a cheap suppression window: any transaction tagged to this debt with a
 * date >= cycleStart is considered "already paid for this cycle".
 */
function cycleStartFromDueDate(dueDate) {
  const y = dueDate.getFullYear();
  const m = dueDate.getMonth();
  const d = dueDate.getDate();
  const prevMonth = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
  const lastDay = new Date(prevMonth.y, prevMonth.m + 1, 0).getDate();
  return new Date(prevMonth.y, prevMonth.m, Math.min(d, lastDay));
}

// ---------------------------------------------------------------------------
// Manual-trigger HTTP endpoints — useful for emulator dry runs.
// ---------------------------------------------------------------------------

exports.runBtCliffAlertsNow = onRequest(async (req, res) => {
  try {
    const result = await runBtCliffScan({ db: getFirestore(), today: londonToday() });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

exports.runPaymentRemindersNow = onRequest(async (req, res) => {
  try {
    const result = await runPaymentReminderScan({ db: getFirestore(), today: londonToday() });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Keep healthcheck for emulator verification.
exports.healthcheck = onRequest((req, res) => {
  res.json({ ok: true, region: 'europe-west2', ts: new Date().toISOString() });
});
