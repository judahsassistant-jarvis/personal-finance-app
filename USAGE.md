# Usage Guide

## Getting Started

After starting the app (`npm run dev`), open http://localhost:3000 in your browser.

The sidebar navigation provides access to all features:
- **Dashboard** - Overview of your financial position
- **Accounts** - Manage bank accounts
- **Credit Cards** - Manage credit cards and balance buckets
- **Transactions** - View and manage transactions
- **Import** - Import CSV bank statements
- **Budgets** - Set monthly budgets with AI suggestions
- **Forecast** - Run debt payoff forecasts

## Step 1: Add Your Accounts

Go to **Accounts** and add your bank accounts:
1. Enter account name (e.g. "Current Account", "Savings")
2. Select type (checking or savings)
3. Enter current balance
4. Click **Add**

## Step 2: Add Your Credit Cards

Go to **Credit Cards** and add each card:
1. Enter card name, standard APR (as decimal, e.g. 0.199 for 19.9%)
2. Set minimum payment percentage (e.g. 0.02 for 2%) and floor (e.g. 25)
3. Enter credit limit and statement date
4. Click **Add**

Then add **buckets** for each card:
- **Purchases bucket**: Name it "Purchases", type "purchases", enter balance
- **Balance transfer bucket**: Name it "0% BT", type "transfer", enter balance, set promo APR (0 for 0%), set promo end date

## Step 3: Import Bank Statements

Go to **Import**:
1. Select the account this statement belongs to
2. Choose your CSV file (supports Nationwide, Revolut, Virgin Money)
3. Click **Upload & Parse**
4. Review the parsed transactions:
   - Verify categories (auto-assigned by merchant name)
   - Check the "recurring bill" checkboxes for regular bills
   - Edit any incorrect categorizations
5. Click **Confirm & Save**

### Supported CSV Formats

| Bank | Auto-Detected By |
|------|-----------------|
| Nationwide | "Transaction type" and "Paid out" columns |
| Revolut | "Started Date" and "State" columns |
| Virgin Money | "Billing Amount" and "Debit or Credit" columns |
| Generic | "Date", "Amount", "Description" columns |

The parser handles:
- ISO-8859-1 encoding (Nationwide's pound sign)
- UTF-8 BOM (Revolut)
- Multiple date formats (DD/MM/YYYY, YYYY-MM-DD, DD-Mon-YY)

## Step 4: Set Monthly Budgets

Go to **Budgets**:
1. Select the month
2. Click **Get Suggestions** to analyze your spending patterns
   - Suggestions are based on the last 3 months of transactions
   - Confidence indicators: high (consistent), medium, low
   - You can edit suggested amounts before applying
3. Select the suggestions you want to apply
4. Click **Apply Selected**
5. Or manually add budgets by category and amount

## Step 5: Run Forecasts

### From the Dashboard
Click **Run Forecast (Avalanche)** for a quick forecast using available funds.

### From the Forecast Page
1. Choose strategy:
   - **Avalanche** - Pays highest APR first (saves most interest)
   - **Snowball** - Pays lowest balance first (quickest wins)
2. Set monthly payment budget:
   - Check "Auto from available funds" to use your calculated available amount
   - Or uncheck and enter a manual amount
3. Click **Run Forecast**

### Understanding the Results

- **Debt Over Time chart** - Stacked area chart showing each card's balance declining
- **Payment Breakdown chart** - Bar chart showing interest vs. minimum vs. extra payments
- **Avalanche Priority Order** - Cards ranked by APR (where extra payments go)
- **Payoff Schedule** - When each card reaches zero
- **Monthly Breakdown table** - Detailed month-by-month numbers
- **Cliff warnings** - Amber highlights when promo rates expire

### Live Recalculation
When you change the strategy or budget amount, the forecast automatically recalculates after a 600ms delay.

## Dashboard Overview

The dashboard shows:
- **Summary cards**: Total balance, total debt, available for debt, debt-free date, 12-month forecast
- **Debt projection chart**: 12-month line chart with per-card lines and cliff markers
- **Cliff warnings**: Upcoming promo rate expirations with monthly cost increase
- **Avalanche priority**: Cards in payment priority order
- **Payoff dates**: When each card will be paid off
- **Cash flow breakdown**: Account balances, recurring bills, budgets, card minimums, available

### Special States
- **Debt-free celebration**: When all card balances are zero, a green banner congratulates you
- **Overspend warning**: When outflows exceed your balance, a red warning shows the shortfall

## Electron Desktop App

### Development Mode
```bash
npm run electron:dev
```
This starts the server, client, and Electron window together.

### Build for Linux
```bash
npm run electron:build:linux
```
Produces `.deb` and `.AppImage` packages in `dist-electron/`.

The desktop app bundles both the Express server and React frontend. It connects to your local PostgreSQL database.
