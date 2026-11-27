const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TaskAssignee = sequelize.define('TaskAssignee', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  task_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  employee_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  assigned_by: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  assigned_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING(16),
    defaultValue: 'TODO',
    allowNull: false,
    validate: {
      isIn: {
        args: [['TODO', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'MISSED']],
        msg: 'Invalid task status',
      },
    },
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  removed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'task_assignees',
  timestamps: true,
  indexes: [
    { fields: ['task_id', 'employee_id'] },
    { fields: ['employee_id'] },
    { fields: ['status'] },
  ],
});

module.exports = TaskAssignee;
