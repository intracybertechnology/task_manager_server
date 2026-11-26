// Attaches Socket.io to the same HTTP server as Express.
// The client passes its JWT in the handshake as { auth: { token } }.
// Each socket joins a private room for its user, and admins also join 'admins'.

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { User } = require('./models');

let io = null;

const allowedOrigins = () =>
  (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const initRealtime = (httpServer) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required for realtime authentication');

  io = new Server(httpServer, {
    cors: { origin: allowedOrigins(), methods: ['GET', 'POST'] },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Missing token'));
      const decoded = jwt.verify(token, secret);
      const user = await User.findByPk(decoded.id, { attributes: ['id', 'role', 'is_active'] });
      if (!user || !user.is_active) return next(new Error('Invalid user'));
      socket.data.user = { id: user.id, role: user.role };
      return next();
    } catch (err) {
      return next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.data.user;
    socket.join(`user:${id}`);
    if (role === 'ADMIN') socket.join('admins');
  });

  return io;
};

const emitToUser = (userId, event, payload) => {
  if (io && userId) io.to(`user:${userId}`).emit(event, payload);
};

const emitToUsers = (userIds, event, payload) => {
  (userIds || []).forEach((id) => emitToUser(id, event, payload));
};

const emitToAdmins = (event, payload) => {
  if (io) io.to('admins').emit(event, payload);
};

module.exports = { initRealtime, emitToUser, emitToUsers, emitToAdmins, allowedOrigins };
