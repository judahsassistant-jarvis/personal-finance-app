const Papa = require('papaparse');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Transaction } = require('../models');

// Merchant name normalization map
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
};

function normalizeMerchant(rawMerchant) {
  if (!rawMerchant) return 'Unknown';
  // Strip store/branch numbers and clean up
  const cleaned = rawMerchant
    .replace(/[#]\d{4,}/g, '')
    .replace(/\s+\d{6,}/g, '')
    .replace(/\s+(GB|UK|US|IE|GBR|USA)\s*\d*/gi, '')
    .replace(/\s+\d{4}$/, '')
    .trim();

  // Check our normalization map (longest match first)
  const upperCleaned = cleaned.toUpperCase();
  const sortedKeys = Object.keys(MERCHANT_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (upperCleaned.includes(key.toUpperCase())) {
      return MERCHANT_MAP[key];
    }
  }

  // Title-case the cleaned name
  return cleaned
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .substring(0, 255);
}

// Auto-categorization rules based on merchant name
// Order matters: more specific entries checked first (longer matches before shorter)
const CATEGORY_RULES = {
  Health: ['Lords Pharmacy', 'Boots Pharmacy', 'NHS'],
  Food: ['Uber Eats', 'Deliveroo', 'Just Eat', 'McDonalds', 'Burger King', 'KFC', 'Nandos', 'Costa Coffee', 'Starbucks', 'Greggs', 'Subway'],
  Bills: ['EDF Energy', 'Fuse Energy', 'Octopus Energy', 'BT', 'Virgin', 'Utility Warehouse', 'Thames Water', 'Council Tax', 'TV Licence', 'Sky', 'Sky Protect'],
  Subscriptions: ['Netflix', 'Disney+', 'Spotify', 'Amazon Prime', 'YouTube', 'Apple', 'Dropbox', 'OpenAI ChatGPT', 'Uber One', 'Experian', 'Google Play'],
  Transport: ['Uber', 'Shell', 'BP', 'Esso', 'NCP Parking', 'TfL', 'DVLA', 'Esure Motor', 'RAC'],
  Shopping: ['Tesco', 'Sainsburys', 'Asda', 'Aldi', 'Lidl', 'Morrisons', 'Waitrose', 'M&S', 'TK Maxx', 'Primark', 'Argos', 'Amazon', 'Currys', 'Halfords', 'Superdrug', 'Boots', 'Zable'],
  Payments: ['Nationwide', 'Virgin Money', 'Amex', 'Zopa', 'Samsung Finance', 'PayPal'],
};

function autoCategorize(merchantName) {
  if (!merchantName) return 'Other';
  const upper = merchantName.toUpperCase();
  // Build flat list of all (merchant, category) pairs, sorted by merchant name length descending
  // This ensures "Boots Pharmacy" matches Health before "Boots" matches Shopping
  const allMappings = [];
  for (const [category, merchants] of Object.entries(CATEGORY_RULES)) {
    for (const m of merchants) {
      allMappings.push({ merchant: m, category });
    }
  }
  allMappings.sort((a, b) => b.merchant.length - a.merchant.length);
  for (const { merchant, category } of allMappings) {
    if (upper.includes(merchant.toUpperCase())) return category;
  }
  return 'Other';
}

// Known recurring bill merchants
const KNOWN_RECURRING = ['EDF Energy', 'Fuse Energy', 'Octopus Energy', 'BT', 'Virgin', 'Sky', 'Sky Protect',
  'Netflix', 'Disney+', 'Spotify', 'Utility Warehouse', 'O2', 'Uber One', 'Experian',
  'OpenAI ChatGPT', 'Dropbox', 'Apple', 'Samsung Finance', 'Zopa', 'Esure Motor', 'Council Tax'];

function isKnownRecurring(merchantName) {
  if (!merchantName) return false;
  const upper = merchantName.toUpperCase();
  return KNOWN_RECURRING.some(m => upper.includes(m.toUpperCase()));
}

// Detect recurring bills from a set of transactions
// Groups by merchant+amount, flags transactions appearing 2+ times
function detectRecurringBills(transactions) {
  const groups = {};
  for (const t of transactions) {
    const key = `${(t.merchant || '').toLowerCase()}|${Math.abs(t.amount).toFixed(2)}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }

  const recurring = [];
  for (const [key, txns] of Object.entries(groups)) {
    if (txns.length >= 2) {
      for (const t of txns) {
        t.is_recurring_bill = true;
        if (t.category === 'Other') t.category = 'Bills';
      }
      recurring.push({ merchant: txns[0].merchant, amount: txns[0].amount, count: txns.length });
    }
  }
  return recurring;
}

// Suggest category based on past transactions for this merchant
async function suggestCategory(merchantName) {
  try {
    const past = await Transaction.findAll({
      where: { merchant: merchantName },
      order: [['created_at', 'DESC']],
      limit: 5,
    });
    if (past.length > 0) {
      return {
        category: past[0].category,
        is_recurring_bill: past[0].is_recurring_bill,
      };
    }
  } catch (_) {
    // Ignore errors in suggestion
  }
  return { category: 'Other', is_recurring_bill: false };
}

// Parse date from various formats
function parseDate(dateStr) {
  if (!dateStr) return null;
  const s = dateStr.trim();

  // DD/MM/YYYY HH:MM or DD/MM/YYYY
  const ukMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (ukMatch) {
    return `${ukMatch[3]}-${ukMatch[2].padStart(2, '0')}-${ukMatch[1].padStart(2, '0')}`;
  }

  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // DD-Mon-YY (Nationwide format: 07-Nov-25)
  const monMatch = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (monMatch) {
    const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const mon = months[monMatch[2].toLowerCase()];
    const year = parseInt(monMatch[3]) > 50 ? `19${monMatch[3]}` : `20${monMatch[3]}`;
    return `${year}-${mon}-${monMatch[1].padStart(2, '0')}`;
  }

  return null;
}

// Parse currency amount, stripping symbols
function parseAmount(amountStr) {
  if (amountStr === undefined || amountStr === null || amountStr === '') return 0;
  const cleaned = String(amountStr)
    .replace(/[\u00a3£$€,\s]/g, '')  // Strip currency symbols including \xa3 pound
    .replace(/[()]/g, '')
    .trim();
  if (cleaned === '' || cleaned === '-') return 0;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Detect CSV format from headers
function detectFormat(headers) {
  const lower = headers.map((h) => h.toLowerCase().trim());

  // Nationwide: Date, Transaction type, Description, Paid out, Paid in, Balance
  if (lower.includes('transaction type') && lower.includes('paid out')) {
    return 'nationwide';
  }

  // Revolut: Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance
  if (lower.includes('started date') && lower.includes('completed date') && lower.includes('state')) {
    return 'revolut';
  }

  // Virgin Money: Transaction Date, Posting Date, Billing Amount, Merchant, ...
  if (lower.includes('billing amount') && lower.includes('debit or credit')) {
    return 'virgin_money';
  }

  // Generic with debit/credit columns
  if (lower.includes('debit') && lower.includes('credit')) {
    return 'bank_with_balance';
  }

  return 'generic';
}

// Parse a single row based on format
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
      if (state && state.toUpperCase() === 'REVERTED') return null; // Skip reverted
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
      // DBIT = money out (negative), CRDT = money in (positive)
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
      // Generic: try common column names
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

async function parseCSV(filePath, accountId) {
  // Try UTF-8 first, fall back to latin1 for files with non-UTF8 pound signs
  let fileContent;
  const rawUtf8 = fs.readFileSync(filePath, 'utf-8');
  if (rawUtf8.includes('\ufffd')) {
    // Contains replacement chars - file isn't valid UTF-8, try latin1
    const rawLatin = fs.readFileSync(filePath, 'latin1');
    fileContent = rawLatin.replace(/\xa3/g, '\u00a3');
  } else {
    fileContent = rawUtf8;
  }
  // Strip UTF-8 BOM
  if (fileContent.charCodeAt(0) === 0xfeff) {
    fileContent = fileContent.slice(1);
  }

  // Strip BOM and Nationwide's header rows (Account Name:, Account Balance:, Available Balance:, blank)
  const lines = fileContent.split('\n');
  let startIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].trim();
    if (line.startsWith('Account Name:') || line.startsWith('Account Balance:') ||
        line.startsWith('Available Balance:') || line === '' || line === ',,,,,') {
      startIdx = i + 1;
    } else {
      break;
    }
  }
  const cleanedContent = lines.slice(startIdx).join('\n');

  const parsed = Papa.parse(cleanedContent, {
    header: false,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
  }

  const headers = parsed.data[0];
  const format = detectFormat(headers);
  const batchId = uuidv4();
  const transactions = [];

  for (let i = 1; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    if (row.every((cell) => !cell || cell.trim() === '')) continue; // skip empty rows

    const result = parseRow(row, format, headers);
    if (!result || !result.date) continue;

    // Try past history first, then auto-categorize by rules
    const suggestion = await suggestCategory(result.merchant);
    const autoCategory = suggestion.category !== 'Other' ? suggestion.category : autoCategorize(result.merchant);
    const autoRecurring = suggestion.is_recurring_bill || isKnownRecurring(result.merchant);

    transactions.push({
      account_id: accountId,
      date: result.date,
      merchant: result.merchant,
      description: result.description,
      amount: result.amount,
      category: autoCategory,
      is_recurring_bill: autoRecurring,
      suggested_category: autoCategory,
      imported_from: 'csv_upload',
      import_batch_id: batchId,
    });
  }

  // Detect recurring bills by grouping merchant+amount (2+ occurrences)
  const recurringBills = detectRecurringBills(transactions);

  return {
    format,
    batch_id: batchId,
    count: transactions.length,
    total_debit: transactions.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0),
    total_credit: transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0),
    recurring_bills: recurringBills,
    transactions,
  };
}

async function saveTransactions(transactions) {
  const created = await Transaction.bulkCreate(transactions);
  return created;
}

module.exports = { parseCSV, saveTransactions, normalizeMerchant, parseDate, detectFormat, autoCategorize, detectRecurringBills, isKnownRecurring };
