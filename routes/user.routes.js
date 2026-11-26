const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/role.middleware');
const validate = require('../middlewares/validation.middleware');
const {
  createUserSchema,
  updateUserSchema,
  setManagerTeamSchema,
  resetPasswordSchema,
} = require('../validators/user.validator');

router.use(authenticate);

// List and get user (Admin and Manager can view lists, Manager to select assignees)
router.get('/', authorize('ADMIN', 'MANAGER'), userController.listUsers);
// F0.4 S3: profile detail is admin/manager only; previously any user could read any profile.
router.get('/:id', authorize('ADMIN', 'MANAGER'), userController.getUserById);

// Admin-only management
router.post('/', authorize('ADMIN'), validate(createUserSchema), userController.createUser);
router.patch('/:id', authorize('ADMIN'), validate(updateUserSchema), userController.updateUser);
router.patch('/:id/status', authorize('ADMIN'), userController.toggleUserStatus);
router.post(
  '/:id/reset-password',
  authorize('ADMIN'),
  validate(resetPasswordSchema),
  userController.resetUserPassword
);

// Manager team assignment
router.get('/:id/team', authorize('ADMIN', 'MANAGER'), userController.getManagerTeam);
router.post(
  '/:id/team',
  authorize('ADMIN'),
  validate(setManagerTeamSchema),
  userController.setManagerTeam
);

module.exports = router;
