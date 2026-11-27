const asyncHandler = require('../utils/asyncHandler');
const notificationService = require('../services/notification.service');

const listMine = asyncHandler(async (req, res) => {
  const data = await notificationService.listMine(req.user, {
    unreadOnly: req.query.unread === 'true',
    limit: req.query.limit,
  });
  res.status(200).json({ success: true, data });
});

const unreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.unreadCount(req.user);
  res.status(200).json({ success: true, data: { unread_count: count } });
});

const markRead = asyncHandler(async (req, res) => {
  const row = await notificationService.markRead(req.user, req.params.id);
  res.status(200).json({ success: true, data: row });
});

const markAllRead = asyncHandler(async (req, res) => {
  const data = await notificationService.markAllRead(req.user);
  res.status(200).json({ success: true, message: 'All notifications marked read', data });
});

const dismiss = asyncHandler(async (req, res) => {
  const data = await notificationService.dismiss(req.user, req.params.id);
  res.status(200).json({ success: true, message: 'Notification dismissed', data });
});

const clearRead = asyncHandler(async (req, res) => {
  const data = await notificationService.clearRead(req.user);
  res.status(200).json({ success: true, message: 'Read notifications cleared', data });
});

module.exports = { listMine, unreadCount, markRead, markAllRead, dismiss, clearRead };
