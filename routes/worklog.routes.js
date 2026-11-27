const express = require('express');
const router = express.Router();
const worklogController = require('../controllers/worklog.controller');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/role.middleware');
const validate = require('../middlewares/validation.middleware');
const {
  addWorklogEntrySchema,
  updateWorklogEntrySchema,
  createCategorySchema,
  updateCategorySchema,
} = require('../validators/worklog.validator');

router.use(authenticate);

// Worklog Categories
router.get('/categories', worklogController.getCategories);
router.post(
  '/categories',
  authorize('ADMIN'),
  validate(createCategorySchema),
  worklogController.createCategory
);
router.patch(
  '/categories/:id',
  authorize('ADMIN'),
  validate(updateCategorySchema),
  worklogController.updateCategory
);

// Employee worklog draft & reports
router.get('/today', worklogController.getTodayDraft);
router.get('/reminder', worklogController.getSubmitReminder);
router.get('/prefill', worklogController.getPrefill);
router.get('/my-reports', worklogController.getMyReports);
router.get('/reports/:reportId', worklogController.getReportById);

// Draft operations
router.post(
  '/reports/:reportId/entries',
  validate(addWorklogEntrySchema),
  worklogController.addEntry
);
router.patch(
  '/entries/:entryId',
  validate(updateWorklogEntrySchema),
  worklogController.updateEntry
);
router.delete('/entries/:entryId', worklogController.deleteEntry);

// Submit and lock
router.post('/reports/:reportId/submit', worklogController.submitReport);

module.exports = router;
