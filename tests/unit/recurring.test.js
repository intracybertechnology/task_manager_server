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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
