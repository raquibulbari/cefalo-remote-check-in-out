const test = require('node:test');
const assert = require('node:assert/strict');
const { textMatches, pickVisibleMatch } = require('../extension/content.js');

test('textMatches: matches "Check In" for kind checkin', () => {
  assert.equal(textMatches('Check In', 'checkin'), true);
});

test('textMatches: matches "Check Out" for kind checkout', () => {
  assert.equal(textMatches('Check Out', 'checkout'), true);
});

test('textMatches: "Check Out" does not match kind checkin', () => {
  assert.equal(textMatches('Check Out', 'checkin'), false);
});

test('textMatches: "Check In" does not match kind checkout', () => {
  assert.equal(textMatches('Check In', 'checkout'), false);
});

test('textMatches: is case-insensitive and tolerates a hyphen', () => {
  assert.equal(textMatches('check-in', 'checkin'), true);
  assert.equal(textMatches('CHECKOUT', 'checkout'), true);
});

test('pickVisibleMatch: returns the first visible match', () => {
  const elements = [
    { text: 'Home', visible: true },
    { text: 'Check In', visible: false },
    { text: 'Check In', visible: true, id: 'right-one' },
  ];
  const result = pickVisibleMatch(elements, 'checkin');
  assert.equal(result.id, 'right-one');
});

test('pickVisibleMatch: returns null when nothing matches', () => {
  const elements = [{ text: 'Home', visible: true }];
  assert.equal(pickVisibleMatch(elements, 'checkin'), null);
});
