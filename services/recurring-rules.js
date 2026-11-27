// Pure rules for recurring tasks. No database here: the job and the API both
// call these, and they are unit-tested in tests/unit/recurring.test.js.
//
//   1. Does a template run on a given company date?
//   2. Which people does it apply to that date?
//   3. What are its next run dates? (shown to the admin before saving)

// 'YYYY-MM-DD' -> weekday 0..6 (0 = Sunday). UTC noon so DST cannot shift the day.
const weekdayOf = (dateStr) => new Date(`${dateStr}T12:00:00Z`).getUTCDay();

// Real month length, as the language's calendar defines it (leap years included).
const daysInMonth = (dateStr) => {
  const [y, m] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// The short months a chosen day would skip, for the "is this 29th/30th risky?" warning.
const skipsShortMonths = (day) => {
  if (!day || day < 29) return false;
  // Day 29 only skips February in non-leap years; 30 skips February; 31 is LAST.
  return day === 29 || day === 30;
};

const templateRunsOn = (template, dateStr) => {
  if (!template || template.is_active === false) return false;

  switch (template.frequency) {
    case 'DAILY':
      return true;

    case 'WEEKLY': {
      const days = Array.isArray(template.weekdays) ? template.weekdays.map(Number) : [];
      // No days chosen means every day of the week, so a half-configured
      // template never silently produces nothing.
      if (days.length === 0) return true;
      return days.includes(weekdayOf(dateStr));
    }

    case 'MONTHLY': {
      const dom = Number(dateStr.slice(8, 10));
      const dim = daysInMonth(dateStr);
      const rule = template.day_rule || (Number(template.day_of_month) >= 31 ? 'LAST' : 'NTH');
      if (rule === 'LAST') return dom === dim;
      const day = Number(template.day_of_month);
      if (!day) return false;
      return dom === day;
    }

    default:
      return false;
  }
};

// Who gets the task:
//   DEPARTMENT mode: everyone active in the template's department
//   PEOPLE mode:     only the ADD members
//   always:          minus EXCLUDE members, minus anyone on leave that date
const resolveAssignees = ({
  template,
  members = [],
  activeUsers = [],
  departmentMembers = [],
  onLeaveIds = [],
}) => {
  const addIds = members.filter((m) => m.mode === 'ADD').map((m) => m.employee_id);
  const excludeIds = new Set(members.filter((m) => m.mode === 'EXCLUDE').map((m) => m.employee_id));
  const leave = new Set(onLeaveIds);

  let base;
  if (template.assignee_mode === 'PEOPLE') {
    base = addIds;
  } else {
    base = [...new Set([...departmentMembers, ...addIds])];
  }

  const activeSet = new Set(activeUsers.map((u) => u.id));
  return [...new Set(base)].filter((id) => activeSet.has(id) && !excludeIds.has(id) && !leave.has(id));
};

// Should the whole template be skipped that day? Off days mean nobody works.
const templateSkippedOn = ({ isOffDay }) => Boolean(isOffDay);

// ── "Next runs" for the admin screen ────────────────────────────────────────

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// The next `count` dates (including today) on which this template would run,
// ignoring off days, so the admin sees the pattern. Off days are marked, not removed.
const nextRunDates = (template, fromDate, { count = 6, offDays = [] } = {}) => {
  const off = new Set(offDays);
  const out = [];
  let cursor = fromDate;
  // 400 days covers "day 29 in February of a leap year" from any starting month.
  for (let i = 0; i < 400 && out.length < count; i++) {
    if (templateRunsOn(template, cursor)) {
      out.push({ date: cursor, is_off_day: off.has(cursor) });
    }
    cursor = addDays(cursor, 1);
  }
  return out;
};

module.exports = {
  weekdayOf,
  daysInMonth,
  skipsShortMonths,
  templateRunsOn,
  resolveAssignees,
  templateSkippedOn,
  nextRunDates,
  addDays,
};
