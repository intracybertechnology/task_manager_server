const express = require('express');
const router = express.Router();
const taskController = require('../controllers/task.controller');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/role.middleware');
const validate = require('../middlewares/validation.middleware');
const {
  createTaskSchema,
  updateTaskSchema,
  updateAssignmentStatusSchema,
  addCommentSchema,
  addAssigneesSchema,
} = require('../validators/task.validator');

router.use(authenticate);

// Static paths first, so they are not captured by '/:id' below.
router.get('/my-tasks', taskController.getMyTasks);
router.get('/time-history/:taskId', taskController.getTimeChanges);

// List & My Tasks
router.get('/', taskController.listTasks);
router.get('/:id', taskController.getTaskById);

// Create task (Manager or Admin)
router.post(
  '/',
  authorize('ADMIN', 'MANAGER'),
  validate(createTaskSchema),
  taskController.createTask
);

// Update task details
router.patch(
  '/:id',
  authorize('ADMIN', 'MANAGER'),
  validate(updateTaskSchema),
  taskController.updateTask
);

// Assignees management
router.post(
  '/:id/assignees',
  authorize('ADMIN', 'MANAGER'),
  validate(addAssigneesSchema),
  taskController.addAssignees
);
router.delete(
  '/:id/assignees/:assigneeId',
  authorize('ADMIN', 'MANAGER'),
  taskController.removeAssignee
);

// Employee/Assignee updating their individual assignment progress
router.patch(
  '/assignments/:assigneeId/status',
  validate(updateAssignmentStatusSchema),
  taskController.updateAssignmentStatus
);

// Employee/Assignee editing the time of their own assignment
router.patch('/assignments/:assigneeId/time', taskController.editAssignmentTime);

// Add comment
router.post(
  '/:id/comments',
  validate(addCommentSchema),
  taskController.addComment
);

module.exports = router;
