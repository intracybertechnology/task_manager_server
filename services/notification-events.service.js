// Emits notifications for events the app already records. Each function creates
// a template, given the people involved. Failures are logged and never thrown:
// a notification must never break the action that triggered it.

const { User, ManagerEmployeeAccess } = require('../models');
const { notifyUser, notifyUsers, notifyAdmins, hasNotificationToday } = require('./notification.service');

const nameOf = (u) => (u ? `${u.first_name} ${u.last_name}`.trim() : 'Someone');

const safe = (fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (err) {
    console.error('[notifications] failed:', err.message);
    return null;
  }
};

// The manager(s) who have this employee in their team, plus all admins.
const supervisorsOf = async (employeeId) => {
  const access = await ManagerEmployeeAccess.findAll({
    where: { employee_id: employeeId },
    attributes: ['manager_id'],
  });
  return access.map((a) => a.manager_id);
};

const taskAssigned = safe(async ({ actor, task, employeeIds }) => {
  require('./dashboard-events.service').pingDashboard('TASK_ASSIGNED');
  const recipients = employeeIds.filter((id) => id !== actor.id);
  await notifyUsers({
    userIds: recipients,
    type: 'TASK_ASSIGNED',
    title: `New task assigned: ${task.title}`,
    body: `${nameOf(actor)} assigned this task to you.`,
    link: '/employee/tasks',
    taskId: task.id,
  });
});

// A comment tells the other side something happened, so:
//  - a comment by an employee or manager goes to their manager and to admins
//  - a comment by an admin goes to everyone assigned to the task
const taskCommentAdded = safe(async ({ actor, task, commentText, assigneeIds }) => {
  const excerpt = String(commentText || '').slice(0, 140);
  const title = `${nameOf(actor)} commented on "${task.title}"`;

  if (actor.role === 'ADMIN') {
    await notifyUsers({
      userIds: (assigneeIds || []).filter((id) => id !== actor.id),
      type: 'TASK_COMMENT',
      title,
      body: excerpt,
      link: '/employee/tasks',
      taskId: task.id,
    });
    return;
  }

  await notifyAdmins({ type: 'TASK_COMMENT', title, body: excerpt, excludeUserId: actor.id, taskId: task.id });
  const supervisors = (await supervisorsOf(actor.id)).filter((id) => id !== actor.id);
  await notifyUsers({
    userIds: supervisors,
    type: 'TASK_COMMENT',
    title,
    body: excerpt,
    link: '/manager/tasks',
    taskId: task.id,
  });
});

const taskStatusChanged = safe(async ({ actor, assignee, task, oldStatus, newStatus }) => {
  require('./dashboard-events.service').pingDashboard('TASK_STATUS_CHANGED');
  const employeeName = nameOf(assignee.employee || assignee);
  const title = `${employeeName} moved "${task.title}" to ${String(newStatus).replace('_', ' ')}`;
  const link = '/admin/submission-timeline';
  await notifyAdmins({ type: 'TASK_STATUS_CHANGED', title, excludeUserId: actor.id, taskId: task.id });
  const managers = (await supervisorsOf(assignee.employee_id)).filter((id) => id !== actor.id);
  await notifyUsers({ userIds: managers, type: 'TASK_STATUS_CHANGED', title, link, taskId: task.id });
});

const attendanceMarked = safe(async ({ employee }) => {
  require('./dashboard-events.service').pingDashboard('ATTENDANCE_MARKED');
  await notifyAdmins({
    type: 'ATTENDANCE_MARKED',
    title: `${nameOf(employee)} marked attendance`,
    body: 'Present today',
    link: '/admin/attendance',
  });
});

const attendanceStatusChanged = safe(async ({ admin, employee, status }) => {
  require('./dashboard-events.service').pingDashboard('ATTENDANCE_STATUS_CHANGED');
  if (employee.id === admin.id) return;
  await notifyUser({
    userId: employee.id,
    type: 'ATTENDANCE_STATUS_CHANGED',
    title: `Your attendance was set to ${String(status).replace('_', ' ').toLowerCase()}`,
    body: `Set by ${nameOf(admin)}.`,
    link: null,
  });
});

// Recurring tasks were generated for today. One notification per person,
// sent only after the tasks are committed.
const templateGenerated = safe(async ({ template, task, employeeIds }) => {
  require('./dashboard-events.service').pingDashboard('RECURRING_TASK');
  await notifyUsers({
    userIds: employeeIds,
    type: 'RECURRING_TASK',
    title: `New task: ${task.title}`,
    body: `Scheduled for ${task.task_date}${task.start_time ? ` at ${task.start_time}` : ''}.`,
    link: '/employee/tasks',
    taskId: task.id,
  });
});

// An assignee moved their task's time. Admins and the person's manager are told,
// including the original time, which is the doc's requirement.
const taskTimeChanged = safe(async ({ actor, task, employeeId, oldSlot, newSlot }) => {
  require('./dashboard-events.service').pingDashboard('TASK_TIME_CHANGED');
  const employee = await User.findByPk(employeeId, { attributes: ['first_name', 'last_name'] });
  const title = `${nameOf(employee)} moved "${task.title}" to ${newSlot.date} ${newSlot.start}–${newSlot.end}`;
  const body = `Was ${oldSlot.date || 'unscheduled'} ${oldSlot.start || ''}${oldSlot.end ? '–' + oldSlot.end : ''}.`.replace(/\s+/g, ' ').trim();

  await notifyAdmins({ type: 'TASK_TIME_CHANGED', title, body, excludeUserId: actor.id, taskId: task.id });
  const managers = (await supervisorsOf(employeeId)).filter((id) => id !== actor.id);
  await notifyUsers({ userIds: managers, type: 'TASK_TIME_CHANGED', title, body, link: '/manager/tasks', taskId: task.id });
});

// End of day: tasks left unfinished became MISSED.
// Each affected employee gets their own list; admins get ONE summary.
const tasksMissed = safe(async ({ date, byEmployee }) => {
  for (const [employeeId, titles] of Object.entries(byEmployee)) {
    await notifyUser({
      userId: employeeId,
      type: 'TASK_MISSED',
      title: `You missed ${titles.length} task${titles.length === 1 ? '' : 's'} on ${date}`,
      body: titles.slice(0, 5).join(', ') + (titles.length > 5 ? ', …' : ''),
      link: '/employee/tasks',
    });
  }

  const employees = await User.findAll({
    where: { id: Object.keys(byEmployee) },
    attributes: ['first_name', 'last_name'],
  });
  const names = employees.map((e) => `${e.first_name} ${e.last_name}`).join(', ');
  const total = Object.values(byEmployee).reduce((n, t) => n + t.length, 0);
  await notifyAdmins({
    type: 'TASK_MISSED_SUMMARY',
    title: `${total} task${total === 1 ? '' : 's'} missed on ${date}`,
    body: names,
    link: '/admin/missed',
  });
});

// Login digest: today's outstanding task count and a reminder to mark attendance.
// At most one of each type per person per day, however many times they log in.
const loginDigest = async ({ user }) => {
  try {
    const { Op } = require('sequelize');
    const { TaskAssignee, Task, Attendance } = require('../models');
    const clock = require('../utils/clock');

    const today = clock.companyToday();
    const [alreadyTasks, alreadyAttendance] = await Promise.all([
      hasNotificationToday(user.id, 'LOGIN_TASKS', today),
      hasNotificationToday(user.id, 'LOGIN_ATTENDANCE', today),
    ]);

    if (!alreadyTasks) {
      const open = await TaskAssignee.count({
        where: { employee_id: user.id, status: { [Op.in]: ['TODO', 'IN_PROGRESS', 'ON_HOLD'] } },
        include: [{ model: Task, as: 'task', where: { is_archived: false }, attributes: [] }],
      });
      if (open > 0) {
        await notifyUser({
          userId: user.id,
          type: 'LOGIN_TASKS',
          title: `You have ${open} task${open === 1 ? '' : 's'} still open`,
          body: 'Open My Tasks to see them.',
          link: '/employee/tasks',
        });
      }
    }

    if (!alreadyAttendance) {
      const markedToday = await Attendance.findOne({
        where: { employee_id: user.id, date: today },
        attributes: ['id'],
      });
      if (!markedToday) {
        await notifyUser({
          userId: user.id,
          type: 'LOGIN_ATTENDANCE',
          title: 'Have you marked attendance today?',
          body: 'Mark yourself present from the top bar.',
          link: null,
        });
      }
    }
  } catch (err) {
    console.error('[notifications] login digest failed:', err.message);
  }
};

module.exports = {
  taskAssigned,
  taskCommentAdded,
  taskStatusChanged,
  taskTimeChanged,
  tasksMissed,
  attendanceMarked,
  attendanceStatusChanged,
  templateGenerated,
  loginDigest,
};
