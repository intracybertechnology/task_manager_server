require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const run = async () => {
  try {
    await sequelize.authenticate();
    const qi = sequelize.getQueryInterface();
    const table = await qi.describeTable('daily_reports');
    if (table.auto_submitted) {
      console.log('daily_reports.auto_submitted already exists. Nothing to do.');
    } else {
      await qi.addColumn('daily_reports', 'auto_submitted', {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
      console.log('Added daily_reports.auto_submitted.');
    }
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
};

run();
