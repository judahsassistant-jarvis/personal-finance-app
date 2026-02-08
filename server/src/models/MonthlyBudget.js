const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const MonthlyBudget = sequelize.define('MonthlyBudget', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  month: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  budget_category: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  allocated_amount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
  },
  actual_spent: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
  },
  notes: {
    type: DataTypes.TEXT,
  },
}, {
  tableName: 'monthly_budgets',
  indexes: [
    { unique: true, fields: ['month', 'budget_category'] },
  ],
});

module.exports = MonthlyBudget;
