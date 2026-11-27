const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// People attached to a template on top of its department:
//   ADD      always gets the task
//   EXCLUDE  never gets it, even if in the department
const TemplateMember = sequelize.define('TemplateMember', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  template_id: { type: DataTypes.UUID, allowNull: false },
  employee_id: { type: DataTypes.UUID, allowNull: false },
  mode: {
    type: DataTypes.ENUM('ADD', 'EXCLUDE'),
    allowNull: false,
    defaultValue: 'ADD',
  },
}, {
  tableName: 'template_members',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['template_id', 'employee_id'] },
  ],
});

module.exports = TemplateMember;
