// Missed tasks: at 23:10, any dated task that was not completed becomes MISSED.
// It stays on that day's record and does not carry over.
//
//   1. Convert the assignment status (only this person's; other assignees are unaffected)
//   2. Keep the original time, so the record of what was planned survives
//   3. Notify the employee; send admins one summary
//
// Reassigning a missed task creates a NEW task for the chosen person, date and
// time slot. The original stays MISSED and links to its replacement.

const { Op } = require('sequelize');
const ApiError = require('../utils/ApiError');
const {
  Task,
  TaskAssignee,
  TaskStatusHistory,
  User,
  Department,
  AttendanceException,
  CompanyOffDay,
  sequelize,
} = require('../models');
const { logAudit } = require('./audit.service');
const { getSchedule, endTimeFrom } = require('./schedule.service');
const clock = require('../utils/clock');
const jobs = require('./jobs.service');

const MISSED_HOUR = 23;
const MISSED_MINUTE = 10;

// Which assignments should be marked missed on `date`.
//   - the task is dated that day (or has a due date that day)
//   - the assignment is still open
//   - the company is not off that day
//   - the person is not on approved leave that day
const findMissed = async (date) => {
  const offDay = await CompanyOffDay.findOne({ where: { date }, attributes: ['date'] });
  if (offDay) return { date, skipped: 'company off day', candidates: [] };

  const leaveRows = await AttendanceException.findAll({
    where: { date, type: { [Op.in]: ['LEAVE'] } },
    attributes: ['employee_id'],
  });
  const onLeave = new Set(leaveRows.map((r) => r.employee_id));

  const rows = await TaskAssignee.findAll({
    where: { status: { [Op.in]: ['TODO', 'IN_PROGRESS', 'ON_HOLD'] } },
    include: [{
      model: Task,
      as: 'task',
      required: true,
      where: { is_archived: false, [Op.or]: [{ task_date: date }, { due_date: date }] },
      attributes: ['id', 'title', 'task_date', 'due_date'],
    }],
  });

  return { date, skipped: null, candidates: rows.filter((r) => !onLeave.has(r.employee_id)), onLeave };
};

const markMissed = async (date = clock.companyToday(), now = new Date()) => {
  const { skipped, candidates } = await findMissed(date);
  if (skipped) return { date, marked: 0, skipped };

  let marked = 0;
  const byEmployee = {};

  for (const a of candidates) {
    const transaction = await sequelize.transaction();
    try {
      const fresh = await TaskAssignee.findByPk(a.id, { transaction });
      if (!fresh || !['TODO', 'IN_PROGRESS', 'ON_HOLD'].includes(fresh.status)) {
        await transaction.rollback();
        continue;
      }
      fresh.status = 'MISSED';
      fresh.completed_at = null;
      await fresh.save({ transaction });
      await TaskStatusHistory.create(
        {
          task_assignee_id: fresh.id,
          old_status: a.status,
          new_status: 'MISSED',
          changed_by: null,
          change_note: `Not completed by ${MISSED_HOUR}:${String(MISSED_MINUTE).padStart(2, '0')} on ${date}`,
        },
        { transaction }
      );
      await transaction.commit();
      marked += 1;
      byEmployee[a.employee_id] = byEmployee[a.employee_id] || [];
      byEmployee[a.employee_id].push(a.task?.title || 'task');
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  if (marked > 0) {
    await logAudit({
      actor_user_id: null,
      action: 'MARK_MISSED_TASKS',
      entity_type: 'TASK_ASSIGNEE',
      new_values: { date, marked },
    });
    require('./notification-events.service').tasksMissed({ date, byEmployee });
    require('./dashboard-events.service').pingDashboard('TASK_STATUS_CHANGED');
  }

  return { date, marked, skipped: null };
};

// Admin: reassign a missed task. Creates a new task; the original stays MISSED.
const reassignMissed = async (assigneeId, { employee_id, date, start, duration_minutes, note }, adminUser) => {
  const original = await TaskAssignee.findByPk(assigneeId, {
    include: [{ model: Task, as: 'task' }],
  });
  if (!original) throw ApiError.notFound('Assignment not found');
  if (original.status !== 'MISSED') throw ApiError.badRequest('Only missed tasks can be reassigned');

  const employee = await User.findByPk(employee_id);
  if (!employee || !employee.is_active) throw ApiError.badRequest('Choose an active employee');

  const newDate = date || original.task.task_date || clock.companyToday();
  const startTime = start || original.task.start_time || '09:00';
  const minutes = Number(duration_minutes || 60);
  if (!Number.isInteger(minutes) || minutes <= 0) throw ApiError.badRequest('duration_minutes must be a positive number');

  const schedule = await getSchedule();
  const end = endTimeFrom(startTime, minutes, schedule);

  const transaction = await sequelize.transaction();
  try {
    const task = await Task.create(
      {
        title: original.task.title,
        description: original.task.description || '',
        project_id: original.task.project_id || null,
        priority: original.task.priority,
        task_date: newDate,
        start_time: startTime,
        end_time: end,
        task_type: 'ADDITIONAL',
        created_by: adminUser.id,
        reassigned_from: original.task_id,
      },
      { transaction }
    );
    const assignee = await TaskAssignee.create(
      { task_id: task.id, employee_id, assigned_by: adminUser.id, status: 'TODO' },
      { transaction }
    );
    await TaskStatusHistory.create(
      {
        task_assignee_id: assignee.id,
        old_status: 'NONE',
        new_status: 'TODO',
        changed_by: adminUser.id,
        change_note: note || `Reassigned from a missed task on ${original.task.task_date || 'an earlier date'}`,
      },
      { transaction }
    );
    await logAudit({
      actor_user_id: adminUser.id,
      action: 'REASSIGN_MISSED_TASK',
      entity_type: 'TASK_ASSIGNEE',
      entity_id: assignee.id,
      new_values: { original_task_id: original.task_id, employee_id, date: newDate, start: startTime, end },
      transaction,
    });
    await transaction.commit();

    require('./notification-events.service').taskAssigned({
      actor: adminUser,
      task,
      employeeIds: [employee_id],
    });

    return { task_id: task.id, assignee_id: assignee.id, employee_id, date: newDate, start_time: startTime, end_time: end };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

// Admin panel: who missed what on a date.
const missedSummary = async (date = clock.companyToday()) => {
  const rows = await TaskAssignee.findAll({
    where: { status: 'MISSED' },
    include: [
      {
        model: Task,
        as: 'task',
        required: true,
        where: { is_archived: false, [Op.or]: [{ task_date: date }, { due_date: date }] },
        attributes: ['id', 'title', 'task_date', 'start_time', 'end_time', 'reassigned_from'],
      },
      {
        model: User,
        as: 'employee',
        attributes: ['id', 'first_name', 'last_name', 'email'],
        include: [{ model: Department, as: 'department', attributes: ['name'] }],
      },
    ],
    order: [['updatedAt', 'DESC']],
  });

  const byEmployee = {};
  rows.forEach((r) => {
    const id = r.employee_id;
    if (!byEmployee[id]) {
      byEmployee[id] = {
        employee: r.employee,
        count: 0,
        tasks: [],
      };
    }
    byEmployee[id].count += 1;
    byEmployee[id].tasks.push({
      assignee_id: r.id,
      task_id: r.task.id,
      title: r.task.title,
      start_time: r.task.start_time,
      end_time: r.task.end_time,
    });
  });

  const people = Object.values(byEmployee).sort((a, b) => b.count - a.count);
  return { date, total: rows.length, people };
};

const registerMissedJob = () => {
  jobs.registerJob({
    name: 'missed-tasks',
    atHour: MISSED_HOUR,
    atMinute: MISSED_MINUTE,
    run: async () => {
      const r = await markMissed(clock.companyToday());
      if (r.marked) console.log(`[missed] ${r.date}: ${r.marked} assignment(s) marked missed`);
    },
  });
};

module.exports = { findMissed, markMissed, reassignMissed, missedSummary, registerMissedJob, MISSED_HOUR, MISSED_MINUTE };
