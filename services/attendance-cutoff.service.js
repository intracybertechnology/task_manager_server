// The 11:55 attendance cutoff.
// For the company date, everyone active who has no attendance row and no explicit
// exception (leave / half-day / absent) gets a SYSTEM absence written.
// Rules:
//   - never runs on a company off day
//   - never touches someone who already marked
//   - safe to run twice (unique row per person per day)
// Registered on the shared job runner, so it runs once per day and catches up
// after a restart.

const { Op } = require('sequelize');
const { Attendance, AttendanceException, CompanyOffDay, User } = require('../models');
const { logAudit } = require('./audit.service');
const clock = require('../utils/clock');
const jobs = require('./jobs.service');
const { CUTOFF_HOUR, CUTOFF_MINUTE } = require('./attendance-status.service');

const runCutoff = async (now = new Date()) => {
  const date = clock.companyToday(now);
  const parts = clock.companyParts(now);

  const skipped = (why) => ({ date, written: 0, skipped: why });

  if (parts.hour < CUTOFF_HOUR || (parts.hour === CUTOFF_HOUR && parts.minute < CUTOFF_MINUTE)) {
    return skipped('before cutoff');
  }

  const offDay = await CompanyOffDay.findOne({ where: { date }, attributes: ['date'] });
  if (offDay) return skipped('company off day');

  const users = await User.findAll({
    where: { is_active: true, role: { [Op.in]: ['EMPLOYEE', 'MANAGER'] } },
    attributes: ['id'],
  });
  if (users.length === 0) return skipped('no active users');

  const ids = users.map((u) => u.id);
  const [marks, exceptions] = await Promise.all([
    Attendance.findAll({ where: { date }, attributes: ['employee_id'] }),
    AttendanceException.findAll({ where: { date }, attributes: ['employee_id', 'type'] }),
  ]);

  const marked = new Set(marks.map((m) => m.employee_id));
  const excepted = new Set(
    exceptions.filter((e) => ['LEAVE', 'HALF_DAY', 'ABSENT'].includes(e.type)).map((e) => e.employee_id)
  );

  const toAbsent = ids.filter((id) => !marked.has(id) && !excepted.has(id));

  let written = 0;
  for (const employee_id of toAbsent) {
    const [record, created] = await Attendance.findOrCreate({
      where: { employee_id, date },
      defaults: { employee_id, date, marked_at: now, source: 'SYSTEM', cutoff_auto: true, absence_reason: 'CUTOFF' },
    });
    if (!created) continue;
    written++;
    await logAudit({
      actor_user_id: null,
      action: 'ATTENDANCE_CUTOFF_ABSENT',
      entity_type: 'ATTENDANCE',
      entity_id: record.id,
      new_values: { employee_id, date, cutoff: `${CUTOFF_HOUR}:${String(CUTOFF_MINUTE).padStart(2, '0')}` },
    });
  }

  return { date, written, skipped: written === 0 ? 'nobody to mark absent' : null };
};

const registerCutoffJob = () => {
  jobs.registerJob({ name: 'attendance-cutoff', atHour: CUTOFF_HOUR, atMinute: CUTOFF_MINUTE, run: () => runCutoff() });
};

module.exports = { runCutoff, registerCutoffJob };
