// Simple in-process job runner.
// A job runs once per company-day after its scheduled time.
// On startup the runner checks immediately, so a restart after the scheduled
// time still runs the job (catch-up).

const { companyParts } = require('../utils/clock');

const jobs = new Map();
let timer = null;

const registerJob = ({ name, atHour, atMinute, run }) => {
  if (!name || typeof run !== 'function') throw new Error('invalid job registration');
  jobs.set(name, { name, atHour, atMinute, run, lastRunDate: null });
};

const dueJobs = (now) => {
  const { date, hour, minute } = companyParts(now);
  return [...jobs.values()].filter(
    (j) => j.lastRunDate !== date && (hour > j.atHour || (hour === j.atHour && minute >= j.atMinute))
  );
};

const tick = async (now = new Date()) => {
  for (const job of dueJobs(now)) {
    try {
      const { date } = companyParts(now);
      await job.run({ date, now });
      job.lastRunDate = date;
    } catch (err) {
      console.error(`[jobs] ${job.name} failed:`, err.message);
    }
  }
};

const startJobs = () => {
  if (timer) return timer;
  tick().catch((e) => console.error('[jobs] startup tick failed:', e.message));
  timer = setInterval(() => tick().catch((e) => console.error('[jobs] tick failed:', e.message)), 60 * 1000);
  return timer;
};

const stopJobs = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

// Test helper: forget what has run today.
const _reset = () => jobs.forEach((j) => (j.lastRunDate = null));

module.exports = { registerJob, startJobs, stopJobs, tick, _reset };
