// Records WHY an ABSENT attendance row exists, so the UI and the API can tell
// an 11:55 cutoff absence apart from one an admin set deliberately.
//
//   absence_reason = CUTOFF  written by the 11:55 job
//   absence_reason = ADMIN   set by an admin
//
// Both block the employee from re-marking (Option B). Only the explanation differs.

const name = '003_attendance_absence_reason';

const up = async (queryInterface, DataTypes) => {
  const cols = await queryInterface.describeTable('attendance');

  if (!cols.absence_reason) {
    await queryInterface.addColumn('attendance', 'absence_reason', {
      type: DataTypes.STRING(16),
      allowNull: true,
    });
    console.log('  added attendance.absence_reason');
  }

  // Backfill existing rows so the message is right for data written before this column.
  const sql = queryInterface.sequelize;
  await sql.query(
    `UPDATE attendance SET absence_reason = 'CUTOFF'
     WHERE absence_reason IS NULL AND source = 'SYSTEM' AND cutoff_auto = true
       AND cutoff_override_by IS NULL`
  );
  await sql.query(
    `UPDATE attendance SET absence_reason = 'ADMIN'
     WHERE absence_reason IS NULL AND source = 'SYSTEM' AND cutoff_auto = true
       AND cutoff_override_by IS NOT NULL`
  );
  console.log('  backfilled absence_reason');
};

module.exports = { name, up };
