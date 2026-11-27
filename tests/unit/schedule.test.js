// Pure unit tests for the work-schedule calculator. No database needed.
// Run: node tests/unit/schedule.test.js

const assert = require('assert');
const {
  DEFAULT_SCHEDULE,
  workingMinutesBetween,
  endTimeFrom,
  isInsideWorkHours,
  startsInBreak,
  rangesOverlap,
  validateSchedule,
} = require('../../services/schedule.service');

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

// ── the doc's worked example ─────────────────────────────────────────────────
test('09:00 + 150 minutes skips the 11:15–11:30 break and ends at 11:45', () => {
  assert.strictEqual(endTimeFrom('09:00', 150, DEFAULT_SCHEDULE), '11:45');
});

test('09:00 + 135 minutes reaches exactly the start of the break', () => {
  assert.strictEqual(endTimeFrom('09:00', 135, DEFAULT_SCHEDULE), '11:15');
});

test('a task starting inside a break begins once the break ends', () => {
  assert.strictEqual(endTimeFrom('11:20', 30, DEFAULT_SCHEDULE), '12:00');
});

test('08:00 + 480 minutes of work spans lunch and evening breaks', () => {
  // 08:00–11:15 (195) + 11:30–13:30 (120) + 14:00–16:15 (135) + 16:30–17:00 (30) = 480
  assert.strictEqual(endTimeFrom('08:00', 480, DEFAULT_SCHEDULE), '17:00');
});

test('a zero-minute task ends where it starts', () => {
  assert.strictEqual(endTimeFrom('10:00', 0, DEFAULT_SCHEDULE), '10:00');
});

// ── working minutes ─────────────────────────────────────────────────────────
test('09:00–18:00 less three breaks is 8 hours (480 minutes)', () => {
  assert.strictEqual(workingMinutesBetween(540, 1080, DEFAULT_SCHEDULE.breaks), 480);
});

test('a range entirely inside a break has zero working minutes', () => {
  assert.strictEqual(workingMinutesBetween(825, 840, DEFAULT_SCHEDULE.breaks), 0);
});

test('a 45-minute range straddling the lunch break counts only 30 working minutes', () => {
  assert.strictEqual(workingMinutesBetween(825, 870, DEFAULT_SCHEDULE.breaks), 30); // 13:45–14:30, lunch 13:30–14:00 leaves 14:00–14:30
});

test('a range starting inside a break counts only the working part', () => {
  assert.strictEqual(workingMinutesBetween(825, 855, DEFAULT_SCHEDULE.breaks), 15); // 11:15–11:45, skip 15 min of break
});

// ── work hours and breaks ───────────────────────────────────────────────────
test('09:00 is inside work hours', () => assert.ok(isInsideWorkHours('09:00')));
test('08:59 is outside work hours', () => assert.ok(!isInsideWorkHours('08:59')));
test('18:00 is inside work hours', () => assert.ok(isInsideWorkHours('18:00')));
test('18:01 is outside work hours', () => assert.ok(!isInsideWorkHours('18:01')));
test('11:15 starts in a break', () => assert.ok(startsInBreak('11:15')));
test('11:30 does not (the break has ended)', () => assert.ok(!startsInBreak('11:30')));

// ── overlap ─────────────────────────────────────────────────────────────────
test('09:00–10:00 overlaps 09:30–10:30', () => assert.ok(rangesOverlap('09:00', '10:00', '09:30', '10:30')));
test('09:00–10:00 does not overlap 10:00–11:00', () => assert.ok(!rangesOverlap('09:00', '10:00', '10:00', '11:00')));

// ── validation ──────────────────────────────────────────────────────────────
test('the default schedule is valid and has 480 effective minutes', () => {
  assert.strictEqual(validateSchedule(DEFAULT_SCHEDULE).effective_minutes, 480);
});
test('a break outside work hours is rejected', () => {
  assert.throws(() => validateSchedule({ ...DEFAULT_SCHEDULE, breaks: [{ name: 'X', start: '07:00', end: '07:30' }] }), /inside the working day/);
});
test('overlapping breaks are rejected', () => {
  assert.throws(
    () => validateSchedule({ ...DEFAULT_SCHEDULE, breaks: [{ name: 'A', start: '11:00', end: '12:00' }, { name: 'B', start: '11:30', end: '12:30' }] }),
    /must not overlap/
  );
});
test('an end before the start is rejected', () => {
  assert.throws(() => validateSchedule({ start: '18:00', end: '09:00' }), /must be after the start/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
