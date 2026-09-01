const test = require('node:test');
const assert = require('node:assert/strict');
const { textMatches, pickVisibleMatch, decideStatus, ABSENCE_CONFIRM_MS } = require('../extension/content.js');

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

// The portal has three states, not two: a visible "Check In" button, a visible
// "Check Out" button, and — once you have checked out for the day — neither.
// Absence is the only signal for that third state, but it is ambiguous: it also
// describes a page that has not finished rendering.
const ready = { hasCheckIn: false, hasCheckOut: false, pageReady: true, sawCheckOut: false, absentForMs: 0 };

test('decideStatus: a visible Check Out button means checked in', () => {
  assert.equal(decideStatus({ ...ready, hasCheckOut: true }), 'checked-in');
});

test('decideStatus: a visible Check In button means checked out', () => {
  assert.equal(decideStatus({ ...ready, hasCheckIn: true }), 'checked-out');
});

test('decideStatus: a visible Check Out button wins over a stale absence timer', () => {
  const view = { ...ready, hasCheckOut: true, sawCheckOut: true, absentForMs: 10 * ABSENCE_CONFIRM_MS };
  assert.equal(decideStatus(view), 'checked-in');
});

test('decideStatus: neither button before the page is ready is undecidable', () => {
  const view = { ...ready, pageReady: false, absentForMs: 10 * ABSENCE_CONFIRM_MS };
  assert.equal(decideStatus(view), null);
});

test('decideStatus: never reports on an unready page even after seeing a Check Out button', () => {
  const view = { ...ready, pageReady: false, sawCheckOut: true };
  assert.equal(decideStatus(view), null);
});

test('decideStatus: the Check Out button vanishing is an immediate check-out', () => {
  // The confident path: we watched the button exist and then disappear in this
  // same page session, so absence cannot be "not rendered yet".
  assert.equal(decideStatus({ ...ready, sawCheckOut: true, absentForMs: 0 }), 'checked-out');
});

test('decideStatus: cold-load absence is undecidable until it has persisted', () => {
  assert.equal(decideStatus({ ...ready, absentForMs: 0 }), null);
  assert.equal(decideStatus({ ...ready, absentForMs: ABSENCE_CONFIRM_MS - 1 }), null);
});

test('decideStatus: cold-load absence that persists past the window means checked out', () => {
  assert.equal(decideStatus({ ...ready, absentForMs: ABSENCE_CONFIRM_MS }), 'checked-out');
  assert.equal(decideStatus({ ...ready, absentForMs: ABSENCE_CONFIRM_MS + 1 }), 'checked-out');
});

test('decideStatus: the confirmation window is configurable', () => {
  assert.equal(decideStatus({ ...ready, absentForMs: 50 }, { confirmMs: 100 }), null);
  assert.equal(decideStatus({ ...ready, absentForMs: 100 }, { confirmMs: 100 }), 'checked-out');
});

test('decideStatus: the confirmation window is long enough to outlast a slow render', () => {
  assert.ok(ABSENCE_CONFIRM_MS >= 10000, 'a short window risks clearing a live timer mid-session');
});
