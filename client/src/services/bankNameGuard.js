/**
 * Wrong-account import guard (audit Gap 5).
 *
 * The Claude-statement metadata block emits `#bank: <name>`. When the user
 * picks an account at import time, we sanity-check that the metadata bank
 * shares at least one 4+ char word with the selected account name. If not,
 * the user has almost certainly picked the wrong account in the dropdown.
 *
 * Pure function. The Import UI calls this and renders an amber banner when
 * a mismatch is returned.
 */

/**
 * @param {Object} metadata - parsed `#`-prefixed metadata from parseCSV
 * @param {Object} account - AccountDoc with at least { name }
 * @returns {{ statementBank: string } | null}
 *   null when there's no mismatch (no metadata, no account, or names plausibly
 *   share a word). Otherwise returns the statement's bank name so the caller
 *   can render it in the warning.
 */
export function detectBankMismatch(metadata, account) {
  if (!metadata || !account) return null;
  const statementBank = String(metadata.bank || '').trim();
  if (!statementBank) return null;
  const bankTokens = wordSet(statementBank);
  if (bankTokens.size === 0) return null;
  const accountTokens = wordSet(account.name);
  for (const t of bankTokens) {
    if (accountTokens.has(t)) return null;
  }
  return { statementBank };
}

function wordSet(str) {
  return new Set(
    String(str || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  );
}
