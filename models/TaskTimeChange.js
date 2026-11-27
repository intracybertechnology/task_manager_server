const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Each time someone moves an assigned task's slot. Append-only, so the original
// planned time and every later change stay auditable.
const TaskTimeChange = sequelize.define('TaskTimeChange', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  task_id: { type: DataTypes.UUID, allowNull: false },
  task_assignee_id: { type: DataTypes.UUID, allowNull: true },
  employee_id: { type: DataTypes.UUID, allowNull: false },
  old_date: { type: DataTypes.DATEONLY, allowNull: true },
  old_start: { type: DataTypes.STRING(5), allowNull: true },
  old_end: { type: DataTypes.STRING(5), allowNull: true },
  new_date: { type: DataTypes.DATEONLY, allowNull: true },
  new_start: { type: DataTypes.STRING(5), allowNull: false },
  new_end: { type: DataTypes.STRING(5), allowNull: false },
  reason: { type: DataTypes.STRING(500), allowNull: true },
  changed_by: { type: DataTypes.UUID, allowNull: false },
}, {
  tableName: 'task_time_changes',
  timestamps: true,
  indexes: [{ fields: ['task_id', 'createdAt'] }],
});

module.exports = TaskTimeChange;
