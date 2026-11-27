const { Op } = require('sequelize');
const ApiError = require('../utils/ApiError');
const {
  Task,
  TaskAssignee,
  TaskComment,
  TaskAttachment,
  TaskStatusHistory,
  User,
  Project,
  ManagerEmployeeAccess,
  Department,
  sequelize,
} = require('../models');
const { logAudit } = require('./audit.service');

// Verify manager scope for assignees
const validateManagerScope = async (managerId, employeeIds, userRole) => {
  if (userRole === 'ADMIN') return true; // Admin has global scope

  // Manager must only assign to subordinates
  const accessRecords = await ManagerEmployeeAccess.findAll({
    where: {
      manager_id: managerId,
      employee_id: { [Op.in]: employeeIds },
    },
  });

  const authorizedEmployeeIds = accessRecords.map(r => r.employee_id);
  const unauthorized = employeeIds.filter(id => !authorizedEmployeeIds.includes(id));

  if (unauthorized.length > 0) {
    throw ApiError.forbidden(
      `You are not authorized to assign tasks to the selected employee(s). Scope restriction.`
    );
  }

  return true;
};

const createTask = async (data, user) => {
  const {
    title,
    description,
    project_id,
    assignee_ids,
    priority,
    start_date,
    due_date,
    estimated_minutes,
  } = data;

  // Verify all assignees exist and are active employees
  const employees = await User.findAll({
    where: {
      id: { [Op.in]: assignee_ids },
      is_active: true,
    },
  });

  if (employees.length !== assignee_ids.length) {
    throw ApiError.badRequest('One or more assignees are invalid or deactivated');
  }

  // Validate manager scope
  await validateManagerScope(user.id, assignee_ids, user.role);

  // Validate project if provided
  if (project_id) {
    const project = await Project.findByPk(project_id);
    if (!project) throw ApiError.badRequest('Invalid project ID');
  }

  const transaction = await sequelize.transaction();

  try {
    const task = await Task.create(
      {
        title,
        description,
        project_id: project_id || null,
        priority: priority || 'MEDIUM',
        start_date: start_date || null,
        due_date: due_date || null,
        estimated_minutes: estimated_minutes || null,
        created_by: user.id,
        is_archived: false,
      },
      { transaction }
    );

    const assigneeRecords = assignee_ids.map(empId => ({
      task_id: task.id,
      employee_id: empId,
      assigned_by: user.id,
      status: 'TODO',
    }));

    const createdAssignees = await TaskAssignee.bulkCreate(assigneeRecords, { transaction });

    // Record initial status history for each assignee
    const statusHistories = createdAssignees.map(a => ({
      task_assignee_id: a.id,
      old_status: 'NONE',
      new_status: 'TODO',
      changed_by: user.id,
      change_note: 'Initial assignment',
    }));
    await TaskStatusHistory.bulkCreate(statusHistories, { transaction });

    await logAudit({
      actor_user_id: user.id,
      action: 'CREATE_TASK',
      entity_type: 'TASK',
      entity_id: task.id,
      new_values: { title: task.title, assignee_ids },
      transaction,
    });

    await transaction.commit();

    // After commit only: a notification for work that was rolled back would lie.
    await require('./notification-events.service').taskAssigned({
      actor: user,
      task,
      employeeIds: assignee_ids,
    });

    return await getTaskById(task.id, user);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

const listTasks = async (user, query = {}) => {
  const { status, priority, project_id, search, overdue } = query;
  const where = { is_archived: false };

  if (priority) where.priority = priority;
  if (project_id) where.project_id = project_id;
  if (search) {
    where[Op.or] = [
      { title: { [Op.like]: `%${search}%` } },
      { description: { [Op.like]: `%${search}%` } },
    ];
  }
  if (overdue === 'true') {
    const d = new Date();
    const localDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    where.due_date = { [Op.lt]: localDate };
  }

  const include = [
    { model: Project, as: 'project', attributes: ['id', 'name'] },
    { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name', 'email'] },
    {
      model: TaskAssignee,
      as: 'assignees',
      include: [
        {
          model: User,
          as: 'employee',
          attributes: ['id', 'first_name', 'last_name', 'email'],
          include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
        },
      ],
    },
    {
      model: TaskComment,
      as: 'comments',
      include: [{ model: User, as: 'author', attributes: ['id', 'first_name', 'last_name', 'email'] }],
    },
  ];

  if (user.role === 'ADMIN') {
    return await Task.findAll({ where, include, order: [['createdAt', 'DESC']] });
  }

  if (user.role === 'MANAGER') {
    // Managers see tasks they created or tasks assigned to employees in their scope
    const teamMembers = await ManagerEmployeeAccess.findAll({
      where: { manager_id: user.id },
      attributes: ['employee_id'],
    });
    const teamIds = teamMembers.map(t => t.employee_id);

    const tasks = await Task.findAll({ where, include, order: [['createdAt', 'DESC']] });
    return tasks.filter(t => t.created_by === user.id || t.assignees.some(a => teamIds.includes(a.employee_id)));
  }

  // Employee: returns tasks assigned to them
  const tasks = await Task.findAll({ where, include, order: [['createdAt', 'DESC']] });
  return tasks.filter(t => t.assignees.some(a => a.employee_id === user.id));
};

const getMyTasks = async (userId, query = {}) => {
  const { status } = query;
  const assigneeWhere = { employee_id: userId };
  if (status) {
    assigneeWhere.status = status;
  }

  const assignments = await TaskAssignee.findAll({
    where: assigneeWhere,
    include: [
      {
        model: Task,
        as: 'task',
        where: { is_archived: false },
        include: [
          { model: Project, as: 'project', attributes: ['id', 'name'] },
          { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name', 'email'] },
          { model: TaskAttachment, as: 'attachments' },
          {
            model: TaskComment,
            as: 'comments',
            include: [{ model: User, as: 'author', attributes: ['id', 'first_name', 'last_name'] }],
          },
          // Nested inside the task: TaskTemplate belongs to Task, not TaskAssignee.
          {
            model: require('../models').TaskTemplate,
            as: 'template',
            attributes: ['id', 'frequency'],
            required: false,
          },
        ],
      },
      {
        model: TaskStatusHistory,
        as: 'statusHistories',
        include: [{ model: User, as: 'changer', attributes: ['id', 'first_name', 'last_name'] }],
        order: [['createdAt', 'DESC']],
      },
    ],
    order: [['createdAt', 'DESC']],
  });

  return assignments.map(a => ({
    assignment_id: a.id,
    assignment_status: a.status,
    assigned_at: a.assigned_at,
    // The person who made THIS assignment. Usually the same as task.creator,
    // but not when someone else added this employee later.
    assigned_by: a.assigner,
    completed_at: a.completed_at,
    task: a.task,
    status_histories: a.statusHistories,
  }));
};

const getTaskById = async (id, user) => {
  const task = await Task.findByPk(id, {
    include: [
      { model: Project, as: 'project', attributes: ['id', 'name', 'status'] },
      { model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name', 'email'] },
      {
        model: TaskAssignee,
        as: 'assignees',
        include: [
          {
            model: User,
            as: 'employee',
            attributes: ['id', 'first_name', 'last_name', 'email'],
            include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
          },
          {
            model: TaskStatusHistory,
            as: 'statusHistories',
            include: [{ model: User, as: 'changer', attributes: ['id', 'first_name', 'last_name'] }],
          },
        ],
      },
      {
        model: TaskComment,
        as: 'comments',
        include: [{ model: User, as: 'author', attributes: ['id', 'first_name', 'last_name', 'email'] }],
      },
      { model: TaskAttachment, as: 'attachments' },
    ],
  });

  if (!task) throw ApiError.notFound('Task not found');

  // Verify access permission
  if (user.role === 'EMPLOYEE') {
    const isAssigned = task.assignees.some(a => a.employee_id === user.id);
    if (!isAssigned) throw ApiError.forbidden('You do not have access to this task');
  } else if (user.role === 'MANAGER') {
    if (task.created_by !== user.id) {
      const team = await ManagerEmployeeAccess.findAll({
        where: { manager_id: user.id },
        attributes: ['employee_id'],
      });
      const teamIds = team.map(t => t.employee_id);
      const hasTeamAssignee = task.assignees.some(a => teamIds.includes(a.employee_id));
      if (!hasTeamAssignee) throw ApiError.forbidden('You do not have access to this task');
    }
  }

  return task;
};

const updateTask = async (id, data, user) => {
  const task = await Task.findByPk(id);
  if (!task) throw ApiError.notFound('Task not found');

  if (user.role !== 'ADMIN' && task.created_by !== user.id) {
    throw ApiError.forbidden('Only task creator or admin can update task details');
  }

  const old_values = task.toJSON();
  await task.update(data);

  await logAudit({
    actor_user_id: user.id,
    action: 'UPDATE_TASK',
    entity_type: 'TASK',
    entity_id: task.id,
    old_values,
    new_values: task.toJSON(),
  });

  return await getTaskById(id, user);
};

const addAssignees = async (taskId, employeeIds, user) => {
  const task = await Task.findByPk(taskId);
  if (!task) throw ApiError.notFound('Task not found');

  if (user.role !== 'ADMIN' && task.created_by !== user.id) {
    throw ApiError.forbidden('Only task creator or admin can add assignees');
  }

  await validateManagerScope(user.id, employeeIds, user.role);

  const existingAssignees = await TaskAssignee.findAll({
    where: { task_id: taskId, employee_id: { [Op.in]: employeeIds } },
  });

  const existingEmpIds = existingAssignees.map(a => a.employee_id);
  const newEmpIds = employeeIds.filter(id => !existingEmpIds.includes(id));

  if (newEmpIds.length === 0) {
    return await getTaskById(taskId, user);
  }

  const transaction = await sequelize.transaction();
  try {
    const records = newEmpIds.map(empId => ({
      task_id: taskId,
      employee_id: empId,
      assigned_by: user.id,
      status: 'TODO',
    }));

    const created = await TaskAssignee.bulkCreate(records, { transaction });
    const histories = created.map(a => ({
      task_assignee_id: a.id,
      old_status: 'NONE',
      new_status: 'TODO',
      changed_by: user.id,
      change_note: 'Added assignee',
    }));
    await TaskStatusHistory.bulkCreate(histories, { transaction });

    await logAudit({
      actor_user_id: user.id,
      action: 'ADD_TASK_ASSIGNEES',
      entity_type: 'TASK',
      entity_id: taskId,
      new_values: { added_employee_ids: newEmpIds },
      transaction,
    });

    await transaction.commit();

    await require('./notification-events.service').taskAssigned({
      actor: user,
      task,
      employeeIds: newEmpIds,
    });

    return await getTaskById(taskId, user);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

const removeAssignee = async (taskId, assigneeId, user) => {
  const task = await Task.findByPk(taskId);
  if (!task) throw ApiError.notFound('Task not found');

  if (user.role !== 'ADMIN' && task.created_by !== user.id) {
    throw ApiError.forbidden('Only task creator or admin can remove assignees');
  }

  const assignee = await TaskAssignee.findOne({
    where: { id: assigneeId, task_id: taskId },
  });
  if (!assignee) throw ApiError.notFound('Assignee record not found');

  await assignee.destroy();

  await logAudit({
    actor_user_id: user.id,
    action: 'REMOVE_TASK_ASSIGNEE',
    entity_type: 'TASK_ASSIGNEE',
    entity_id: assigneeId,
  });

  return { success: true, message: 'Assignee removed' };
};

const updateAssignmentStatus = async (assigneeId, newStatus, note, user) => {
  const assignee = await TaskAssignee.findByPk(assigneeId, {
    include: [{ model: Task, as: 'task' }],
  });
  if (!assignee) throw ApiError.notFound('Task assignment not found');

  // Authorization check: Must be the assigned employee, manager creator, or admin
  if (user.role === 'EMPLOYEE' && assignee.employee_id !== user.id) {
    throw ApiError.forbidden('You can only update your own task assignment progress');
  }

  const oldStatus = assignee.status;
  if (oldStatus === newStatus) {
    return assignee;
  }

  const transaction = await sequelize.transaction();
  try {
    assignee.status = newStatus;
    if (newStatus === 'COMPLETED') {
      assignee.completed_at = new Date();
    } else {
      assignee.completed_at = null;
    }
    await assignee.save({ transaction });

    await TaskStatusHistory.create(
      {
        task_assignee_id: assignee.id,
        old_status: oldStatus,
        new_status: newStatus,
        changed_by: user.id,
        change_note: note || `Status updated to ${newStatus}`,
      },
      { transaction }
    );

    await logAudit({
      actor_user_id: user.id,
      action: 'UPDATE_TASK_ASSIGNMENT_STATUS',
      entity_type: 'TASK_ASSIGNEE',
      entity_id: assignee.id,
      old_values: { status: oldStatus },
      new_values: { status: newStatus },
      transaction,
    });

    await transaction.commit();

    await require('./notification-events.service').taskStatusChanged({
      actor: user,
      assignee,
      task: assignee.task,
      oldStatus,
      newStatus,
    });

    return assignee;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

const addComment = async (taskId, commentText, assigneeId, user) => {
  const task = await getTaskById(taskId, user); // verifies permission

  const comment = await TaskComment.create({
    task_id: taskId,
    task_assignee_id: assigneeId || null,
    user_id: user.id,
    comment: commentText,
  });

  await logAudit({
    actor_user_id: user.id,
    action: 'ADD_TASK_COMMENT',
    entity_type: 'TASK_COMMENT',
    entity_id: comment.id,
  });

  // Tell the other side about the comment (never blocks the comment itself).
  require('./notification-events.service').taskCommentAdded({
    actor: user,
    task,
    commentText,
    assigneeIds: (task.assignees || []).map((a) => a.employee_id),
  });

  return await TaskComment.findByPk(comment.id, {
    include: [{ model: User, as: 'author', attributes: ['id', 'first_name', 'last_name', 'email'] }],
  });
};

module.exports = {
  createTask,
  listTasks,
  getMyTasks,
  getTaskById,
  updateTask,
  addAssignees,
  removeAssignee,
  updateAssignmentStatus,
  addComment,
};
