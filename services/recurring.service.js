// Recurring task templates: admin CRUD, and the daily job that creates tasks.
//
// Safety rules the job relies on:
//   - one task per template per date (unique index), so running it twice is safe
//   - company off days skip the whole template
//   - people on approved leave are skipped
//   - notifications go out only for tasks actually created

const { Op } = require('sequelize');
const ApiError = require('../utils/ApiError');
const {
  TaskTemplate,
  TemplateMember,
  Task,
  TaskAssignee,
  TaskStatusHistory,
  User,
  Department,
  AttendanceException,
  CompanyOffDay,
  sequelize,
} = require('../models');
const { logAudit } = require('./audit.service');
const { getSchedule, endTimeFrom } = require('./schedule.service');
const { templateRunsOn, resolveAssignees, templateSkippedOn } = require('./recurring-rules');
const clock = require('../utils/clock');
const jobs = require('./jobs.service');

const TEMPLATE_INCLUDE = [
  { model: TemplateMember, as: 'members', include: [{ model: User, as: 'employee', attributes: ['id', 'first_name', 'last_name', 'email'] }] },
  { model: Department, as: 'department', attributes: ['id', 'name'] },
  { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'] },
];

const validateTemplateInput = (data) => {
  if (!data.title || !String(data.title).trim()) throw ApiError.badRequest('Title is required');
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(data.frequency)) {
    throw ApiError.badRequest('Frequency must be DAILY, WEEKLY or MONTHLY');
  }
  if (!/^\d{2}:\d{2}$/.test(data.start_time || '')) throw ApiError.badRequest('start_time must be HH:MM');
  const duration = Number(data.duration_minutes);
  if (!Number.isInteger(duration) || duration <= 0) throw ApiError.badRequest('duration_minutes must be a positive whole number');

  if (data.frequency === 'WEEKLY') {
    const days = Array.isArray(data.weekdays) ? data.weekdays.map(Number) : [];
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw ApiError.badRequest('weekdays must be 0–6 (0 = Sunday)');
  }
  if (data.frequency === 'MONTHLY') {
    const d = Number(data.day_of_month);
    if (!Number.isInteger(d) || d < 1 || d > 31) throw ApiError.badRequest('day_of_month must be 1–31');
  }
  if (!['DEPARTMENT', 'PEOPLE'].includes(data.assignee_mode || 'DEPARTMENT')) {
    throw ApiError.badRequest('assignee_mode must be DEPARTMENT or PEOPLE');
  }
  return {
    title: String(data.title).trim(),
    description: data.description || '',
    department_id: data.department_id || null,
    project_id: data.project_id || null,
    frequency: data.frequency,
    weekdays: data.frequency === 'WEEKLY' ? [...new Set((data.weekdays || []).map(Number))] : [],
    day_of_month: data.frequency === 'MONTHLY' ? Number(data.day_of_month) : null,
    start_time: data.start_time,
    duration_minutes: duration,
    priority: data.priority || 'MEDIUM',
    assignee_mode: data.assignee_mode || 'DEPARTMENT',
    is_active: data.is_active !== false,
  };
};

const listTemplates = async () =>
  TaskTemplate.findAll({ include: TEMPLATE_INCLUDE, order: [['createdAt', 'DESC']] });

const getTemplate = async (id) => {
  const t = await TaskTemplate.findByPk(id, { include: TEMPLATE_INCLUDE });
  if (!t) throw ApiError.notFound('Template not found');
  return t;
};

const setMembers = async (templateId, members, transaction) => {
  if (!Array.isArray(members)) return;
  await TemplateMember.destroy({ where: { template_id: templateId }, transaction });
  if (members.length) {
    await TemplateMember.bulkCreate(
      members.map((m) => ({ template_id: templateId, employee_id: m.employee_id, mode: m.mode === 'EXCLUDE' ? 'EXCLUDE' : 'ADD' })),
      { transaction }
    );
  }
};

const createTemplate = async (data, actorId) => {
  const clean = validateTemplateInput(data);
  const transaction = await sequelize.transaction();
  try {
    const template = await TaskTemplate.create({ ...clean, created_by: actorId }, { transaction });
    await setMembers(template.id, data.members || [], transaction);
    await logAudit({
      actor_user_id: actorId,
      action: 'CREATE_TASK_TEMPLATE',
      entity_type: 'TASK_TEMPLATE',
      entity_id: template.id,
      new_values: clean,
      transaction,
    });
    await transaction.commit();
    return await getTemplate(template.id);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

const updateTemplate = async (id, data, actorId) => {
  const template = await TaskTemplate.findByPk(id);
  if (!template) throw ApiError.notFound('Template not found');
  const clean = validateTemplateInput({ ...template.toJSON(), ...data });
  const transaction = await sequelize.transaction();
  try {
    await template.update(clean, { transaction });
    if (data.members !== undefined) await setMembers(id, data.members, transaction);
    await logAudit({
      actor_user_id: actorId,
      action: 'UPDATE_TASK_TEMPLATE',
      entity_type: 'TASK_TEMPLATE',
      entity_id: id,
      new_values: clean,
      transaction,
    });
    await transaction.commit();
    return await getTemplate(id);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

// Deactivate rather than delete, so generated tasks keep a valid link.
const deactivateTemplate = async (id, actorId) => {
  const template = await TaskTemplate.findByPk(id);
  if (!template) throw ApiError.notFound('Template not found');
  template.is_active = false;
  await template.save();
  await logAudit({
    actor_user_id: actorId,
    action: 'DEACTIVATE_TASK_TEMPLATE',
    entity_type: 'TASK_TEMPLATE',
    entity_id: id,
  });
  return template;
};

// ── Generating tasks for a date ──────────────────────────────────────────────

const generateForDate = async (date = clock.companyToday(), { templateId = null } = {}) => {
  const offDay = await CompanyOffDay.findOne({ where: { date }, attributes: ['date'] });
  const isOffDay = Boolean(offDay);

  const where = { is_active: true };
  if (templateId) where.id = templateId;
  const templates = await TaskTemplate.findAll({
    where,
    include: [
      { model: TemplateMember, as: 'members' },
    ],
  });

  const schedule = await getSchedule();
  const activeUsers = await User.findAll({ where: { is_active: true, role: { [Op.in]: ['EMPLOYEE', 'MANAGER'] } }, attributes: ['id', 'department_id'] });
  const allDepartments = await Department.findAll({ attributes: ['id'] });

  const leaveRows = await AttendanceException.findAll({
    where: { date, type: { [Op.in]: ['LEAVE', 'HALF_DAY'] } },
    attributes: ['employee_id'],
  });
  const onLeave = new Set(leaveRows.map((r) => r.employee_id));

  const result = { date, is_off_day: isOffDay, templates_considered: templates.length, created: 0, skipped: [] };

  if (templateSkippedOn({ isOffDay })) {
    result.skipped.push('company off day');
    return result;
  }

  for (const t of templates) {
    if (!templateRunsOn(t, date)) continue;

    // One task per template per date is the contract; skip if it already exists.
    const existing = await Task.findOne({ where: { template_id: t.id, task_date: date }, attributes: ['id'] });
    if (existing) {
      result.skipped.push(`${t.title}: already generated for ${date}`);
      continue;
    }

    const departmentMembers = t.department_id
      ? activeUsers.filter((u) => u.department_id === t.department_id).map((u) => u.id)
      : [];
    // With no department and PEOPLE mode, the ADD list is the only source.
    const assigneeIds = resolveAssignees({
      template: t,
      members: t.members || [],
      activeUsers,
      departmentMembers,
      onLeaveIds: [...onLeave],
    });

    if (assigneeIds.length === 0) {
      result.skipped.push(`${t.title}: nobody to assign`);
      continue;
    }

    const endTime = endTimeFrom(t.start_time, t.duration_minutes, schedule);

    const transaction = await sequelize.transaction();
    try {
      const task = await Task.create(
        {
          title: t.title,
          description: t.description || '',
          project_id: t.project_id || null,
          priority: t.priority,
          task_date: date,
          start_time: t.start_time,
          end_time: endTime,
          task_type: 'RECURRING',
          template_id: t.id,
          auto_generated: true,
          created_by: t.created_by,
        },
        { transaction }
      );
      const assignees = await TaskAssignee.bulkCreate(
        assigneeIds.map((employee_id) => ({
          task_id: task.id,
          employee_id,
          assigned_by: t.created_by,
          status: 'TODO',
        })),
        { transaction }
      );
      await TaskStatusHistory.bulkCreate(
        assignees.map((a) => ({
          task_assignee_id: a.id,
          old_status: 'NONE',
          new_status: 'TODO',
          changed_by: null,
          change_note: `Generated from recurring template "${t.title}" for ${date}`,
        })),
        { transaction }
      );
      await transaction.commit();
      result.created += 1;

      // Saved first, then announced (never blocks generation).
      require('./notification-events.service').templateGenerated({ template: t, task, employeeIds: assigneeIds });
    } catch (err) {
      await transaction.rollback();
      // A duplicate key here means another run won the race: treat as "already done".
      if (err.name === 'SequelizeUniqueConstraintError') {
        result.skipped.push(`${t.title}: already generated for ${date}`);
        continue;
      }
      throw err;
    }
  }

  return result;
};

// Catch-up: when someone logs in, make sure today's recurring tasks exist.
const catchUpForEmployee = async (user) => {
  try {
    const today = clock.companyToday();
    await generateForDate(today);
  } catch (err) {
    console.error('[recurring] catch-up failed:', err.message);
  }
};

const registerRecurringJob = () => {
  jobs.registerJob({
    name: 'recurring-tasks',
    atHour: 0,
    atMinute: 5,
    run: async () => {
      const r = await generateForDate(clock.companyToday());
      if (r.created) console.log(`[recurring] ${r.date}: created ${r.created} task(s)`);
    },
  });
};

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deactivateTemplate,
  generateForDate,
  catchUpForEmployee,
  registerRecurringJob,
};
