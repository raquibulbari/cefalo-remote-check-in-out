const test = require('node:test');
const assert = require('node:assert/strict');
const { formatBadgeElapsed, reconcile, appendLogEntry } = require('../extension/background.js');

test('formatBadgeElapsed: under an hour shows minutes', () => {
  assert.equal(formatBadgeElapsed(0), '0m');
  assert.equal(formatBadgeElapsed(45 * 60000), '45m');
});

test('formatBadgeElapsed: an hour or more shows hours and padded minutes', () => {
  assert.equal(formatBadgeElapsed(60 * 60000), '1h00m');
  assert.equal(formatBadgeElapsed(65 * 60000), '1h05m');
  assert.equal(formatBadgeElapsed(125 * 60000), '2h05m');
});

test('reconcile: adopts checked-in when page shows checked-in and state was checked-out', () => {
  const state = { checkedIn: false, checkInTime: null };
  const result = reconcile(state, 'checked-in', () => 1000);
  assert.deepEqual(result, { checkedIn: true, checkInTime: 1000 });
});

test('reconcile: keeps existing checkInTime if already set', () => {
  const state = { checkedIn: false, checkInTime: 500 };
  const result = reconcile(state, 'checked-in', () => 1000);
  assert.deepEqual(result, { checkedIn: true, checkInTime: 500 });
});

test('reconcile: clears state when page shows checked-out and state was checked-in', () => {
  const state = { checkedIn: true, checkInTime: 500 };
  const result = reconcile(state, 'checked-out', () => 1000);
  assert.deepEqual(result, { checkedIn: false, checkInTime: null });
});

test('reconcile: returns the same reference when nothing changes', () => {
  const state = { checkedIn: true, checkInTime: 500 };
  assert.equal(reconcile(state, 'checked-in', () => 1000), state);
  const state2 = { checkedIn: false, checkInTime: null };
  assert.equal(reconcile(state2, 'checked-out', () => 1000), state2);
  assert.equal(reconcile(state2, null, () => 1000), state2);
});

test('appendLogEntry: prepends and caps at max', () => {
  const log = [{ n: 1 }, { n: 2 }];
  const result = appendLogEntry(log, { n: 3 }, 2);
  assert.deepEqual(result, [{ n: 3 }, { n: 1 }]);
  assert.deepEqual(log, [{ n: 1 }, { n: 2 }]);
});
