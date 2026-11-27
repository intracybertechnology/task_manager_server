const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/role.middleware');
const recurring = require('../services/recurring.service');

// Recurring task templates are an admin tool.
router.use(authenticate);
router.use(authorize('ADMIN'));

const list = asyncHandler(async (req, res) => {
  const data = await recurring.listTemplates();
  res.status(200).json({ success: true, data });
});

const getOne = asyncHandler(async (req, res) => {
  const data = await recurring.getTemplate(req.params.id);
  res.status(200).json({ success: true, data });
});

const create = asyncHandler(async (req, res) => {
  const data = await recurring.createTemplate(req.body, req.user.id);
  res.status(201).json({ success: true, message: 'Template created', data });
});

const update = asyncHandler(async (req, res) => {
  const data = await recurring.updateTemplate(req.params.id, req.body, req.user.id);
  res.status(200).json({ success: true, message: 'Template updated', data });
});

const start = asyncHandler(async (req, res) => {
  const data = await recurring.startTemplate(req.params.id, req.body || {}, req.user.id);
  res.status(200).json({ success: true, message: 'Template started', data });
});

const deactivate = asyncHandler(async (req, res) => {
  const data = await recurring.deactivateTemplate(req.params.id, req.user.id);
  res.status(200).json({ success: true, message: 'Template deactivated', data });
});

// Manual run for a date, useful for catch-up and testing. Safe to repeat.
const generate = asyncHandler(async (req, res) => {
  const data = await recurring.generateForDate(req.body?.date || undefined);
  res.status(200).json({ success: true, data });
});

router.get('/', list);
router.post('/', create);
router.post('/generate', generate);
router.get('/:id', getOne);
router.patch('/:id', update);
router.post('/:id/start', start);
router.delete('/:id', deactivate);

module.exports = router;
