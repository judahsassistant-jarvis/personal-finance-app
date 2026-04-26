# Manual UAT — Phase 2a

Anything automated lives in the unit / rules / integration test suites. This file tracks what still needs a human at the browser, or a prod environment.

Run the automated suites first:

```
npm run test:client        # Vitest — services, engines, helpers, components
npm run test:rules         # Firestore rules
cd functions/tests && npm test             # node:test helper unit tests
cd functions/tests && npm run test:integration   # Cloud Functions against the emulator
```

All four must be green before running through this checklist.

> **Integration test precondition:** `test:integration` filters by the seeded TEST_UID
> only when cleaning up, but the function scanners query all users. Leftover dogfood
> data from another user inflates the candidate count and fails tests. Run
> `npm run clear` (from `scripts/`) before `test:integration` if you've been
> dogfooding in the same emulator session.

---

## Setup

1. Emulator running: `npm run dev` from the repo root (starts auth, firestore, functions, hosting + Vite client on `:5173`).
2. Optional: `npm run seed` for the full demo dataset, or `npm run clear` for an empty emulator if you want to test onboarding from scratch.

---

## 1. First-run wizard (Sprint 5)

Requires: empty emulator (`npm run clear`).

- [ ] Open `http://localhost:5173`. Unauthenticated → redirects to `/login`.
- [ ] Sign in with Google (emulator picks `judahsassistant@gmail.com`). Lands on `/welcome` with the 4-step stepper.
- [ ] **Step 1 — Pay cycle:** change day-of-month and shift rule, hit Continue. Reload page → values persisted on the users/{uid} doc.
- [ ] Hit Back → returns to step 1 with the saved values pre-filled.
- [ ] **Step 2 — Account:** add one (e.g. Main current, £1500), Continue. Visit `/accounts` in a new tab → the new account is listed.
- [ ] Back on `/welcome`, hit Skip on step 2 (with fresh run) — next step loads without an account created.
- [ ] **Step 3 — Debt:** add a card (Barclaycard, 19.9% APR), Continue. Visit `/debts` → the debt appears.
- [ ] Hit Skip on step 3 — continues without creating a debt.
- [ ] **Step 4 — Buffer:** enter £200, Finish. Redirects to `/` (Dashboard). `profile.onboarding_complete` flips to true.
- [ ] Visit `/welcome` manually after finishing → should redirect straight to `/` (no re-entry).

**Note:** the wizard only lets you add ONE account and ONE debt. Full Accounts CRUD is on `/accounts` (§3.5) and Debt Planner CRUD on `/debts`. Reseed with `npm run seed` if you need the full fixture set instead of typing everything by hand.

---

## 2. Email allowlist (Sprint 5)

Requires: a secondary Google-style emulator account.

- [ ] In the emulator UI (`http://127.0.0.1:4000/auth`), create a new user with an email NOT in the allowlist (e.g. `random@example.com`).
- [ ] Sign out, then sign in as that user on the app.
- [ ] Expect: Firestore rules reject the `users/{uid}` create. UI should hang on "Loading…" or show an error on the Login page. No docs written.
- [ ] Sign out, sign back in as an allowlisted email — normal access restored.

---

## 3. Accounts CRUD

Requires: signed in with at least one account OR empty.

- [ ] `/accounts` loads, "Add account" button top-right.
- [ ] Click Add → inline form appears. Name, type dropdown, balance, rate (hidden for Current), SIPP qualifying age (only when type=SIPP), monthly contribution (optional), safe-to-spend checkbox.
- [ ] Add a savings account (£5000, 4.5% rate, £100/mo contribution) → appears in the Liquid group with rate + contribution + safe-to-spend status on the row.
- [ ] Add a SIPP (£50k, 5% growth, age 58, £300/mo) → appears in the Locked group with "unlocks at 58".
- [ ] Edit a row via the pencil icon → form pre-populated. Change rate + balance, Save → changes reflected in the list.
- [ ] Change subtype in the form from SIPP to Savings → SIPP age field disappears, rate field re-shows interest-rate label, save → doc has `interest_rate`, not `growth_rate`, no `sipp_age`.
- [ ] Delete a row via trash icon → confirm dialog → row disappears from the list.
- [ ] Invalid inputs (non-numeric balance, rate > 100, SIPP age outside 50-75) → inline errors, form does not submit.
- [ ] Safe-to-spend toggle still works inline on each row.

## 4. Debt Planner end-to-end (Sprint 4d–4f, 7 — includes Debt CRUD)

Requires: seeded or hand-built dataset with at least 3 debts.

The Debt Planner is now split across four sub-routes — top-nav dropdown ("Debt
Planner" → Overview / What-If BT / Bonus payment / Reminders) and an in-page
tab strip mirror the same structure. The hover-or-click dropdown closes on
route change and on click-outside.

### 4.1 Overview (`/debts`)

- [ ] Tab strip at the top shows Overview / What-If BT / Bonus payment / Reminders. Overview is highlighted.
- [ ] Per-subtype debt grouping (cards / BNPL / loans / overdrafts / store cards).
- [ ] Add a new credit card debt → add 2 buckets (Purchases 19.9%, BT 0% promo ending 14d from now).
- [ ] Promo cliff countdown pill appears on the card row with an urgency band colour.
- [ ] Strategy Comparison card shows 4 columns (min-only / avalanche / snowball / hybrid) with a trophy on the winner.
- [ ] Toggle "Auto-suggest budget" off → budget input becomes editable. Turn back on → input goes read-only.
- [ ] Forecast chart renders with one line per debt, Projected / Utilisation / Actual / Savings tabs, all populated.
- [ ] Milestones card lists debt-free date + per-category payoff months.

### 4.2 What-If BT (`/debts/what-if`)

- [ ] Click "What-If BT" tab → same H1-style header per page; What-If scenario card centred with descriptive subtitle.
- [ ] Single tab: pick a source card + spec a target BT (0% APR, 30% fee, 18mo) → net-savings banner shows.
- [ ] Multi tab: eligible debts listed with checkboxes, greedy allocation by APR desc.

### 4.3 Bonus payment (`/debts/bonus`)

- [ ] Bonus Payment card: enter £500 at month 6 → "Saves £X, clears N months sooner" summary.
- [ ] Empty state: with zero debts, page shows the "Add debts on the Overview tab first" placeholder rather than a broken card.

### 4.4 Reminders (`/debts/reminders`)

- [ ] Notifications Settings card (Sprint 7): change `reminder_days_before` to 5, Save. Value persists.

### 4.5 Navigation polish

- [ ] Hovering "Debt Planner" in the top nav opens the dropdown.
- [ ] Click outside dropdown → closes.
- [ ] Selecting a sub-item navigates AND closes the dropdown.
- [ ] In-page tabs match the active route (Overview tab uses `end` so it doesn't stay highlighted on sub-routes).

---

## 5. Forecast page (Sprint 6)

Requires: seeded dataset (5 accounts covering current / savings / cash ISA / S&S ISA / SIPP).

- [ ] `/forecast` loads. Pill multi-selector shows every account; toggling filters the chart live.
- [ ] Horizon tabs: 12m, 5y, 10y render correctly. Y-axis scales to data.
- [ ] **"Until SIPP age" tab** appears only after you set `birth_year` via the inline prompt. Set 1982 → tab becomes available, horizon = (SIPP qualifying age − current age) × 12 months.
- [ ] Per account view: each account's line is a distinct colour; legend shows plain lines (no circles).
- [ ] Net worth view: stacked area with sky (liquid) under violet (locked). Tooltip shows both + total.
- [ ] Scenario card: enter £200 and target S&S ISA. Dashed overlay in violet (same as S&S ISA) appears on per-account view. Summary tile flips to "With extra in N years: £X" + delta.
- [ ] Switch to Net worth view — scenario dashed line is emerald (distinct from stacked area; intentional).

---

## 6. Cloud Function notifications (Sprint 7)

### Emulator dry-run

- [ ] Seed data + ensure a promo bucket exists with `promo_end` within 14 days: edit a seeded bucket in the emulator UI, or use `npm run seed` which creates one.
- [ ] Hit `http://127.0.0.1:5001/personal-finance-app-dev-3ffb2/europe-west2/runBtCliffAlertsNow` (or whatever the emulator prints for the function URL).
- [ ] Check `/mail` collection in the emulator UI — one doc with the expected subject + HTML body.
- [ ] Check `/notification_log` — one `bt_<uid>_<bucket>_critical_14d_<date>` entry.
- [ ] Hit the endpoint again → no new `/mail` docs (idempotency).
- [ ] Update the bucket's `promo_end` to something further out (e.g. 60 days) → run again → new `/mail` doc fires (new log key).

Same flow for `runPaymentRemindersNow` — requires a debt with `payment_due_day` matching today (or today + 3).

### Production email delivery

The Cloud Functions write to `/mail`. Actual email delivery requires the **Firebase `firestore-send-email` extension** installed in prod.

- [ ] Install extension: `firebase ext:install firebase/firestore-send-email` against the PFA Firebase project.
- [ ] Configure with a SendGrid / Mailgun / SMTP provider key.
- [ ] Verify from-address is whitelisted / domain authenticated.
- [ ] Trigger a test function run in prod, confirm delivery to the inbox.
- [ ] Check the extension's stats / error log for any bounces.

**Until the extension is installed, the functions are fully idempotent + queue docs in `/mail` as dry-run evidence. No emails are sent.**

---

## 7. CSV Import (Sprint 11 + audit Gaps 1, 4, 5)

Requires: at least one liquid account on `/accounts`. Source CSVs live in
`OneDrive/My Drive (judahsassistant@gmail.com)/PFA-statements/` (output of the
Claude statement processor scheduled task), or any bank-format CSV exported
manually from Nationwide / Revolut / Virgin Money.

### 7.1 Upload + preview

- [ ] `/import` loads. UploadView shows a CSV file picker and a "Import into account" dropdown filtered to liquid accounts only (no SIPP / pension).
- [ ] Pick a fresh statement and an account, hit "Parse + preview" → switches to PreviewView.
- [ ] SummaryStrip shows Format / Transactions / Total debits / Total credits tiles.
- [ ] Statement metadata card lists every `#`-prefixed field from the CSV (bank, account, period_start, period_end, balance_check, etc.). Balance-check status badge: green "OK", red "MISMATCH", grey "N/A".
- [ ] Sample rows table shows the first 20 parsed transactions.
- [ ] Confirm + import → PostCommitView reports "Imported X transactions". Visit `/transactions` → the rows are listed newest-first.

### 7.2 Re-import deduplication (audit Gap 1)

- [ ] Re-upload the same file you just imported, pick the same account, parse + preview.
- [ ] SummaryStrip should now show a banner: "0 new, X duplicates (already imported — will be skipped)".
- [ ] Confirm button label reads "Nothing new to import" and is disabled.
- [ ] Cancel → back to the upload step.
- [ ] Open a slightly different statement that overlaps in date range with what you've already imported. Preview should show "X new, Y duplicates". Confirm → only the X new rows write; PostCommitView reports "Imported X. Skipped Y duplicates that were already imported."
- [ ] On `/transactions`, edit the category on one of the imported rows. Re-import the same statement → row's category is preserved (skip rather than upsert-overwrite).

### 7.3 Wrong-account import guard (audit Gap 5)

- [ ] Pick a Revolut statement but select a Nationwide account in the dropdown.
- [ ] Parse + preview → an amber Alert appears above the SummaryStrip: "This statement looks like it's from Revolut but you've selected Nationwide Current. Double-check before importing."
- [ ] Cancel + redo with the correct account → no warning.
- [ ] Edge: a statement with a multi-word `#bank` field (e.g. "Nationwide Building Society") still matches a "Nationwide Current" account name (token overlap on "nationwide").
- [ ] Edge: a statement whose `#bank` field is missing or only contains 3-char abbreviations gets no warning (no false alarms).

### 7.4 Past imports + cascade delete (audit Gap 4)

- [ ] On `/import`, scroll below the upload form. "Past imports" section lists every batch sorted newest-first.
- [ ] Each row shows: account name, count badge (e.g. "47 txns"), balance-OK or MISMATCH badge if known, period range (if metadata present), import timestamp, format. Historical (back-filled) batches show a "historical" outline badge.
- [ ] Click the trash icon on a small batch → confirm dialog: "Delete N transactions imported into <account> (period)?"
- [ ] Confirm → batch row disappears immediately. Visit `/transactions` → the deleted batch's rows are gone too. Tagged debt payments and transfer pairs in the batch are cleared.
- [ ] Re-import the same statement → it appears as a fresh batch in Past Imports.

### 7.5 Account balance after import

- [ ] After confirming an import, the account's `balance_pennies` on `/accounts` is NOT auto-updated by the import (statements provide row movements, not the closing balance — that's inferred from the metadata's `#closing_balance` if present, but applied manually).
- [ ] If the statement's `#balance_check` is `MISMATCH`, investigate before trusting the row data — usually means the file was edited or a row was missed.

---

## 8. Transactions page interactions

Requires: at least one imported statement. Reseed with `npm run seed` if you want
the deterministic dogfood fixture set instead.

### 8.1 Auto-categorisation + bulk recategorise

- [ ] `/transactions` loads with All / Untagged outflows / Suggestions / Debt payments tabs at the top. Counts on each tab.
- [ ] Filter "All": every imported row visible. Each shows merchant, account, category dropdown, amount.
- [ ] Recategorise a row via the per-row dropdown → the single row updates instantly. A confirm dialog then asks: if siblings (other untagged rows with the same merchant in a different category) exist, "Apply '<cat>' to N other '<merchant>' transactions AND save as a rule?"; otherwise, "Save '<cat>' as a rule for '<merchant>' so future imports auto-categorise this merchant?".
- [ ] Confirm → matching siblings (if any) update + a new entry appears in `category_rules`. Future imports that produce that merchant will auto-pick the rule's category.
- [ ] Cancel → only the originally clicked row was updated; no bulk update, no rule saved.
- [ ] Visit "Manage categories" → built-in + custom categories listed. Add a custom category → appears in the dropdown. Remove → tagged rows fall back to "Other".
- [ ] Search box filters by merchant / description / category substring. Date / amount / account filters compose with it.

### 8.2 Debt-payment suggestions

- [ ] Filter "Suggestions" shows untagged outflows where the matcher detected a probable debt.
- [ ] A row with an obvious match (e.g. "BARCLAYCARD" merchant + "Barclaycard Platinum" debt) shows: ✨ "Looks like Barclaycard Platinum?" + "Tag" button + "Other…" dropdown.
- [ ] Click Tag → row gets a "Debt Payment" badge in the Category column and the debt name in the Tagged To column. Discretionary + recurring-bill inference excludes the row going forward.
- [ ] Untag (X icon) → row reverts; suggestion may re-appear.
- [ ] **Specificity guard**: a "PayPal: Steam" merchant must NOT suggest a "PayPal Credit" debt. The shared "paypal" word alone shouldn't trigger when the merchant has a specific non-generic word (Steam) absent from the debt name.
- [ ] **Frequency floor**: a bare "PayPal" merchant must NOT suggest "PayPal Credit" either, because "paypal" appears in many distinct merchant strings (PayPal, PayPal: Steam, PayPal: Dropbox, etc.) and is too weak a signal alone. The actual "PayPal Credit" repayment row (which has both "paypal" + "credit") DOES still suggest correctly.
- [ ] Bank-label cases preserved: "HALIFAX CREDIT CARD" merchant still suggests a "Halifax Clarity" debt — "credit" and "card" are generic transaction labels, not disqualifying.

### 8.3 Transfer-pair suggestions (audit Gap 2)

Requires: at least 2 current accounts imported with at least one transfer between them
(e.g. a "Payment from YEHUDA LEVI" inflow on Revolut paired with the matching outflow
on Nationwide).

- [ ] Filter "Suggestions" includes candidate transfer pairs alongside debt suggestions.
- [ ] An eligible row in either direction shows: ↔ "Transfer to <other account>?" / "Transfer from <other account>?" + "Pair" button + dismiss (X) button.
- [ ] Click Pair → both sides of the pair get a "Transfer" Category badge and "Paired" indicator in the Tagged To column. Both rows persist a shared `transfer_pair_id`. Suggestions count drops by 1 (per-pair, not per-side).
- [ ] Click Dismiss on a candidate → suggestion goes away. Refresh page → it stays away (`pair_dismissed_at` stamped on both sides).
- [ ] **One-to-one rule**: if two outflows of the same amount exist on Nationwide and a single inflow on Revolut, NO suggestion is shown (ambiguous). User has to manually tag.
- [ ] **Date window**: a Friday→Monday transfer (clearance delay) within 3 calendar days should still pair. A 7-day-apart pair should not.
- [ ] **Excludes debt payments**: a `debt_id`-tagged outflow does not pair (Debt Payment takes precedence over Transfer).

### 8.4 Investment + Transfer categories

- [ ] Category picker dropdown shows "Investment" and "Transfer" alongside Bills / Cash / Charity / etc.
- [ ] Auto-categorisation: a "JPMorgan Chase" / "Vanguard" / "Hargreaves Lansdown" / "Trading 212" / "Coinbase" merchant lands in Investment automatically.
- [ ] Transfer category is intentionally empty for auto-rules (safer for "Payment from <person>" patterns) — manual tagging or transfer-pair confirmation is the path.
- [ ] Tag a "JPMorgan" row → recurring-bill inference no longer suggests it as a "monthly bill" (Investment is excluded from `inferRecurringBills`).
- [ ] Same exclusion applies to Transfer-tagged rows.

### 8.5 Variable-bill detection (audit Gap 3)

Requires: 3+ months of energy / mobile / utility data with month-to-month amount swings.

- [ ] On the dashboard, a recurring-bill suggestion appears for an "EDF Energy" merchant with three rows around £140 / £110 / £88 (i.e. ±25% spread). Tight ±5% bucketing would have missed it; loose tier (3+ at ±25%) catches it.
- [ ] The expected_amount_pennies for the inferred bill is the median (£110), not the first-seen value.
- [ ] Fixed subscriptions (Netflix £13.99 × 3 months) still detect via the tight tier (2+ at ±5%).
- [ ] A 2-occurrence variable bill (£140 + £88) is NOT inferred — needs 3+ occurrences for the loose tier.

---

## 9. Budgets

Requires: at least 1 month of categorised transactions (suggestions need 1–3 months
to become useful).

- [ ] `/budgets` loads with the page header + month selector defaulting to the current month.
- [ ] Click chevrons → step backward / forward by month. The "Today" pill appears when off the current month and snaps you back.
- [ ] Summary strip: Spent this month / Budgeted (with category count) / Remaining (or "Over by" with destructive tone if spend > total budget).
- [ ] Per-category rows show category name, spent amount, progress bar (green / amber ≥80% / red over-budget), spent-of-budget summary line.
- [ ] Categories with no budget set show "No budget set" placeholder.
- [ ] Type a value into the row's budget input → Save (✓) button enables → click → row updates with the new budget + progress bar.
- [ ] Trash icon clears the budget and reverts to "No budget set".
- [ ] Suggestion line below the row appears when the engine has a 3-month average to suggest. "Use" button accepts the suggestion. Confidence badge (high / medium / low) reflects consistency over the lookback window.
- [ ] Balance-shifting categories (Transfer / Investment / Payments / Debt Payment / Income) are NEVER shown — they're tracked elsewhere.
- [ ] Empty state ("Nothing to budget yet") shows on a fresh account before any transactions exist.

## 10. Known gaps — not yet testable

- **Production email delivery (Section 6 subsection)** deferred indefinitely — Judah decided 2026-04-24 it should not block further development. Functions queue `/mail` docs in both emulator and prod; bolt the firestore-send-email extension on when prod is set up.
- **Credit-card statement import** out of scope for 2a (`PHASE-2-PLAN.md §2.9`). Manual balance entry via the per-debt "Record statement balance" form. Card-side import deferred to 2b on its own merits.

---

## 11. 2a exit gate

Ship from this branch to a private prod Firebase project (not publicly advertised):

- [ ] Deploy rules: `npm run deploy:rules`.
- [ ] Deploy indexes: `npm run deploy:indexes`.
- [ ] Deploy functions: `npm run deploy:functions`.
- [ ] Deploy hosting: `npm run deploy:hosting`.
- [ ] Install + configure the firestore-send-email extension.
- [ ] Sign in as Judah, verify the allowlist accepts you.
- [ ] 4-week dogfood — treat as normal daily use. Note any friction in a running list.
- [ ] After 4 weeks, review the list. If major → iterate in 2a.5. If minor → greenlight Phase 2b.
