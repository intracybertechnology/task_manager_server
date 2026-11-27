// Admin task library: saved task drafts to pick from when assigning.
const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const authenticate = require('../middlewares/auth.middleware');
const authorize = require('../middlewares/role.middleware');
const { TaskLibrary, User } = require('../models');
const ApiError = require('../utils/ApiError');
const { logAudit } = require('../services/audit.service');

router.use(authenticate);

const list = asyncHandler(async (req, res) => {
  const rows = await TaskLibrary.findAll({
    where: req.query.include_inactive === 'true' ? {} : { is_active: true },
    include: [{ model: User, as: 'creator', attributes: ['id', 'first_name', 'last_name'] }],
    order: [['title', 'ASC']],
  });
  res.status(200).json({ success: true, data: rows });
});

const create = asyncHandler(async (req, res) => {
  const { title, description, project_id, estimated_minutes, priority } = req.body;
  if (!title || !String(title).trim()) throw ApiError.badRequest('Title is required');
  const row = await TaskLibrary.create({
    title: String(title).trim(),
    description: description || '',
    project_id: project_id || null,
    estimated_minutes: estimated_minutes ? Number(estimated_minutes) : null,
    priority: priority || 'MEDIUM',
    created_by: req.user.id,
    is_active: true,
  });
  await logAudit({ actor_user_id: req.user.id, action: 'CREATE_TASK_LIBRARY_ITEM', entity_type: 'TASK_LIBRARY', entity_id: row.id, new_values: { title: row.title } });
  res.status(201).json({ success: true, message: 'Saved to library', data: row });
});

const update = asyncHandler(async (req, res) => {
  const row = await TaskLibrary.findByPk(req.params.id);
  if (!row) throw ApiError.notFound('Library item not found');
  const fields = ['title', 'description', 'project_id', 'estimated_minutes', 'priority', 'is_active'];
  fields.forEach((f) => { if (req.body[f] !== undefined) row[f] = req.body[f]; });
  await row.save();
  res.status(200).json({ success: true, message: 'Library item updated', data: row });
});

const remove = asyncHandler(async (req, res) => {
  const row = await TaskLibrary.findByPk(req.params.id);
  if (!row) throw ApiError.notFound('Library item not found');
  row.is_active = false;
  await row.save();
  res.status(200).json({ success: true, message: 'Library item deactivated' });
});

router.get('/', list);
router.post('/', authorize('ADMIN', 'MANAGER'), create);
router.patch('/:id', authorize('ADMIN', 'MANAGER'), update);
router.delete('/:id', authorize('ADMIN', 'MANAGER'), remove);

module.exports = router;
