require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { sequelize } = require('./models');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const accountsRouter = require('./routes/accounts');
const creditCardsRouter = require('./routes/creditCards');
const cardBucketsRouter = require('./routes/cardBuckets');
const transactionsRouter = require('./routes/transactions');
const billsRouter = require('./routes/bills');
const debtConfigRouter = require('./routes/debtConfig');
const forecastsRouter = require('./routes/forecasts');
const importRouter = require('./routes/import');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/accounts', accountsRouter);
app.use('/api/credit-cards', creditCardsRouter);
app.use('/api/card-buckets', cardBucketsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/budgets', billsRouter);
app.use('/api/debt-config', debtConfigRouter);
app.use('/api/forecasts', forecastsRouter);
app.use('/api/import', importRouter);

// Error handler (must be last)
app.use(errorHandler);

// Start server
async function start() {
  try {
    await sequelize.authenticate();
    console.log('Database connected');

    // Sync tables in development
    await sequelize.sync({ alter: true });
    console.log('Database synced');

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log('API endpoints:');
      console.log('  GET  /api/health');
      console.log('  CRUD /api/accounts');
      console.log('  CRUD /api/credit-cards');
      console.log('  CRUD /api/card-buckets');
      console.log('  CRUD /api/transactions');
      console.log('  CRUD /api/budgets');
      console.log('  CRUD /api/debt-config');
      console.log('  GET  /api/forecasts');
      console.log('  POST /api/import/csv');
      console.log('  POST /api/import/confirm');
    });
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
