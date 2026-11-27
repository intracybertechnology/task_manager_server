const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Task = sequelize.define('Task', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  project_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  priority: {
    type: DataTypes.ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT'),
    allowNull: false,
    defaultValue: 'MEDIUM',
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  due_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  estimated_minutes: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  created_by: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  is_archived: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false,
  },
  // ── Recurring-task support (migration 006) ──
  // The company date a scheduled task belongs to. Null for undated tasks.
  task_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  start_time: { type: DataTypes.STRING(5), allowNull: true },
  end_time: { type: DataTypes.STRING(5), allowNull: true },
  task_type: {
    type: DataTypes.ENUM('ONE_OFF', 'RECURRING', 'ADDITIONAL'),
    allowNull: false,
    defaultValue: 'ONE_OFF',
  },
  template_id: { type: DataTypes.UUID, allowNull: true },
  auto_generated: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  time_edited: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  tableName: 'tasks',
  timestamps: true,
  indexes: [
    { fields: ['project_id'] },
    { fields: ['created_by'] },
    { fields: ['due_date'] },
    { fields: ['priority'] },
    { fields: ['is_archived'] },
    { fields: ['task_date'] },
  ],
});

module.exports = Task;
