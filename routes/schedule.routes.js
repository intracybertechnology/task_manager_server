// Work schedule: admin edits the company's working hours and breaks.
// The full schedule (with the computed end time) is available to every signed-in
// user, because task forms show end times to employees too.

const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/role.middleware');
const schedule = require('../services/schedule.service');

router.use(authenticate);

const getSchedule = asyncHandler(async (req, res) => {
  const data = await schedule.getSchedule();
  res.status(200).json({ success: true, data });
});

const updateSchedule = asyncHandler(async (req, res) => {
  const data = await schedule.saveSchedule(req.body, req.user.id);
  res.status(200).json({ success: true, message: 'Work schedule saved', data });
});

// Preview: end time for a start and duration under the current schedule.
// Used by the admin form and by task forms, so the rule is only written once.
const previewEnd = asyncHandler(async (req, res) => {
  const scheduleData = await schedule.getSchedule();
  const start = req.query.start;
  const minutes = Number(req.query.minutes);
  const end = schedule.endTimeFrom(start, minutes, scheduleData);
  res.status(200).json({
    success: true,
    data: {
      start,
      minutes,
      end,
      starts_in_break: schedule.startsInBreak(start, scheduleData),
      inside_work_hours: schedule.isInsideWorkHours(start, scheduleData),
    },
  });
});

router.get('/', getSchedule);
router.get('/preview', previewEnd);
router.put('/', authorize('ADMIN'), updateSchedule);

module.exports = router;
