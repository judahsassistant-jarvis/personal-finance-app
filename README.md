# Personal Finance App

A personal cash flow and debt optimization application that imports bank statements, categorizes spending, calculates available funds, and runs debt payoff forecasts using the avalanche method.

## Features

- **CSV Statement Import** - Supports Nationwide, Revolut, and Virgin Money formats with auto-encoding detection
- **Transaction Categorization** - 50+ merchant normalizations, auto-categorization into 7 categories, recurring bill detection
- **Budget Management** - Monthly budget allocations with spending pattern analysis and AI-powered suggestions
- **Debt Optimization** - Avalanche (highest APR first) and snowball (lowest balance first) strategies
- **12-Month Forecasting** - Cash flow simulation with per-card breakdown, payoff dates, and total interest projections
- **Balance Transfer Cliff Detection** - Warns when promo rates expire and shows the interest impact
- **Live Re-Forecast** - Real-time recalculation as you adjust strategy or budget
- **Dashboard** - Summary cards, debt projection chart, avalanche priority, payoff timeline, cash flow breakdown
- **Electron Desktop App** - Runs as a native Linux desktop application

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | React 18, Vite, TailwindCSS v4, Redux Toolkit, Recharts |
| Backend | Express 5, Sequelize ORM, PostgreSQL |
| Desktop | Electron with electron-builder |
| Testing | Jest (unit + integration), custom e2e smoke tests |

## Prerequisites

- **Node.js** v18+
- **PostgreSQL** 14+ (running locally)
- **npm** v9+

## Quick Start

```bash
# 1. Clone the repository
git clone <repo-url>
cd personal-finance-app

# 2. Install dependencies
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# 3. Set up PostgreSQL
# Create database and user (adjust as needed)
createdb personal_finance
# Configure connection in server/.env

# 4. Start the application
npm run dev
```

The app will be available at:
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both server and client in dev mode (hot reload) |
| `npm run start` | Start both in production mode |
| `npm run build` | Build the React frontend |
| `npm run test` | Run e2e smoke tests (38 tests) |
| `npm run test:unit` | Run Jest unit tests (67 tests) |
| `npm run test:api` | Run Jest API integration tests (39 tests) |
| `npm run test:all` | Run all test suites |
| `npm run db:sync` | Sync database schema |
| `npm run electron:dev` | Run as Electron desktop app (dev mode) |
| `npm run electron:build:linux` | Build Linux packages (.deb, .AppImage) |

## Database

The app uses PostgreSQL with 9 tables:

- `accounts` - Bank accounts (checking/savings)
- `credit_cards` - Card details with APR and minimum payment rules
- `card_buckets` - Multiple balance buckets per card (purchases, balance transfers)
- `transactions` - Transaction records with categories and recurring flags
- `monthly_budgets` - Monthly budget allocations by category
- `debt_config` - Debt optimization strategy configuration
- `forecast_results` - Cached forecast output with per-card breakdowns
- `payoff_schedule` - Card payoff dates
- `audit_log` - Entity change tracking

Tables are auto-created/migrated on server startup via `sequelize.sync({ alter: true })`.

## Configuration

Create `server/.env` with:

```
DB_NAME=personal_finance
DB_USER=your_username
DB_PASS=
DB_HOST=/var/run/postgresql
DB_DIALECT=postgres
PORT=3001
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| CRUD | `/api/accounts` | Bank account management |
| CRUD | `/api/credit-cards` | Credit card management |
| CRUD | `/api/card-buckets` | Card bucket management |
| CRUD | `/api/transactions` | Transaction management |
| CRUD | `/api/budgets` | Budget management |
| GET | `/api/budgets/suggestions` | Budget suggestions based on spending |
| POST | `/api/budgets/apply-suggestions` | Apply budget suggestions |
| CRUD | `/api/debt-config` | Debt strategy configuration |
| POST | `/api/forecasts/calculate` | Run full forecast |
| POST | `/api/forecasts/recalculate` | Live re-forecast |
| GET | `/api/forecasts/strategy` | Avalanche priority order |
| GET | `/api/forecasts/cliffs` | Promo cliff warnings |
| POST | `/api/import/csv` | Upload and parse CSV |
| POST | `/api/import/confirm` | Save parsed transactions |
| GET | `/api/available` | Available funds calculation |

## Project Structure

```
personal-finance-app/
├── client/                 # React frontend
│   ├── src/
│   │   ├── pages/          # 7 pages (Dashboard, Accounts, etc.)
│   │   ├── components/     # Shared components
│   │   ├── store/          # Redux slices
│   │   └── api/            # API client functions
│   └── dist/               # Built output
├── server/                 # Express backend
│   ├── src/
│   │   ├── models/         # Sequelize models (9 tables)
│   │   ├── routes/         # API route handlers
│   │   ├── services/       # Business logic
│   │   │   ├── debtForecast.js     # Avalanche/snowball engine
│   │   │   ├── csvParser.js        # Multi-format CSV parser
│   │   │   └── budgetSuggestions.js # Spending analysis
│   │   ├── middleware/     # Validation, error handling
│   │   └── tests/          # Unit + integration tests
│   └── .env                # Database configuration
├── electron/               # Electron main process
│   └── main.js
└── package.json            # Root scripts + electron-builder config
```

## License

Private - Personal use only.
