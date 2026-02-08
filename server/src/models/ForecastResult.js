const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ForecastResult = sequelize.define('ForecastResult', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  month: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  total_beginning_debt: {
    type: DataTypes.DECIMAL(10, 2),
  },
  total_interest: {
    type: DataTypes.DECIMAL(10, 2),
  },
  total_minimum_payments: {
    type: DataTypes.DECIMAL(10, 2),
  },
  total_extra_payments: {
    type: DataTypes.DECIMAL(10, 2),
  },
  total_ending_debt: {
    type: DataTypes.DECIMAL(10, 2),
  },
  debt_free_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  calculated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  card_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'credit_cards', key: 'id' },
  },
  card_beginning_balance: {
    type: DataTypes.DECIMAL(10, 2),
  },
  card_payment_allocation: {
    type: DataTypes.DECIMAL(10, 2),
  },
  card_ending_balance: {
    type: DataTypes.DECIMAL(10, 2),
  },
  card_payoff_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
}, {
  tableName: 'forecast_results',
  indexes: [
    { fields: ['month'] },
    { fields: ['card_id'] },
  ],
});

module.exports = ForecastResult;
