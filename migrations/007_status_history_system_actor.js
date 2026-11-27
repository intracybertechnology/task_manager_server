// System events (recurring-task generation) have no human actor, so the status
// history must allow a null changed_by. The task itself records who created the
// template, and the history note names it.

const name = '007_status_history_system_actor';

const up = async (queryInterface) => {
  const sql = queryInterface.sequelize;
  const cols = await sql.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'task_status_history' AND column_name = 'changed_by'`,
    { type: sql.QueryTypes.SELECT }
  );
  if (cols.length && cols[0].is_nullable === 'NO') {
    await sql.query('ALTER TABLE task_status_history ALTER COLUMN changed_by DROP NOT NULL');
    console.log('  task_status_history.changed_by now allows null (system events)');
  } else {
    console.log('  task_status_history.changed_by already nullable');
  }
};

module.exports = { name, up };
