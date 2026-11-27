require('dotenv').config();

// F0.4 S1: fail fast if the JWT secret is missing. The old fallback string made
// every token forgeable when .env was absent in a deployment.
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Set it in server/.env (see .env.example).');
  process.exit(1);
}

const http = require('http');
const app = require('./app');
const { sequelize } = require('./models');
const { initRealtime } = require('./realtime');
const { startJobs } = require('./services/jobs.service');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully.');

    const httpServer = http.createServer(app);
    initRealtime(httpServer);

    httpServer.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`API Base URL: http://localhost:${PORT}/api/v1`);
      require('./services/autosubmit.service').startAutoSubmitJob();
      require('./services/attendance-cutoff.service').registerCutoffJob();
      require('./services/notification.service').registerCleanupJob();
      startJobs();
    });
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
};

startServer();
