// Every change an employee makes to an assigned task's time is recorded:
// who, when, the old and new slot, and an optional reason. The admin is notified.
// The original times are never lost; the history is append-only.

const name = '008_task_time_changes';

const up = async (queryInterface, DataTypes) => {
  const tables = (await queryInterface.showAllTables()).map((t) =>
    typeof t === 'string' ? t : t.tableName
  );
  if (!tables.includes('task_time_changes')) {
    await queryInterface.createTable('task_time_changes', {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
      task_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'tasks', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      task_assignee_id: { type: DataTypes.UUID, allowNull: true },
      employee_id: { type: DataTypes.UUID, allowNull: false },
      old_date: { type: DataTypes.DATEONLY, allowNull: true },
      old_start: { type: DataTypes.STRING(5), allowNull: true },
      old_end: { type: DataTypes.STRING(5), allowNull: true },
      new_date: { type: DataTypes.DATEONLY, allowNull: true },
      new_start: { type: DataTypes.STRING(5), allowNull: false },
      new_end: { type: DataTypes.STRING(5), allowNull: false },
      reason: { type: DataTypes.STRING(500), allowNull: true },
      changed_by: { type: DataTypes.UUID, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    console.log('  created task_time_changes');
  }

  const sql = queryInterface.sequelize;
  const idx = await sql.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'task_time_changes_task_idx'`,
    { type: sql.QueryTypes.SELECT }
  );
  if (idx.length === 0) {
    await sql.query('CREATE INDEX task_time_changes_task_idx ON task_time_changes (task_id, "createdAt")');
    console.log('  created task_time_changes_task_idx');
  }
};

module.exports = { name, up };
