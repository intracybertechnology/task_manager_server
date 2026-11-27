// tasks.status and task_assignees.status become STRING so 'MISSED' can be added.
// task_assignees.status was a Postgres ENUM with a not-null default; converting it
// keeps all existing rows (TODO, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED).
// Also adds tasks.reassigned_from, which links a reassigned task to the missed one.

const name = '009_missed_tasks';

const up = async (queryInterface, DataTypes) => {
  const sql = queryInterface.sequelize;

  const convertToVarchar = async (table, column, defaultVal) => {
    const rows = await sql.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${column}'`,
      { type: sql.QueryTypes.SELECT }
    );
    if (rows.length === 0) {
      await queryInterface.addColumn(table, column, {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: defaultVal,
      });
      console.log(`  added ${table}.${column}`);
      return;
    }
    if (rows[0].data_type !== 'USER-DEFINED') {
      console.log(`  ${table}.${column} already a plain type`);
      return;
    }
    // Postgres cannot change an enum column in place; drop default, cast, restore default.
    const typeName = (
      await sql.query(
        `SELECT t.typname FROM pg_type t JOIN pg_attribute a ON a.atttypid = t.oid
         JOIN pg_class c ON c.oid = a.attrelid
         WHERE c.relname = '${table}' AND a.attname = '${column}'`,
        { type: sql.QueryTypes.SELECT }
      )
    )[0]?.typname;
    await sql.query(`ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT`);
    await sql.query(
      `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE VARCHAR(16) USING "${column}"::text`
    );
    await sql.query(`ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT '${defaultVal}'`);
    if (typeName) {
      // The enum type is no longer referenced; drop it so it cannot be used again.
      await sql.query(`DROP TYPE IF EXISTS "${typeName}"`).catch(() => {});
    }
    console.log(`  converted ${table}.${column} enum -> varchar`);
  };

  await convertToVarchar('tasks', 'status', 'TODO');
  await convertToVarchar('task_assignees', 'status', 'TODO');

  const taskCols = await queryInterface.describeTable('tasks');
  if (!taskCols.reassigned_from) {
    await queryInterface.addColumn('tasks', 'reassigned_from', {
      type: DataTypes.UUID,
      allowNull: true,
    });
    console.log('  added tasks.reassigned_from');
  }

  const idx = await sql.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'task_assignees_status_date_idx'`,
    { type: sql.QueryTypes.SELECT }
  );
  if (idx.length === 0) {
    await sql.query('CREATE INDEX task_assignees_status_date_idx ON task_assignees (status)');
    console.log('  ensured task_assignees status index');
  }
};

module.exports = { name, up };
