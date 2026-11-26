// Pure unit tests for the attendance status rule. No database needed.
// Run: node tests/unit/attendance.status.test.js

const assert = require('assert');
const { computeStatus, isPastCutoff, isStickyAbsence } = require('../../services/attendance-status.service');

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

const base = {
  date: '2026-11-20',
  today: '2026-11-20',
  attendance: null,
  exceptionType: null,
  isOffDay: false,
  cutoffPassed: false,
};

// ── within the working day ────────────────────────────────────────────────────
test('nothing marked before the cutoff -> NOT_YET', () => {
  assert.strictEqual(computeStatus(base), 'NOT_YET');
});

test('marked before the cutoff -> PRESENT', () => {
  assert.strictEqual(computeStatus({ ...base, attendance: { marked_at: new Date() } }), 'PRESENT');
});

test('nothing marked after the cutoff -> ABSENT', () => {
  assert.strictEqual(computeStatus({ ...base, cutoffPassed: true }), 'ABSENT');
});

// ── off day: nobody marks, nobody is absent ──────────────────────────────────
test('off day with nothing marked -> OFF (not NOT_YET)', () => {
  assert.strictEqual(computeStatus({ ...base, isOffDay: true }), 'OFF');
});

test('off day after the cutoff -> still OFF, never ABSENT', () => {
  assert.strictEqual(computeStatus({ ...base, isOffDay: true, cutoffPassed: true }), 'OFF');
});

// ── past and future ───────────────────────────────────────────────────────────
test('past working day with nothing recorded -> ABSENT', () => {
  assert.strictEqual(computeStatus({ ...base, date: '2026-11-19' }), 'ABSENT');
});

test('future day -> FUTURE', () => {
  assert.strictEqual(computeStatus({ ...base, date: '2026-11-21' }), 'FUTURE');
});

// ── admin exceptions win ──────────────────────────────────────────────────────
test('leave -> LEAVE', () => {
  assert.strictEqual(computeStatus({ ...base, exceptionType: 'LEAVE' }), 'LEAVE');
});

test('half day -> HALF_DAY', () => {
  assert.strictEqual(computeStatus({ ...base, exceptionType: 'HALF_DAY' }), 'HALF_DAY');
});

test('explicit absent -> ABSENT even before the cutoff', () => {
  assert.strictEqual(computeStatus({ ...base, exceptionType: 'ABSENT' }), 'ABSENT');
});

test('admin leave overrides a self-mark', () => {
  assert.strictEqual(
    computeStatus({ ...base, attendance: { marked_at: new Date() }, exceptionType: 'LEAVE' }),
    'LEAVE'
  );
});

// ── cutoff clock ──────────────────────────────────────────────────────────────
test('11:54 is before the cutoff', () => {
  assert.strictEqual(isPastCutoff({ hour: 11, minute: 54 }), false);
});
test('11:55 is at the cutoff', () => {
  assert.strictEqual(isPastCutoff({ hour: 11, minute: 55 }), true);
});
test('12:30 is past the cutoff', () => {
  assert.strictEqual(isPastCutoff({ hour: 12, minute: 30 }), true);
});

// ── sticky absences block the employee, with an accurate reason ──────────────
const sticky = { source: 'SYSTEM', cutoff_auto: true };
test('cutoff absence is sticky', () => {
  assert.strictEqual(isStickyAbsence({ ...sticky, absence_reason: 'CUTOFF' }), true);
});
test('admin-set absence is sticky', () => {
  assert.strictEqual(isStickyAbsence({ ...sticky, absence_reason: 'ADMIN' }), true);
});
test('a self-mark is not sticky', () => {
  assert.strictEqual(isStickyAbsence({ source: 'SELF', cutoff_auto: false }), false);
});
test('a present row is not sticky', () => {
  assert.strictEqual(isStickyAbsence({ source: 'SYSTEM', cutoff_auto: false }), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
