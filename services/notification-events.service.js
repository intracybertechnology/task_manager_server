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
  const employeeName = nameOf(assignee.employee || assignee);
  const title = `${employeeName} moved "${task.title}" to ${String(newStatus).replace('_', ' ')}`;
  const link = '/admin/submission-timeline';
  await notifyAdmins({ type: 'TASK_STATUS_CHANGED', title, excludeUserId: actor.id, taskId: task.id });
  const managers = (await supervisorsOf(assignee.employee_id)).filter((id) => id !== actor.id);
  await notifyUsers({ userIds: managers, type: 'TASK_STATUS_CHANGED', title, link, taskId: task.id });
});

const attendanceMarked = safe(async ({ employee }) => {
  await notifyAdmins({
    type: 'ATTENDANCE_MARKED',
    title: `${nameOf(employee)} marked attendance`,
    body: 'Present today',
    link: '/admin/attendance',
  });
});

const attendanceStatusChanged = safe(async ({ admin, employee, status }) => {
  if (employee.id === admin.id) return;
  await notifyUser({
    userId: employee.id,
    type: 'ATTENDANCE_STATUS_CHANGED',
    title: `Your attendance was set to ${String(status).replace('_', ' ').toLowerCase()}`,
    body: `Set by ${nameOf(admin)}.`,
    link: null,
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
  attendanceMarked,
  attendanceStatusChanged,
  loginDigest,
};
