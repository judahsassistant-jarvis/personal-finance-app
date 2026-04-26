import { describe, test, expect } from 'vitest';
import { detectBankMismatch } from '../bankNameGuard.js';

describe('detectBankMismatch', () => {
  test('null when no metadata', () => {
    expect(detectBankMismatch(null, { name: 'Revolut Current' })).toBeNull();
    expect(detectBankMismatch({}, { name: 'Revolut Current' })).toBeNull();
  });

  test('null when metadata has no #bank field', () => {
    expect(detectBankMismatch({ account: 'foo' }, { name: 'Revolut Current' })).toBeNull();
  });

  test('null when no account selected', () => {
    expect(detectBankMismatch({ bank: 'Revolut' }, null)).toBeNull();
  });

  test('null when bank name shares a word with account name', () => {
    expect(detectBankMismatch({ bank: 'Revolut' }, { name: 'Revolut Current' })).toBeNull();
    expect(detectBankMismatch({ bank: 'Revolut' }, { name: 'My Revolut' })).toBeNull();
  });

  test('null when bank-name tokens overlap account-name tokens (multi-word bank names)', () => {
    expect(detectBankMismatch(
      { bank: 'Nationwide Building Society' },
      { name: 'Nationwide Current' },
    )).toBeNull();
  });

  test('flags mismatch when bank and account share no words', () => {
    const out = detectBankMismatch(
      { bank: 'Revolut' },
      { name: 'Nationwide Current' },
    );
    expect(out).toEqual({ statementBank: 'Revolut' });
  });

  test('case-insensitive matching', () => {
    expect(detectBankMismatch(
      { bank: 'REVOLUT' },
      { name: 'revolut current' },
    )).toBeNull();
  });

  test('punctuation in either name does not block matching', () => {
    expect(detectBankMismatch(
      { bank: 'JPMorgan Chase, N.A.' },
      { name: 'JPMorgan ISA' },
    )).toBeNull();
  });

  test('null when bank name is just whitespace', () => {
    expect(detectBankMismatch({ bank: '   ' }, { name: 'Revolut Current' })).toBeNull();
  });

  test('null when bank metadata yields no comparable tokens (all words < 4 chars)', () => {
    // We deliberately don't warn when we can't extract a meaningful comparison
    // word from the bank metadata — better than spamming the user when the
    // metadata format is too terse to be useful.
    expect(detectBankMismatch(
      { bank: 'BoS' },
      { name: 'Bank of Scotland Current' },
    )).toBeNull();
  });
});
