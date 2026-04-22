/**
 * Debt-payment matcher.
 *
 * Suggests a probable `debt_id` tag for a transaction based on fuzzy merchant-
 * to-debt-name matching. Pure function — no state, no Firestore, no network.
 *
 * Heuristic (deliberately simple for 2a dogfood):
 *   1. Reject inflows (amount_pennies ≥ 0) — debt payments are outflows.
 *   2. Normalise merchant + debt name to lowercase word sets, ignoring
 *      punctuation and any word shorter than 4 chars.
 *   3. For each debt, score = sum of character lengths of matching words.
 *   4. Return the highest-scoring debt (or null if no overlap).
 *
 * Works well for UK dogfood cases:
 *   "BARCLAYCARD"       → "Barclaycard Platinum"   (shared: barclaycard)
 *   "ZOPA LTD"          → "Zopa Personal Loan"     (shared: zopa)
 *   "KLARNA*SOFA"       → "Klarna Sofa Purchase"   (shared: klarna, sofa, purchase)
 *   "HALIFAX CC BP"     → "Halifax Clarity"        (shared: halifax)
 */

const MIN_WORD_LEN = 4;

export function suggestDebtForTransaction(transaction, debts) {
  if (!transaction || !Array.isArray(debts) || debts.length === 0) return null;
  const amount = Number(transaction.amount_pennies || 0);
  if (amount >= 0) return null;

  const merchantWords = normaliseWords(transaction.merchant);
  if (merchantWords.size === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const debt of debts) {
    const debtWords = normaliseWords(debt?.name);
    let score = 0;
    for (const w of debtWords) {
      if (w.length < MIN_WORD_LEN) continue;
      if (merchantWords.has(w)) score += w.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = debt;
    }
  }
  if (!best) return null;
  return { debtId: best.id, confidence: bestScore };
}

/**
 * Build a { transactionId → suggestedDebtId } map for every *untagged* outflow
 * in the list. Skips already-tagged rows so callers can use this as "what
 * should I prompt the user to confirm?".
 */
export function suggestTagsForUntagged(transactions, debts) {
  const out = new Map();
  for (const t of transactions || []) {
    if (t.debt_id) continue;
    const suggestion = suggestDebtForTransaction(t, debts);
    if (suggestion) out.set(t.id, suggestion.debtId);
  }
  return out;
}

function normaliseWords(str) {
  if (!str) return new Set();
  return new Set(
    String(str)
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}
