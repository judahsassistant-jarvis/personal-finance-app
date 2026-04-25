import { describe, test, expect } from 'vitest';
import {
  normalizeMerchant,
  parseDate,
  detectFormat,
  autoCategorize,
  isKnownRecurring,
  detectRecurringBills,
  parseCSV,
  KNOWN_CATEGORIES,
} from '../csvParser.js';

describe('normalizeMerchant', () => {
  test('normalises known merchants', () => {
    expect(normalizeMerchant('TESCO STORES #1234')).toBe('Tesco');
    expect(normalizeMerchant('NETFLIX.COM')).toBe('Netflix');
    expect(normalizeMerchant('EDF ENERGY SERVICES')).toBe('EDF Energy');
    expect(normalizeMerchant('UBER *EATS LONDON')).toBe('Uber Eats');
  });
  test('strips store/branch numbers', () => {
    expect(normalizeMerchant('TESCO STORES #12345')).toBe('Tesco');
  });
  test('strips country codes', () => {
    expect(normalizeMerchant('SPOTIFY AB GB')).toBe('Spotify');
  });
  test('title-cases unknown merchants', () => {
    expect(normalizeMerchant('RANDOM SHOP NAME')).toBe('Random Shop Name');
  });
  test('handles null/empty input', () => {
    expect(normalizeMerchant(null)).toBe('Unknown');
    expect(normalizeMerchant('')).toBe('Unknown');
    expect(normalizeMerchant(undefined)).toBe('Unknown');
  });
  test('long trailing numbers stripped', () => {
    expect(normalizeMerchant('SAINSBURY 123456')).toBe('Sainsburys');
  });
  test('matches longest key first', () => {
    expect(normalizeMerchant('TESCO STORES LTD')).toBe('Tesco');
  });
  test('Uber variants', () => {
    expect(normalizeMerchant('UBER *TRIP LONDON')).toBe('Uber');
    expect(normalizeMerchant('UBER *EATS ORDER')).toBe('Uber Eats');
    expect(normalizeMerchant('UBER *ONE SUB')).toBe('Uber One');
  });
});

describe('parseDate', () => {
  test('UK format DD/MM/YYYY', () => { expect(parseDate('15/02/2026')).toBe('2026-02-15'); });
  test('UK with time', () => { expect(parseDate('15/02/2026 14:30')).toBe('2026-02-15'); });
  test('ISO format', () => { expect(parseDate('2026-02-15')).toBe('2026-02-15'); });
  test('Nationwide DD-Mon-YY', () => {
    expect(parseDate('07-Nov-25')).toBe('2025-11-07');
    expect(parseDate('15-Feb-26')).toBe('2026-02-15');
  });
  test('DD-MM-YYYY dashed', () => { expect(parseDate('15-02-2026')).toBe('2026-02-15'); });
  test('single-digit day/month', () => { expect(parseDate('1/2/2026')).toBe('2026-02-01'); });
  test('returns null for empty/null input', () => {
    expect(parseDate(null)).toBe(null);
    expect(parseDate('')).toBe(null);
    expect(parseDate(undefined)).toBe(null);
  });
  test('returns null for unparseable date', () => { expect(parseDate('not a date')).toBe(null); });
  test('handles whitespace', () => { expect(parseDate('  15/02/2026  ')).toBe('2026-02-15'); });
});

describe('detectFormat', () => {
  test('Nationwide', () => {
    expect(detectFormat(['Date', 'Transaction type', 'Description', 'Paid out', 'Paid in', 'Balance']))
      .toBe('nationwide');
  });
  test('Revolut', () => {
    expect(detectFormat(['Type', 'Product', 'Started Date', 'Completed Date', 'Description', 'Amount', 'Fee', 'Currency', 'State', 'Balance']))
      .toBe('revolut');
  });
  test('Virgin Money', () => {
    expect(detectFormat(['Transaction Date', 'Posting Date', 'Billing Amount', 'Merchant', 'Debit or Credit']))
      .toBe('virgin_money');
  });
  test('bank with debit/credit', () => {
    expect(detectFormat(['Date', 'Description', 'Debit', 'Credit', 'Balance']))
      .toBe('bank_with_balance');
  });
  test('falls back to generic', () => {
    expect(detectFormat(['Date', 'Amount', 'Description'])).toBe('generic');
  });
  test('case-insensitive', () => {
    expect(detectFormat(['date', 'TRANSACTION TYPE', 'Description', 'PAID OUT', 'Paid In', 'Balance']))
      .toBe('nationwide');
  });
});

describe('autoCategorize', () => {
  test('supermarkets → Shopping', () => {
    expect(autoCategorize('Tesco')).toBe('Shopping');
    expect(autoCategorize('Sainsburys')).toBe('Shopping');
  });
  test('food delivery → Food', () => {
    expect(autoCategorize('Uber Eats')).toBe('Food');
    expect(autoCategorize('McDonalds')).toBe('Food');
  });
  test('energy → Bills', () => {
    expect(autoCategorize('EDF Energy')).toBe('Bills');
    expect(autoCategorize('BT')).toBe('Bills');
  });
  test('streaming → Subscriptions', () => {
    expect(autoCategorize('Netflix')).toBe('Subscriptions');
    expect(autoCategorize('Spotify')).toBe('Subscriptions');
    expect(autoCategorize('Disney+')).toBe('Subscriptions');
  });
  test('transport', () => {
    expect(autoCategorize('Uber')).toBe('Transport');
    expect(autoCategorize('Shell')).toBe('Transport');
  });
  test('payments', () => {
    expect(autoCategorize('Amex')).toBe('Payments');
    expect(autoCategorize('Zopa')).toBe('Payments');
  });
  test('cash withdrawals → Cash', () => {
    expect(autoCategorize('ATM Withdrawal Notemachine Ltd')).toBe('Cash');
    expect(autoCategorize('LINK ATM')).toBe('Cash');
    expect(autoCategorize('Cashpoint')).toBe('Cash');
  });
  test('user rules take precedence over hardcoded mapping', () => {
    // 'Tesco' would normally categorise to 'Shopping' via the hardcoded list.
    // A user rule for 'Tesco' = 'Food' should win.
    const userRules = [{ merchant: 'Tesco', category: 'Food' }];
    expect(autoCategorize('Tesco', userRules)).toBe('Food');
  });
  test('user rule match is case-insensitive on the exact merchant name', () => {
    const userRules = [{ merchant: 'Atm Withdrawal Notemachine', category: 'Cash' }];
    expect(autoCategorize('ATM WITHDRAWAL NOTEMACHINE', userRules)).toBe('Cash');
  });
  test('falls through to hardcoded list when no user rule matches', () => {
    const userRules = [{ merchant: 'Some Other Merchant', category: 'Food' }];
    expect(autoCategorize('Tesco', userRules)).toBe('Shopping');
  });
  test('ignores malformed user rules without throwing', () => {
    const userRules = [
      { merchant: '', category: 'Food' },
      { category: 'Food' },
      null,
      { merchant: 'Tesco' },
    ];
    expect(autoCategorize('Tesco', userRules)).toBe('Shopping');
  });
});

describe('KNOWN_CATEGORIES', () => {
  test('exposes the fixed UI category list including Cash + Other', () => {
    expect(KNOWN_CATEGORIES).toContain('Cash');
    expect(KNOWN_CATEGORIES).toContain('Other');
    expect(KNOWN_CATEGORIES).toContain('Bills');
  });
  test('health', () => {
    expect(autoCategorize('Lords Pharmacy')).toBe('Health');
    expect(autoCategorize('Boots Pharmacy')).toBe('Health');
    expect(autoCategorize('NHS')).toBe('Health');
  });
  test('unknown → Other', () => {
    expect(autoCategorize('Random Shop')).toBe('Other');
    expect(autoCategorize('ABC Ltd')).toBe('Other');
  });
  test('null/empty → Other', () => {
    expect(autoCategorize(null)).toBe('Other');
    expect(autoCategorize('')).toBe('Other');
  });
  test('case-insensitive', () => {
    expect(autoCategorize('NETFLIX')).toBe('Subscriptions');
    expect(autoCategorize('tesco')).toBe('Shopping');
  });
});

describe('isKnownRecurring', () => {
  test('known recurring', () => {
    expect(isKnownRecurring('Netflix')).toBe(true);
    expect(isKnownRecurring('EDF Energy')).toBe(true);
    expect(isKnownRecurring('Spotify')).toBe(true);
    expect(isKnownRecurring('Sky')).toBe(true);
  });
  test('non-recurring', () => {
    expect(isKnownRecurring('Tesco')).toBe(false);
    expect(isKnownRecurring('Random Shop')).toBe(false);
  });
  test('null/empty → false', () => {
    expect(isKnownRecurring(null)).toBe(false);
    expect(isKnownRecurring('')).toBe(false);
  });
  test('case-insensitive', () => {
    expect(isKnownRecurring('NETFLIX')).toBe(true);
    expect(isKnownRecurring('netflix')).toBe(true);
  });
});

describe('detectRecurringBills', () => {
  test('flags 2+ occurrences of same merchant+amount', () => {
    const txns = [
      { merchant: 'Netflix', amount_pennies: -1399, category: 'Subscriptions' },
      { merchant: 'Netflix', amount_pennies: -1399, category: 'Subscriptions' },
      { merchant: 'Tesco', amount_pennies: -5000, category: 'Shopping' },
    ];
    const recurring = detectRecurringBills(txns);
    expect(recurring).toHaveLength(1);
    expect(recurring[0].merchant).toBe('Netflix');
    expect(txns[0].is_recurring).toBe(true);
    expect(txns[1].is_recurring).toBe(true);
    expect(txns[2].is_recurring).toBeUndefined();
  });
  test('single occurrences not flagged', () => {
    const txns = [
      { merchant: 'Netflix', amount_pennies: -1399, category: 'Subscriptions' },
      { merchant: 'Tesco', amount_pennies: -5000, category: 'Shopping' },
    ];
    expect(detectRecurringBills(txns)).toHaveLength(0);
  });
  test('groups by exact amount', () => {
    const txns = [
      { merchant: 'Netflix', amount_pennies: -1399, category: 'Subscriptions' },
      { merchant: 'Netflix', amount_pennies: -1599, category: 'Subscriptions' },
    ];
    expect(detectRecurringBills(txns)).toHaveLength(0);
  });
  test('re-categorises Other → Bills for recurring items', () => {
    const txns = [
      { merchant: 'Unknown Co', amount_pennies: -5000, category: 'Other' },
      { merchant: 'Unknown Co', amount_pennies: -5000, category: 'Other' },
    ];
    detectRecurringBills(txns);
    expect(txns[0].category).toBe('Bills');
    expect(txns[1].category).toBe('Bills');
  });
  test('empty input', () => {
    expect(detectRecurringBills([])).toHaveLength(0);
  });
  test('multiple recurring groups', () => {
    const txns = [
      { merchant: 'Netflix', amount_pennies: -1399, category: 'Subscriptions' },
      { merchant: 'Netflix', amount_pennies: -1399, category: 'Subscriptions' },
      { merchant: 'Spotify', amount_pennies: -999, category: 'Subscriptions' },
      { merchant: 'Spotify', amount_pennies: -999, category: 'Subscriptions' },
    ];
    expect(detectRecurringBills(txns)).toHaveLength(2);
  });
});

describe('parseCSV', () => {
  test('parses a Nationwide-format CSV into pennies', () => {
    const csv = [
      'Account Name: Judah Current Account',
      'Account Balance: 1234.56',
      'Available Balance: 1000.00',
      '',
      'Date,Transaction type,Description,Paid out,Paid in,Balance',
      '07-Nov-25,Direct Debit,OCTOPUS ENERGY,"£125.00","","1234.56"',
      '08-Nov-25,Faster Payment,Employer,"","£3800.00","5034.56"',
      '10-Nov-25,Card Payment,TESCO STORES #1234,"£72.50","","4962.06"',
    ].join('\n');
    const result = parseCSV(csv, 'acct-1');
    expect(result.format).toBe('nationwide');
    expect(result.transactions.length).toBe(3);
    const [octopus, employer, tesco] = result.transactions;
    expect(octopus.merchant).toBe('Octopus Energy');
    expect(octopus.amount_pennies).toBe(-12500);
    expect(octopus.category).toBe('Bills');
    expect(employer.amount_pennies).toBe(380000);
    expect(tesco.merchant).toBe('Tesco');
    expect(tesco.amount_pennies).toBe(-7250);
  });

  test('rejects a File object with a helpful error', () => {
    expect(() => parseCSV({ not: 'a string' }, 'acct-1')).toThrow(/expects text/);
  });

  test('skips `#`-prefixed comment metadata emitted by the Claude statement flow', () => {
    // Matches the shape produced by docs/claude-statement-prompt.md v1.2.
    const csv = [
      '#bank: Virgin Money',
      '#account: Virgin Atlantic •••• 1130',
      '#account_type: credit_card',
      '#period_start: 2026-03-07',
      '#period_end: 2026-04-06',
      '#opening_balance: 2925.96',
      '#closing_balance: 3134.60',
      '#total_debits: 472.78',
      '#total_credits: 264.14',
      '#transaction_count: 3',
      '#balance_check: OK',
      '#credit_limit: 3200.00',
      '#available_to_spend: 65.40',
      'Date,Description,Amount',
      '2026-03-06,SQ *VICTOR VICTORIA CO Newmarket,-14.91',
      '2026-03-08,PAYMENT RECEIVED,200.00',
      '2026-04-06,INTEREST,-67.17',
    ].join('\n');
    const result = parseCSV(csv, 'acct-vm');
    expect(result.format).toBe('generic');
    expect(result.transactions.length).toBe(3);
    const [victor, payment, interest] = result.transactions;
    expect(victor.amount_pennies).toBe(-1491);
    expect(victor.description).toBe('SQ *VICTOR VICTORIA CO Newmarket');
    expect(payment.amount_pennies).toBe(20000);
    expect(interest.amount_pennies).toBe(-6717);
  });

  test('extracts `#`-prefixed metadata into result.metadata for the Import UI preview', () => {
    const csv = [
      '#bank: Virgin Money',
      '#account_type: credit_card',
      '#period_start: 2026-03-07',
      '#period_end: 2026-04-06',
      '#opening_balance: 2925.96',
      '#closing_balance: 3134.60',
      '#balance_check: OK',
      '#credit_limit: 3200.00',
      'Date,Description,Amount',
      '2026-03-08,PAYMENT RECEIVED,200.00',
    ].join('\n');
    const result = parseCSV(csv, 'acct-vm');
    expect(result.metadata).toEqual({
      bank: 'Virgin Money',
      account_type: 'credit_card',
      period_start: '2026-03-07',
      period_end: '2026-04-06',
      opening_balance: '2925.96',
      closing_balance: '3134.60',
      balance_check: 'OK',
      credit_limit: '3200.00',
    });
  });

  test('result.metadata is empty {} when no #-prefixed lines are present', () => {
    const csv = ['Date,Description,Amount', '2026-03-08,FOO,-10.00'].join('\n');
    const result = parseCSV(csv, 'acct-1');
    expect(result.metadata).toEqual({});
  });

  test('a `#` inside a transaction description does not get stripped', () => {
    // `#1234` appears in the TESCO merchant text — must survive the metadata stripper
    // because only lines *starting* with `#` are treated as comments.
    const csv = [
      '#bank: Acme',
      'Date,Description,Amount',
      '2026-03-15,TESCO STORES #1234 NEWMARKET,-42.18',
    ].join('\n');
    const result = parseCSV(csv, 'acct-1');
    expect(result.transactions.length).toBe(1);
    // The #1234 is stripped by normalizeMerchant's #-digits rule, but the
    // row itself survives — that's the only guarantee this test makes.
    expect(result.transactions[0].amount_pennies).toBe(-4218);
  });
});
