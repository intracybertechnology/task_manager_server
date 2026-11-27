// Pure unit tests for recurring-task rules. No database needed.
// Run: node tests/unit/recurring.test.js

const assert = require('assert');
const {
  weekdayOf,
  templateRunsOn,
  resolveAssignees,
  templateSkippedOn,
} = require('../../services/recurring-rules');

let passed = 0;
let failed = 0;
const test = (label, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${label}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${label}\n       ${err.message}`);
  }
};

// 2026-11-26 is a Thursday (weekday 4); 2026-11-29 is a Sunday (0).
test('weekdayOf(2026-11-26) is Thursday', () => assert.strictEqual(weekdayOf('2026-11-26'), 4));
test('weekdayOf(2026-11-29) is Sunday', () => assert.strictEqual(weekdayOf('2026-11-29'), 0));

// ── does it run? ────────────────────────────────────────────────────────────
test('DAILY runs every day', () => {
  assert.ok(templateRunsOn({ frequency: 'DAILY', is_active: true }, '2026-11-26'));
  assert.ok(templateRunsOn({ frequency: 'DAILY', is_active: true }, '2026-11-29'));
});

test('an inactive template never runs', () => {
  assert.ok(!templateRunsOn({ frequency: 'DAILY', is_active: false }, '2026-11-26'));
});

test('WEEKLY on listed weekdays only', () => {
  const t = { frequency: 'WEEKLY', weekdays: [1, 4], is_active: true }; // Mon, Thu
  assert.ok(templateRunsOn(t, '2026-11-26')); // Thu
  assert.ok(!templateRunsOn(t, '2026-11-25')); // Wed
});

test('WEEKLY with no weekdays chosen runs every day', () => {
  assert.ok(templateRunsOn({ frequency: 'WEEKLY', weekdays: [], is_active: true }, '2026-11-25'));
});

test('MONTHLY on the 26th runs only on the 26th', () => {
  const t = { frequency: 'MONTHLY', day_of_month: 26, is_active: true };
  assert.ok(templateRunsOn(t, '2026-11-26'));
  assert.ok(!templateRunsOn(t, '2026-11-25'));
});

test('MONTHLY on day 31 means the last day of a short month', () => {
  const t = { frequency: 'MONTHLY', day_of_month: 31, is_active: true };
  assert.ok(templateRunsOn(t, '2026-02-28'), 'Feb 28 is the last day of February 2026');
  assert.ok(templateRunsOn(t, '2026-12-31'));
  assert.ok(!templateRunsOn(t, '2026-12-30'));
});

test('an off day skips the whole template', () => {
  assert.ok(templateSkippedOn({ isOffDay: true }));
  assert.ok(!templateSkippedOn({ isOffDay: false }));
});

// ── who gets it? ────────────────────────────────────────────────────────────
const users = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

test('DEPARTMENT mode: everyone in the department', () => {
  const ids = resolveAssignees({
    template: { assignee_mode: 'DEPARTMENT' },
    members: [],
    activeUsers: users,
    departmentMembers: ['a', 'b'],
  });
  assert.deepStrictEqual(ids, ['a', 'b']);
});

test('DEPARTMENT mode: ADD brings someone from another department in', () => {
  const ids = resolveAssignees({
    template: { assignee_mode: 'DEPARTMENT' },
    members: [{ employee_id: 'd', mode: 'ADD' }],
    activeUsers: users,
    departmentMembers: ['a'],
  });
  assert.deepStrictEqual(ids.sort(), ['a', 'd']);
});

test('EXCLUDE removes someone even if in the department', () => {
  const ids = resolveAssignees({
    template: { assignee_mode: 'DEPARTMENT' },
    members: [{ employee_id: 'b', mode: 'EXCLUDE' }],
    activeUsers: users,
    departmentMembers: ['a', 'b'],
  });
  assert.deepStrictEqual(ids, ['a']);
});

test('PEOPLE mode: only the ADD members', () => {
  const ids = resolveAssignees({
    template: { assignee_mode: 'PEOPLE' },
    members: [
      { employee_id: 'a', mode: 'ADD' },
      { employee_id: 'c', mode: 'ADD' },
      { employee_id: 'b', mode: 'EXCLUDE' },
    ],
    activeUsers: users,
    departmentMembers: ['a', 'b', 'c', 'd'],
  });
  assert.deepStrictEqual(ids.sort(), ['a', 'c']);
});

test('people on leave are skipped', () => {
  const ids = resolveAssignees({
    template: { assignee_mode: 'DEPARTMENT' },
    members: [],
    activeUsers: users,
    departmentMembers: ['a', 'b'],
    onLeaveIds: ['b'],
  });
  assert.deepStrictEqual(ids, ['a']);
});

test('inactive users are never included', () => {
  const ids = resolveAssignees({
    template: { assignee_mode: 'DEPARTMENT' },
    members: [{ employee_id: 'z', mode: 'ADD' }],
    activeUsers: users,
    departmentMembers: ['a'],
  });
  assert.deepStrictEqual(ids, ['a']);
});

test('the same person is not returned twice', () => {
  const ids = resolveAssignees({
    template: { assignee_mode: 'DEPARTMENT' },
    members: [{ employee_id: 'a', mode: 'ADD' }],
    activeUsers: users,
    departmentMembers: ['a', 'a'],
  });
  assert.deepStrictEqual(ids, ['a']);
});

// ── month lengths and leap years ─────────────────────────────────────────────
const { daysInMonth, skipsShortMonths, nextRunDates } = require('../../services/recurring-rules');

test('February 2026 (not a leap year) has 28 days', () => {
  assert.strictEqual(daysInMonth('2026-02-10'), 28);
});
test('February 2028 (a leap year) has 29 days', () => {
  assert.strictEqual(daysInMonth('2028-02-10'), 29);
});
test('April has 30 days', () => {
  assert.strictEqual(daysInMonth('2026-04-01'), 30);
});
test('29th and 30th are flagged as risky; 28th and LAST are not', () => {
  assert.strictEqual(skipsShortMonths(29), true);
  assert.strictEqual(skipsShortMonths(30), true);
  assert.strictEqual(skipsShortMonths(28), false);
  assert.strictEqual(skipsShortMonths(31), false);
});

// ── LAST vs NTH ─────────────────────────────────────────────────────────────
test('LAST runs on the last day of every month', () => {
  const t = { frequency: 'MONTHLY', day_rule: 'LAST', is_active: true };
  assert.ok(templateRunsOn(t, '2026-12-31'));
  assert.ok(templateRunsOn(t, '2027-01-31'));
  assert.ok(templateRunsOn(t, '2026-02-28'), 'Feb 2026 has 28 days');
  assert.ok(templateRunsOn(t, '2026-04-30'));
  assert.ok(!templateRunsOn(t, '2026-02-27'));
});

test('LAST runs on 29 Feb in a leap year', () => {
  const t = { frequency: 'MONTHLY', day_rule: 'LAST', is_active: true };
  assert.ok(templateRunsOn(t, '2028-02-29'));
  assert.ok(!templateRunsOn(t, '2028-02-28'));
});

test('NTH 30 skips February entirely', () => {
  const t = { frequency: 'MONTHLY', day_rule: 'NTH', day_of_month: 30, is_active: true };
  assert.ok(templateRunsOn(t, '2026-01-30'));
  assert.ok(!templateRunsOn(t, '2026-02-28'), 'no 30th in February');
  assert.ok(templateRunsOn(t, '2026-04-30'));
});

test('NTH 29 only reaches February in a leap year', () => {
  const t = { frequency: 'MONTHLY', day_rule: 'NTH', day_of_month: 29, is_active: true };
  assert.ok(!templateRunsOn(t, '2026-02-28'));
  assert.ok(templateRunsOn(t, '2028-02-29'));
});

test('day 15 runs on the 15th every month', () => {
  const t = { frequency: 'MONTHLY', day_rule: 'NTH', day_of_month: 15, is_active: true };
  assert.ok(templateRunsOn(t, '2026-12-15'));
  assert.ok(templateRunsOn(t, '2027-02-15'));
  assert.ok(!templateRunsOn(t, '2027-02-16'));
});

test('an old template with day 31 and no day_rule still means LAST', () => {
  const t = { frequency: 'MONTHLY', day_of_month: 31, is_active: true };
  assert.ok(templateRunsOn(t, '2026-02-28'));
});

// ── next run dates (what the admin screen shows) ────────────────────────────
test('nextRunDates for LAST from 27 Nov 2026 gives the real month ends', () => {
  const t = { frequency: 'MONTHLY', day_rule: 'LAST', is_active: true };
  const runs = nextRunDates(t, '2026-11-27', { count: 4 }).map((r) => r.date);
  assert.deepStrictEqual(runs, ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
});

test('nextRunDates for NTH 30 skips February and says so by omission', () => {
  const t = { frequency: 'MONTHLY', day_rule: 'NTH', day_of_month: 30, is_active: true };
  const runs = nextRunDates(t, '2026-12-01', { count: 3 }).map((r) => r.date);
  assert.deepStrictEqual(runs, ['2026-12-30', '2027-01-30', '2027-03-30']);
});

test('nextRunDates for NTH 29 reaches 2028 leap February', () => {
  const t = { frequency: 'MONTHLY', day_rule: 'NTH', day_of_month: 29, is_active: true };
  const runs = nextRunDates(t, '2028-01-01', { count: 2 }).map((r) => r.date);
  assert.deepStrictEqual(runs, ['2028-01-29', '2028-02-29']);
});

test('nextRunDates for weekly Mon,Thu skips the other days', () => {
  const t = { frequency: 'WEEKLY', weekdays: [1, 4], is_active: true };
  const runs = nextRunDates(t, '2026-11-27', { count: 3 }).map((r) => r.date); // 27 Nov 2026 is a Friday
  assert.deepStrictEqual(runs, ['2026-11-30', '2026-12-03', '2026-12-07']);
});

test('nextRunDates marks company off days instead of hiding them', () => {
  const t = { frequency: 'DAILY', is_active: true };
  const runs = nextRunDates(t, '2026-11-27', { count: 2, offDays: ['2026-11-28'] });
  assert.deepStrictEqual(runs, [{ date: '2026-11-27', is_off_day: false }, { date: '2026-11-28', is_off_day: true }]);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
