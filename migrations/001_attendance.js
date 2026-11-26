// Creates the attendance table for self-marking.
// One row per person per day; the unique constraint is what makes a double click safe.
// Safe to re-run: the table may exist without all indexes if an earlier run was interrupted.

const name = '001_attendance';

const hasIndex = async (queryInterface, indexName) => {
  const rows = await queryInterface.sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :n LIMIT 1`,
    { replacements: { n: indexName }, type: queryInterface.sequelize.QueryTypes.SELECT }
  );
  return rows.length > 0;
};

const up = async (queryInterface, DataTypes) => {
  const tables = await queryInterface.showAllTables();
  const exists = tables
    .map((t) => (typeof t === 'string' ? t : t.tableName))
    .includes('attendance');

  if (!exists) {
    await queryInterface.createTable('attendance', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      employee_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      marked_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      source: {
        type: DataTypes.ENUM('SELF', 'ADMIN'),
        allowNull: false,
        defaultValue: 'SELF',
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    console.log('  created attendance table');
  }

  if (!(await hasIndex(queryInterface, 'attendance_employee_date_unique'))) {
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX attendance_employee_date_unique ON attendance (employee_id, date)'
    );
    console.log('  created attendance_employee_date_unique');
  }
  if (!(await hasIndex(queryInterface, 'attendance_date_idx'))) {
    await queryInterface.sequelize.query('CREATE INDEX attendance_date_idx ON attendance (date)');
    console.log('  created attendance_date_idx');
  }
};

module.exports = { name, up };
