/**
 * Cloud Functions for Personal Finance App.
 *
 * Region: europe-west2. Node 20 runtime.
 *
 * Functions:
 * - refreshBankHolidays   weekly cron, fetches gov.uk/bank-holidays.json →
 *                         system/bank_holidays doc.
 *
 * Planned (future sprints):
 * - generatePaymentReminders (4d)
 * - generateBtCliffAlerts    (7)
 * - deleteUserData           (2b)
 * - scheduledFirestoreBackup (2b)
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

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

// Keep healthcheck for emulator verification.
exports.healthcheck = onRequest((req, res) => {
  res.json({ ok: true, region: 'europe-west2', ts: new Date().toISOString() });
});
