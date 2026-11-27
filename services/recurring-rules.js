// Pure rules for recurring tasks. No database here: the job and the API both
// call these, and they are unit-tested in tests/unit/recurring.test.js.
//
// The two rules that matter:
//   1. Does a template run on a given company date?
//   2. Which people does it apply to that date?

// 'YYYY-MM-DD' -> weekday 0..6 (0 = Sunday). Uses UTC noon so DST cannot shift the day.
const weekdayOf = (dateStr) => new Date(`${dateStr}T12:00:00Z`).getUTCDay();

const daysInMonth = (dateStr) => {
  const [y, m] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

// True when the template should produce tasks on `date`.
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
      const day = Number(template.day_of_month);
      if (!day) return false;
      const dom = Number(dateStr.slice(8, 10));
      const dim = daysInMonth(dateStr);
      // 31 means "the last day", so a 31st-of-month template runs on 28 Feb,
      // 30 Apr, and so on. For every other day, the date must match exactly.
      if (day >= 31) return dom === dim;
      return dom === day;
    }

    default:
      return false;
  }
};

// Who gets the task:
//   DEPARTMENT mode: everyone active in the template's department
//   PEOPLE mode:     only the ADD members
//   always:          minus EXCLUDE members
//   minus:           anyone on leave for that date
//   minus:           anyone the company has marked off? (off days are handled by
//                    the caller, because the whole template is skipped that day)
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

  // Only active people, never excluded, never on leave. Order is stable.
  const activeSet = new Set(activeUsers.map((u) => u.id));
  return [...new Set(base)].filter((id) => activeSet.has(id) && !excludeIds.has(id) && !leave.has(id));
};

// Should the whole template be skipped that day? Off days and (optionally)
// leave-only days: an off day means nobody is expected to work.
const templateSkippedOn = ({ isOffDay }) => Boolean(isOffDay);

module.exports = { weekdayOf, daysInMonth, templateRunsOn, resolveAssignees, templateSkippedOn };
