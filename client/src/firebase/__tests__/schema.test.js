import { describe, test, expect, vi } from 'vitest';

// Stub firebase/firestore.serverTimestamp to a sentinel — the factory we're
// testing only stamps it onto the doc; the runtime value doesn't matter.
vi.mock('firebase/firestore', () => ({
  serverTimestamp: () => '__SERVER_TS__',
}));

const { newImportBatchDoc } = await import('../schema.js');

describe('newImportBatchDoc', () => {
  test('produces minimal doc with computed defaults', () => {
    const doc = newImportBatchDoc({
      user_id: 'u1',
      account_id: 'a1',
      count: 12,
      format: 'nationwide',
    });
    expect(doc).toEqual({
      user_id: 'u1',
      account_id: 'a1',
      count: 12,
      skipped: 0,
      total_debit_pennies: 0,
      total_credit_pennies: 0,
      format: 'nationwide',
      imported_at: '__SERVER_TS__',
    });
  });

  test('pulls recognised metadata fields onto the doc as top-level columns', () => {
    const doc = newImportBatchDoc({
      user_id: 'u1',
      account_id: 'a1',
      count: 5,
      total_debit_pennies: 12345,
      total_credit_pennies: 50000,
      format: 'revolut',
      metadata: {
        bank: 'Revolut',
        account: 'Revolut GBP Account (sort 04-00-75, acct 14988925)',
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        balance_check: 'OK',
        source_email_subject: '[PFA] Revolut',
        unrecognised_key: 'should be dropped',
      },
    });
    expect(doc.bank).toBe('Revolut');
    expect(doc.account).toBe('Revolut GBP Account (sort 04-00-75, acct 14988925)');
    expect(doc.period_start).toBe('2026-04-01');
    expect(doc.period_end).toBe('2026-04-30');
    expect(doc.balance_check).toBe('OK');
    expect(doc.source_email_subject).toBe('[PFA] Revolut');
    expect(doc).not.toHaveProperty('unrecognised_key');
  });

  test('omits metadata fields when they are absent / empty', () => {
    const doc = newImportBatchDoc({
      user_id: 'u1',
      account_id: 'a1',
      count: 1,
      format: 'nationwide',
      metadata: { bank: '', period_start: undefined },
    });
    expect(doc).not.toHaveProperty('bank');
    expect(doc).not.toHaveProperty('period_start');
  });

  test('historical flag set when explicitly requested', () => {
    const doc = newImportBatchDoc({
      user_id: 'u1',
      account_id: 'a1',
      count: 50,
      format: 'nationwide',
      historical: true,
    });
    expect(doc.historical).toBe(true);
  });

  test('historical flag absent by default (live imports do not set it)', () => {
    const doc = newImportBatchDoc({
      user_id: 'u1',
      account_id: 'a1',
      count: 1,
      format: 'nationwide',
    });
    expect(doc).not.toHaveProperty('historical');
  });

  test('coerces numeric fields defensively', () => {
    const doc = newImportBatchDoc({
      user_id: 'u1',
      account_id: 'a1',
      count: '12',
      skipped: '3',
      total_debit_pennies: '1234.5',
      total_credit_pennies: null,
      format: 'nationwide',
    });
    expect(doc.count).toBe(12);
    expect(doc.skipped).toBe(3);
    expect(doc.total_debit_pennies).toBe(1234.5);
    expect(doc.total_credit_pennies).toBe(0);
  });
});
