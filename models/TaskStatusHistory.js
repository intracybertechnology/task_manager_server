const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TaskStatusHistory = sequelize.define('TaskStatusHistory', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  task_assignee_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  old_status: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  new_status: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  // Null only for system events such as recurring-task generation.
  changed_by: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  change_note: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'task_status_history',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['task_assignee_id'] },
  ],
});

module.exports = TaskStatusHistory;
