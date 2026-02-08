require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { sequelize } = require('../models');

async function syncDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established.');

    await sequelize.sync({ alter: true });
    console.log('All tables synced successfully.');

    const [results] = await sequelize.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
    );
    console.log('\nTables in database:');
    results.forEach((r) => console.log(`  - ${r.tablename}`));
    console.log(`\nTotal: ${results.length} tables`);

    process.exit(0);
  } catch (error) {
    console.error('Database sync failed:', error.message);
    process.exit(1);
  }
}

syncDatabase();
