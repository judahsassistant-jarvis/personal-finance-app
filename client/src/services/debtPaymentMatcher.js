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

// A word that appears in this many distinct merchant strings (or more) is
// treated as a "weak" match signal — too common across the user's data to be
// reliable on its own. The matcher then requires at least one strong word OR
// 2+ weak words to overlap before suggesting a debt. Calibrated for typical
// 2a dogfood (a few months of transactions across 2-3 accounts): 'paypal'
// appears in ~7 distinct merchants once PayPal-prefixed parsing is live, so
// it's weak; 'barclaycard' / 'zopa' / 'klarna' each appear in 1-3 merchants,
// so they stay strong.
const WEAK_WORD_DISTINCT_MERCHANT_THRESHOLD = 4;

// Words that commonly appear in bank-statement merchant strings as labels
// rather than as the actual merchant — e.g. "HALIFAX CREDIT CARD" where the
// user's debt is "Halifax Clarity". These don't disqualify a brand-only match
// when present in the merchant but absent from the debt name.
//
// 'credit' is included deliberately: it's the natural distinguishing word for
// "PayPal Credit" debts but it also legitimately appears as a transaction
// label on Halifax/Amex/etc. card-payment rows. The specificity guard relies
// on the OTHER merchant words (Steam, Dropbox, etc.) to reject false matches
// from the new PayPal-prefixed format.
const GENERIC_MERCHANT_WORDS = new Set([
  'payment', 'payments', 'debit', 'credit', 'account', 'accounts',
  'online', 'services', 'service', 'group', 'holdings',
  'transfer', 'direct', 'card', 'cards', 'limited',
]);

/**
 * @param {Object} transaction
 * @param {Array} debts
 * @param {Object} [opts]
 * @param {Map<string, number>} [opts.wordFrequencies] - word → count of distinct
 *   merchant strings the word appears in across the user's transaction set.
 *   When provided, the matcher down-weights words that span many merchants
 *   (e.g. 'paypal' across PayPal Credit + PayPal: Steam + PayPal: Dropbox).
 *   Compute via `computeMerchantWordFrequencies(transactions)`. Without it,
 *   all matched words are treated as strong (legacy behaviour).
 */
export function suggestDebtForTransaction(transaction, debts, opts = {}) {
  if (!transaction || !Array.isArray(debts) || debts.length === 0) return null;
  const amount = Number(transaction.amount_pennies || 0);
  if (amount >= 0) return null;

  const merchantWords = normaliseWords(transaction.merchant);
  if (merchantWords.size === 0) return null;
  const wordFrequencies = opts.wordFrequencies;

  let best = null;
  let bestScore = 0;
  for (const debt of debts) {
    const debtWords = normaliseWords(debt?.name);
    // Specificity guard: if the merchant carries a "specific" word (≥4 chars,
    // all letters, not generic) that's NOT in the debt name, the merchant is
    // probably not this debt. Without this, "PayPal: Steam" matches a
    // "PayPal Credit" debt purely on the shared 'paypal' prefix.
    if (hasUnmatchedSpecificWord(merchantWords, debtWords)) continue;
    let score = 0;
    let strongMatches = 0;
    let weakMatches = 0;
    for (const w of debtWords) {
      if (w.length < MIN_WORD_LEN) continue;
      if (!merchantWords.has(w)) continue;
      score += w.length;
      const freq = wordFrequencies?.get(w) ?? 0;
      if (freq >= WEAK_WORD_DISTINCT_MERCHANT_THRESHOLD) weakMatches += 1;
      else strongMatches += 1;
    }
    // Frequency-aware floor: at least one strong word, OR 2+ weak words. A
    // single weak overlap (just 'paypal' against debt 'PayPal Credit') is
    // suppressed — the user's other PayPal-prefixed merchants would all
    // otherwise spuriously match.
    if (strongMatches === 0 && weakMatches < 2) continue;
    if (score > bestScore) {
      bestScore = score;
      best = debt;
    }
  }
  if (!best) return null;
  return { debtId: best.id, confidence: bestScore };
}

/**
 * Build a word → distinct-merchant-count map across the user's transactions.
 * Pre-computed once per render and passed into `suggestDebtForTransaction` /
 * `suggestTagsForUntagged` so the matcher can down-weight words that span
 * many distinct merchants.
 *
 * @param {Array} transactions
 * @returns {Map<string, number>}
 */
export function computeMerchantWordFrequencies(transactions) {
  const wordToMerchants = new Map();
  for (const t of transactions || []) {
    const merchant = (t?.merchant || '').toLowerCase();
    if (!merchant) continue;
    const words = normaliseWords(merchant);
    for (const w of words) {
      if (w.length < MIN_WORD_LEN) continue;
      if (!wordToMerchants.has(w)) wordToMerchants.set(w, new Set());
      wordToMerchants.get(w).add(merchant);
    }
  }
  const out = new Map();
  for (const [w, merchants] of wordToMerchants) out.set(w, merchants.size);
  return out;
}

function hasUnmatchedSpecificWord(merchantWords, debtWords) {
  for (const w of merchantWords) {
    if (w.length < MIN_WORD_LEN) continue;
    if (debtWords.has(w)) continue;
    if (GENERIC_MERCHANT_WORDS.has(w)) continue;
    // ID-like tokens (contain a digit) are reference numbers, not real
    // merchant names — never disqualifying.
    if (!/^[a-z]+$/.test(w)) continue;
    return true;
  }
  return false;
}

/**
 * Build a { transactionId → suggestedDebtId } map for every *untagged* outflow
 * in the list. Skips already-tagged rows so callers can use this as "what
 * should I prompt the user to confirm?".
 */
export function suggestTagsForUntagged(transactions, debts) {
  const wordFrequencies = computeMerchantWordFrequencies(transactions);
  const out = new Map();
  for (const t of transactions || []) {
    if (t.debt_id) continue;
    const suggestion = suggestDebtForTransaction(t, debts, { wordFrequencies });
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
