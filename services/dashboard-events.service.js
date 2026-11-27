// Re-sends a lightweight signal over the socket whenever something the admin
// dashboard shows changes. The dashboard then re-reads its own data.
//
// This emits no personal data: just the event name. It is deliberately separate
// from notifications, which carry content and are saved per user.

const { emitToAdmins } = require('../realtime');

const DASHBOARD_EVENTS = {
  TASK_STATUS_CHANGED: 'dashboard:task',
  TASK_ASSIGNED: 'dashboard:task',
  RECURRING_TASK: 'dashboard:task',
  TASK_TIME_CHANGED: 'dashboard:task',
  ATTENDANCE_MARKED: 'dashboard:attendance',
  ATTENDANCE_STATUS_CHANGED: 'dashboard:attendance',
  ATTENDANCE_CUTOFF: 'dashboard:attendance',
};

// Call after the write has committed.
const pingDashboard = (type) => {
  const event = DASHBOARD_EVENTS[type];
  if (event) emitToAdmins(event, { at: new Date().toISOString() });
};

module.exports = { pingDashboard, DASHBOARD_EVENTS };
