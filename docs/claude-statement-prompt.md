# Claude Statement → Standard CSV Prompt

**Version:** 1.3
**Last updated:** 2026-04-24
**Pairs with:** `client/src/services/csvParser.js` (generic format, `#` comment-line stripping at parseCSV)

**Changelog:**
- v1.3 (2026-04-24) — ASCII-only constraint on `#` metadata lines after v1.2 testing produced mojibake on bullet characters (`••••` → `â¢â¢â¢â¢`). Added mobile-UI troubleshooting note for artifact downloads.
- v1.2 (2026-04-24) — Claude now emits a **single downloadable CSV artifact** containing both the `#` metadata comments and the transaction rows. The parser strips `#`-prefixed lines before reading headers, so the one file covers both verification and import. No more copy-paste.
- v1.1 (2026-04-24) — explicit "preserve every character" rule after v1.0 testing showed Claude stripping `*` separators from merchant names (SQ\*, VER\*). Added optional `#credit_limit` and `#available_to_spend` fields for credit card statements.
- v1.0 (2026-04-24) — initial version.

## Purpose

Convert any UK bank or credit card statement (CSV, PDF, or pasted text) into
a standardised CSV that the PFA Import page can ingest.

Flow:

1. Open a new chat at [claude.ai](https://claude.ai).
2. Paste the prompt below.
3. Attach or paste the statement.
4. Claude shows a verification summary in chat AND creates a downloadable
   CSV artifact. Eyeball the summary — especially `#balance_check: OK` and
   the closing balance.
5. Download the CSV artifact.
6. Drop into PFA Import, pick the right account, commit.

The CSV file includes the `#` metadata lines at the top as comments — the
parser skips them before reading transactions. Metadata travels with the
data as an audit trail.

Privacy note: pasting statements into Claude sends real transaction data to
Anthropic's API. Judah has already accepted this class of exposure for the
Halvsies receipt flow. Same calculus applies here.

---

## The prompt

Copy everything between the fenced block and paste into a Claude chat.

```
You are extracting transactions from a UK bank or credit card statement
for import into a personal finance app.

The user will paste or attach the statement. You must:
  1. Show the verification block inline in the chat (so the user can
     eyeball the balance reconciliation).
  2. Create a downloadable CSV artifact that contains the verification
     block AS COMMENTS at the top, followed by the transaction CSV.
     Name the artifact: statement-<bank-slug>-<period-end>.csv
     (e.g. statement-virgin-money-2026-04-06.csv). Use lowercase,
     hyphenated bank slug; strip special characters.

Do not output anything after the artifact is created — no summary,
no commentary, no confirmation.

=== PART 1: Verification block (shown inline AND in the artifact) ===

Each line prefixed with `#`, in this exact order. All values must be
ASCII-only — do NOT use bullet characters (`•`), em/en dashes, curly
quotes, or any non-ASCII punctuation, because they cause encoding
mojibake when the CSV is imported. If referring to the last 4 digits of a
card, write "ending 1234" not "•••• 1234".

#bank: <bank or card issuer name, ASCII only>
#account: <human-readable account label, ASCII only, e.g. "Nationwide FlexDirect" or "Barclaycard ending 1234">
#account_type: bank_account | credit_card
#period_start: YYYY-MM-DD
#period_end: YYYY-MM-DD
#opening_balance: <GBP, 2dp, no symbol — as shown on the statement>
#closing_balance: <GBP, 2dp, no symbol — as shown on the statement>
#total_debits: <positive magnitude, 2dp — sum of all outflows/charges>
#total_credits: <positive magnitude, 2dp — sum of all inflows/payments>
#transaction_count: <integer>
#balance_check: OK | MISMATCH (expected X, computed Y)

If `account_type` is `credit_card`, also include these two lines (skip for bank_account):
#credit_limit: <GBP, 2dp, no symbol>
#available_to_spend: <GBP, 2dp, no symbol>
If either is not visible on the statement, use `#missing`.

For `balance_check`, compute the closing balance from the opening balance
and extracted transactions, then compare to the statement's closing balance:
  - For `bank_account`: computed = opening + credits − debits
  - For `credit_card`:  computed = opening + debits − credits
Output OK if they match to within 1p. Otherwise MISMATCH with both values.

If any field is not visible on the statement, write `#missing` instead of
guessing.

=== PART 2: Transaction CSV (the body of the artifact, after the verification block) ===

The CSV artifact must start with all `#` verification lines from Part 1,
each on its own line, then one line with exactly these headers:

Date,Description,Amount

Then one row per transaction. Rules:

- Date: ISO YYYY-MM-DD. If posting date and transaction date both appear,
  use the transaction date.
- Description: preserve the merchant text EXACTLY as printed on the
  statement. Preserve EVERY character including asterisks (`*`),
  ampersands (`&`), slashes (`/`), hashes (`#`), dots (`.`), and
  punctuation. Do NOT strip any symbol, even if it looks like formatting.
  Example: the statement text `SQ *VICTOR VICTORIA CO` must be written
  as `SQ *VICTOR VICTORIA CO`, not `SQ VICTOR VICTORIA CO`. The asterisks
  are payment-processor separators (Square, Verifone, etc.) and carry
  information. Do not clean, normalise, or abbreviate. If the statement
  shows description and merchant city/location in two columns, join them
  with a single space in the order they appear.
- Amount: signed decimal, 2dp, no currency symbol, no thousand separators.
  Sign convention (from the account holder's perspective):
    * NEGATIVE for: purchases, fees, interest charged, cash withdrawals,
      outgoing transfers, direct debits leaving the account.
    * POSITIVE for: salary, refunds, cashback, interest earned, incoming
      transfers, payments received on a credit card.

Every line item on the statement gets its own row, including:
  - Interest charged
  - Annual fees, late fees, over-limit fees, BT fees, FX fees
  - Promotional credits / signup bonuses / refunds
  - Cashback or rewards credits
  - Balance-transfer credits and the accompanying fees

Do NOT include:
  - Opening balance line
  - Closing balance / "new balance" line
  - Subtotal rows
  - "Minimum payment due" lines
  - Rewards points summaries (we only track cash)

Foreign currency: use the GBP amount charged to the account. Append the
original amount in square brackets at the end of the description:
  AMAZON DE [29.50 EUR]

Uncertainty: if a row's amount, date, or description can't be read
reliably, prefix the row with `#warning:` and add a short note after it
on the same line:
  #warning: 2026-04-03,UNCLEAR MERCHANT,-12.00  ## description partially obscured

After producing the artifact, stop. Do not add any chat text after the
artifact — no commentary, no "here is the file", no next steps.
```

---

## Worked example

Given a Barclaycard statement 15 Mar – 14 Apr 2026, opening balance £1,240.55,
closing balance £1,592.03, credit limit £2,500, Claude should:

1. Show the `#...` verification block inline in the chat.
2. Create a downloadable artifact named `statement-barclaycard-2026-04-14.csv`
   whose contents are the block below (verification lines + header + rows).

```
#bank: Barclaycard
#account: Barclaycard ending 1234
#account_type: credit_card
#period_start: 2026-03-15
#period_end: 2026-04-14
#opening_balance: 1240.55
#closing_balance: 1592.03
#total_debits: 461.48
#total_credits: 110.00
#transaction_count: 8
#balance_check: OK
#credit_limit: 2500.00
#available_to_spend: 907.97
Date,Description,Amount
2026-03-16,TESCO STORES 4821 NEWMARKET,-42.18
2026-03-18,SQ *BOOKSHOP LTD LONDON [24.99 EUR],-21.45
2026-03-22,PAYMENT RECEIVED - THANK YOU,110.00
2026-03-28,SHELL 2847 CAMBRIDGE,-65.20
2026-04-01,INTEREST CHARGED,-18.92
2026-04-03,NETFLIX.COM,-17.99
2026-04-05,UBER *EATS,-14.74
2026-04-12,FEE - OVER LIMIT,-12.00
```

Note how `SQ *BOOKSHOP LTD` and `UBER *EATS` preserve their asterisks —
those are payment-processor separators, not formatting noise.

Verification: 1240.55 + 461.48 − 110.00 = 1592.03. ✓ matches statement →
extraction is trustworthy.

---

## When it goes wrong

- **`#balance_check: MISMATCH`** — Claude extracted every transaction but
  the math doesn't reconcile. Usually means one amount was misread (digit
  transposition, decimal place off) or a transaction was dropped. Re-run
  in a fresh chat, or ask Claude: "The math doesn't reconcile. Re-check
  every amount against the statement and find the error." Don't import
  until OK.

- **`#warning:` rows present** — Claude flagged rows it wasn't confident
  about. Open the CSV, cross-check those specific rows against the
  statement, fix by hand, remove the `#warning:` prefix. Then import.

- **Wrong account type** — for a savings account, set `account_type:
  bank_account`. For a credit card, `credit_card`. The balance math
  formula differs.

- **Statement has a pending/posted distinction** — use posted transactions
  only (pending will appear on next month's statement, risk of double-count).

- **Artifact won't download on mobile** — Claude.ai's mobile renderer
  sometimes shows the CSV as an inline preview instead of a downloadable
  file. On a Z Fold / tablet / phone:
    1. Tap the file card — a download icon (arrow-down) usually lives
       in the top-right corner.
    2. If it still won't download, long-press the preview.
    3. Fallback: on desktop Claude.ai the download control is reliable;
       open the same chat URL on a laptop to grab the file.
  The content is correct regardless — only the download UX is flaky.

- **Mojibake on special characters** (`â¢â¢â¢â¢` in place of `••••`, etc.)
  — upgrade to prompt v1.3+ which forbids non-ASCII characters in the
  `#` metadata lines. Then re-run the chat.

---

## Keeping this prompt in sync with the parser

The prompt's CSV output must match what `csvParser.js` can consume via its
`generic` format path:

- Leading `#` lines are stripped by `parseCSV` before header detection,
  so the verification block ships with the data without breaking the parser.
- Headers: `Date,Description,Amount` — matches `parseRow` default branch.
- Date formats: ISO `YYYY-MM-DD` — handled by `parseDate`.
- Amount sign convention: negative for outflows — matches `parseAmount`.

If `csvParser.js` ever changes its expected headers, amount sign
convention, or comment-line handling, bump this doc's version and update
the prompt accordingly. Test with at least one real bank statement and
one real credit card statement after any change.
