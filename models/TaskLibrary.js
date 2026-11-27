const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TaskLibrary = sequelize.define('TaskLibrary', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
  project_id: { type: DataTypes.UUID, allowNull: true },
  estimated_minutes: { type: DataTypes.INTEGER, allowNull: true },
  priority: {
    type: DataTypes.ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT'),
    allowNull: false,
    defaultValue: 'MEDIUM',
  },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_by: { type: DataTypes.UUID, allowNull: false },
}, {
  tableName: 'task_library',
  timestamps: true,
  indexes: [{ fields: ['is_active'] }],
});

module.exports = TaskLibrary;
