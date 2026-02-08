const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PayoffSchedule = sequelize.define('PayoffSchedule', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  card_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'credit_cards', key: 'id' },
  },
  payoff_month: {
    type: DataTypes.DATEONLY,
  },
  total_interest_on_card: {
    type: DataTypes.DECIMAL(10, 2),
  },
  calculated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'payoff_schedule',
});

module.exports = PayoffSchedule;
