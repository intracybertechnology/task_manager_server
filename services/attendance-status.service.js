// Single source of truth for a person's attendance status on a date.
// Every screen (admin board, timeline, employee button) must call these.
// The pure function is unit-tested in server/tests/unit/attendance.status.test.js.
//
// Rules (agreed):
//  - On a company off day nobody marks and nobody is absent: everyone is OFF.
//    The cutoff job does not run on off days.
//  - An explicit admin exception (leave / half-day / absent) wins over a self-mark.
//  - Before the 11:55 cutoff, an unmarked person today is NOT_YET.
//  - From 11:55 the cutoff job writes a SYSTEM absence. That absence sticks:
//    only an admin can change it. A self-mark cannot override a SYSTEM absence.
//  - A past working day with nothing recorded is ABSENT. A future day is FUTURE.

const { Op } = require('sequelize');
const ApiError = require('../utils/ApiError');
const { Attendance, AttendanceException, CompanyOffDay, User, AuditLog } = require('../models');
const { logAudit } = require('./audit.service');
const clock = require('../utils/clock');

const CUTOFF_HOUR = Number(process.env.ATTENDANCE_CUTOFF_HOUR || 11);
const CUTOFF_MINUTE = Number(process.env.ATTENDANCE_CUTOFF_MINUTE || 55);

const isPastCutoff = (parts) =>
  parts.hour > CUTOFF_HOUR || (parts.hour === CUTOFF_HOUR && parts.minute >= CUTOFF_MINUTE);

// Pure status rule. `cutoffPassed` and `isStickyAbsence` are supplied by callers
// so this stays testable without a clock or a database.
const computeStatus = ({
  date,
  today,
  attendance,
  exceptionType,
  isOffDay,
  cutoffPassed = false,
}) => {
  // 1. Company off day: nobody marks, nobody is absent.
  if (isOffDay) return 'OFF';

  // 2. An explicit admin decision is a correction to the record and wins.
  if (exceptionType === 'LEAVE') return 'LEAVE';
  if (exceptionType === 'HALF_DAY') return 'HALF_DAY';
  if (exceptionType === 'ABSENT') return 'ABSENT';

  // 3. A recorded mark is Present (a SYSTEM cutoff absence is never stored as an
  //    attendance row that counts as present — see loadAttendanceInputs).
  if (attendance) return 'PRESENT';

  // 4. Today: "Not yet" until the cutoff, then absent.
  if (date === today) return cutoffPassed ? 'ABSENT' : 'NOT_YET';
  if (date > today) return 'FUTURE';

  // 5. Past working day with nothing recorded is absent.
  return 'ABSENT';
};

// Bulk loader for a date range: returns everything the pure function needs.
const loadAttendanceInputs = async (start, end, employeeIds = null) => {
  const [marks, exceptions, offDays] = await Promise.all([
    Attendance.findAll({
      where: {
        date: { [Op.between]: [start, end] },
        ...(employeeIds ? { employee_id: { [Op.in]: employeeIds } } : {}),
      },
      attributes: ['employee_id', 'date', 'marked_at', 'source', 'cutoff_auto', 'absence_reason', 'cutoff_override_by', 'cutoff_override_at'],
    }),
    AttendanceException.findAll({
      where: {
        date: { [Op.between]: [start, end] },
        ...(employeeIds ? { employee_id: { [Op.in]: employeeIds } } : {}),
      },
      attributes: ['employee_id', 'date', 'type'],
    }),
    CompanyOffDay.findAll({
      where: { date: { [Op.between]: [start, end] } },
      attributes: ['date'],
    }),
  ]);

  const markMap = {};
  marks.forEach((m) => {
    markMap[m.employee_id] = markMap[m.employee_id] || {};
    markMap[m.employee_id][m.date] = {
      marked_at: m.marked_at,
      source: m.source,
      cutoff_auto: m.cutoff_auto,
      absence_reason: m.absence_reason,
      cutoff_override_by: m.cutoff_override_by,
      cutoff_override_at: m.cutoff_override_at,
    };
  });
  const exceptionMap = {};
  exceptions.forEach((e) => {
    exceptionMap[e.employee_id] = exceptionMap[e.employee_id] || {};
    exceptionMap[e.employee_id][e.date] = e.type;
  });
  const offDaySet = new Set(offDays.map((d) => d.date));

  return { markMap, exceptionMap, offDaySet };
};

// A stored row only counts as "present" if it is not an un-overridden cutoff absence.
const isPresentRow = (row) => Boolean(row) && !(row.cutoff_auto && row.source === 'SYSTEM');

const isStickyAbsence = (row) => Boolean(row) && row.cutoff_auto && row.source === 'SYSTEM';

const statusFor = ({ date, today, mark, exceptionType, isOffDay, cutoffPassed }) =>
  computeStatus({
    date,
    today,
    attendance: isPresentRow(mark) ? mark : null,
    exceptionType,
    isOffDay,
    cutoffPassed,
  });

const getMyToday = async (user, now = new Date()) => {
  const today = clock.companyToday(now);
  const [mark, exception, offDay] = await Promise.all([
    Attendance.findOne({ where: { employee_id: user.id, date: today } }),
    AttendanceException.findOne({ where: { employee_id: user.id, date: today } }),
    CompanyOffDay.findOne({ where: { date: today }, attributes: ['date'] }),
  ]);
  const isOffDay = Boolean(offDay);
  const cutoffPassed = isPastCutoff(clock.companyParts(now));
  const status = statusFor({
    date: today,
    today,
    mark,
    exceptionType: exception?.type || null,
    isOffDay,
    cutoffPassed,
  });
  return {
    date: today,
    status,
    is_off_day: isOffDay,
    marked_at: status === 'PRESENT' ? mark?.marked_at || null : null,
    // Employees cannot mark on an off day or after the cutoff.
    can_mark: status === 'NOT_YET',
    cutoff: `${String(CUTOFF_HOUR).padStart(2, '0')}:${String(CUTOFF_MINUTE).padStart(2, '0')}`,
  };
};

const markMe = async (user, now = new Date()) => {
  if (user.role === 'ADMIN') {
    throw ApiError.forbidden('Admins do not mark attendance');
  }
  const today = clock.companyToday(now);

  const offDay = await CompanyOffDay.findOne({ where: { date: today }, attributes: ['date'] });
  if (offDay) {
    throw ApiError.badRequest('Today is a company off day. Attendance is not marked.');
  }

  const existing = await Attendance.findOne({ where: { employee_id: user.id, date: today } });

  // Option B: once the cutoff marks someone absent, only an admin can change it.
  if (isStickyAbsence(existing)) {
    const message =
      existing.absence_reason === 'ADMIN'
        ? 'An admin marked you absent. Only an admin can change it.'
        : 'You were marked absent by the cutoff. Ask an admin to change it.';
    throw ApiError.forbidden(message);
  }
  if (existing) {
    return { date: today, marked_at: existing.marked_at, already_marked: true };
  }

  const record = await Attendance.create({
    employee_id: user.id,
    date: today,
    marked_at: now,
    source: 'SELF',
  });

  await logAudit({
    actor_user_id: user.id,
    action: 'MARK_ATTENDANCE',
    entity_type: 'ATTENDANCE',
    entity_id: record.id,
    new_values: { date: today, source: 'SELF' },
  });

  // Saved above; now announce to admins (never blocks the mark).
  require('./notification-events.service').attendanceMarked({ employee: user });

  return { date: today, marked_at: record.marked_at, already_marked: false };
};

// Admin override of a cutoff absence. Admin may set PRESENT, LEAVE, HALF_DAY or ABSENT.
const setStatus = async (adminUser, { employee_id, date, status, reason }, now = new Date()) => {
  const allowed = ['PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY'];
  if (!allowed.includes(status)) {
    throw ApiError.badRequest(`status must be one of ${allowed.join(', ')}`);
  }
  const employee = await User.findByPk(employee_id);
  if (!employee) throw ApiError.notFound('Employee not found');
  if (!date) throw ApiError.badRequest('date is required');

  const row = await Attendance.findOne({ where: { employee_id, date } });
  const offDay = await CompanyOffDay.findOne({ where: { date }, attributes: ['date'] });
  if (offDay) throw ApiError.badRequest('That date is a company off day; no attendance applies');

  const audit = { employee_id, date, status, reason: reason || null };

  if (status === 'PRESENT') {
    if (row) {
      row.source = row.cutoff_auto ? 'SYSTEM' : row.source === 'SYSTEM' ? 'ADMIN' : row.source;
      row.cutoff_auto = false;
      row.absence_reason = null;
      row.cutoff_override_by = adminUser.id;
      row.cutoff_override_at = now;
      await row.save();
    } else {
      await Attendance.create({
        employee_id,
        date,
        marked_at: now,
        source: 'ADMIN',
        cutoff_override_by: adminUser.id,
        cutoff_override_at: now,
      });
    }
    await AttendanceException.destroy({ where: { employee_id, date } });
  } else if (status === 'ABSENT') {
    if (row) {
      row.source = 'SYSTEM';
      row.cutoff_auto = true;
      row.absence_reason = 'ADMIN';
      row.cutoff_override_by = adminUser.id;
      row.cutoff_override_at = now;
      await row.save();
    } else {
      await Attendance.create({
        employee_id,
        date,
        marked_at: now,
        source: 'SYSTEM',
        cutoff_auto: true,
        absence_reason: 'ADMIN',
        cutoff_override_by: adminUser.id,
        cutoff_override_at: now,
      });
    }
  } else {
    // LEAVE / HALF_DAY live in attendance_exceptions, the existing admin table.
    await Attendance.destroy({ where: { employee_id, date } });
    await AttendanceException.findOrCreate({
      where: { employee_id, date },
      defaults: { employee_id, date, type: status, reason: reason || null, marked_by: adminUser.id },
    });
    await AttendanceException.update(
      { type: status, reason: reason !== undefined ? reason || null : null, marked_by: adminUser.id },
      { where: { employee_id, date } }
    );
  }

  await logAudit({
    actor_user_id: adminUser.id,
    action: 'SET_ATTENDANCE_STATUS',
    entity_type: 'ATTENDANCE',
    entity_id: row?.id || `${employee_id}_${date}`,
    new_values: audit,
  });

  require('./notification-events.service').attendanceStatusChanged({
    admin: adminUser,
    employee,
    status,
  });

  return { employee_id, date, status };
};

// The admin board: everyone active, grouped by status for the company date.
const getTodayBoard = async (now = new Date()) => {
  const parts = clock.companyParts(now);
  const today = parts.date;
  const users = await User.findAll({
    where: { is_active: true, role: { [Op.in]: ['EMPLOYEE', 'MANAGER'] } },
    attributes: ['id', 'first_name', 'last_name', 'email', 'role'],
    order: [['first_name', 'ASC']],
  });
  const { markMap, exceptionMap, offDaySet } = await loadAttendanceInputs(today, today);
  const isOffDay = offDaySet.has(today);
  const cutoffPassed = isPastCutoff(parts);

  // Who last changed each person's status, taken from the append-only audit log.
  // With several admins this is the only reliable record of who decided what.
  const recentChanges = await AuditLog.findAll({
    where: {
      action: 'SET_ATTENDANCE_STATUS',
      createdAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    order: [['createdAt', 'ASC']],
  });
  const changedBy = {};
  recentChanges.forEach((a) => {
    const id = a.new_values?.employee_id;
    if (!id) return;
    changedBy[id] = {
      admin_id: a.actor_user_id,
      at: a.createdAt,
      to: a.new_values?.status || null,
    };
  });
  const adminIds = [...new Set(Object.values(changedBy).map((c) => c.admin_id).filter(Boolean))];
  const admins = adminIds.length
    ? await User.findAll({ where: { id: { [Op.in]: adminIds } }, attributes: ['id', 'first_name', 'last_name', 'email'] })
    : [];
  const adminMap = new Map(admins.map((a) => [a.id, a]));
  const annotate = (user) => {
    const c = changedBy[user.id];
    if (!c) return { last_changed_by: null, last_changed_at: null };
    const a = adminMap.get(c.admin_id);
    return {
      last_changed_by: a ? { id: a.id, name: `${a.first_name} ${a.last_name}`, email: a.email } : null,
      last_changed_at: c.at,
    };
  };

  const present = [];
  const notYet = [];
  const absent = [];
  const other = [];

  users.forEach((u) => {
    const mark = markMap[u.id]?.[today] || null;
    const exceptionType = exceptionMap[u.id]?.[today] || null;
    const status = statusFor({ date: today, today, mark, exceptionType, isOffDay, cutoffPassed });
    const row = {
      id: u.id,
      first_name: u.first_name,
      last_name: u.last_name,
      email: u.email,
      role: u.role,
      status,
      marked_at: status === 'PRESENT' ? mark?.marked_at || null : null,
      cutoff_absence: isStickyAbsence(mark),
      absence_reason: isStickyAbsence(mark) ? mark.absence_reason || 'CUTOFF' : null,
      overridden: Boolean(mark?.cutoff_override_by),
      ...annotate(u),
    };
    if (status === 'PRESENT') present.push(row);
    else if (status === 'NOT_YET') notYet.push(row);
    else if (status === 'ABSENT') absent.push(row);
    else other.push(row);
  });

  return {
    date: today,
    is_off_day: isOffDay,
    cutoff_passed: cutoffPassed,
    cutoff: `${String(CUTOFF_HOUR).padStart(2, '0')}:${String(CUTOFF_MINUTE).padStart(2, '0')}`,
    counts: {
      present: present.length,
      not_yet: notYet.length,
      absent: absent.length,
      other: other.length,
      total: users.length,
    },
    all: users.map((u) => {
      const mark = markMap[u.id]?.[today] || null;
      const exceptionType = exceptionMap[u.id]?.[today] || null;
      return {
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        role: u.role,
        status: statusFor({ date: today, today, mark, exceptionType, isOffDay, cutoffPassed }),
        marked_at: mark && !isStickyAbsence(mark) ? mark.marked_at : null,
        cutoff_absence: isStickyAbsence(mark),
        absence_reason: isStickyAbsence(mark) ? mark.absence_reason || 'CUTOFF' : null,
        ...annotate(u),
      };
    }),
    present,
    not_yet: notYet,
    absent,
    other,
  };
};

// Compact summary for the admin Overview page: counts only, plus the cutoff.
const getBoardSummary = async (now = new Date()) => {
  const board = await getTodayBoard(now);
  return {
    date: board.date,
    is_off_day: board.is_off_day,
    cutoff: board.cutoff,
    cutoff_passed: board.cutoff_passed,
    counts: board.counts,
    present: board.present.map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, marked_at: p.marked_at })),
    absent: board.absent.map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, cutoff_absence: p.cutoff_absence })),
  };
};

module.exports = {
  computeStatus,
  isStickyAbsence,
  isPresentRow,
  isPastCutoff,
  loadAttendanceInputs,
  getMyToday,
  markMe,
  setStatus,
  getTodayBoard,
  getBoardSummary,
  CUTOFF_HOUR,
  CUTOFF_MINUTE,
};
