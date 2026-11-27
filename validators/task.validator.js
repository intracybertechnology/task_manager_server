const { z } = require('zod');

const createTaskSchema = {
  body: z.object({
    title: z.string().min(1, 'Task title is required').max(255),
    description: z.string().min(1, 'Description is required'),
    project_id: z.string().uuid().nullable().optional(),
    assignee_ids: z.array(z.string().uuid()).min(1, 'At least one assignee is required'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format must be YYYY-MM-DD').nullable().optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format must be YYYY-MM-DD').nullable().optional(),
    // The single day this task belongs to. Optional: with no date it stays on
    // the assignee's Today list until completed.
    task_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format must be YYYY-MM-DD').nullable().optional(),
    estimated_minutes: z.number().int().positive().nullable().optional(),
  }),
};

const updateTaskSchema = {
  body: z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().min(1).optional(),
    project_id: z.string().uuid().nullable().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    estimated_minutes: z.number().int().positive().nullable().optional(),
    is_archived: z.boolean().optional(),
  }),
};

const updateAssignmentStatusSchema = {
  body: z.object({
    // MISSED is set by the end-of-day job, never by a person, so it is not accepted here.
    status: z.enum(['TODO', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']),
    note: z.string().optional(),
  }),
};

const addCommentSchema = {
  body: z.object({
    comment: z.string().min(1, 'Comment text is required'),
    task_assignee_id: z.string().uuid().nullable().optional(),
  }),
};

const addAssigneesSchema = {
  body: z.object({
    employee_ids: z.array(z.string().uuid()).min(1, 'At least one employee must be selected'),
  }),
};

module.exports = {
  createTaskSchema,
  updateTaskSchema,
  updateAssignmentStatusSchema,
  addCommentSchema,
  addAssigneesSchema,
};
