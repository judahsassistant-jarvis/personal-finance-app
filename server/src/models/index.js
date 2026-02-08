const sequelize = require('../config/database');
const Account = require('./Account');
const CreditCard = require('./CreditCard');
const CardBucket = require('./CardBucket');
const Transaction = require('./Transaction');
const MonthlyBudget = require('./MonthlyBudget');
const DebtConfig = require('./DebtConfig');
const ForecastResult = require('./ForecastResult');
const PayoffSchedule = require('./PayoffSchedule');
const AuditLog = require('./AuditLog');

// Associations
CreditCard.hasMany(CardBucket, { foreignKey: 'card_id', as: 'buckets', onDelete: 'CASCADE' });
CardBucket.belongsTo(CreditCard, { foreignKey: 'card_id', as: 'card' });

Account.hasMany(Transaction, { foreignKey: 'account_id', as: 'transactions', onDelete: 'CASCADE' });
Transaction.belongsTo(Account, { foreignKey: 'account_id', as: 'account' });

CreditCard.hasMany(ForecastResult, { foreignKey: 'card_id', as: 'forecastResults' });
ForecastResult.belongsTo(CreditCard, { foreignKey: 'card_id', as: 'card' });

CreditCard.hasMany(PayoffSchedule, { foreignKey: 'card_id', as: 'payoffSchedule', onDelete: 'CASCADE' });
PayoffSchedule.belongsTo(CreditCard, { foreignKey: 'card_id', as: 'card' });

module.exports = {
  sequelize,
  Account,
  CreditCard,
  CardBucket,
  Transaction,
  MonthlyBudget,
  DebtConfig,
  ForecastResult,
  PayoffSchedule,
  AuditLog,
};
