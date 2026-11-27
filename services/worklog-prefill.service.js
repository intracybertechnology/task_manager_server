// Pre-fill the daily worklog from today's tasks.
//
// For the given person and company date:
//   - completed today's tasks become draft worklog entries (they are the work done)
//   - unfinished today's tasks are returned as a list, for an optional reason
//
// Nothing is written here: the client shows the suggestion and calls the normal
// addEntry endpoint, so every existing worklog rule still applies.

const { Op } = require('sequelize');
const { Task, TaskAssignee, DailyWorklog, TaskTimeChange } = require('../models');
const { toMinutes } = require('./schedule.service');
const clock = require('../utils/clock');

const minutesBetween = (start, end) => {
  if (!start || !end) return null;
  const diff = toMinutes(end) - toMinutes(start);
  return diff > 0 ? diff : null;
};

// The task's current length, then the original length, then 30 minutes.
// Worklog durations must be a multiple of 30, so round up to the next half hour.
const durationFor = async (task) => {
  const current = minutesBetween(task.start_time, task.end_time);
  let base = current;
  if (!base) {
    const first = await TaskTimeChange.findOne({
      where: { task_id: task.id },
      order: [['createdAt', 'ASC']],
      attributes: ['old_start', 'old_end'],
    });
    base = first ? minutesBetween(first.old_start, first.old_end) : null;
  }
  const minutes = base || 30;
  return Math.max(30, Math.ceil(minutes / 30) * 30);
};

const worklogPrefill = async (employeeId, date = clock.companyToday()) => {
  const assignments = await TaskAssignee.findAll({
    where: { employee_id: employeeId, status: { [Op.in]: ['COMPLETED', 'TODO', 'IN_PROGRESS', 'ON_HOLD', 'MISSED'] } },
    include: [{ model: Task, as: 'task', where: { task_date: date, is_archived: false }, attributes: ['id', 'title', 'start_time', 'end_time', 'task_type'] }],
  });

  // What has already been logged today, so the same task is not suggested twice.
  const loggedTaskIds = new Set();
  const worklogs = await DailyWorklog.findAll({
    where: { task_id: { [Op.ne]: null } },
    attributes: ['task_id', 'daily_report_id'],
    include: [{ model: require('../models').DailyReport, as: 'dailyReport', where: { employee_id: employeeId, report_date: date }, attributes: [] }],
  });
  worklogs.forEach((w) => loggedTaskIds.add(w.task_id));

  const completed = [];
  const unfinished = [];

  for (const a of assignments) {
    const task = a.task;
    if (!task) continue;
    const entry = {
      task_id: task.id,
      assignment_id: a.id,
      title: task.title,
      start_time: task.start_time,
      end_time: task.end_time,
      already_logged: loggedTaskIds.has(task.id),
    };
    if (a.status === 'COMPLETED') {
      entry.suggested_duration_minutes = await durationFor(task);
      completed.push(entry);
    } else {
      unfinished.push({ ...entry, status: a.status });
    }
  }

  return {
    date,
    completed,
    unfinished,
    suggested_entries: completed.filter((c) => !c.already_logged),
  };
};

module.exports = { worklogPrefill };
