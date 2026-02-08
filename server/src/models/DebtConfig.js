const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DebtConfig = sequelize.define('DebtConfig', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  month: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  monthly_payment_budget: {
    type: DataTypes.DECIMAL(10, 2),
  },
  strategy: {
    type: DataTypes.ENUM('avalanche', 'snowball'),
    defaultValue: 'avalanche',
  },
  auto_calculate: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  notes: {
    type: DataTypes.TEXT,
  },
}, {
  tableName: 'debt_config',
});

module.exports = DebtConfig;
