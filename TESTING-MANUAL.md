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

- [ ] `/debts` loads with per-subtype grouping (cards / BNPL / loans / overdrafts / store cards).
- [ ] Add a new credit card debt → add 2 buckets (Purchases 19.9%, BT 0% promo ending 14d from now).
- [ ] Promo cliff countdown pill appears on the card row with an urgency band colour.
- [ ] Strategy Comparison card shows 4 columns (min-only / avalanche / snowball / hybrid) with a trophy on the winner.
- [ ] Toggle "Auto-suggest budget" off → budget input becomes editable. Turn back on → input goes read-only.
- [ ] Forecast chart renders with one line per debt, Projected / Utilisation / Actual / Savings tabs, all populated.
- [ ] Milestones card lists debt-free date + per-category payoff months.
- [ ] Bonus Payment card: enter £500 at month 6 → "Saves £X, clears N months sooner" summary.
- [ ] What-If Scenario card, Single tab: pick a source card + spec a target BT (0% APR, 30% fee, 18mo) → net-savings banner shows.
- [ ] What-If, Multi tab: eligible debts listed with checkboxes, greedy allocation by APR desc.
- [ ] Notifications Settings card (Sprint 7): change `reminder_days_before` to 5, Save. Value persists.

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
- [ ] Hit `http://127.0.0.1:5001/<project>/europe-west2/runBtCliffAlertsNow` (or whatever the emulator prints for the function URL).
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

## 7. Known gaps — not yet testable

- **CSV import (`/import` page).** Stubbed as Coming Soon. Phase 1's csvParser logic ported in Sprint 3 but the import UI was never rebuilt for Firebase. Defer to the 2a → 2b transition when Open Banking is evaluated.
- **Transactions / Budgets pages partially stubbed.** Transactions has tag + filter but no CSV ingest; Budgets is empty. Not blockers for dogfood (you'll work from seed + hand-edits via emulator UI).
- **Real-data UAT.** Once Accounts CRUD lands, run through this checklist with Judah's actual accounts / debts / bank CSVs and verify the forecast + discretionary + reminder numbers against reality.
- **Post-dogfood sprint:** gather any bugs / UX friction into a 2a.5 cleanup sprint before making 2b go/no-go decision.

---

## 8. 2a exit gate

Ship from this branch to a private prod Firebase project (not publicly advertised):

- [ ] Deploy rules: `npm run deploy:rules`.
- [ ] Deploy indexes: `npm run deploy:indexes`.
- [ ] Deploy functions: `npm run deploy:functions`.
- [ ] Deploy hosting: `npm run deploy:hosting`.
- [ ] Install + configure the firestore-send-email extension.
- [ ] Sign in as Judah, verify the allowlist accepts you.
- [ ] 4-week dogfood — treat as normal daily use. Note any friction in a running list.
- [ ] After 4 weeks, review the list. If major → iterate in 2a.5. If minor → greenlight Phase 2b.
