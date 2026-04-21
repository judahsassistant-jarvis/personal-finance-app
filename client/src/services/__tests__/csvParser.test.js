import { describe, test, expect } from 'vitest';
import {
  normalizeMerchant,
  parseDate,
  detectFormat,
  autoCategorize,
  isKnownRecurring,
  detectRecurringBills,
  parseCSV,
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
});
