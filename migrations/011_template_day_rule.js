// Monthly templates get an explicit "day rule":
//   NTH  — run on day_of_month (1–31); months without that day are skipped
//   LAST — run on the last day of every month (handles Feb, leap years)
//
// 31 already means "last day" in the existing rule, so existing rows with 31
// migrate to LAST, and 1–30 migrate to NTH. Nothing else changes.

const name = '011_template_day_rule';

const up = async (queryInterface, DataTypes) => {
  const cols = await queryInterface.describeTable('task_templates');

  if (!cols.day_rule) {
    await queryInterface.addColumn('task_templates', 'day_rule', {
      type: DataTypes.STRING(8),
      allowNull: true,
    });
    console.log('  added task_templates.day_rule');
  }

  const sql = queryInterface.sequelize;
  await sql.query(
    `UPDATE task_templates SET day_rule = 'LAST' WHERE frequency = 'MONTHLY' AND day_rule IS NULL AND day_of_month >= 31`
  );
  await sql.query(
    `UPDATE task_templates SET day_rule = 'NTH' WHERE frequency = 'MONTHLY' AND day_rule IS NULL AND day_of_month IS NOT NULL AND day_of_month < 31`
  );
  console.log('  backfilled day_rule for existing monthly templates');
};

module.exports = { name, up };
