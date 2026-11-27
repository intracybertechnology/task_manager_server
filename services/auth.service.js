const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const { User, Department } = require('../models');
const { logAudit } = require('./audit.service');

const generateToken = (user) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  const expiresIn = process.env.JWT_EXPIRES_IN || '24h';
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    secret,
    { expiresIn }
  );
};

const login = async (email, password, ipAddress = null) => {
  const user = await User.findOne({
    where: { email: email.toLowerCase().trim() },
    include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
  });

  if (!user) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (!user.is_active) {
    throw ApiError.unauthorized('Your account has been deactivated. Please contact your administrator.');
  }

  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const token = generateToken(user);

  await logAudit({
    actor_user_id: user.id,
    action: 'USER_LOGIN',
    entity_type: 'USER',
    entity_id: user.id,
    ip_address: ipAddress,
  });

  const userData = user.toJSON();
  delete userData.password_hash;

  // Login digest: outstanding tasks and an attendance reminder, saved as
  // notifications so they survive the reload and show in the bell.
  if (user.role !== 'ADMIN') {
    require('./notification-events.service').loginDigest({ user });
  }

  return {
    user: userData,
    token,
  };
};

const changePassword = async (userId, currentPassword, newPassword, ipAddress = null) => {
  const user = await User.findByPk(userId);
  if (!user) {
    throw ApiError.notFound('User not found');
  }

  const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isValidPassword) {
    throw ApiError.badRequest('Current password is incorrect');
  }

  user.password_hash = await bcrypt.hash(newPassword, 10);
  await user.save();

  await logAudit({
    actor_user_id: user.id,
    action: 'CHANGE_PASSWORD',
    entity_type: 'USER',
    entity_id: user.id,
    ip_address: ipAddress,
  });

  return { message: 'Password changed successfully' };
};

module.exports = {
  login,
  generateToken,
  changePassword,
};
