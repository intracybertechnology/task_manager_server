// Task library: a saved list of common tasks. Assigning from it pre-fills the
// task form; it never creates work by itself.

const name = '010_task_library';

const up = async (queryInterface, DataTypes) => {
  const tables = (await queryInterface.showAllTables()).map((t) =>
    typeof t === 'string' ? t : t.tableName
  );
  if (!tables.includes('task_library')) {
    await queryInterface.createTable('task_library', {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
      title: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
      project_id: { type: DataTypes.UUID, allowNull: true },
      estimated_minutes: { type: DataTypes.INTEGER, allowNull: true },
      priority: { type: DataTypes.ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT'), allowNull: false, defaultValue: 'MEDIUM' },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: { type: DataTypes.UUID, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    console.log('  created task_library');
  }
};

module.exports = { name, up };
