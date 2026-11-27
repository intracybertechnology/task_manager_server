// Employee time editing: an assignee can move their own task's slot for that day.
//
// Rules:
//   - today or a future date only
//   - not on a completed or cancelled assignment
//   - the new slot must be inside working hours and must not start inside a break
//   - an overlap with another of the person's tasks is a WARNING, not a block
//   - every change is recorded, and admins + the person's manager are notified
//   - a recurring task is edited for that one day only; the template is untouched

const { Op } = require('sequelize');
const ApiError = require('../utils/ApiError');
const { Task, TaskAssignee, TaskTimeChange, User } = require('../models');
const { logAudit } = require('./audit.service');
const { getSchedule, toMinutes, endTimeFrom, isInsideWorkHours, startsInBreak, rangesOverlap } = require('./schedule.service');
const clock = require('../utils/clock');

const BLOCKED_STATUSES = ['COMPLETED', 'CANCELLED'];

const canEditAssignment = (assignee, user) => {
  if (user.role === 'ADMIN') return true;
  return assignee.employee_id === user.id;
};

// Other tasks the same person has on the same date whose slots overlap the new one.
const findOverlaps = async ({ employeeId, date, start, end, excludeTaskId }) => {
  const others = await TaskAssignee.findAll({
    where: {
      employee_id: employeeId,
      status: { [Op.notIn]: BLOCKED_STATUSES },
      task_id: { [Op.ne]: excludeTaskId },
    },
    include: [{ model: Task, as: 'task', where: { task_date: date, is_archived: false }, attributes: ['id', 'title', 'start_time', 'end_time'] }],
  });
  return others
    .filter((a) => a.task.start_time && a.task.end_time && rangesOverlap(start, end, a.task.start_time, a.task.end_time))
    .map((a) => ({ task_id: a.task.id, title: a.task.title, start: a.task.start_time, end: a.task.end_time }));
};

const editAssignmentTime = async (assigneeId, { date, start, duration_minutes, reason }, user) => {
  const assignee = await TaskAssignee.findByPk(assigneeId, { include: [{ model: Task, as: 'task' }] });
  if (!assignee) throw ApiError.notFound('Task assignment not found');
  if (!canEditAssignment(assignee, user)) {
    throw ApiError.forbidden('You can only change the time of your own tasks');
  }
  const task = assignee.task;
  if (!task || task.is_archived) throw ApiError.notFound('Task not found');
  if (BLOCKED_STATUSES.includes(assignee.status)) {
    throw ApiError.badRequest(`This task is ${assignee.status.toLowerCase()}; its time cannot be changed`);
  }

  const today = clock.companyToday();
  const newDate = date || task.task_date || today;
  if (newDate < today) throw ApiError.badRequest('You can only change the time of today\'s or future tasks');

  if (!/^\d{2}:\d{2}$/.test(start || '')) throw ApiError.badRequest('start must be HH:MM');
  const schedule = await getSchedule();
  if (!isInsideWorkHours(start, schedule)) {
    throw ApiError.badRequest(`Start time must be inside working hours (${schedule.start}–${schedule.end})`);
  }
  if (startsInBreak(start, schedule)) {
    throw ApiError.badRequest('Start time falls inside a break');
  }

  // Duration: explicit if given, otherwise keep the task's current length.
  let minutes = duration_minutes;
  if (minutes === undefined || minutes === null) {
    if (task.start_time && task.end_time) {
      // Existing length is the *elapsed* time, breaks included: recompute below.
      minutes = null;
    }
  }
  const end = minutes
    ? endTimeFrom(start, Number(minutes), schedule)
    : endTimeFrom(start, Math.max(1, toMinutes(task.end_time) - toMinutes(task.start_time)), schedule);
  if (!isInsideWorkHours(end, schedule) || end < start) {
    throw ApiError.badRequest(`The task would end outside working hours (${schedule.start}–${schedule.end})`);
  }

  const overlaps = await findOverlaps({
    employeeId: assignee.employee_id,
    date: newDate,
    start,
    end,
    excludeTaskId: task.id,
  });

  const oldDate = task.task_date;
  const oldStart = task.start_time;
  const oldEnd = task.end_time;

  task.task_date = newDate;
  task.start_time = start;
  task.end_time = end;
  task.time_edited = true;
  await task.save();

  await TaskTimeChange.create({
    task_id: task.id,
    task_assignee_id: assignee.id,
    employee_id: assignee.employee_id,
    old_date: oldDate,
    old_start: oldStart,
    old_end: oldEnd,
    new_date: newDate,
    new_start: start,
    new_end: end,
    reason: reason || null,
    changed_by: user.id,
  });

  await logAudit({
    actor_user_id: user.id,
    action: 'EDIT_TASK_TIME',
    entity_type: 'TASK',
    entity_id: task.id,
    old_values: { date: oldDate, start: oldStart, end: oldEnd },
    new_values: { date: newDate, start, end, reason: reason || null },
  });

  // Notify admins and the person's manager; never blocks the edit.
  require('./notification-events.service').taskTimeChanged({
    actor: user,
    task,
    employeeId: assignee.employee_id,
    oldSlot: { date: oldDate, start: oldStart, end: oldEnd },
    newSlot: { date: newDate, start, end },
  });

  return {
    task_id: task.id,
    date: newDate,
    start_time: start,
    end_time: end,
    old: { date: oldDate, start_time: oldStart, end_time: oldEnd },
    overlaps,
    warning: overlaps.length ? 'This time overlaps another of your tasks.' : null,
  };
};

const timeChangesFor = async (taskId) =>
  TaskTimeChange.findAll({
    where: { task_id: taskId },
    include: [{ model: User, as: 'changer', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['createdAt', 'DESC']],
  });

module.exports = { editAssignmentTime, timeChangesFor };
