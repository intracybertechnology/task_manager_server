// Missed tasks: the admin panel for a date, and reassigning one.
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/role.middleware');
const missed = require('../services/missed.service');

router.use(authenticate);
router.use(authorize('ADMIN'));

const summary = asyncHandler(async (req, res) => {
  const data = await missed.missedSummary(req.query.date || undefined);
  res.status(200).json({ success: true, data });
});

const reassign = asyncHandler(async (req, res) => {
  const data = await missed.reassignMissed(req.params.assigneeId, req.body, req.user);
  res.status(201).json({ success: true, message: 'Task reassigned', data });
});

// Manual run for a date, useful for testing and catch-up.
const run = asyncHandler(async (req, res) => {
  const data = await missed.markMissed(req.body?.date || undefined);
  res.status(200).json({ success: true, data });
});

router.get('/', summary);
router.post('/run', run);
router.post('/:assigneeId/reassign', reassign);

module.exports = router;
