const { Op } = require('sequelize');
const ApiError = require('../utils/ApiError');
const {
  User,
  Department,
  Project,
  Task,
  TaskAssignee,
  DailyReport,
  DailyWorklog,
  WorklogCategory,
  ReportCorrection,
  AuditLog,
  sequelize,
} = require('../models');
const { logAudit } = require('./audit.service');
const { loadCalendarData } = require('./attendance.service');
const { getBoardSummary } = require('./attendance-status.service');

const getAdminDashboard = async (query = {}) => {
  // Use local date, not UTC, to avoid off-by-one in IST and similar timezones
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const date = query.date || localToday();

  const totalEmployees = await User.count({ where: { role: 'EMPLOYEE', is_active: true } });
  const totalManagers = await User.count({ where: { role: 'MANAGER', is_active: true } });
  const activeProjects = await Project.count({ where: { status: 'ACTIVE' } });
  const totalTasks = await Task.count({ where: { is_archived: false } });

  // Tasks by status
  const taskAssignments = await TaskAssignee.findAll({
    attributes: ['status'],
  });

  const taskStatusCounts = {
    TODO: 0,
    IN_PROGRESS: 0,
    ON_HOLD: 0,
    COMPLETED: 0,
    CANCELLED: 0,
  };

  taskAssignments.forEach(a => {
    if (taskStatusCounts[a.status] !== undefined) {
      taskStatusCounts[a.status]++;
    }
  });

  // Active reporting users (employees + managers) — used to determine who has / hasn't submitted for the date
  const activeReportingUsers = await User.findAll({
    where: { role: { [Op.in]: ['EMPLOYEE', 'MANAGER'] }, is_active: true },
    attributes: ['id', 'first_name', 'last_name', 'email', 'role'],
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
    order: [['first_name', 'ASC'], ['last_name', 'ASC']],
  });

  // Submitted reports for the selected date, with worklogs to compute effort
  const submittedReportsForDate = await DailyReport.findAll({
    where: { report_date: date, status: 'SUBMITTED' },
    include: [{ model: DailyWorklog, as: 'worklogs', attributes: ['duration_minutes'] }],
  });

  const submittedMap = {};
  submittedReportsForDate.forEach(r => {
    const total = (r.worklogs || []).reduce((sum, w) => sum + w.duration_minutes, 0);
    submittedMap[r.employee_id] = { submitted_at: r.submitted_at, total_minutes: total };
  });

  const submittedUsers = [];
  const pendingUsers = [];
  activeReportingUsers.forEach(e => {
    const base = {
      id: e.id,
      first_name: e.first_name,
      last_name: e.last_name,
      email: e.email,
      role: e.role,
      department: e.department,
    };
    if (submittedMap[e.id]) {
      submittedUsers.push({
        ...base,
        submitted_at: submittedMap[e.id].submitted_at,
        total_minutes: submittedMap[e.id].total_minutes,
      });
    } else {
      pendingUsers.push(base);
    }
  });

  // Time logged by category and project (company-wide, across all submitted reports)
  const submittedReports = await DailyReport.findAll({
    where: { status: 'SUBMITTED' },
    include: [
      {
        model: DailyWorklog,
        as: 'worklogs',
        include: [
          { model: Project, as: 'project', attributes: ['id', 'name'] },
          { model: WorklogCategory, as: 'category', attributes: ['id', 'name'] },
        ],
      },
      {
        model: User,
        as: 'employee',
        include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
      },
    ],
  });

  const projectHours = {};
  const departmentHours = {};

  submittedReports.forEach(report => {
    const deptName = report.employee?.department?.name || 'Unassigned';
    if (!departmentHours[deptName]) departmentHours[deptName] = 0;

    report.worklogs?.forEach(w => {
      const projName = w.project?.name || 'Unplanned / General';
      if (!projectHours[projName]) projectHours[projName] = 0;
      projectHours[projName] += w.duration_minutes / 60;
      departmentHours[deptName] += w.duration_minutes / 60;
    });
  });

  // Today's attendance summary (present / not yet / absent, cutoff time).
  // Only meaningful for today; the submission panels remain date-driven.
  const attendanceToday = await getBoardSummary();

  return {
    submission_date: date,
    attendance_today: attendanceToday,
    total_employees: totalEmployees,
    total_reporting_users: activeReportingUsers.length,
    total_managers: totalManagers,
    active_projects: activeProjects,
    total_tasks: totalTasks,
    task_status_counts: taskStatusCounts,
    submitted_count: submittedUsers.length,
    pending_count: pendingUsers.length,
    submitted_users: submittedUsers,
    pending_users: pendingUsers,
    project_hours: projectHours,
    department_hours: departmentHours,
  };
};

// Per-employee × per-day submission status grid for a date range
const getSubmissionTimeline = async (query = {}) => {
  const { start_date, end_date, department_id } = query;
  // Local date string to avoid UTC off-by-one
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const today = localToday();

  const end = end_date || today;
  let start = start_date;
  if (!start) {
    // default: last 7 days using string arithmetic
    const d = new Date();
    d.setDate(d.getDate() - 6);
    start = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  if (start > end) {
    throw ApiError.badRequest('start_date cannot be after end_date');
  }

  const userWhere = { role: { [Op.in]: ['EMPLOYEE', 'MANAGER'] }, is_active: true };
  if (department_id) userWhere.department_id = department_id;

  const [users, reports, { offDaySet, exceptionMap }] = await Promise.all([
    User.findAll({
      where: userWhere,
      attributes: ['id', 'first_name', 'last_name', 'email', 'role'],
      include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
      order: [['first_name', 'ASC'], ['last_name', 'ASC']],
    }),
    DailyReport.findAll({
      where: {
        report_date: { [Op.between]: [start, end] },
        status: 'SUBMITTED',
      },
      include: [{ model: DailyWorklog, as: 'worklogs', attributes: ['duration_minutes'] }],
    }),
    loadCalendarData(start, end),
  ]);

  const userIdSet = new Set(users.map(u => u.id));

  // Build submission matrix: employee_id → date → { status, total_minutes, submitted_at }
  const matrix = {};
  reports.forEach(r => {
    if (!userIdSet.has(r.employee_id)) return;
    const total = (r.worklogs || []).reduce((sum, w) => sum + w.duration_minutes, 0);
    if (!matrix[r.employee_id]) matrix[r.employee_id] = {};
    matrix[r.employee_id][r.report_date] = {
      status: 'SUBMITTED',
      total_minutes: total,
      submitted_at: r.submitted_at,
    };
  });

  // Build date list — pure local-date arithmetic, no UTC conversion
  const dates = [];
  const localDateStr = (d) =>
    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const addDays = (dateStr, n) => {
    const d = new Date(`${dateStr}T12:00:00`); // noon avoids DST edge cases
    d.setDate(d.getDate() + n);
    return localDateStr(d);
  };
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  // Per-date summary — only count working days (not off days)
  // For per-person: not off + not excepted = "expected"
  const summary = {};
  dates.forEach(d => {
    summary[d] = { submitted: 0, absent: 0, off: 0, missing: 0, total_users: users.length };
  });

  users.forEach(u => {
    dates.forEach(d => {
      const isOff = offDaySet.has(d);
      const exType = exceptionMap[u.id]?.[d];
      const submitted = matrix[u.id]?.[d];

      if (submitted) {
        summary[d].submitted++;
      } else if (isOff) {
        summary[d].off++;
      } else if (exType) {
        summary[d].absent++;
      } else {
        summary[d].missing++;
      }
    });
  });

  return {
    start_date: start,
    end_date: end,
    dates,
    users: users.map(u => ({
      id: u.id,
      first_name: u.first_name,
      last_name: u.last_name,
      email: u.email,
      role: u.role,
      department: u.department,
    })),
    matrix,
    off_days: [...offDaySet],
    exception_map: exceptionMap,
    summary,
    total_users: users.length,
  };
};

const getAllWorklogs = async (query = {}) => {
  const { employee_id, department_id, start_date, end_date, status = 'SUBMITTED' } = query;
  const where = {};
  if (status && status !== 'ALL') where.status = status;

  if (employee_id) where.employee_id = employee_id;

  if (start_date && end_date) {
    where.report_date = { [Op.between]: [start_date, end_date] };
  } else if (start_date) {
    where.report_date = { [Op.gte]: start_date };
  } else if (end_date) {
    where.report_date = { [Op.lte]: end_date };
  }

  const userWhere = {};
  if (department_id) {
    userWhere.department_id = department_id;
  }

  const reports = await DailyReport.findAll({
    where,
    include: [
      {
        model: User,
        as: 'employee',
        where: userWhere,
        attributes: ['id', 'first_name', 'last_name', 'email'],
        include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
      },
      {
        model: DailyWorklog,
        as: 'worklogs',
        include: [
          { model: WorklogCategory, as: 'category' },
          { model: Project, as: 'project', attributes: ['id', 'name'] },
          { model: Task, as: 'task', attributes: ['id', 'title'] },
        ],
      },
      {
        model: ReportCorrection,
        as: 'corrections',
        include: [{ model: User, as: 'corrector', attributes: ['id', 'first_name', 'last_name', 'email'] }],
      },
    ],
    order: [['report_date', 'DESC'], ['submitted_at', 'DESC']],
  });

  return reports;
};

const correctReport = async (reportId, { reason, entries }, adminUser) => {
  const report = await DailyReport.findByPk(reportId, {
    include: [{ model: DailyWorklog, as: 'worklogs' }],
  });

  if (!report) throw ApiError.notFound('Report not found');
  if (report.status !== 'SUBMITTED') {
    throw ApiError.badRequest('Can only perform corrections on submitted reports');
  }

  if (!reason || reason.trim().length < 5) {
    throw ApiError.badRequest('A clear reason (at least 5 characters) is required for audited corrections');
  }

  const beforeDataSnapshot = report.worklogs.map(w => w.toJSON());

  const transaction = await sequelize.transaction();
  try {
    // Remove existing worklogs
    await DailyWorklog.destroy({
      where: { daily_report_id: reportId },
      transaction,
    });

    // Create corrected worklogs
    const newWorklogRecords = entries.map(e => ({
      daily_report_id: reportId,
      category_id: e.category_id,
      description: e.description,
      duration_minutes: e.duration_minutes,
      task_id: e.task_id || null,
      project_id: e.project_id || null,
    }));

    await DailyWorklog.bulkCreate(newWorklogRecords, { transaction });

    // Store immutable correction audit record
    const correction = await ReportCorrection.create(
      {
        daily_report_id: reportId,
        corrected_by: adminUser.id,
        reason,
        before_data: beforeDataSnapshot,
        after_data: newWorklogRecords,
      },
      { transaction }
    );

    await logAudit({
      actor_user_id: adminUser.id,
      action: 'CORRECT_SUBMITTED_REPORT',
      entity_type: 'REPORT_CORRECTION',
      entity_id: correction.id,
      old_values: { entries: beforeDataSnapshot },
      new_values: { reason, entries: newWorklogRecords },
      transaction,
    });

    await transaction.commit();

    return await getAllWorklogs({ report_id: reportId });
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

const getAuditLogs = async (query = {}) => {
  const { limit = 100, entity_type, action } = query;
  const where = {};
  if (entity_type) where.entity_type = entity_type;
  if (action) where.action = action;

  return await AuditLog.findAll({
    where,
    include: [{ model: User, as: 'actor', attributes: ['id', 'first_name', 'last_name', 'email', 'role'] }],
    order: [['createdAt', 'DESC']],
    limit: parseInt(limit, 10),
  });
};

// Everything the admin needs for a single person's profile: profile, submission
// summary, their task assignments, and their full daily-worklog report history.
const getUserOverview = async (userId) => {
  const user = await User.findByPk(userId, {
    attributes: { exclude: ['password_hash'] },
    include: [
      { model: Department, as: 'department', attributes: ['id', 'name'] },
      {
        model: User,
        as: 'managedEmployees',
        attributes: ['id', 'first_name', 'last_name', 'email'],
        through: { attributes: [] },
      },
      {
        model: User,
        as: 'reportingManagers',
        attributes: ['id', 'first_name', 'last_name', 'email'],
        through: { attributes: [] },
      },
    ],
  });

  if (!user) throw ApiError.notFound('User not found');

  const reports = await DailyReport.findAll({
    where: { employee_id: userId },
    include: [
      {
        model: DailyWorklog,
        as: 'worklogs',
        include: [
          { model: WorklogCategory, as: 'category' },
          { model: Project, as: 'project', attributes: ['id', 'name'] },
          { model: Task, as: 'task', attributes: ['id', 'title'] },
        ],
      },
    ],
    order: [['report_date', 'DESC'], ['submitted_at', 'DESC']],
  });

  const taskAssignments = await TaskAssignee.findAll({
    where: { employee_id: userId },
    include: [
      {
        model: Task,
        as: 'task',
        required: false,
        where: { is_archived: false },
        include: [
          { model: Project, as: 'project', attributes: ['id', 'name'] },
          { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name', 'email'] },
        ],
      },
    ],
    order: [['createdAt', 'DESC']],
  });

  const submittedReports = reports.filter(r => r.status === 'SUBMITTED');
  const totalMinutes = submittedReports.reduce(
    (sum, r) => sum + (r.worklogs || []).reduce((s, w) => s + w.duration_minutes, 0),
    0
  );

  const tasksByStatus = { TODO: 0, IN_PROGRESS: 0, ON_HOLD: 0, COMPLETED: 0, CANCELLED: 0 };
  taskAssignments.forEach(a => {
    if (tasksByStatus[a.status] !== undefined) tasksByStatus[a.status]++;
  });

  return {
    user,
    reports,
    task_assignments: taskAssignments,
    summary: {
      total_reports: reports.length,
      submitted_reports: submittedReports.length,
      draft_reports: reports.length - submittedReports.length,
      last_submission_date: submittedReports[0]?.submitted_at || null,
      total_minutes_logged: totalMinutes,
      total_tasks: taskAssignments.length,
      tasks_by_status: tasksByStatus,
    },
  };
};

module.exports = {
  getAdminDashboard,
  getSubmissionTimeline,
  getAllWorklogs,
  correctReport,
  getAuditLogs,
  getUserOverview,
};
