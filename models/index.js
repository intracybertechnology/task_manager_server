const sequelize = require('../config/database');
const User = require('./User');
const Department = require('./Department');
const ManagerEmployeeAccess = require('./ManagerEmployeeAccess');
const Project = require('./Project');
const ProjectMember = require('./ProjectMember');
const Task = require('./Task');
const TaskAssignee = require('./TaskAssignee');
const TaskComment = require('./TaskComment');
const TaskAttachment = require('./TaskAttachment');
const TaskStatusHistory = require('./TaskStatusHistory');
const WorklogCategory = require('./WorklogCategory');
const DailyReport = require('./DailyReport');
const DailyWorklog = require('./DailyWorklog');
const ReportCorrection = require('./ReportCorrection');
const AuditLog = require('./AuditLog');
const CompanySetting = require('./CompanySetting');
const CompanyOffDay = require('./CompanyOffDay');
const AttendanceException = require('./AttendanceException');
const Attendance = require('./Attendance');
// Department <-> User
Department.hasMany(User, { foreignKey: 'department_id', as: 'users' });
User.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });

// Manager <-> Employee relationship
User.belongsToMany(User, {
  through: ManagerEmployeeAccess,
  as: 'managedEmployees',
  foreignKey: 'manager_id',
  otherKey: 'employee_id',
});
User.belongsToMany(User, {
  through: ManagerEmployeeAccess,
  as: 'reportingManagers',
  foreignKey: 'employee_id',
  otherKey: 'manager_id',
});

// Project <-> User (Creator and Members)
Project.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
User.hasMany(Project, { foreignKey: 'created_by', as: 'createdProjects' });

Project.belongsToMany(User, {
  through: ProjectMember,
  as: 'members',
  foreignKey: 'project_id',
  otherKey: 'employee_id',
});
User.belongsToMany(Project, {
  through: ProjectMember,
  as: 'assignedProjects',
  foreignKey: 'employee_id',
  otherKey: 'project_id',
});

// Task <-> User (Creator)
Task.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });
User.hasMany(Task, { foreignKey: 'created_by', as: 'createdTasks' });

// Task <-> Project
Task.belongsTo(Project, { foreignKey: 'project_id', as: 'project' });
Project.hasMany(Task, { foreignKey: 'project_id', as: 'tasks' });

// Task <-> TaskAssignee <-> User
Task.hasMany(TaskAssignee, { foreignKey: 'task_id', as: 'assignees' });
TaskAssignee.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });

User.hasMany(TaskAssignee, { foreignKey: 'employee_id', as: 'taskAssignments' });
TaskAssignee.belongsTo(User, { foreignKey: 'employee_id', as: 'employee' });
TaskAssignee.belongsTo(User, { foreignKey: 'assigned_by', as: 'assigner' });

// Task <-> TaskComment
Task.hasMany(TaskComment, { foreignKey: 'task_id', as: 'comments' });
TaskComment.belongsTo(Task, { foreignKey: 'task_id' });
TaskComment.belongsTo(User, { foreignKey: 'user_id', as: 'author' });

// Task <-> TaskAttachment
Task.hasMany(TaskAttachment, { foreignKey: 'task_id', as: 'attachments' });
TaskAttachment.belongsTo(Task, { foreignKey: 'task_id' });
TaskAttachment.belongsTo(User, { foreignKey: 'uploaded_by', as: 'uploader' });

// TaskAssignee <-> TaskStatusHistory
TaskAssignee.hasMany(TaskStatusHistory, { foreignKey: 'task_assignee_id', as: 'statusHistories' });
TaskStatusHistory.belongsTo(TaskAssignee, { foreignKey: 'task_assignee_id' });
TaskStatusHistory.belongsTo(User, { foreignKey: 'changed_by', as: 'changer' });

// DailyReport <-> User
User.hasMany(DailyReport, { foreignKey: 'employee_id', as: 'dailyReports' });
DailyReport.belongsTo(User, { foreignKey: 'employee_id', as: 'employee' });

// DailyReport <-> DailyWorklog
DailyReport.hasMany(DailyWorklog, { foreignKey: 'daily_report_id', as: 'worklogs' });
DailyWorklog.belongsTo(DailyReport, { foreignKey: 'daily_report_id', as: 'dailyReport' });

// DailyWorklog <-> Task, TaskAssignee, Category, Project
DailyWorklog.belongsTo(Task, { foreignKey: 'task_id', as: 'task' });
Task.hasMany(DailyWorklog, { foreignKey: 'task_id', as: 'worklogs' });

DailyWorklog.belongsTo(TaskAssignee, { foreignKey: 'task_assignee_id', as: 'taskAssignee' });

DailyWorklog.belongsTo(WorklogCategory, { foreignKey: 'category_id', as: 'category' });
WorklogCategory.hasMany(DailyWorklog, { foreignKey: 'category_id', as: 'worklogs' });

DailyWorklog.belongsTo(Project, { foreignKey: 'project_id', as: 'project' });
Project.hasMany(DailyWorklog, { foreignKey: 'project_id', as: 'worklogs' });

// DailyReport <-> ReportCorrection
DailyReport.hasMany(ReportCorrection, { foreignKey: 'daily_report_id', as: 'corrections' });
ReportCorrection.belongsTo(DailyReport, { foreignKey: 'daily_report_id', as: 'dailyReport' });
ReportCorrection.belongsTo(User, { foreignKey: 'corrected_by', as: 'corrector' });

// AuditLog <-> User
AuditLog.belongsTo(User, { foreignKey: 'actor_user_id', as: 'actor' });

// CompanyOffDay <-> User (creator)
CompanyOffDay.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

// AttendanceException <-> User
AttendanceException.belongsTo(User, { foreignKey: 'employee_id', as: 'employee' });
AttendanceException.belongsTo(User, { foreignKey: 'marked_by', as: 'marker' });
User.hasMany(AttendanceException, { foreignKey: 'employee_id', as: 'attendanceExceptions' });

// Attendance (self-marked presence) <-> User
Attendance.belongsTo(User, { foreignKey: 'employee_id', as: 'employee' });
User.hasMany(Attendance, { foreignKey: 'employee_id', as: 'attendanceRecords' });

module.exports = {
  sequelize,
  User,
  Department,
  ManagerEmployeeAccess,
  Project,
  ProjectMember,
  Task,
  TaskAssignee,
  TaskComment,
  TaskAttachment,
  TaskStatusHistory,
  WorklogCategory,
  DailyReport,
  DailyWorklog,
  ReportCorrection,
  AuditLog,
  CompanySetting,
  CompanyOffDay,
  AttendanceException,
  Attendance,
};
