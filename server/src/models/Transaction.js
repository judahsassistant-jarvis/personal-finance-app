const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Transaction = sequelize.define('Transaction', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  account_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'accounts', key: 'id' },
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  merchant: {
    type: DataTypes.STRING(255),
  },
  description: {
    type: DataTypes.STRING(500),
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
  },
  category: {
    type: DataTypes.STRING(100),
    defaultValue: 'Other',
  },
  is_recurring_bill: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  suggested_category: {
    type: DataTypes.STRING(100),
  },
  notes: {
    type: DataTypes.TEXT,
  },
  imported_from: {
    type: DataTypes.STRING(50),
    defaultValue: 'manual',
  },
  import_batch_id: {
    type: DataTypes.UUID,
  },
}, {
  tableName: 'transactions',
  indexes: [
    { fields: ['date'] },
    { fields: ['category'] },
    { fields: ['is_recurring_bill'] },
    { fields: ['account_id'] },
  ],
});

module.exports = Transaction;
