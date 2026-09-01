const test = require('node:test');
const assert = require('node:assert/strict');
const { formatRow } = require('../extension/log.js');

test('formatRow: formats a checkin entry', () => {
  const entry = { type: 'checkin', timestamp: new Date('2026-09-01T09:15:00').getTime() };
  const row = formatRow(entry);
  assert.equal(row.type, 'Check In');
  assert.equal(typeof row.date, 'string');
  assert.equal(typeof row.time, 'string');
});

test('formatRow: formats a checkout entry', () => {
  const entry = { type: 'checkout', timestamp: new Date('2026-09-01T17:30:00').getTime() };
  assert.equal(formatRow(entry).type, 'Check Out');
});
