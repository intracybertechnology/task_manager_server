// Work schedule: company working hours and breaks.
//
// The calculator is pure and shared in spirit with the browser: the same rules
// (start + minutes, skipping breaks) must give the same end time on both sides.
// It is the base for recurring tasks, employee time editing and missed tasks.

const { CompanySetting } = require('../models');
const ApiError = require('../utils/ApiError');
const { logAudit } = require('./audit.service');

const SETTING_KEY = 'work_schedule';

const DEFAULT_SCHEDULE = {
  start: '09:00',
  end: '18:00',
  breaks: [
    { name: 'Morning', start: '11:15', end: '11:30' },
    { name: 'Lunch', start: '13:30', end: '14:00' },
    { name: 'Evening', start: '16:15', end: '16:30' },
  ],
};

// ── Time helpers (minutes since midnight) ───────────────────────────────────

const toMinutes = (hhmm) => {
  if (typeof hhmm === 'number' && Number.isFinite(hhmm)) return hhmm;
  if (typeof hhmm !== 'string' || !/^\d{1,2}:\d{2}$/.test(hhmm.trim())) {
    throw ApiError.badRequest(`Invalid time "${hhmm}". Use HH:MM.`);
  }
  const [h, m] = hhmm.trim().split(':').map(Number);
  if (h > 23 || m > 59) throw ApiError.badRequest(`Invalid time "${hhmm}". Use 00:00–23:59.`);
  return h * 60 + m;
};

const toHHMM = (minutes) => {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const normaliseBreaks = (breaks) =>
  (breaks || [])
    // Accept breaks already normalised to minutes (from a stored setting) as well as "HH:MM".
    .map((b) => ({
      name: b.name || 'Break',
      start: typeof b.start === 'number' ? b.start : toMinutes(b.start),
      end: typeof b.end === 'number' ? b.end : toMinutes(b.end),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);

// Minutes of work between two clock times, excluding any break overlap.
const workingMinutesBetween = (fromMin, toMin, breaks = []) => {
  if (toMin <= fromMin) return 0;
  let total = toMin - fromMin;
  for (const b of normaliseBreaks(breaks)) {
    const overlap = Math.min(toMin, b.end) - Math.max(fromMin, b.start);
    if (overlap > 0) total -= overlap;
  }
  return Math.max(0, total);
};

// Given a start time and a duration of *work*, when does it finish?
// Time spent inside a break does not count towards the duration, so the end
// time moves later by the length of every break it crosses.
const endTimeFrom = (start, durationMinutes, schedule = DEFAULT_SCHEDULE) => {
  let remaining = Number(durationMinutes);
  if (!Number.isFinite(remaining) || remaining < 0) {
    throw ApiError.badRequest('Duration must be a non-negative number of minutes');
  }
  let cursor = toMinutes(start);
  const breaks = normaliseBreaks(schedule.breaks);

  // Guard against a schedule that never lets work proceed.
  let guard = 0;
  while (remaining > 0) {
    if (guard++ > 5000) throw ApiError.badRequest('Could not calculate an end time with this schedule');
    const insideBreak = breaks.find((b) => cursor >= b.start && cursor < b.end);
    if (insideBreak) {
      cursor = insideBreak.end;
      continue;
    }
    const nextBreak = breaks.find((b) => b.start > cursor);
    const untilNext = nextBreak ? nextBreak.start - cursor : remaining;
    const chunk = Math.min(remaining, untilNext);
    cursor += chunk;
    remaining -= chunk;
  }
  return toHHMM(cursor);
};

const isInsideWorkHours = (time, schedule = DEFAULT_SCHEDULE) => {
  const t = toMinutes(time);
  return t >= toMinutes(schedule.start) && t <= toMinutes(schedule.end);
};

const startsInBreak = (time, schedule = DEFAULT_SCHEDULE) => {
  const t = toMinutes(time);
  return normaliseBreaks(schedule.breaks).some((b) => t >= b.start && t < b.end);
};

// True when two [start, end) ranges overlap. Used for the employee time-edit warning.
const rangesOverlap = (aStart, aEnd, bStart, bEnd) => {
  const as = toMinutes(aStart);
  const ae = toMinutes(aEnd);
  const bs = toMinutes(bStart);
  const be = toMinutes(bEnd);
  return as < be && bs < ae;
};

// ── Validation of an edited schedule ─────────────────────────────────────────

const validateSchedule = (input) => {
  const schedule = {
    start: input?.start ?? DEFAULT_SCHEDULE.start,
    end: input?.end ?? DEFAULT_SCHEDULE.end,
    breaks: Array.isArray(input?.breaks) ? input.breaks : DEFAULT_SCHEDULE.breaks,
  };

  const startMin = toMinutes(schedule.start);
  const endMin = toMinutes(schedule.end);
  if (endMin <= startMin) throw ApiError.badRequest('The end of the working day must be after the start');

  const breaks = normaliseBreaks(schedule.breaks);
  let previousEnd = startMin;
  for (const b of breaks) {
    if (b.start < startMin || b.end > endMin) {
      throw ApiError.badRequest(`Break "${b.name}" must be inside the working day (${schedule.start}–${schedule.end})`);
    }
    if (b.start < previousEnd) {
      throw ApiError.badRequest('Breaks must not overlap each other');
    }
    previousEnd = b.end;
  }

  const effective = workingMinutesBetween(startMin, endMin, breaks);
  if (effective <= 0) throw ApiError.badRequest('The schedule leaves no working time');

  return {
    start: toHHMM(startMin),
    end: toHHMM(endMin),
    breaks: breaks.map((b) => ({ name: b.name, start: toHHMM(b.start), end: toHHMM(b.end) })),
    effective_minutes: effective,
  };
};

// ── Stored setting ───────────────────────────────────────────────────────────

const getSchedule = async () => {
  const row = await CompanySetting.findOne({ where: { setting_key: SETTING_KEY } });
  if (!row) return { ...validateSchedule(DEFAULT_SCHEDULE), is_default: true };
  return { ...validateSchedule(row.setting_value), is_default: false };
};

const saveSchedule = async (input, actorId) => {
  const validated = validateSchedule(input);
  const [row, created] = await CompanySetting.findOrCreate({
    where: { setting_key: SETTING_KEY },
    defaults: { setting_key: SETTING_KEY, setting_value: validated, updated_by: actorId },
  });
  if (!created) {
    row.setting_value = validated;
    row.updated_by = actorId;
    await row.save();
  }
  await logAudit({
    actor_user_id: actorId,
    action: 'UPDATE_WORK_SCHEDULE',
    entity_type: 'COMPANY_SETTING',
    entity_id: row.id,
    new_values: validated,
  });
  return { ...validated, is_default: false };
};

module.exports = {
  DEFAULT_SCHEDULE,
  toMinutes,
  toHHMM,
  workingMinutesBetween,
  endTimeFrom,
  isInsideWorkHours,
  startsInBreak,
  rangesOverlap,
  validateSchedule,
  getSchedule,
  saveSchedule,
};
