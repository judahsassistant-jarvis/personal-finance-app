# CSV Parser & Import Audit

Written 2026-04-26 after Phase 2a Sprint 11 dogfood (4 Nationwide + 4 Revolut
statements imported across two months). Two real bugs already surfaced during
that dogfood (PayPal merchant collapsing → fixed in `1022652`/`d3c1c23`;
missing Investment/Transfer categories → fixed in `d5464a0`). This audit
catalogues the remaining gaps in the import pipeline that could surface as
real-data noise once dogfood broadens, and proposes priority order for fixes.

---

## Gap 1 — No deduplication on re-import

### Current behaviour
`parseCSV` → `confirmImport` writes every row as a new Firestore doc with a
fresh auto-generated ID. The only persisted import-side metadata is
`import_batch_id` (UUID per import session), `imported_from` (format name),
and the row's date/amount/merchant/description.

If the same statement is imported twice — or two overlapping statements (e.g.
April 1–30, then April 15–May 15) — every row in the overlap is duplicated.
Dashboard balances re-derive correctly because they use account
`balance_pennies` (statement entry) rather than summed transactions, but:

- Recurring-bill inference will see 2× the occurrences and inflate confidence.
- Bulk recategorisation will silently double-touch the same merchant.
- Manual "find this transaction" searches return doubles, confusing the user.
- Spending-by-category aggregations (future) will inflate.

### Proposed fix
**Composite deterministic doc ID** keyed by `(account_id, date, amount_pennies,
description)` hashed via SHA-256 (truncated to a Firestore-safe 22-char ID).
Re-imports of the same row write the same ID — Firestore upsert semantics make
the operation idempotent.

Use the **raw description** (not the normalised merchant) as the hash input.
The merchant changes when MERCHANT_MAP changes; the description doesn't.

The Import UI preview should also show a "X duplicates will be skipped"
banner — distinguish "X new" from "X duplicates" in the confirmation pane.
Implementation: at preview time, batch-read existing IDs for the candidate
hashes, partition the import into new/duplicate buckets.

### Open questions
- Should we store the hash on the doc (e.g. `dedup_key` field) for diagnostic
  / audit trails, or is the doc ID sufficient?
- For statement-level dedup, the `#period_start`/`#period_end` metadata could
  drive a "this statement already imported" check before even running the row
  parser — cheaper, but only works for Claude-statement output (not
  Nationwide raw exports). Worth doing as a fast path on top of row-level.

### Scope: ~half a day
Hashing helper + ID computation in `parseCSV` + `batchCreate` upgrade to
upsert + Import UI banner + tests. Touches `csvParser.js`, `firebase/helpers.js`,
`Import.jsx`, and adds ~6 tests.

---

## Gap 2 — No cross-account transfer detection

### Current behaviour
A transfer between two of the user's own accounts arrives as two unrelated
transactions: an outflow on Account A and an inflow on Account B. They have
different doc IDs, no shared identifier, and no way to know they're "the
same money."

Symptoms now that both Nationwide and Revolut are imported:
- "Payment from YEHUDA LEVI" on Revolut is currently uncategorised; matched
  by an outgoing FP/transfer on Nationwide. User must tag both manually as
  Transfer (or accept inflated income on Revolut + inflated outgoing on
  Nationwide if left as Other).
- The new Transfer category exists but has zero auto-rules — entire
  detection burden falls on the user.

### Proposed fix
**Auto-pair detector** runs at import time AND on a "scan for new pairs"
button in the Transactions page. Pairing rule:

- One side outflow, the other inflow
- Same `Math.abs(amount_pennies)`
- Date within ±3 calendar days
- Different `account_id`
- Both rows currently unpaired (no `transfer_pair_id`)
- One-to-one match: only pair if exactly one candidate exists on each side

When paired:
- Set `transfer_pair_id = <hash of canonicalised pair>` on both docs
- Set `category = 'Transfer'` on both (only if currently 'Other' or 'Income'
  for the inflow side — don't override manual categorisation)

UI surface: similar pattern to the existing "Looks like Paypal?" prompt on
debt-payment matches. New "Looks like a transfer to/from <other-account>?"
chip with Confirm / Dismiss buttons. Dismiss adds a `dismissed_pair`
sentinel so the suggestion doesn't keep re-appearing.

### Edge cases to handle
- **Bank transfers crossing the cycle boundary**: a Friday 28th transfer
  might land on Monday 31st in one account but the originating account
  records it on Friday. The ±3 day window covers this.
- **False positives from coincidental amounts**: £20 paid to Tesco on Monday
  + £20 received from a friend on Wednesday. The "different account_id"
  rule catches this (Tesco isn't an account), but two REAL inflows of £20
  to different accounts on close dates is genuinely ambiguous — the
  one-to-one constraint suppresses ambiguous matches.
- **Standing orders**: identical monthly outflow on Nationwide could
  spuriously pair with a £50 inflow on Revolut from someone repaying you.
  The one-to-one constraint within the date window helps; if multiple
  candidates exist, surface NONE rather than guess.
- **Pre-existing "Payment from <person>" rules**: if the user has tagged
  some "Payment from YEHUDA LEVI" rows as Transfer manually + created a
  rule, the auto-pair detector should respect that and just need to set
  the pair ID, not re-categorise.

### Schema change
Add `transfer_pair_id` (string, optional) to the transactions collection.
Add a Firestore index on `(user_id, transfer_pair_id)` for "find the other
side of this pair" queries. Optionally add `pair_dismissed_at` (Timestamp)
to suppress repeat suggestions.

### Scope: ~half a day, possibly a full day
Pure pairing function + scan-on-import integration + scan-on-demand button +
UI prompt + dismiss flow + tests. Touches a new
`services/transferPairing.js`, `Transactions.jsx`, `Import.jsx`, schema, rules.

---

## Gap 3 — Recurring-bill tolerance is too tight for variable bills

### Current behaviour
`inferRecurringBills` buckets by ±5% amount tolerance. Variable bills can
swing more:

- Energy: £140 winter / £80 summer (±27% from £110 mean) — won't cluster
- Mobile data overage: £15 base / £18 with overage (±10%)
- Council tax: 10 monthly payments at £140 then 2 at £0 (or different)

Result: the parser catches truly fixed subscriptions (Netflix £13.99 every
month) but misses precisely the bills the user most wants reminders for.

### Proposed fix
**Two-tier tolerance**:

1. **Tight tier (±5%, current)**: 2+ occurrences confirms — covers fixed
   subscriptions
2. **Loose tier (±25%)**: 3+ occurrences confirms — covers variable bills

The expected amount uses the median of the dominant cluster (current code
uses the bucket key, which is the first-seen amount — biased).

Optional: per-merchant tolerance overrides for known-variable categories
(energy, water, mobile). Drives off `KNOWN_RECURRING` membership or a
new `VARIABLE_BILL_MERCHANTS` set.

### Scope: ~2 hours
Pure-function tweak in `recurringBills.js` + tests. Smallest of the three
gaps.

---

## Gap 4 (newly noticed) — No statement-level provenance UI

### Current behaviour
`import_batch_id` is stored on every transaction but never surfaced. No way
to say "show me everything I imported from the April Nationwide statement"
or "undo the last import." The Claude-statement metadata
(`#bank` / `#account` / `#period_start` / `#period_end` / `#balance_check`)
is parsed (`parseCSV` returns it as `metadata`) but not persisted on the
imported transactions or anywhere else.

### Proposed fix
- New `import_batches` collection: one doc per import recording
  `account_id`, `period_start`, `period_end`, `count`, `total_debit_pennies`,
  `total_credit_pennies`, `balance_check`, `imported_at`, optional
  `source_email_subject` / `source_email_date` from metadata.
- Each transaction stores `import_batch_id` (already does) + a per-import
  back-reference is implicit.
- Settings → Imports page lists batches with delete affordance. Delete
  walks the batch's transactions and removes them — guarded by a confirm
  dialog.

### Scope: ~half a day
New collection + slice + page + tests. Modest.

---

## Gap 5 (newly noticed) — No wrong-account-import guard

### Current behaviour
The Import UI lets the user pick any account from the dropdown, then
imports the rows under it. If they pick the wrong account (e.g. select
"Nationwide Current" but upload a Revolut statement), every row goes to the
wrong place silently. Recoverable only via batch delete (which doesn't
exist — see Gap 4) or manual per-row deletion.

The Claude-statement metadata block contains `#bank` and `#account` (e.g.
`Revolut GBP Account (sort 04-00-75, acct 14988925)`). The user's
`AccountDoc` doesn't currently store sort code / account number, but the
account-name field is free-text and usually distinctive.

### Proposed fix
At preview time: if the metadata block has `#bank` and the selected account
name doesn't case-insensitively contain that bank name (or vice versa),
show an amber banner: "This statement is from <Bank>, but you've selected
<Account Name>. Are you sure?" — non-blocking, just a sanity check.

A deeper fix would require AccountDoc to gain `sort_code` and
`account_number` fields, and exact matching against the metadata. Defer
that to 2b unless dogfood actively burns us.

### Scope: ~1 hour
String-matching guard in `Import.jsx`, copy + amber Tailwind banner.

---

## Priority order

Ranked by leverage — what stops the dogfood from being noisy in real use:

1. **Gap 1 (Dedup)** — highest blast radius. Without it, anyone re-importing
   for any reason silently doubles their data. 2a dogfood doesn't yet test
   re-imports but production-grade trust requires this.
2. **Gap 2 (Transfer detection)** — directly addresses the "what just
   surfaced" pain. Now that two current accounts are imported, the missing
   pairing is visible every day.
3. **Gap 5 (Wrong-account guard)** — cheap, prevents a footgun. Slot in
   alongside Gap 1 since both touch `Import.jsx`.
4. **Gap 4 (Batch provenance / undo)** — quality-of-life, doesn't fix data
   correctness but enables recovery from import mistakes. Pairs naturally
   with Gap 1.
5. **Gap 3 (Variable bill tolerance)** — pure parameter tuning, smallest
   scope, but lowest-impact in practice (most user bills ARE fixed).

## Recommended sprint shape (Sprint 11.6)

If we tackle as a unit:

- Phase A (~half a day): Gap 1 + Gap 5 + Gap 4 — all touch Import.jsx +
  schema. Land together to keep one schema migration.
- Phase B (~half a day): Gap 2 (transfer pairing) — independent of the
  above, can ship separately.
- Phase C (~2 hours): Gap 3 — slot in opportunistically.

Total: ~1–1.5 days for all five.

If we tackle just (2) and (3) per the current session's scope:

- Gap 2 first (blocks immediate dogfood pain)
- Gap 3 second (small, easy to slot in after)
- Half-day to a day total.

## Out of scope for this audit

- **Open Banking** — explicitly removed from the roadmap (`PHASE-2-PLAN.md
  §2.9`); no automatic statement fetch from banks.
- **Credit-card statement import** — deferred to 2b; manual balance entry
  for cards in the interim.
- **Cross-currency conversion** (EUR / USD card spend on Revolut) — the
  Revolut export is GBP-converted at the row level; no conversion needed
  on our side. Revisit if a multi-currency account is ever imported.
