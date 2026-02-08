const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Account = sequelize.define('Account', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Account name is required' },
      len: { args: [1, 100], msg: 'Account name must be 1-100 characters' },
    },
  },
  type: {
    type: DataTypes.ENUM('checking', 'savings'),
    defaultValue: 'checking',
  },
  balance: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    validate: {
      isDecimal: { msg: 'Balance must be a valid number' },
    },
  },
}, {
  tableName: 'accounts',
});

module.exports = Account;
