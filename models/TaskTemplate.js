const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// A recurring task definition. A daily job turns active templates into dated
// tasks for the people they apply to.
const TaskTemplate = sequelize.define('TaskTemplate', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
  department_id: { type: DataTypes.UUID, allowNull: true },
  project_id: { type: DataTypes.UUID, allowNull: true },
  frequency: {
    type: DataTypes.ENUM('DAILY', 'WEEKLY', 'MONTHLY'),
    allowNull: false,
  },
  // The model type must match the column: the migration made `weekdays` JSON.
  weekdays: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  day_of_month: { type: DataTypes.INTEGER, allowNull: true },
  start_time: { type: DataTypes.STRING(5), allowNull: false },
  duration_minutes: { type: DataTypes.INTEGER, allowNull: false },
  priority: {
    type: DataTypes.ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT'),
    allowNull: false,
    defaultValue: 'MEDIUM',
  },
  assignee_mode: {
    type: DataTypes.ENUM('DEPARTMENT', 'PEOPLE'),
    allowNull: false,
    defaultValue: 'DEPARTMENT',
  },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_by: { type: DataTypes.UUID, allowNull: false },
}, {
  tableName: 'task_templates',
  timestamps: true,
  indexes: [
    { fields: ['is_active'] },
    { fields: ['department_id'] },
  ],
});

module.exports = TaskTemplate;
