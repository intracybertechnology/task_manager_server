// Source values for attendance rows, plus the columns that make a cutoff absence
// auditable and distinguishable from a self-mark or an admin decision.
//
//   source = SELF    the person marked themselves
//   source = SYSTEM  written by the 11:55 cutoff job (cutoff_auto = true)
//   source = ADMIN   written by an admin override
//
// An admin changing a cutoff absence records cutoff_override_by / cutoff_override_at.

const name = '002_attendance_cutoff';

const up = async (queryInterface, DataTypes) => {
  const sql = queryInterface.sequelize;

  const enumRows = await sql.query(
    `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'enum_attendance_source'`,
    { type: sql.QueryTypes.SELECT }
  );
  const existing = enumRows.map((r) => r.enumlabel);
  if (!existing.includes('SYSTEM')) {
    await sql.query(`ALTER TYPE "enum_attendance_source" ADD VALUE 'SYSTEM'`);
    console.log('  added SYSTEM to enum_attendance_source');
  }

  const cols = await queryInterface.describeTable('attendance');

  if (!cols.cutoff_auto) {
    await queryInterface.addColumn('attendance', 'cutoff_auto', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    console.log('  added attendance.cutoff_auto');
  }

  if (!cols.cutoff_override_at) {
    await queryInterface.addColumn('attendance', 'cutoff_override_at', {
      type: DataTypes.DATE,
      allowNull: true,
    });
    console.log('  added attendance.cutoff_override_at');
  }

  if (!cols.cutoff_override_by) {
    await queryInterface.addColumn('attendance', 'cutoff_override_by', {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
    console.log('  added attendance.cutoff_override_by');
  }
};

module.exports = { name, up };
