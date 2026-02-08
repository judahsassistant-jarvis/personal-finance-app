const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CreditCard = sequelize.define('CreditCard', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Card name is required' },
      len: { args: [1, 100], msg: 'Card name must be 1-100 characters' },
    },
  },
  standard_apr: {
    type: DataTypes.DECIMAL(5, 3),
    validate: {
      min: { args: [0], msg: 'APR cannot be negative' },
    },
  },
  min_percentage: {
    type: DataTypes.DECIMAL(3, 2),
    defaultValue: 0.02,
  },
  min_floor: {
    type: DataTypes.DECIMAL(6, 2),
    defaultValue: 25.00,
  },
  credit_limit: {
    type: DataTypes.DECIMAL(10, 2),
  },
  statement_date: {
    type: DataTypes.INTEGER,
    validate: {
      min: { args: [1], msg: 'Statement date must be between 1 and 31' },
      max: { args: [31], msg: 'Statement date must be between 1 and 31' },
    },
  },
}, {
  tableName: 'credit_cards',
});

module.exports = CreditCard;
