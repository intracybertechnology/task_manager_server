// Adds task_id so a notification can open the exact task, instead of the task list.

const name = '005_notifications_task_link';

const up = async (queryInterface, DataTypes) => {
  const cols = await queryInterface.describeTable('notifications');
  if (!cols.task_id) {
    await queryInterface.addColumn('notifications', 'task_id', {
      type: DataTypes.UUID,
      allowNull: true,
    });
    console.log('  added notifications.task_id');
  }

  const sql = queryInterface.sequelize;
  const idx = await sql.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'notifications_user_created_idx'`,
    { type: sql.QueryTypes.SELECT }
  );
  if (idx.length === 0) {
    await sql.query('CREATE INDEX notifications_user_created_idx ON notifications (user_id, "createdAt")');
    console.log('  created notifications_user_created_idx');
  }
};

module.exports = { name, up };
