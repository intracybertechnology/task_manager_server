const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const notFound = require('./middlewares/notFound.middleware');
const errorHandler = require('./middlewares/error.middleware');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const departmentRoutes = require('./routes/department.routes');
const projectRoutes = require('./routes/project.routes');
const taskRoutes = require('./routes/task.routes');
const worklogRoutes = require('./routes/worklog.routes');
const managerRoutes = require('./routes/manager.routes');
const adminRoutes = require('./routes/admin.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const notificationRoutes = require('./routes/notification.routes');
const scheduleRoutes = require('./routes/schedule.routes');
const recurringRoutes = require('./routes/recurring.routes');
const missedRoutes = require('./routes/missed.routes');
const taskLibraryRoutes = require('./routes/task-library.routes');

const app = express();

// F0.4 S2: restrict CORS to the real app origin(s), comma-separated in CORS_ORIGIN.
const { allowedOrigins } = require('./realtime');
const corsOptions = {
  origin: allowedOrigins(),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Date'],
};

// Security and utility middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
// Ensure OPTIONS preflight requests are handled for all routes
app.options('*', cors(corsOptions));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

// Mount API v1 routes
const API_PREFIX = '/api/v1';
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/users`, userRoutes);
app.use(`${API_PREFIX}/departments`, departmentRoutes);
app.use(`${API_PREFIX}/projects`, projectRoutes);
app.use(`${API_PREFIX}/tasks`, taskRoutes);
app.use(`${API_PREFIX}/worklogs`, worklogRoutes);
app.use(`${API_PREFIX}/manager`, managerRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/attendance`, attendanceRoutes);
app.use(`${API_PREFIX}/notifications`, notificationRoutes);
app.use(`${API_PREFIX}/work-schedule`, scheduleRoutes);
app.use(`${API_PREFIX}/task-templates`, recurringRoutes);
app.use(`${API_PREFIX}/missed`, missedRoutes);
app.use(`${API_PREFIX}/task-library`, taskLibraryRoutes);

// Catch 404 and handle errors
app.use(notFound);
app.use(errorHandler);

module.exports = app;
