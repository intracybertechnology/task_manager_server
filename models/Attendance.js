const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// One row per person per working day. The row is created either:
//  - when the person marks themselves (source SELF), or
//  - by the 11:55 cutoff job for anyone still unmarked (source SYSTEM, cutoff_auto).
// A cutoff absence can only be lifted by an admin; an admin change records
// cutoff_override_by / cutoff_override_at.
const Attendance = sequelize.define('Attendance', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  employee_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  marked_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  source: {
    type: DataTypes.ENUM('SELF', 'ADMIN', 'SYSTEM'),
    allowNull: false,
    defaultValue: 'SELF',
  },
  cutoff_auto: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  cutoff_override_by: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  cutoff_override_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Why an ABSENT row exists: 'CUTOFF' (11:55 job) or 'ADMIN' (an admin set it).
  // Null for present / self-marked rows.
  absence_reason: {
    type: DataTypes.STRING(16),
    allowNull: true,
  },
}, {
  tableName: 'attendance',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['employee_id', 'date'] },
    { fields: ['date'] },
  ],
});

module.exports = Attendance;
