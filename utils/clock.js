// Single source of truth for "what date and time is it for the company".
// All jobs (recurring, missed, reminders) and attendance must use this,
// NOT the browser's X-Client-Date header (which is spoofable) and NOT
// each service's own new Date() formatting.

const COMPANY_TIMEZONE = process.env.COMPANY_TIMEZONE || 'Asia/Kolkata';

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: COMPANY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const companyParts = (now = new Date()) => {
  const parts = partsFormatter.formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
  };
};

const companyToday = (now = new Date()) => companyParts(now).date;

// Local (server) YYYY-MM-DD. Used only where the old code already relied on it.
const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

module.exports = { COMPANY_TIMEZONE, companyParts, companyToday, localDateStr, addDays };
