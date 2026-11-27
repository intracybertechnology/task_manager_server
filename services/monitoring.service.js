// Admin monitoring additions for the Overview page:
//   - completion by department for a date (from that date's dated tasks)
//   - which recurring templates are running today, and who they produced
//
// Completion counts each *assignment*, not each task, and attributes it to the
// assignee's department. A task assigned to two people in two departments counts
// once in each, which is the honest reading of "completion by department".

const { Op } = require('sequelize');
const { Task, TaskAssignee, User, Department, TaskTemplate } = require('../models');
const { templateRunsOn } = require('./recurring-rules');
const clock = require('../utils/clock');

const completionByDepartment = async (date) => {
  const rows = await TaskAssignee.findAll({
    where: { removed_at: null },
    attributes: ['status'],
    include: [
      { model: Task, as: 'task', required: true, where: { task_date: date, is_archived: false }, attributes: [] },
      {
        model: User,
        as: 'employee',
        attributes: ['id'],
        include: [{ model: Department, as: 'department', attributes: ['name'] }],
      },
    ],
  });

  const byDept = {};
  rows.forEach((a) => {
    const dept = a.employee?.department?.name || 'Unassigned';
    if (!byDept[dept]) byDept[dept] = { total: 0, done: 0, in_progress: 0, not_started: 0 };
    byDept[dept].total += 1;
    if (a.status === 'COMPLETED') byDept[dept].done += 1;
    else if (a.status === 'IN_PROGRESS') byDept[dept].in_progress += 1;
    else if (a.status !== 'CANCELLED') byDept[dept].not_started += 1;
  });

  return Object.entries(byDept)
    .map(([department, s]) => ({
      department,
      ...s,
      percent: s.total ? Math.round((s.done / s.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);
};

const templatesRunningToday = async (date = clock.companyToday()) => {
  const templates = await TaskTemplate.findAll({ where: { is_active: true }, order: [['start_time', 'ASC']] });
  const running = templates.filter((t) => templateRunsOn(t, date));

  if (running.length === 0) return { date, templates: [] };

  const generated = await Task.findAll({
    where: { task_date: date, template_id: { [Op.in]: running.map((t) => t.id) } },
    attributes: ['id', 'template_id'],
    include: [{ model: TaskAssignee, as: 'assignees', attributes: ['status'] }],
  });

  const byTemplate = {};
  generated.forEach((t) => {
    byTemplate[t.template_id] = byTemplate[t.template_id] || { tasks: 0, assignments: 0, done: 0 };
    byTemplate[t.template_id].tasks += 1;
    byTemplate[t.template_id].assignments += (t.assignees || []).length;
    byTemplate[t.template_id].done += (t.assignees || []).filter((a) => a.status === 'COMPLETED').length;
  });

  return {
    date,
    templates: running.map((t) => ({
      id: t.id,
      title: t.title,
      start_time: t.start_time,
      duration_minutes: t.duration_minutes,
      frequency: t.frequency,
      generated: Boolean(byTemplate[t.id]),
      ...(byTemplate[t.id] || { tasks: 0, assignments: 0, done: 0 }),
    })),
  };
};

module.exports = { completionByDepartment, templatesRunningToday };
