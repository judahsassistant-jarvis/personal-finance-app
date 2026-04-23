const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
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
} = require('../helpers/notifications.js');

// ---------------------------------------------------------------------------
// daysUntil
// ---------------------------------------------------------------------------

describe('daysUntil', () => {
  it('returns 0 when dates are the same calendar day', () => {
    // Construct from local year/month/day so the test is timezone-agnostic.
    const a = new Date(2026, 3, 23, 9, 0);
    const b = new Date(2026, 3, 23, 23, 0);
    assert.strictEqual(daysUntil(a, b), 0);
  });
  it('positive for future, negative for past', () => {
    const today = new Date('2026-04-23');
    assert.strictEqual(daysUntil(today, new Date('2026-05-07')), 14);
    assert.strictEqual(daysUntil(today, new Date('2026-04-16')), -7);
  });
  it('returns null on non-Date input', () => {
    assert.strictEqual(daysUntil(null, new Date()), null);
    assert.strictEqual(daysUntil(new Date(), 'x'), null);
  });
});

// ---------------------------------------------------------------------------
// classifyCliffThreshold
// ---------------------------------------------------------------------------

describe('classifyCliffThreshold', () => {
  it('returns null for > 90 days or negative', () => {
    assert.strictEqual(classifyCliffThreshold(91), null);
    assert.strictEqual(classifyCliffThreshold(-1), null);
    assert.strictEqual(classifyCliffThreshold(NaN), null);
  });
  it('picks tightest threshold', () => {
    assert.strictEqual(classifyCliffThreshold(14).key, 'critical_14d');
    assert.strictEqual(classifyCliffThreshold(13).key, 'critical_14d');
    assert.strictEqual(classifyCliffThreshold(0).key, 'critical_14d');
  });
  it('30-day band', () => {
    assert.strictEqual(classifyCliffThreshold(30).key, 'urgent_30d');
    assert.strictEqual(classifyCliffThreshold(15).key, 'urgent_30d');
  });
  it('60-day band', () => {
    assert.strictEqual(classifyCliffThreshold(60).key, 'warning_60d');
    assert.strictEqual(classifyCliffThreshold(31).key, 'warning_60d');
  });
  it('90-day band', () => {
    assert.strictEqual(classifyCliffThreshold(90).key, 'distant_90d');
    assert.strictEqual(classifyCliffThreshold(61).key, 'distant_90d');
  });
  it('CLIFF_THRESHOLDS is sorted tightest-first', () => {
    const days = CLIFF_THRESHOLDS.map((t) => t.days);
    assert.deepStrictEqual(days, [...days].sort((a, b) => a - b));
  });
});

// ---------------------------------------------------------------------------
// upcomingDueDate
// ---------------------------------------------------------------------------

describe('upcomingDueDate', () => {
  it('returns this month when due day is today or later', () => {
    const today = new Date(2026, 3, 10); // 10 Apr 2026
    const due = upcomingDueDate(today, 15);
    assert.strictEqual(due.getFullYear(), 2026);
    assert.strictEqual(due.getMonth(), 3);
    assert.strictEqual(due.getDate(), 15);
  });
  it('rolls to next month when due day has passed', () => {
    const today = new Date(2026, 3, 20);
    const due = upcomingDueDate(today, 15);
    assert.strictEqual(due.getMonth(), 4);
    assert.strictEqual(due.getDate(), 15);
  });
  it('clamps 31st in a 30-day month to last day of month', () => {
    const today = new Date(2026, 3, 1); // April (30 days)
    const due = upcomingDueDate(today, 31);
    assert.strictEqual(due.getMonth(), 3);
    assert.strictEqual(due.getDate(), 30);
  });
  it('clamps 31st in February', () => {
    const today = new Date(2026, 1, 1); // Feb 2026 (28 days)
    const due = upcomingDueDate(today, 31);
    assert.strictEqual(due.getMonth(), 1);
    assert.strictEqual(due.getDate(), 28);
  });
  it('wraps year boundary', () => {
    const today = new Date(2026, 11, 20); // 20 Dec 2026
    const due = upcomingDueDate(today, 15);
    assert.strictEqual(due.getFullYear(), 2027);
    assert.strictEqual(due.getMonth(), 0);
    assert.strictEqual(due.getDate(), 15);
  });
});

// ---------------------------------------------------------------------------
// classifyReminderTrigger
// ---------------------------------------------------------------------------

describe('classifyReminderTrigger', () => {
  it('fires day_of when today === due day', () => {
    const today = new Date(2026, 3, 15);
    const res = classifyReminderTrigger({ today, paymentDueDay: 15 });
    assert.strictEqual(res.type, 'day_of');
  });
  it('fires one_day when due tomorrow', () => {
    const today = new Date(2026, 3, 14);
    const res = classifyReminderTrigger({ today, paymentDueDay: 15 });
    assert.strictEqual(res.type, 'one_day');
  });
  it('fires upcoming when today is N days before due (default N=3)', () => {
    const today = new Date(2026, 3, 12);
    const res = classifyReminderTrigger({ today, paymentDueDay: 15 });
    assert.strictEqual(res.type, 'upcoming');
  });
  it('honours user reminderDaysBefore', () => {
    const today = new Date(2026, 3, 10);
    const res = classifyReminderTrigger({ today, paymentDueDay: 15, reminderDaysBefore: 5 });
    assert.strictEqual(res.type, 'upcoming');
  });
  it('prefers day_of over upcoming when reminderDaysBefore is invalid/0', () => {
    const today = new Date(2026, 3, 15);
    const res = classifyReminderTrigger({ today, paymentDueDay: 15, reminderDaysBefore: 0 });
    assert.strictEqual(res.type, 'day_of');
  });
  it('prefers one_day over upcoming when reminderDaysBefore=1', () => {
    const today = new Date(2026, 3, 14);
    const res = classifyReminderTrigger({ today, paymentDueDay: 15, reminderDaysBefore: 1 });
    assert.strictEqual(res.type, 'one_day');
  });
  it('clamps reminderDaysBefore to 1..7', () => {
    const today = new Date(2026, 3, 4);
    const res = classifyReminderTrigger({ today, paymentDueDay: 11, reminderDaysBefore: 100 });
    assert.strictEqual(res?.type, 'upcoming'); // clamped to 7 days before
  });
  it('returns null on non-reminder days', () => {
    const today = new Date(2026, 3, 5);
    assert.strictEqual(classifyReminderTrigger({ today, paymentDueDay: 15 }), null);
  });
  it('returns null when paymentDueDay invalid', () => {
    const today = new Date(2026, 3, 15);
    assert.strictEqual(classifyReminderTrigger({ today, paymentDueDay: 0 }), null);
    assert.strictEqual(classifyReminderTrigger({ today, paymentDueDay: 32 }), null);
    assert.strictEqual(classifyReminderTrigger({ today, paymentDueDay: null }), null);
  });
});

// ---------------------------------------------------------------------------
// cycleIdForDueDate + log keys
// ---------------------------------------------------------------------------

describe('cycleIdForDueDate', () => {
  it('returns YYYY-MM', () => {
    assert.strictEqual(cycleIdForDueDate(new Date(2026, 3, 15)), '2026-04');
    assert.strictEqual(cycleIdForDueDate(new Date(2026, 0, 1)), '2026-01');
    assert.strictEqual(cycleIdForDueDate(new Date(2026, 11, 31)), '2026-12');
  });
});

describe('log keys', () => {
  it('paymentReminderLogKey is deterministic + includes trigger', () => {
    assert.strictEqual(
      paymentReminderLogKey('u1', 'd1', '2026-04', 'day_of'),
      'payment_u1_d1_2026-04_day_of',
    );
    assert.notStrictEqual(
      paymentReminderLogKey('u1', 'd1', '2026-04', 'upcoming'),
      paymentReminderLogKey('u1', 'd1', '2026-04', 'one_day'),
    );
  });
  it('btCliffLogKey includes promo_end so extensions re-fire alerts', () => {
    const a = btCliffLogKey('u1', 'b1', 'urgent_30d', '2026-05-01');
    const b = btCliffLogKey('u1', 'b1', 'urgent_30d', '2026-08-01');
    assert.notStrictEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// mail shapers
// ---------------------------------------------------------------------------

describe('buildBtCliffMail', () => {
  it('builds a to + message with subject + html', () => {
    const mail = buildBtCliffMail({
      toEmail: 'u@e.com', displayName: 'Judah',
      debtName: 'Barclaycard', bucketName: 'BT',
      daysUntilCliff: 14, thresholdLabel: '14 days', promoEndIso: '2026-05-07',
    });
    assert.deepStrictEqual(mail.to, ['u@e.com']);
    assert.match(mail.message.subject, /Barclaycard: BT promo ends in 14 days/);
    assert.match(mail.message.html, /Hi Judah,/);
    assert.match(mail.message.html, /2026-05-07/);
  });
  it('escapes HTML in debt/bucket names', () => {
    const mail = buildBtCliffMail({
      toEmail: 'u@e.com', displayName: null,
      debtName: '<script>x</script>', bucketName: 'B&T',
      daysUntilCliff: 30, thresholdLabel: '30 days', promoEndIso: '2026-05-07',
    });
    assert.match(mail.message.html, /&lt;script&gt;/);
    assert.match(mail.message.html, /B&amp;T/);
    assert.match(mail.message.html, /^<p>Hi,<\/p>/);
  });
});

describe('buildPaymentReminderMail', () => {
  it('day_of phrasing', () => {
    const mail = buildPaymentReminderMail({
      toEmail: 'u@e.com', displayName: 'Judah',
      debtName: 'Zopa Loan', dueDateIso: '2026-04-15',
      triggerType: 'day_of', paymentDueDay: 15,
    });
    assert.match(mail.message.subject, /due today/);
    assert.match(mail.message.html, /due today/);
  });
  it('one_day phrasing', () => {
    const mail = buildPaymentReminderMail({
      toEmail: 'u@e.com', displayName: 'Judah',
      debtName: 'Zopa Loan', dueDateIso: '2026-04-15',
      triggerType: 'one_day', paymentDueDay: 15,
    });
    assert.match(mail.message.subject, /due tomorrow/);
  });
  it('upcoming uses ordinal due day', () => {
    const mail = buildPaymentReminderMail({
      toEmail: 'u@e.com', displayName: null,
      debtName: 'Zopa Loan', dueDateIso: '2026-04-15',
      triggerType: 'upcoming', paymentDueDay: 22,
    });
    assert.match(mail.message.subject, /due on the 22nd/);
  });
});

describe('ordinal', () => {
  it('ordinal suffixes', () => {
    assert.strictEqual(ordinal(1), '1st');
    assert.strictEqual(ordinal(2), '2nd');
    assert.strictEqual(ordinal(3), '3rd');
    assert.strictEqual(ordinal(4), '4th');
    assert.strictEqual(ordinal(11), '11th');
    assert.strictEqual(ordinal(21), '21st');
    assert.strictEqual(ordinal(22), '22nd');
    assert.strictEqual(ordinal(23), '23rd');
  });
});

describe('escapeHtml', () => {
  it('escapes all five characters', () => {
    assert.strictEqual(escapeHtml(`<a href="x&y">'</a>`), '&lt;a href=&quot;x&amp;y&quot;&gt;&#39;&lt;/a&gt;');
  });
  it('handles null and undefined', () => {
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
  });
});
