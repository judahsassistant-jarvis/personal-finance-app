/**
 * CSV parser — browser-safe.
 *
 * Phase 1 parsed files from disk and persisted via Sequelize. In Phase 2 the
 * browser reads the File itself (FileReader or File.text()), passes the text
 * here, and the caller (Redux thunk) batch-writes to Firestore. No IO here.
 *
 * Monetary values: parses input strings as pounds (what banks export), then
 * converts to integer pennies for storage. The Phase 1 pounds-as-decimals
 * output shape is gone.
 */

import Papa from 'papaparse';
import { poundsToPennies } from '../firebase/schema.js';

// ---------------------------------------------------------------------------
// Merchant normalisation
// ---------------------------------------------------------------------------

const MERCHANT_MAP = {
  TESCO: 'Tesco',
  'TESCO STORES': 'Tesco',
  'ESCO STORES': 'Tesco',
  SAINSBURY: 'Sainsburys',
  'EDF ENERGY': 'EDF Energy',
  'FUSE ENERGY': 'Fuse Energy',
  'OCTOPUS ENERGY': 'Octopus Energy',
  NETFLIX: 'Netflix',
  'DISNEY+': 'Disney+',
  SPOTIFY: 'Spotify',
  'BT GROUP': 'BT',
  VIRGIN: 'Virgin',
  'VIRGIN MONEY': 'Virgin Money',
  AMEX: 'Amex',
  'UBER EATS': 'Uber Eats',
  'UBER *EATS': 'Uber Eats',
  'UBER *ONE': 'Uber One',
  'UBER *TRIP': 'Uber',
  UBER: 'Uber',
  APPLE: 'Apple',
  MICROSOFT: 'Microsoft',
  GOOGLE: 'Google',
  'GOOGLE PLAY': 'Google Play',
  'GOOGLE YOUTUBE': 'YouTube',
  EXPERIAN: 'Experian',
  COINBASE: 'Coinbase',
  'SKY DIGITAL': 'Sky',
  'DGI SKY PROTECT': 'Sky Protect',
  O2: 'O2',
  MCDONALDS: 'McDonalds',
  'BURGER KING': 'Burger King',
  'LORDS PHARMACY': 'Lords Pharmacy',
  PAYPAL: 'PayPal',
  STEAM: 'Steam',
  'OPENAI *CHATGPT': 'OpenAI ChatGPT',
  'UTILITY WAREHOUSE': 'Utility Warehouse',
  HALFORDS: 'Halfords',
  ZABLE: 'Zable',
  'TK MAXX': 'TK Maxx',
  'T K MAXX': 'TK Maxx',
  SAMSUNGFINANCEGLOW: 'Samsung Finance',
  SUPERDRUG: 'Superdrug',
  'COSTA COFFEE': 'Costa Coffee',
  DROPBOX: 'Dropbox',
  BOOTS: 'Boots',
  SHELL: 'Shell',
  NCP: 'NCP Parking',
  ZOPA: 'Zopa',
  'ESURE MOTOR': 'Esure Motor',
  DVLA: 'DVLA',
  CURRYS: 'Currys',
  'JPMORGAN CHASE': 'JPMorgan Chase',
  JPMORGAN: 'JPMorgan Chase',
  VANGUARD: 'Vanguard',
  'HARGREAVES LANSDOWN': 'Hargreaves Lansdown',
  'AJ BELL': 'AJ Bell',
  'TRADING 212': 'Trading 212',
  T212: 'Trading 212',
  FIDELITY: 'Fidelity',
  'INTERACTIVE INVESTOR': 'Interactive Investor',
  'INTERACTIVE BROKERS': 'Interactive Brokers',
};

export function normalizeMerchant(rawMerchant) {
  if (!rawMerchant) return 'Unknown';
  const cleaned = rawMerchant
    .replace(/[#]\d{4,}/g, '')
    .replace(/\s+\d{6,}/g, '')
    .replace(/\s+(GB|UK|US|IE|GBR|USA)\s*\d*/gi, '')
    .replace(/\s+\d{4}$/, '')
    .trim();

  // PayPal-mediated transactions arrive as `PAYPAL *<inner>`. Without special-
  // casing, every one collapses to bare 'PayPal' and the underlying merchant is
  // lost. The `PAYPAL *PAYPAL CREDIT` line is the credit-account repayment
  // (a debt) — kept as a flat 'PayPal Credit' so debtPaymentMatcher can fuzzy-
  // tag it. Everything else gets prefixed: `PayPal: Steam`, `PayPal: Dropbox`.
  const paypalMatch = cleaned.match(/^PAYPAL\s*\*\s*(.+)$/i);
  if (paypalMatch) {
    const inner = paypalMatch[1].trim();
    if (/^PAYPAL\s+CREDIT/i.test(inner)) return 'PayPal Credit';
    const innerNormalised = normalizeMerchant(inner);
    return innerNormalised === 'Unknown' ? 'PayPal' : `PayPal: ${innerNormalised}`;
  }

  const upper = cleaned.toUpperCase();
  const sortedKeys = Object.keys(MERCHANT_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (upper.includes(key.toUpperCase())) return MERCHANT_MAP[key];
  }
  return cleaned
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .substring(0, 255);
}

// ---------------------------------------------------------------------------
// Auto-categorisation
// ---------------------------------------------------------------------------

const CATEGORY_RULES = {
  Health: ['Lords Pharmacy', 'Boots Pharmacy', 'NHS'],
  Food: ['Uber Eats', 'Deliveroo', 'Just Eat', 'McDonalds', 'Burger King', 'KFC', 'Nandos', 'Costa Coffee', 'Starbucks', 'Greggs', 'Subway'],
  Bills: ['EDF Energy', 'Fuse Energy', 'Octopus Energy', 'BT', 'Virgin', 'Utility Warehouse', 'Thames Water', 'Council Tax', 'TV Licence', 'Sky', 'Sky Protect'],
  Subscriptions: ['Netflix', 'Disney+', 'Spotify', 'Amazon Prime', 'YouTube', 'Apple', 'Dropbox', 'OpenAI ChatGPT', 'Uber One', 'Experian', 'Google Play'],
  Transport: ['Uber', 'Shell', 'BP', 'Esso', 'NCP Parking', 'TfL', 'DVLA', 'RAC'],
  Insurance: ['Esure', 'Aviva', 'AXA', 'Admiral', 'Direct Line', 'LV=', 'Liverpool Victoria', 'AA Insurance', 'Hastings Direct', 'More Than'],
  Income: ['HMRC', 'Tax Refund', 'Salary'],
  Charity: [],
  Shopping: ['Tesco', 'Sainsburys', 'Asda', 'Aldi', 'Lidl', 'Morrisons', 'Waitrose', 'M&S', 'TK Maxx', 'Primark', 'Argos', 'Amazon', 'Currys', 'Halfords', 'Superdrug', 'Boots', 'Zable'],
  Cash: ['ATM', 'NoteMachine', 'LINK', 'Cashpoint', 'Cash Withdrawal'],
  Payments: ['Nationwide', 'Virgin Money', 'Amex', 'Zopa', 'Samsung Finance', 'PayPal Credit'],
  Investment: ['JPMorgan Chase', 'Vanguard', 'Hargreaves Lansdown', 'AJ Bell', 'Trading 212', 'Fidelity', 'Coinbase', 'Interactive Investor', 'Interactive Brokers'],
  // Transfer is intentionally empty — "Payment from <person>" patterns are too
  // varied to safely auto-rule (could be income, gift, repayment, transfer
  // from own account). User tags manually + creates personal rules.
  Transfer: [],
};

/**
 * Built-in categories surfaced in the Transactions UI category picker. User-
 * defined custom categories are merged on top in the UI (see
 * mergedCategories in Transactions.jsx).
 *
 * Order matters — drives dropdown order. "Debt Payment" is special-cased:
 * applied automatically when a transaction is tagged to a debt, never
 * user-selected from this list.
 */
export const KNOWN_CATEGORIES = [
  'Bills',
  'Cash',
  'Charity',
  'Food',
  'Health',
  'Income',
  'Insurance',
  'Investment',
  'Payments',
  'Shopping',
  'Subscriptions',
  'Transfer',
  'Transport',
  'Other',
];

/**
 * Pick a category for a merchant.
 *
 * `userRules`, when supplied, takes precedence over the hardcoded list. Each
 * rule is `{merchant, category}`; the match is exact (case-insensitive) on
 * the normalised merchant name. The first matching rule wins. Falling through
 * to the hardcoded `CATEGORY_RULES` keeps Phase 2a's defaults working for
 * unknown merchants without forcing the user to write a rule for everything.
 *
 * @param {string} merchantName - normalised merchant name
 * @param {Array<{merchant: string, category: string}>} [userRules]
 */
export function autoCategorize(merchantName, userRules = []) {
  if (!merchantName) return 'Other';
  const upperMerchant = merchantName.toUpperCase();

  for (const rule of userRules) {
    if (!rule?.merchant || !rule?.category) continue;
    if (rule.merchant.toUpperCase() === upperMerchant) return rule.category;
  }

  const allMappings = [];
  for (const [category, merchants] of Object.entries(CATEGORY_RULES)) {
    for (const m of merchants) allMappings.push({ merchant: m, category });
  }
  allMappings.sort((a, b) => b.merchant.length - a.merchant.length);
  for (const { merchant, category } of allMappings) {
    if (upperMerchant.includes(merchant.toUpperCase())) return category;
  }
  return 'Other';
}

const KNOWN_RECURRING = [
  'EDF Energy', 'Fuse Energy', 'Octopus Energy', 'BT', 'Virgin', 'Sky', 'Sky Protect',
  'Netflix', 'Disney+', 'Spotify', 'Utility Warehouse', 'O2', 'Uber One', 'Experian',
  'OpenAI ChatGPT', 'Dropbox', 'Apple', 'Samsung Finance', 'Zopa', 'Esure Motor', 'Council Tax',
];

export function isKnownRecurring(merchantName) {
  if (!merchantName) return false;
  const upper = merchantName.toUpperCase();
  return KNOWN_RECURRING.some((m) => upper.includes(m.toUpperCase()));
}

/**
 * Detect recurring bills by grouping transactions with same merchant+amount (2+ occurrences).
 * Mutates transactions in place: sets is_recurring=true and promotes Other → Bills.
 */
export function detectRecurringBills(transactions) {
  const groups = {};
  for (const t of transactions) {
    const key = `${(t.merchant || '').toLowerCase()}|${t.amount_pennies}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  const recurring = [];
  for (const txns of Object.values(groups)) {
    if (txns.length >= 2) {
      for (const t of txns) {
        t.is_recurring = true;
        if (t.category === 'Other') t.category = 'Bills';
      }
      recurring.push({ merchant: txns[0].merchant, amount_pennies: txns[0].amount_pennies, count: txns.length });
    }
  }
  return recurring;
}

// ---------------------------------------------------------------------------
// Date / amount parsing
// ---------------------------------------------------------------------------

export function parseDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();

  const ukMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (ukMatch) {
    return `${ukMatch[3]}-${ukMatch[2].padStart(2, '0')}-${ukMatch[1].padStart(2, '0')}`;
  }
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  const monMatch = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (monMatch) {
    const months = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mon = months[monMatch[2].toLowerCase()];
    const year = parseInt(monMatch[3], 10) > 50 ? `19${monMatch[3]}` : `20${monMatch[3]}`;
    return `${year}-${mon}-${monMatch[1].padStart(2, '0')}`;
  }
  return null;
}

/** Parse currency string to pounds (float). Converting to pennies is the caller's job. */
export function parseAmount(amountStr) {
  if (amountStr === undefined || amountStr === null || amountStr === '') return 0;
  const cleaned = String(amountStr)
    .replace(/[££$€,\s]/g, '')
    .replace(/[()]/g, '')
    .trim();
  if (cleaned === '' || cleaned === '-') return 0;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// ---------------------------------------------------------------------------
// Format detection + row parsing
// ---------------------------------------------------------------------------

export function detectFormat(headers) {
  const lower = headers.map((h) => h.toLowerCase().trim());
  if (lower.includes('transaction type') && lower.includes('paid out')) return 'nationwide';
  if (lower.includes('started date') && lower.includes('completed date') && lower.includes('state')) return 'revolut';
  if (lower.includes('billing amount') && lower.includes('debit or credit')) return 'virgin_money';
  if (lower.includes('debit') && lower.includes('credit')) return 'bank_with_balance';
  return 'generic';
}

function parseRow(row, format, headers) {
  const get = (name) => {
    const idx = headers.findIndex((h) => h.toLowerCase().trim() === name.toLowerCase());
    return idx >= 0 ? (row[idx] || '').trim() : '';
  };

  switch (format) {
    case 'nationwide': {
      const paidOut = parseAmount(get('Paid out'));
      const paidIn = parseAmount(get('Paid in'));
      const amount = paidIn > 0 ? paidIn : -paidOut;
      return {
        date: parseDate(get('Date')),
        merchant: normalizeMerchant(get('Description')),
        description: get('Description'),
        amount,
      };
    }
    case 'revolut': {
      const state = get('State');
      if (state && state.toUpperCase() === 'REVERTED') return null;
      return {
        date: parseDate(get('Completed Date') || get('Started Date')),
        merchant: normalizeMerchant(get('Description')),
        description: `${get('Type')}: ${get('Description')}`,
        amount: parseAmount(get('Amount')),
      };
    }
    case 'virgin_money': {
      const direction = get('Debit or Credit');
      let amount = parseAmount(get('Billing Amount'));
      if (direction === 'DBIT') amount = -Math.abs(amount);
      if (direction === 'CRDT') amount = Math.abs(amount);
      return {
        date: parseDate(get('Transaction Date')),
        merchant: normalizeMerchant(get('Merchant')),
        description: `${get('Merchant')} - ${get('Merchant City') || ''}`.trim(),
        amount,
      };
    }
    default: {
      const dateVal = get('Date') || get('Transaction Date');
      const desc = get('Description') || get('Merchant') || '';
      const amountVal = get('Amount');
      return {
        date: parseDate(dateVal),
        merchant: normalizeMerchant(desc),
        description: desc,
        amount: parseAmount(amountVal),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Parse a CSV file's text content.
 *
 * @param {string} fileContent - full CSV text
 * @param {string} accountId - Firestore account id the transactions belong to
 * @param {Object} [opts]
 * @param {string} [opts.importBatchId] - tag all transactions with this batch id
 * @returns {{format: string, batch_id: string, transactions: Object[], recurring_bills: Object[], total_debit_pennies: number, total_credit_pennies: number, count: number}}
 */
export function parseCSV(fileContent, accountId, { importBatchId, userRules = [] } = {}) {
  if (typeof fileContent !== 'string') {
    throw new Error('parseCSV expects text content, not a File object. Use file.text() first.');
  }

  // Strip UTF-8 BOM
  let content = fileContent.charCodeAt(0) === 0xfeff ? fileContent.slice(1) : fileContent;

  // Strip pre-header metadata rows. Covers Nationwide's export format
  // ("Account Name:" / "Account Balance:" / "Available Balance:") and any
  // `#`-prefixed comment lines emitted by the Claude-statement flow
  // (see docs/claude-statement-prompt.md). Stops at the first non-matching
  // line — a data row starting with a date won't accidentally be skipped.
  // The `#`-prefixed lines also get parsed into a metadata object so the
  // Import UI can show #balance_check, #bank, etc. in the preview pane.
  const lines = content.split('\n');
  let startIdx = 0;
  const MAX_METADATA_LINES = 50;
  const metadata = {};
  for (let i = 0; i < Math.min(lines.length, MAX_METADATA_LINES); i++) {
    const line = lines[i].trim();
    if (line.startsWith('#')) {
      const match = line.match(/^#([\w_]+):\s*(.*)$/);
      if (match) metadata[match[1]] = match[2].trim();
      startIdx = i + 1;
    } else if (
      line.startsWith('Account Name:') ||
      line.startsWith('Account Balance:') ||
      line.startsWith('Available Balance:') ||
      line === '' ||
      line === ',,,,,'
    ) {
      startIdx = i + 1;
    } else {
      break;
    }
  }
  content = lines.slice(startIdx).join('\n');

  const parsed = Papa.parse(content, {
    header: false,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
  }

  const headers = parsed.data[0];
  const format = detectFormat(headers);
  const batchId = importBatchId || cryptoRandomId();
  const transactions = [];

  for (let i = 1; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    if (row.every((cell) => !cell || cell.trim() === '')) continue;
    const result = parseRow(row, format, headers);
    if (!result || !result.date) continue;

    const autoCategory = autoCategorize(result.merchant, userRules);
    const autoRecurring = isKnownRecurring(result.merchant);
    const amountPennies = poundsToPennies(result.amount);
    // Dedup key uses the RAW description (not the normalised merchant) so it
    // stays stable across MERCHANT_MAP changes — see audit Gap 1. account_id +
    // ISO date + integer amount + raw description is the natural composite
    // key for "is this the same row I already imported?"
    const dedupKey = computeDedupKey(accountId, result.date, amountPennies, result.description);

    transactions.push({
      account_id: accountId,
      date: result.date, // ISO string; caller converts to Firestore Timestamp
      merchant: result.merchant,
      description: result.description,
      amount_pennies: amountPennies,
      category: autoCategory,
      suggested_category: autoCategory,
      is_recurring: autoRecurring,
      imported_from: format === 'generic' ? 'csv' : format,
      import_batch_id: batchId,
      dedup_key: dedupKey,
    });
  }

  const recurringBills = detectRecurringBills(transactions);

  return {
    format,
    batch_id: batchId,
    count: transactions.length,
    total_debit_pennies: transactions
      .filter((t) => t.amount_pennies < 0)
      .reduce((s, t) => s + Math.abs(t.amount_pennies), 0),
    total_credit_pennies: transactions
      .filter((t) => t.amount_pennies > 0)
      .reduce((s, t) => s + t.amount_pennies, 0),
    recurring_bills: recurringBills,
    metadata,
    transactions,
  };
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Dedup key (audit Gap 1: re-import deduplication)
// ---------------------------------------------------------------------------

/**
 * Deterministic key for "is this row already imported?" lookups. Composed of
 * account_id + ISO date + integer amount + a hash of the raw description.
 * The raw description (not normalised merchant) is hashed so the key stays
 * stable when MERCHANT_MAP changes.
 *
 * Pure FNV-1a 64-bit (concatenation of two 32-bit hashes with different seeds)
 * → 16 hex chars. Sync, no Web Crypto dependency. Collision probability across
 * the dedup space (per-account, per-day, per-amount) is effectively zero at
 * personal-finance dataset scale.
 *
 * Stored on each transaction as `dedup_key`. Queryable via the
 * `(user_id, dedup_key)` composite index for partitioning re-imported rows
 * into new vs duplicate.
 *
 * @param {string} accountId
 * @param {string} isoDate - YYYY-MM-DD
 * @param {number} amountPennies - integer; signed
 * @param {string} description - raw description from the CSV
 * @returns {string} 16-hex-char composite key
 */
export function computeDedupKey(accountId, isoDate, amountPennies, description) {
  const composite = `${accountId || ''}|${isoDate || ''}|${amountPennies | 0}|${description || ''}`;
  return fnv1a32(composite, 0x811c9dc5).toString(16).padStart(8, '0')
       + fnv1a32(composite, 0xa5a5a5a5).toString(16).padStart(8, '0');
}

function fnv1a32(str, seed) {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
