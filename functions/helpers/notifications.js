/**
 * Pure helpers for Cloud Functions notification scheduling. No Firestore / no
 * IO — all side effects happen in the function layer. Kept in CommonJS so
 * functions/index.js can `require()` them natively.
 *
 * Sprint 7. Covers:
 *   - BT cliff alert threshold selection (90 / 60 / 30 / 14 days).
 *   - Payment reminder trigger classification (upcoming / 1-day / day-of).
 *
 * UK timezone semantics: callers pass in `today` as a Date whose year/month/day
 * are interpreted naively (no timezone conversion inside these helpers).
 * Functions/index.js computes "today" in Europe/London before calling.
 */

// ---------------------------------------------------------------------------
// BT cliff alerts
// ---------------------------------------------------------------------------

/**
 * Thresholds are ordered from tightest to loosest. The caller emits the
 * tightest bucket the promo is under. Idempotency in the log keys on the
 * returned threshold_key so each is sent at most once per bucket-promo.
 */
const CLIFF_THRESHOLDS = Object.freeze([
  { key: 'critical_14d', days: 14, label: '14 days' },
  { key: 'urgent_30d', days: 30, label: '30 days' },
  { key: 'warning_60d', days: 60, label: '60 days' },
  { key: 'distant_90d', days: 90, label: '90 days' },
]);

/**
 * Classify days-until-cliff to the tightest active threshold. Returns null
 * when the promo is >90 days away (too far to alert on) or has already
 * expired (past alerts don't retroactively fire).
 */
function classifyCliffThreshold(daysUntilCliff) {
  if (!Number.isFinite(daysUntilCliff) || daysUntilCliff < 0) return null;
  for (const t of CLIFF_THRESHOLDS) {
    if (daysUntilCliff <= t.days) return t;
  }
  return null;
}

/** Integer days from `today` to `cliffDate`. Both inputs should be Date. */
function daysUntil(today, targetDate) {
  if (!(today instanceof Date) || !(targetDate instanceof Date)) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const x = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  return Math.round((x - t) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Payment reminders
// ---------------------------------------------------------------------------

/**
 * Classify "should we remind today?" relative to a debt's `payment_due_day`.
 * Returns { type, dueDate } when today is a reminder day, null otherwise.
 *
 * Three trigger points per cycle:
 *   - 'upcoming': N days before due (N = reminderDaysBefore, 1–7)
 *   - 'one_day':  1 day before due
 *   - 'day_of':   the due day itself
 *
 * When 'upcoming' and 'one_day' collide (reminderDaysBefore=1), only 'one_day'
 * fires. When 'upcoming' collides with 'day_of' (reminderDaysBefore=0 — not
 * valid per schema, but defensive), only 'day_of' fires.
 *
 * @param {Object} input
 * @param {Date} input.today
 * @param {number} input.paymentDueDay — 1..31
 * @param {number} [input.reminderDaysBefore=3] — 1..7
 */
function classifyReminderTrigger({ today, paymentDueDay, reminderDaysBefore = 3 }) {
  if (!(today instanceof Date)) return null;
  if (!Number.isInteger(paymentDueDay) || paymentDueDay < 1 || paymentDueDay > 31) return null;
  const days = Math.max(1, Math.min(7, Number(reminderDaysBefore) || 3));

  const dueDate = upcomingDueDate(today, paymentDueDay);
  const daysToGo = daysUntil(today, dueDate);

  if (daysToGo === 0) return { type: 'day_of', dueDate };
  if (daysToGo === 1) return { type: 'one_day', dueDate };
  if (daysToGo === days) return { type: 'upcoming', dueDate };
  return null;
}

/**
 * Given today and a 1–31 due day, return the next Date on/after today whose
 * day-of-month matches. If the month has fewer days than the due day, the
 * reminder falls on the last day of the month (common for 31st due day in
 * February).
 */
function upcomingDueDate(today, paymentDueDay) {
  let year = today.getFullYear();
  let month = today.getMonth();
  let candidate = buildDueDate(year, month, paymentDueDay);
  if (daysUntil(today, candidate) < 0) {
    // This month's due day has passed — roll to next month.
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    candidate = buildDueDate(year, month, paymentDueDay);
  }
  return candidate;
}

function buildDueDate(year, month, day) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const clamped = Math.min(day, lastDay);
  return new Date(year, month, clamped);
}

/**
 * Build a stable cycle identifier for the current cycle the `dueDate` belongs
 * to. Format: YYYY-MM of dueDate. Same cycle for all three reminder triggers
 * tied to that due date. When the cycle rolls, cycle_id changes → new log
 * entries, reminders re-fire.
 */
function cycleIdForDueDate(dueDate) {
  const y = dueDate.getFullYear();
  const m = String(dueDate.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Build the notification_log entry key for payment reminders. Idempotency:
 * only write+send when a doc at this key does not already exist.
 */
function paymentReminderLogKey(userId, debtId, cycleId, triggerType) {
  return `payment_${userId}_${debtId}_${cycleId}_${triggerType}`;
}

function btCliffLogKey(userId, bucketId, thresholdKey, promoEndIso) {
  // promo_end in the key so extending a promo (changing promo_end) causes
  // the same threshold to fire again with the new date.
  return `bt_${userId}_${bucketId}_${thresholdKey}_${promoEndIso}`;
}

// ---------------------------------------------------------------------------
// Mail doc shaping (for Firebase Email Extension — firestore-send-email).
// The extension watches /mail/{id} and delivers via SendGrid/Mailgun/SMTP.
// When the extension is NOT installed (2a dogfood, local emulator), these
// docs queue up and can be inspected but no email is sent.
// ---------------------------------------------------------------------------

function buildBtCliffMail({ toEmail, displayName, debtName, bucketName, daysUntilCliff, thresholdLabel, promoEndIso }) {
  const subject = `${debtName}: ${bucketName} promo ends in ${daysUntilCliff} days`;
  const greeting = displayName ? `Hi ${displayName},` : 'Hi,';
  const html = [
    `<p>${greeting}</p>`,
    `<p>The promo rate on your <b>${escapeHtml(bucketName)}</b> bucket on <b>${escapeHtml(debtName)}</b>`,
    ` ends on <b>${escapeHtml(promoEndIso)}</b> — that's <b>${daysUntilCliff} days</b> away`,
    ` (${thresholdLabel} alert).</p>`,
    '<p>If you don\'t clear or re-transfer this balance before the cliff, it will revert to the',
    ' card\'s standard APR. Consider your options: pay off, move to a new BT card, or accept the rate change.</p>',
    '<p>— Personal Finance App</p>',
  ].join('');
  return {
    to: [toEmail],
    message: { subject, html },
  };
}

function buildPaymentReminderMail({ toEmail, displayName, debtName, dueDateIso, triggerType, paymentDueDay }) {
  const when = triggerType === 'day_of' ? 'due today'
    : triggerType === 'one_day' ? 'due tomorrow'
    : `due on the ${ordinal(paymentDueDay)}`;
  const subject = `${debtName} payment ${when}`;
  const greeting = displayName ? `Hi ${displayName},` : 'Hi,';
  const html = [
    `<p>${greeting}</p>`,
    `<p>Your <b>${escapeHtml(debtName)}</b> payment is <b>${when}</b> (${escapeHtml(dueDateIso)}).</p>`,
    '<p>Once you\'ve paid it from your current account, tag the transaction against this debt',
    ' on the Transactions page — we\'ll stop reminding you for the rest of this cycle.</p>',
    '<p>— Personal Finance App</p>',
  ].join('');
  return {
    to: [toEmail],
    message: { subject, html },
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

module.exports = {
  CLIFF_THRESHOLDS,
  classifyCliffThreshold,
  daysUntil,
  classifyReminderTrigger,
  upcomingDueDate,
  cycleIdForDueDate,
  paymentReminderLogKey,
  btCliffLogKey,
  buildBtCliffMail,
  buildPaymentReminderMail,
  escapeHtml,
  ordinal,
};
