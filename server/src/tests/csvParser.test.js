const { normalizeMerchant, parseDate, detectFormat, autoCategorize, detectRecurringBills, isKnownRecurring } = require('../services/csvParser');

describe('CSV Parser - Pure Functions', () => {
  describe('normalizeMerchant', () => {
    test('normalizes known merchants', () => {
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
      const result = normalizeMerchant('RANDOM SHOP NAME');
      expect(result).toBe('Random Shop Name');
    });

    test('handles null/empty input', () => {
      expect(normalizeMerchant(null)).toBe('Unknown');
      expect(normalizeMerchant('')).toBe('Unknown');
      expect(normalizeMerchant(undefined)).toBe('Unknown');
    });

    test('handles merchants with long trailing numbers', () => {
      expect(normalizeMerchant('SAINSBURY 123456')).toBe('Sainsburys');
    });

    test('matches longest key first', () => {
      // 'TESCO STORES' should match before 'TESCO'
      expect(normalizeMerchant('TESCO STORES LTD')).toBe('Tesco');
    });

    test('normalizes Uber variants', () => {
      expect(normalizeMerchant('UBER *TRIP LONDON')).toBe('Uber');
      expect(normalizeMerchant('UBER *EATS ORDER')).toBe('Uber Eats');
      expect(normalizeMerchant('UBER *ONE SUB')).toBe('Uber One');
    });
  });

  describe('parseDate', () => {
    test('parses UK format DD/MM/YYYY', () => {
      expect(parseDate('15/02/2026')).toBe('2026-02-15');
    });

    test('parses UK format with time', () => {
      expect(parseDate('15/02/2026 14:30')).toBe('2026-02-15');
    });

    test('parses ISO format YYYY-MM-DD', () => {
      expect(parseDate('2026-02-15')).toBe('2026-02-15');
    });

    test('parses Nationwide format DD-Mon-YY', () => {
      expect(parseDate('07-Nov-25')).toBe('2025-11-07');
      expect(parseDate('15-Feb-26')).toBe('2026-02-15');
    });

    test('parses DD-MM-YYYY with dashes', () => {
      expect(parseDate('15-02-2026')).toBe('2026-02-15');
    });

    test('handles single-digit day/month', () => {
      expect(parseDate('1/2/2026')).toBe('2026-02-01');
    });

    test('returns null for empty/null input', () => {
      expect(parseDate(null)).toBe(null);
      expect(parseDate('')).toBe(null);
      expect(parseDate(undefined)).toBe(null);
    });

    test('returns null for unparseable date', () => {
      expect(parseDate('not a date')).toBe(null);
    });

    test('handles whitespace', () => {
      expect(parseDate('  15/02/2026  ')).toBe('2026-02-15');
    });
  });

  describe('detectFormat', () => {
    test('detects Nationwide format', () => {
      expect(detectFormat(['Date', 'Transaction type', 'Description', 'Paid out', 'Paid in', 'Balance']))
        .toBe('nationwide');
    });

    test('detects Revolut format', () => {
      expect(detectFormat(['Type', 'Product', 'Started Date', 'Completed Date', 'Description', 'Amount', 'Fee', 'Currency', 'State', 'Balance']))
        .toBe('revolut');
    });

    test('detects Virgin Money format', () => {
      expect(detectFormat(['Transaction Date', 'Posting Date', 'Billing Amount', 'Merchant', 'Debit or Credit']))
        .toBe('virgin_money');
    });

    test('detects bank with debit/credit columns', () => {
      expect(detectFormat(['Date', 'Description', 'Debit', 'Credit', 'Balance']))
        .toBe('bank_with_balance');
    });

    test('falls back to generic format', () => {
      expect(detectFormat(['Date', 'Amount', 'Description']))
        .toBe('generic');
    });

    test('is case-insensitive', () => {
      expect(detectFormat(['date', 'TRANSACTION TYPE', 'Description', 'PAID OUT', 'Paid In', 'Balance']))
        .toBe('nationwide');
    });
  });

  describe('autoCategorize', () => {
    test('categorizes supermarkets as Shopping', () => {
      expect(autoCategorize('Tesco')).toBe('Shopping');
      expect(autoCategorize('Sainsburys')).toBe('Shopping');
    });

    test('categorizes food delivery as Food', () => {
      expect(autoCategorize('Uber Eats')).toBe('Food');
      expect(autoCategorize('McDonalds')).toBe('Food');
    });

    test('categorizes energy providers as Bills', () => {
      expect(autoCategorize('EDF Energy')).toBe('Bills');
      expect(autoCategorize('BT')).toBe('Bills');
    });

    test('categorizes streaming services as Subscriptions', () => {
      expect(autoCategorize('Netflix')).toBe('Subscriptions');
      expect(autoCategorize('Spotify')).toBe('Subscriptions');
      expect(autoCategorize('Disney+')).toBe('Subscriptions');
    });

    test('categorizes transport', () => {
      expect(autoCategorize('Uber')).toBe('Transport');
      expect(autoCategorize('Shell')).toBe('Transport');
    });

    test('categorizes payments', () => {
      expect(autoCategorize('Amex')).toBe('Payments');
      expect(autoCategorize('Zopa')).toBe('Payments');
    });

    test('categorizes health merchants', () => {
      expect(autoCategorize('Lords Pharmacy')).toBe('Health');
      expect(autoCategorize('Boots Pharmacy')).toBe('Health');
      expect(autoCategorize('NHS')).toBe('Health');
    });

    test('returns Other for unknown merchants', () => {
      expect(autoCategorize('Random Shop')).toBe('Other');
      expect(autoCategorize('ABC Ltd')).toBe('Other');
    });

    test('handles null/empty input', () => {
      expect(autoCategorize(null)).toBe('Other');
      expect(autoCategorize('')).toBe('Other');
    });

    test('is case-insensitive', () => {
      expect(autoCategorize('NETFLIX')).toBe('Subscriptions');
      expect(autoCategorize('tesco')).toBe('Shopping');
    });
  });

  describe('isKnownRecurring', () => {
    test('identifies known recurring merchants', () => {
      expect(isKnownRecurring('Netflix')).toBe(true);
      expect(isKnownRecurring('EDF Energy')).toBe(true);
      expect(isKnownRecurring('Spotify')).toBe(true);
      expect(isKnownRecurring('Sky')).toBe(true);
    });

    test('returns false for non-recurring merchants', () => {
      expect(isKnownRecurring('Tesco')).toBe(false);
      expect(isKnownRecurring('Random Shop')).toBe(false);
    });

    test('handles null/empty input', () => {
      expect(isKnownRecurring(null)).toBe(false);
      expect(isKnownRecurring('')).toBe(false);
    });

    test('is case-insensitive', () => {
      expect(isKnownRecurring('NETFLIX')).toBe(true);
      expect(isKnownRecurring('netflix')).toBe(true);
    });
  });

  describe('detectRecurringBills', () => {
    test('flags transactions appearing 2+ times with same merchant and amount', () => {
      const transactions = [
        { merchant: 'Netflix', amount: -13.99, category: 'Subscriptions' },
        { merchant: 'Netflix', amount: -13.99, category: 'Subscriptions' },
        { merchant: 'Tesco', amount: -50, category: 'Shopping' },
      ];
      const recurring = detectRecurringBills(transactions);
      expect(recurring).toHaveLength(1);
      expect(recurring[0].merchant).toBe('Netflix');
      expect(transactions[0].is_recurring_bill).toBe(true);
      expect(transactions[1].is_recurring_bill).toBe(true);
      expect(transactions[2].is_recurring_bill).toBeUndefined();
    });

    test('does not flag single occurrences', () => {
      const transactions = [
        { merchant: 'Netflix', amount: -13.99, category: 'Subscriptions' },
        { merchant: 'Tesco', amount: -50, category: 'Shopping' },
      ];
      const recurring = detectRecurringBills(transactions);
      expect(recurring).toHaveLength(0);
    });

    test('groups by exact amount', () => {
      const transactions = [
        { merchant: 'Netflix', amount: -13.99, category: 'Subscriptions' },
        { merchant: 'Netflix', amount: -15.99, category: 'Subscriptions' },
      ];
      const recurring = detectRecurringBills(transactions);
      expect(recurring).toHaveLength(0);
    });

    test('re-categorizes "Other" to "Bills" for recurring items', () => {
      const transactions = [
        { merchant: 'Unknown Co', amount: -50, category: 'Other' },
        { merchant: 'Unknown Co', amount: -50, category: 'Other' },
      ];
      detectRecurringBills(transactions);
      expect(transactions[0].category).toBe('Bills');
      expect(transactions[1].category).toBe('Bills');
    });

    test('handles empty array', () => {
      const recurring = detectRecurringBills([]);
      expect(recurring).toHaveLength(0);
    });

    test('handles multiple recurring groups', () => {
      const transactions = [
        { merchant: 'Netflix', amount: -13.99, category: 'Subscriptions' },
        { merchant: 'Netflix', amount: -13.99, category: 'Subscriptions' },
        { merchant: 'Spotify', amount: -9.99, category: 'Subscriptions' },
        { merchant: 'Spotify', amount: -9.99, category: 'Subscriptions' },
      ];
      const recurring = detectRecurringBills(transactions);
      expect(recurring).toHaveLength(2);
    });
  });
});
