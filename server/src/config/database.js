const { Sequelize } = require('sequelize');
require('dotenv').config();

const dbPassword = process.env.DB_PASSWORD || null;

const config = {
  dialect: 'postgres',
  logging: false,
  define: {
    underscored: true,
    timestamps: true,
  },
};

// Use Unix socket for local passwordless auth, TCP for remote/password
if (dbPassword) {
  config.host = process.env.DB_HOST || 'localhost';
  config.port = process.env.DB_PORT || 5432;
} else {
  config.host = '/var/run/postgresql';
}

const sequelize = new Sequelize(
  process.env.DB_NAME || 'personal_finance_dev',
  process.env.DB_USER || 'judah',
  dbPassword,
  config
);

module.exports = sequelize;
