// Notifications: saved first, then pushed over the socket.
//
// Order matters. Every write goes to the database before any socket emit, so a
// notification is never lost if the recipient is offline, and a rollback cannot
// leave a toast on screen for something that did not happen.

const { Op } = require('sequelize');
const ApiError = require('../utils/ApiError');
const { Notification, User } = require('../models');
const { emitToUser } = require('../realtime');
const jobs = require('./jobs.service');

const RETENTION_DAYS = Number(process.env.NOTIFICATION_RETENTION_DAYS || 30);
const LIST_LIMIT = 50;

// Send one notification to one user. Returns the saved row.
const notifyUser = async ({ userId, type, title, body = null, link = null, taskId = null, socket = true }) => {
  if (!userId) return null;
  const row = await Notification.create({ user_id: userId, type, title, body, link, task_id: taskId });
  if (socket) {
    emitToUser(userId, 'notification', {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      link: row.link,
      task_id: row.task_id,
      createdAt: row.createdAt,
    });
  }
  return row;
};

// Send the same notification to several users (duplicates are removed).
const notifyUsers = async ({ userIds, ...rest }) => {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  const rows = [];
  for (const userId of unique) {
    rows.push(await notifyUser({ ...rest, userId }));
  }
  return rows;
};

// Send to every active admin. Admins are resolved at send time, so a newly
// added admin starts receiving immediately.
const notifyAdmins = async ({ type, title, body = null, link = null, taskId = null, excludeUserId = null }) => {
  const admins = await User.findAll({
    where: { role: 'ADMIN', is_active: true },
    attributes: ['id'],
  });
  const ids = admins.map((a) => a.id).filter((id) => id !== excludeUserId);
  // Each admin is pushed to through their own room, which is also how they
  // receive personal notifications, so nobody gets the same event twice.
  const rows = await notifyUsers({ userIds: ids, type, title, body, link, taskId });
  return rows;
};

// ── Reading ──────────────────────────────────────────────────────────────────

const listMine = async (user, { unreadOnly = false, limit = LIST_LIMIT } = {}) => {
  const where = { user_id: user.id };
  if (unreadOnly) where.is_read = false;
  const [rows, unread] = await Promise.all([
    Notification.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: Math.min(Number(limit) || LIST_LIMIT, LIST_LIMIT),
    }),
    Notification.count({ where: { user_id: user.id, is_read: false } }),
  ]);
  return { items: rows, unread_count: unread };
};

const unreadCount = async (user) =>
  Notification.count({ where: { user_id: user.id, is_read: false } });

// True when this user already has a notification of this type on the given day.
// Used so the login digest fires at most once per day per type.
const hasNotificationToday = async (userId, type, date) => {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  const count = await Notification.count({
    where: { user_id: userId, type, createdAt: { [Op.between]: [start, end] } },
  });
  return count > 0;
};

// ── Changing state ───────────────────────────────────────────────────────────

const markRead = async (user, id) => {
  const row = await Notification.findOne({ where: { id, user_id: user.id } });
  if (!row) throw ApiError.notFound('Notification not found');
  if (!row.is_read) {
    row.is_read = true;
    row.read_at = new Date();
    await row.save();
  }
  return row;
};

const markAllRead = async (user) => {
  const now = new Date();
  const [count] = await Notification.update(
    { is_read: true, read_at: now },
    { where: { user_id: user.id, is_read: false } }
  );
  return { marked: count };
};

const dismiss = async (user, id) => {
  const row = await Notification.findOne({ where: { id, user_id: user.id } });
  if (!row) throw ApiError.notFound('Notification not found');
  await row.destroy();
  return { success: true };
};

const clearRead = async (user) => {
  const deleted = await Notification.destroy({ where: { user_id: user.id, is_read: true } });
  return { deleted };
};

// ── Retention ────────────────────────────────────────────────────────────────

const deleteOld = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await Notification.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
  return { deleted, cutoff };
};

const registerCleanupJob = () => {
  jobs.registerJob({
    name: 'notification-cleanup',
    atHour: 2,
    atMinute: 15,
    run: async () => {
      const r = await deleteOld();
      if (r.deleted) console.log(`[notifications] deleted ${r.deleted} older than ${RETENTION_DAYS} days`);
    },
  });
};

module.exports = {
  notifyUser,
  notifyUsers,
  notifyAdmins,
  listMine,
  unreadCount,
  hasNotificationToday,
  markRead,
  markAllRead,
  dismiss,
  clearRead,
  deleteOld,
  registerCleanupJob,
  RETENTION_DAYS,
};
