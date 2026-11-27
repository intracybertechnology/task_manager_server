const express = require('express');
const router = express.Router();
const controller = require('../controllers/notification.controller');
const authenticate = require('../middlewares/auth.middleware');

// Every signed-in user reads and manages only their own notifications.
router.use(authenticate);

router.get('/', controller.listMine);
router.get('/unread-count', controller.unreadCount);
router.post('/read-all', controller.markAllRead);
router.post('/clear-read', controller.clearRead);
router.patch('/:id/read', controller.markRead);
router.delete('/:id', controller.dismiss);

module.exports = router;
