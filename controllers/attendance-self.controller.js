const asyncHandler = require('../utils/asyncHandler');
const attendanceStatus = require('../services/attendance-status.service');

// Self-service attendance: employee and manager only (admin is blocked in the service).
const getMyToday = asyncHandler(async (req, res) => {
  const data = await attendanceStatus.getMyToday(req.user);
  res.status(200).json({ success: true, data });
});

const markMe = asyncHandler(async (req, res) => {
  const data = await attendanceStatus.markMe(req.user);
  res.status(data.already_marked ? 200 : 201).json({
    success: true,
    message: data.already_marked ? 'Already marked for today' : 'Attendance marked',
    data,
  });
});

module.exports = { getMyToday, markMe };
