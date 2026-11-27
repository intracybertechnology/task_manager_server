const asyncHandler = require('../utils/asyncHandler');
const taskService = require('../services/task.service');
const taskTimeService = require('../services/task-time.service');

const createTask = asyncHandler(async (req, res) => {
  const task = await taskService.createTask(req.body, req.user);
  res.status(201).json({ success: true, message: 'Task created successfully', data: task });
});

const listTasks = asyncHandler(async (req, res) => {
  const tasks = await taskService.listTasks(req.user, req.query);
  res.status(200).json({ success: true, data: tasks });
});

const getMyTasks = asyncHandler(async (req, res) => {
  const tasks = await taskService.getMyTasks(req.user.id, req.query);
  res.status(200).json({ success: true, data: tasks });
});

const getMyToday = asyncHandler(async (req, res) => {
  const data = await taskService.getMyToday(req.user.id);
  res.status(200).json({ success: true, data });
});

const getTaskById = asyncHandler(async (req, res) => {
  const task = await taskService.getTaskById(req.params.id, req.user);
  res.status(200).json({ success: true, data: task });
});

const updateTask = asyncHandler(async (req, res) => {
  const task = await taskService.updateTask(req.params.id, req.body, req.user);
  res.status(200).json({ success: true, message: 'Task updated successfully', data: task });
});

const addAssignees = asyncHandler(async (req, res) => {
  const task = await taskService.addAssignees(req.params.id, req.body.employee_ids, req.user);
  res.status(200).json({ success: true, message: 'Assignees added successfully', data: task });
});

const removeAssignee = asyncHandler(async (req, res) => {
  const result = await taskService.removeAssignee(req.params.id, req.params.assigneeId, req.user);
  res.status(200).json({ success: true, message: result.message });
});

const updateAssignmentStatus = asyncHandler(async (req, res) => {
  const assignee = await taskService.updateAssignmentStatus(
    req.params.assigneeId,
    req.body.status,
    req.body.note,
    req.user
  );
  res.status(200).json({ success: true, message: 'Assignment status updated', data: assignee });
});

const addComment = asyncHandler(async (req, res) => {
  const comment = await taskService.addComment(
    req.params.id,
    req.body.comment,
    req.body.task_assignee_id,
    req.user
  );
  res.status(201).json({ success: true, message: 'Comment added', data: comment });
});

// Edit the time of one assignment. Self-service for the assignee, or an admin.
const editAssignmentTime = asyncHandler(async (req, res) => {
  const data = await taskTimeService.editAssignmentTime(req.params.assigneeId, req.body, req.user);
  res.status(200).json({ success: true, message: 'Task time updated', data });
});

const getTimeChanges = asyncHandler(async (req, res) => {
  const data = await taskTimeService.timeChangesFor(req.params.taskId);
  res.status(200).json({ success: true, data });
});

module.exports = {
  createTask,
  listTasks,
  getMyTasks,
  getMyToday,
  getTaskById,
  updateTask,
  addAssignees,
  removeAssignee,
  updateAssignmentStatus,
  addComment,
  editAssignmentTime,
  getTimeChanges,
};
