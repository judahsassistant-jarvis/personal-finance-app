# Personal Finance App

Private UK-focused personal-finance web app. Firebase + React 19 + Vite + Redux Toolkit + Tailwind 4 + Recharts.

**Current branch: `phase-2a`** — Firebase rewrite of Phase 1 for private solo use (dogfood). See `../staging/personal-finance-app/PHASE-2-PLAN.md` for the full scope.

## Modules

- **Dashboard** — Snoop-style cycle view: safe-to-spend, bills remaining, days-to-payday, discretionary calc.
- **Accounts** — current, savings, cash ISA, S&S ISA, SIPP, investment, pension. Liquid vs locked distinction.
- **Transactions** — auto-categorised, recurring detection, CSV import from Nationwide / Revolut / Virgin Money.
- **Budgets** — category allocations with suggestion engine.
- **Debt Planner** — cards, BT cards, BNPL, personal loans, overdrafts, store cards. Avalanche/snowball strategies, What-If BT scenario tool, promo cliff detection, payment reminders. Auto-suggested budget = discretionary from Dashboard.
- **Forecast** — multi-account balance projection; liquid accounts projected via income/bills flows, locked accounts via growth rate. SIPP projects to qualifying age.

## Prerequisites

- **Node.js** v20+ (dev works on any recent LTS; Cloud Functions runtime pins to Node 20).
- **Java 21+** — required by the Firestore emulator. Install via `winget install Microsoft.OpenJDK.21` on Windows. `JAVA_HOME` must point to the JDK 21 install (set automatically by winget for new shells).
- **Firebase CLI** — `npm install -g firebase-tools`, then `firebase login` using `judahsassistant@gmail.com`.

## Local dev loop

```bash
# 1. Install deps (first time only)
npm install
cd client && npm install && cd ..
cd functions && npm install && cd ..

# 2. Start emulators + client together
npm run dev
```

This runs:
- Firebase emulator suite on ports 9099 (auth), 8080 (firestore), 5001 (functions), 5000 (hosting), 4000 (UI at `http://localhost:4000`).
- Vite dev server for the client on port 5173 (MC runs on 3000, so PFA stays out of its way).

The client connects to the emulator suite when `VITE_USE_FIREBASE_EMULATOR=true` in `client/.env` (default in dev).

To point the client at production Firebase instead:
```bash
# edit client/.env, set VITE_USE_FIREBASE_EMULATOR=false
npm run dev:client
```

## Environment files

- `client/.env` — gitignored, contains the real Firebase config (API key, project ID, etc.). Copy `client/.env.example` as a template.
- `client/.env.example` — committed template showing required keys.

Firebase client config is not secret (public by design — auth rules enforce security), but env-var pattern keeps dev/prod swaps clean.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Emulator suite + Vite client together |
| `npm run dev:emulators` | Emulators only |
| `npm run dev:client` | Client only (connects to emulators if `VITE_USE_FIREBASE_EMULATOR=true`) |
| `npm run build` | Build Vite client to `client/dist/` |
| `npm run deploy` | Deploy everything (rules, indexes, functions, hosting) to production Firebase |
| `npm run deploy:rules` | Deploy Firestore rules only |
| `npm run deploy:indexes` | Deploy Firestore indexes only |
| `npm run deploy:functions` | Deploy Cloud Functions only |
| `npm run deploy:hosting` | Build + deploy hosting only |

Scripts prefixed `_phase1:*` invoke the legacy Express/Electron stack — kept during migration, removed in Sprint 4.

## Firebase project

- **Project ID:** `personal-finance-app-dev-3ffb2`
- **Region:** `europe-west2` (London)
- **Owner:** `judahsassistant@gmail.com`
- **Firestore mode:** Production rules (security enforced)
- **Auth providers:** Google

## Data model

10 Firestore collections. See [PHASE-2-PLAN.md §3.1](../staging/personal-finance-app/PHASE-2-PLAN.md) for full field list.

```
users              accounts          debts (was credit_cards)
card_buckets       transactions      recurring_bills
monthly_budgets    debt_config       forecast_snapshots
audit_log
```

Plus `system/bank_holidays` (global cache, Cloud Function writes only).

## Tests

2a reduces test scope to Jest unit tests + Firestore rules tests. WCAG / integration / UAT deferred to 2b.

```bash
# TODO: wire in Sprint 10
```

## Migrating from Phase 1

Phase 1 lived on `main` with Postgres + Express + Electron. This branch deletes those in Sprint 4 and rewires Redux thunks to Firestore SDK. Until Sprint 4 lands, `server/` and `electron/` remain on disk; don't run them.

## Status

Sprint 1 (foundation) done. See [PHASE-2-PLAN.md §4a](../staging/personal-finance-app/PHASE-2-PLAN.md) for sprint breakdown.
