const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const { User, Department } = require('../models');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(ApiError.unauthorized('Authentication token is missing'));
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return next(ApiError.unauthorized('Server is missing JWT configuration'));
    }

    const decoded = jwt.verify(token, secret);
    const user = await User.findByPk(decoded.id, {
      include: [{ model: Department, as: 'department', attributes: ['id', 'name'] }],
      attributes: { exclude: ['password_hash'] },
    });

    if (!user) {
      return next(ApiError.unauthorized('User not found'));
    }

    if (!user.is_active) {
      return next(ApiError.unauthorized('User account is deactivated'));
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return next(ApiError.unauthorized('Token has expired'));
    }
    if (error.name === 'JsonWebTokenError') {
      return next(ApiError.unauthorized('Invalid token'));
    }
    next(error);
  }
};

module.exports = authenticate;
