const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CardBucket = sequelize.define('CardBucket', {
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
  bucket_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Bucket name is required' },
    },
  },
  bucket_type: {
    type: DataTypes.ENUM('transfer', 'purchases'),
    defaultValue: 'purchases',
  },
  current_balance: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
  },
  promo_apr: {
    type: DataTypes.DECIMAL(5, 3),
    defaultValue: 0,
  },
  promo_end_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
}, {
  tableName: 'card_buckets',
});

module.exports = CardBucket;
