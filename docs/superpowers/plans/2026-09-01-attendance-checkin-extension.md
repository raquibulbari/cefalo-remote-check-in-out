# Attendance Check-in/Check-out Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome extension that clicks Check In/Check Out on the HR attendance portal, tracks elapsed time via a popup and toolbar badge, keeps a 30-entry history log, and ships with a local dummy test page so the whole flow is verifiable without touching the real portal.

**Architecture:** A background service worker (`extension/background.js`) is the single source of truth (state in `chrome.storage.local`, tab reuse/creation, badge via `chrome.alarms`). A content script (`extension/content.js`) runs on both the real portal and the local test page, finds the right button by text match, and clicks it. A popup (`extension/popup.html/js`) triggers actions and shows a live timer; `extension/log.html/js` shows history. `test-page/` is a static dummy portal for local testing.

**Tech Stack:** Vanilla JS, Manifest V3 Chrome extension APIs (`storage`, `tabs`, `alarms`, `action`), no bundler/build step. Unit tests for pure logic use Node's built-in `node:test` + `node:assert/strict` (Node 18+) — no new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-01-attendance-checkin-extension-design.md`

## Global Constraints

- Manifest V3 only; no build step or bundler for the shipped extension.
- No new runtime/npm dependencies — unit tests use only Node's built-in `node:test`/`node:assert/strict`.
- History log capped at exactly 30 entries (`MAX_LOG_ENTRIES = 30`), newest first.
- Badge/timer resolution: `chrome.alarms` minimum period is 1 minute — badge text is minute-granularity (e.g. `23m`, `1h05m`); the popup's own timer ticks every second while open.
- Files that need to run in both Node (for tests) and the browser (`content.js`, `background.js`, `log.js`) use the dual-export guard pattern: pure functions get `if (typeof module !== 'undefined') { module.exports = {...} }`; browser-only orchestration code (anything touching `chrome.*` or `document`) is wrapped in `if (typeof chrome !== 'undefined') { ... }` so `require()`-ing the file in a test never throws.

---

## Task 1: Extension scaffolding, manifest, icons, and dummy test page

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/icons/icon16.png`, `extension/icons/icon48.png`, `extension/icons/icon128.png`
- Create: `test-page/index.html`
- Create: `test-page/app.js`

**Interfaces:**
- Produces: the dummy portal at `test-page/index.html` has a `<button id="attendance-btn">` whose text toggles between exactly `Check In` and `Check Out` on click, and a `<p id="status-text">` reflecting status. Later tasks' content script relies on this exact button text.

- [ ] **Step 1: Write the manifest**

Create `extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Cefalo Attendance Check-in",
  "version": "1.0.0",
  "description": "Check in/out of the Cefalo HR attendance portal from the toolbar.",
  "permissions": ["storage", "tabs", "alarms"],
  "host_permissions": [
    "https://hrportal.cefalolab.com/*",
    "http://localhost/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "content_scripts": [
    {
      "matches": [
        "https://hrportal.cefalolab.com/attendance/*",
        "http://localhost/*"
      ],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

Note: Chrome match patterns without an explicit port match any port, so `http://localhost/*` matches the dummy page served on any port (e.g. 8000).

- [ ] **Step 2: Add placeholder icons**

Run (creates a minimal valid 1x1 PNG reused for all three sizes — Chrome scales it fine as a placeholder):

```bash
mkdir -p extension/icons
base64 -d > extension/icons/icon16.png <<'EOF'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=
EOF
cp extension/icons/icon16.png extension/icons/icon48.png
cp extension/icons/icon16.png extension/icons/icon128.png
```

- [ ] **Step 3: Write the dummy attendance page**

Create `test-page/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Dummy Attendance Portal</title>
</head>
<body>
<h1>Dummy Attendance Portal</h1>
<p id="status-text">Status: Checked out</p>
<button id="attendance-btn">Check In</button>
<script src="app.js"></script>
</body>
</html>
```

Create `test-page/app.js`:

```js
const btn = document.getElementById('attendance-btn');
const status = document.getElementById('status-text');

btn.addEventListener('click', () => {
  if (btn.textContent === 'Check In') {
    btn.textContent = 'Check Out';
    status.textContent = 'Status: Checked in';
  } else {
    btn.textContent = 'Check In';
    status.textContent = 'Status: Checked out';
  }
});
```

- [ ] **Step 4: Manual verification**

```bash
cd test-page && python3 -m http.server 8000
```

Open `http://localhost:8000/` in a browser tab, click the button, confirm it toggles between "Check In" and "Check Out" and the status line updates. Leave the server running for later tasks.

Then open `chrome://extensions`, enable Developer mode, click "Load unpacked", and select the `extension/` folder. Confirm it loads with no errors and the toolbar icon appears.

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json extension/icons test-page
git commit -m "Scaffold extension manifest, icons, and local dummy attendance page"
```

---

## Task 2: content.js — pure button-matching logic (TDD)

**Files:**
- Create: `extension/content.js`
- Test: `tests/content.test.js`

**Interfaces:**
- Produces: `textMatches(text, kind)` where `kind` is `'checkin'` or `'checkout'`, returns boolean. `pickVisibleMatch(elements, kind)` where `elements` is an array of `{ text: string, visible: boolean }` (plus any other properties, ignored), returns the first element where `visible === true` and `textMatches(el.text, kind)` is true, or `null` if none match.

- [ ] **Step 1: Write the failing tests**

Create `tests/content.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/content.test.js`
Expected: FAIL — `extension/content.js` does not exist yet (`Cannot find module`).

- [ ] **Step 3: Write the minimal implementation**

Create `extension/content.js`:

```js
function textMatches(text, kind) {
  const pattern = kind === 'checkin' ? /check.?in/i : /check.?out/i;
  return pattern.test(text.trim());
}

function pickVisibleMatch(elements, kind) {
  return elements.find((el) => el.visible && textMatches(el.text, kind)) || null;
}

if (typeof module !== 'undefined') {
  module.exports = { textMatches, pickVisibleMatch };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/content.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/content.js tests/content.test.js
git commit -m "Add content.js button-matching logic with unit tests"
```

---

## Task 3: content.js — DOM wiring (click handling + observed-status reporting)

**Files:**
- Modify: `extension/content.js`

**Interfaces:**
- Consumes: `textMatches(text, kind)` and `pickVisibleMatch(elements, kind)` from Task 2, already defined above the `module.exports` guard in this same file — do not redefine them.
- Produces: when loaded in a real browser tab matching the manifest's content script patterns, this script (a) listens for `chrome.runtime.onMessage` messages shaped `{ command: 'click', want: 'checkin' | 'checkout' }` and responds `{ ok: true }` after clicking the matched element, or `{ ok: false, error: 'button not found' }` if none is visible; (b) on load, sends `{ type: 'observed', status: 'checked-in' | 'checked-out' }` to the background script reporting which button is currently visible (sends nothing if neither is found).

- [ ] **Step 1: Append the browser-only wiring**

Append to the end of `extension/content.js` (after the `module.exports` guard block):

```js
if (typeof chrome !== 'undefined') {
  function queryClickableElements() {
    const selector = 'button, a, input[type="submit"], [role="button"]';
    return Array.from(document.querySelectorAll(selector)).map((node) => ({
      text: node.textContent || node.value || '',
      visible: !!node.offsetParent,
      node,
    }));
  }

  function reportObservedStatus() {
    const elements = queryClickableElements();
    if (pickVisibleMatch(elements, 'checkout')) {
      chrome.runtime.sendMessage({ type: 'observed', status: 'checked-in' });
    } else if (pickVisibleMatch(elements, 'checkin')) {
      chrome.runtime.sendMessage({ type: 'observed', status: 'checked-out' });
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.command === 'click') {
      const elements = queryClickableElements();
      const match = pickVisibleMatch(elements, message.want);
      if (match) {
        match.node.click();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'button not found' });
      }
      return true;
    }
    return false;
  });

  reportObservedStatus();
}
```

- [ ] **Step 2: Re-run the Task 2 unit tests to confirm nothing broke**

Run: `node --test tests/content.test.js`
Expected: PASS (still 7 tests — the new code is skipped by `require()` since `chrome` is undefined in Node)

- [ ] **Step 3: Manual verification against the dummy page**

With `test-page/` still served at `http://localhost:8000/` (Task 1), reload the unpacked extension in `chrome://extensions`, then open `http://localhost:8000/` in a tab.

On `chrome://extensions`, click "service worker" under the extension to open its DevTools console (it will show no listeners yet since `background.js` doesn't exist — that's fine for this test, `chrome.tabs.sendMessage` still works). In that console, run:

```js
chrome.tabs.query({ url: 'http://localhost/*' }, async ([tab]) => {
  const res = await chrome.tabs.sendMessage(tab.id, { command: 'click', want: 'checkin' });
  console.log(res);
});
```

Expected: logs `{ok: true}`, and the dummy page's button visibly changes from "Check In" to "Check Out". Re-run with `want: 'checkout'` and confirm it flips back and also logs `{ok: true}`.

- [ ] **Step 4: Commit**

```bash
git add extension/content.js
git commit -m "Wire content script DOM click handling and observed-status reporting"
```

---

## Task 4: background.js — pure state logic (TDD)

**Files:**
- Create: `extension/background.js`
- Test: `tests/background.test.js`

**Interfaces:**
- Produces:
  - `formatBadgeElapsed(ms)` → string. `<60` minutes: `"${minutes}m"` (e.g. `"0m"`, `"45m"`). `>=60` minutes: `"${hours}h${paddedMinutes}m"` with minutes zero-padded to 2 digits (e.g. `"1h05m"`, `"2h00m"`).
  - `reconcile(state, observedStatus, now)` where `state` is `{ checkedIn: boolean, checkInTime: number|null }`, `observedStatus` is `'checked-in' | 'checked-out' | null`, `now` is a zero-arg function returning epoch ms. Returns a state object: if `observedStatus === 'checked-in'` and `state.checkedIn` is false, returns `{ checkedIn: true, checkInTime: state.checkInTime ?? now() }`. If `observedStatus === 'checked-out'` and `state.checkedIn` is true, returns `{ checkedIn: false, checkInTime: null }`. Otherwise returns the exact same `state` reference (used by callers to detect "no change" via `===`).
  - `appendLogEntry(log, entry, max)` → new array `[entry, ...log]` truncated to `max` length. Does not mutate `log`.

- [ ] **Step 1: Write the failing tests**

Create `tests/background.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/background.test.js`
Expected: FAIL — `extension/background.js` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `extension/background.js`:

```js
function formatBadgeElapsed(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${String(minutes).padStart(2, '0')}m`;
}

function reconcile(state, observedStatus, now) {
  if (observedStatus === 'checked-in' && !state.checkedIn) {
    return { checkedIn: true, checkInTime: state.checkInTime ?? now() };
  }
  if (observedStatus === 'checked-out' && state.checkedIn) {
    return { checkedIn: false, checkInTime: null };
  }
  return state;
}

function appendLogEntry(log, entry, max) {
  return [entry, ...log].slice(0, max);
}

if (typeof module !== 'undefined') {
  module.exports = { formatBadgeElapsed, reconcile, appendLogEntry };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/background.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/background.js tests/background.test.js
git commit -m "Add background.js pure state logic with unit tests"
```

---

## Task 5: background.js — storage helpers, tab reuse/creation, and action handling

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `formatBadgeElapsed`, `reconcile`, `appendLogEntry` from Task 4, already defined above the `module.exports` guard in this file.
- Produces (inside the `if (typeof chrome !== 'undefined')` block, so accessible from the service worker's own DevTools console for manual testing): `getState()`, `setState(state)`, `appendLog(entry)`, `findOrCreateTargetTab()`, `performAction(want)` where `want` is `'checkin'` or `'checkout'`, returning `Promise<{ok: true} | {ok: false, error: string}>`. Registers a `chrome.runtime.onMessage` listener that, on receiving `{ action: 'checkin' | 'checkout' }` (the message shape the popup will send in Task 8), calls `performAction` and responds with its result.

- [ ] **Step 1: Append storage, tab, and action-handling code**

Append to the end of `extension/background.js`, inside a new `if (typeof chrome !== 'undefined') { ... }` block:

```js
if (typeof chrome !== 'undefined') {
  const STORAGE_KEYS = { CHECKED_IN: 'checkedIn', CHECK_IN_TIME: 'checkInTime', LOG: 'log' };
  const MAX_LOG_ENTRIES = 30;
  const TARGET_URL_PATTERNS = ['https://hrportal.cefalolab.com/attendance/*', 'http://localhost/*'];
  const TARGET_URL = 'https://hrportal.cefalolab.com/attendance/';

  async function getState() {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.CHECKED_IN, STORAGE_KEYS.CHECK_IN_TIME]);
    return {
      checkedIn: stored[STORAGE_KEYS.CHECKED_IN] ?? false,
      checkInTime: stored[STORAGE_KEYS.CHECK_IN_TIME] ?? null,
    };
  }

  async function setState(state) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.CHECKED_IN]: state.checkedIn,
      [STORAGE_KEYS.CHECK_IN_TIME]: state.checkInTime,
    });
  }

  async function appendLog(entry) {
    const { log = [] } = await chrome.storage.local.get(STORAGE_KEYS.LOG);
    const next = appendLogEntry(log, entry, MAX_LOG_ENTRIES);
    await chrome.storage.local.set({ [STORAGE_KEYS.LOG]: next });
  }

  async function findOrCreateTargetTab() {
    for (const pattern of TARGET_URL_PATTERNS) {
      const [tab] = await chrome.tabs.query({ url: pattern });
      if (tab) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return tab;
      }
    }
    const tab = await chrome.tabs.create({ url: TARGET_URL });
    await new Promise((resolve) => {
      function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
    return tab;
  }

  async function performAction(want) {
    const tab = await findOrCreateTargetTab();
    const response = await chrome.tabs.sendMessage(tab.id, { command: 'click', want });
    if (!response || !response.ok) {
      return { ok: false, error: (response && response.error) || 'no response from page' };
    }
    const now = Date.now();
    if (want === 'checkin') {
      await setState({ checkedIn: true, checkInTime: now });
      await appendLog({ type: 'checkin', timestamp: now });
    } else {
      await setState({ checkedIn: false, checkInTime: null });
      await appendLog({ type: 'checkout', timestamp: now });
    }
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'checkin' || message.action === 'checkout') {
      performAction(message.action).then(sendResponse);
      return true;
    }
    return false;
  });
}
```

- [ ] **Step 2: Re-run existing unit tests to confirm nothing broke**

Run: `node --test tests/*.test.js`
Expected: PASS (all tests from Tasks 2 and 4)

- [ ] **Step 3: Manual verification**

Ensure the `test-page/` server from Task 1 is running and a tab with `http://localhost:8000/` is open. Reload the unpacked extension in `chrome://extensions`, open the service worker console, and run:

```js
performAction('checkin').then(console.log);
```

Expected: logs `{ok: true}`; the localhost tab activates and its button flips to "Check Out". Then run:

```js
chrome.storage.local.get(null, console.log);
```

Expected: shows `checkedIn: true`, a numeric `checkInTime`, and a `log` array with one `{type: 'checkin', timestamp: ...}` entry. Then run `performAction('checkout').then(console.log)` and confirm `checkedIn` becomes `false`, `checkInTime` becomes `null`, and `log` now has 2 entries with the checkout one first.

- [ ] **Step 4: Commit**

```bash
git add extension/background.js
git commit -m "Add background state storage, tab reuse/creation, and check-in/out action handling"
```

---

## Task 6: background.js — badge and alarm wiring

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `formatBadgeElapsed` (Task 4), `getState` (Task 5), already defined earlier in this file.
- Produces: `updateBadge()` (sets the toolbar badge text/color from current state, or clears it when checked out), a `chrome.alarms` alarm named `badge-tick` firing every minute that calls `updateBadge()`, and `updateBadge()` also called on `chrome.runtime.onInstalled`/`onStartup` and at the end of `performAction`.

- [ ] **Step 1: Add updateBadge and alarm registration**

Inside the same `if (typeof chrome !== 'undefined') { ... }` block from Task 5, add this constant near the top (next to `MAX_LOG_ENTRIES`):

```js
  const BADGE_ALARM = 'badge-tick';
```

Add the `updateBadge` function (place it after `appendLog`, before `findOrCreateTargetTab`):

```js
  async function updateBadge() {
    const state = await getState();
    if (!state.checkedIn) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    const elapsed = Date.now() - state.checkInTime;
    await chrome.action.setBadgeText({ text: formatBadgeElapsed(elapsed) });
    await chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' });
  }
```

Modify `performAction` to call it before returning success — change:

```js
    if (want === 'checkin') {
      await setState({ checkedIn: true, checkInTime: now });
      await appendLog({ type: 'checkin', timestamp: now });
    } else {
      await setState({ checkedIn: false, checkInTime: null });
      await appendLog({ type: 'checkout', timestamp: now });
    }
    return { ok: true };
```

to:

```js
    if (want === 'checkin') {
      await setState({ checkedIn: true, checkInTime: now });
      await appendLog({ type: 'checkin', timestamp: now });
    } else {
      await setState({ checkedIn: false, checkInTime: null });
      await appendLog({ type: 'checkout', timestamp: now });
    }
    await updateBadge();
    return { ok: true };
```

Add alarm registration at the very end of the `if (typeof chrome !== 'undefined')` block:

```js
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BADGE_ALARM) {
      updateBadge();
    }
  });

  chrome.runtime.onInstalled.addListener(updateBadge);
  chrome.runtime.onStartup.addListener(updateBadge);
```

- [ ] **Step 2: Re-run existing unit tests to confirm nothing broke**

Run: `node --test tests/*.test.js`
Expected: PASS

- [ ] **Step 3: Manual verification**

Reload the unpacked extension. In the service worker console, run `performAction('checkin').then(console.log)`, then immediately run `updateBadge()` and check the toolbar icon shows `0m`. Run `chrome.alarms.getAll(console.log)` and confirm an alarm named `badge-tick` with `periodInMinutes: 1` is listed. Run `performAction('checkout').then(console.log)` and confirm the badge clears.

- [ ] **Step 4: Commit**

```bash
git add extension/background.js
git commit -m "Add toolbar badge updates driven by a 1-minute alarm"
```

---

## Task 7: background.js — observed-status reconciliation wiring

**Files:**
- Modify: `extension/background.js`

**Interfaces:**
- Consumes: `reconcile` (Task 4), `getState`/`setState` (Task 5), `updateBadge` (Task 6). Also consumes the `{ type: 'observed', status: 'checked-in' | 'checked-out' }` message shape sent by `content.js` (Task 3).
- Produces: the `onMessage` listener now also handles `observed` messages, updating storage and the badge when the page's real status disagrees with stored state.

- [ ] **Step 1: Extend the onMessage listener**

Change the `chrome.runtime.onMessage.addListener` body from Task 5:

```js
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'checkin' || message.action === 'checkout') {
      performAction(message.action).then(sendResponse);
      return true;
    }
    return false;
  });
```

to:

```js
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'checkin' || message.action === 'checkout') {
      performAction(message.action).then(sendResponse);
      return true;
    }
    if (message.type === 'observed') {
      (async () => {
        const state = await getState();
        const next = reconcile(state, message.status, Date.now);
        if (next !== state) {
          await setState(next);
          await updateBadge();
        }
      })();
    }
    return false;
  });
```

- [ ] **Step 2: Re-run existing unit tests to confirm nothing broke**

Run: `node --test tests/*.test.js`
Expected: PASS

- [ ] **Step 3: Manual verification**

With the extension checked-out (from Task 6's cleanup) and the `http://localhost:8000/` tab open, click the dummy page's button directly (not via the extension) so it now reads "Check Out" — this simulates checking in outside the extension. Reload that tab (triggers `content.js`'s on-load `reportObservedStatus`). In the service worker console, run `chrome.storage.local.get(['checkedIn', 'checkInTime'], console.log)` and confirm `checkedIn: true` with a `checkInTime` set to roughly now. Then click the dummy page's button again directly (back to "Check In") and reload the tab; confirm `checkedIn` becomes `false` and `checkInTime` becomes `null`.

- [ ] **Step 4: Commit**

```bash
git add extension/background.js
git commit -m "Reconcile extension state when the page's real status drifts from stored state"
```

---

## Task 8: Popup UI

**Files:**
- Create: `extension/popup.html`
- Create: `extension/popup.js`

**Interfaces:**
- Consumes: sends `{ action: 'checkin' | 'checkout' }` to the background (handled since Task 5); reads/writes `chrome.storage.local` keys `checkedIn`/`checkInTime` (same keys as `background.js`'s `STORAGE_KEYS`).
- Produces: opens `log.html` (Task 9) via `chrome.runtime.getURL('log.html')` when "View Log" is clicked.

- [ ] **Step 1: Write popup.html**

Create `extension/popup.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Attendance</title>
<style>
  body { font-family: sans-serif; width: 220px; padding: 12px; }
  button { width: 100%; padding: 8px; font-size: 14px; cursor: pointer; }
  #timer { margin-top: 8px; font-size: 13px; color: #333; }
  #error { margin-top: 8px; font-size: 12px; color: #c62828; }
  #view-log { display: block; margin-top: 12px; font-size: 12px; text-align: center; }
</style>
</head>
<body>
  <button id="action-btn">Check In</button>
  <div id="timer"></div>
  <div id="error"></div>
  <a href="#" id="view-log">View Log</a>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write popup.js**

Create `extension/popup.js`:

```js
const actionBtn = document.getElementById('action-btn');
const timerEl = document.getElementById('timer');
const errorEl = document.getElementById('error');
const viewLogLink = document.getElementById('view-log');

let tickHandle = null;

function formatTimer(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function render(state) {
  clearInterval(tickHandle);
  if (state.checkedIn) {
    actionBtn.textContent = 'Check Out';
    const tick = () => {
      timerEl.textContent = `Elapsed: ${formatTimer(Date.now() - state.checkInTime)}`;
    };
    tick();
    tickHandle = setInterval(tick, 1000);
  } else {
    actionBtn.textContent = 'Check In';
    timerEl.textContent = '';
  }
}

async function loadState() {
  const stored = await chrome.storage.local.get(['checkedIn', 'checkInTime']);
  render({ checkedIn: stored.checkedIn ?? false, checkInTime: stored.checkInTime ?? null });
}

actionBtn.addEventListener('click', async () => {
  errorEl.textContent = '';
  actionBtn.disabled = true;
  const action = actionBtn.textContent === 'Check In' ? 'checkin' : 'checkout';
  const response = await chrome.runtime.sendMessage({ action });
  actionBtn.disabled = false;
  if (!response || !response.ok) {
    errorEl.textContent = (response && response.error) || 'Something went wrong';
  }
});

viewLogLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('log.html') });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.checkedIn || changes.checkInTime)) {
    loadState();
  }
});

loadState();
```

- [ ] **Step 3: Manual verification**

Reload the unpacked extension. With `http://localhost:8000/` open and the dummy page reading "Check In", click the toolbar icon to open the popup. Click "Check In" in the popup: confirm the dummy page's tab activates and its button flips to "Check Out", the popup button relabels to "Check Out", and the elapsed timer starts ticking every second. Close and reopen the popup — confirm the timer resumes from the correct elapsed value (not reset to zero). Click "Check Out": confirm the dummy page flips back, the popup relabels to "Check In", and the timer clears.

- [ ] **Step 4: Commit**

```bash
git add extension/popup.html extension/popup.js
git commit -m "Add popup UI with check-in/out button and live elapsed timer"
```

---

## Task 9: History log page (TDD for formatting + rendering)

**Files:**
- Create: `extension/log.html`
- Create: `extension/log.js`
- Test: `tests/log.test.js`

**Interfaces:**
- Consumes: reads the `log` array (`{type, timestamp}[]`) from `chrome.storage.local`, the same key `background.js` writes in `appendLog` (Task 5).
- Produces: `formatRow(entry)` → `{ type: 'Check In' | 'Check Out', date: string, time: string }`, a pure function.

- [ ] **Step 1: Write the failing test**

Create `tests/log.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/log.test.js`
Expected: FAIL — `extension/log.js` does not exist yet.

- [ ] **Step 3: Write log.js**

Create `extension/log.js`:

```js
function formatRow(entry) {
  const date = new Date(entry.timestamp);
  return {
    type: entry.type === 'checkin' ? 'Check In' : 'Check Out',
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString(),
  };
}

if (typeof module !== 'undefined') {
  module.exports = { formatRow };
}

if (typeof chrome !== 'undefined') {
  async function render() {
    const { log = [] } = await chrome.storage.local.get('log');
    const tbody = document.getElementById('log-body');
    tbody.innerHTML = '';
    for (const entry of log) {
      const row = formatRow(entry);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${row.type}</td><td>${row.date}</td><td>${row.time}</td>`;
      tbody.appendChild(tr);
    }
  }
  render();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/log.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Write log.html**

Create `extension/log.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Attendance Log</title>
<style>
  body { font-family: sans-serif; padding: 16px; }
  table { border-collapse: collapse; width: 100%; max-width: 480px; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f0f0f0; }
</style>
</head>
<body>
  <h1>Attendance Log</h1>
  <table id="log-table">
    <thead><tr><th>Type</th><th>Date</th><th>Time</th></tr></thead>
    <tbody id="log-body"></tbody>
  </table>
  <script src="log.js"></script>
</body>
</html>
```

- [ ] **Step 6: Manual verification**

Reload the unpacked extension. Using the popup (Task 8), do one check-in and one check-out against the dummy page so the log has 2 entries. Open the popup and click "View Log": confirm a new tab opens showing a table with 2 rows, newest first, correct "Check In"/"Check Out" labels and plausible date/time values.

- [ ] **Step 7: Commit**

```bash
git add extension/log.html extension/log.js tests/log.test.js
git commit -m "Add history log page with formatted, tested rendering"
```

---

## Task 10: Independent code review

This task is deliberately done by a fresh reviewer with no memory of why implementation choices were made, so it catches things the implementer normalized.

- [ ] **Step 1: Dispatch a fresh, context-free reviewer**

Use the Agent tool with `subagent_type: general-purpose` (a brand-new agent, not a continuation of the implementation session). Prompt it with:

> Review the Chrome extension in `extension/` (plus `tests/` and `test-page/`) against the spec at `docs/superpowers/specs/2026-09-01-attendance-checkin-extension-design.md`. Check for: correctness bugs, mismatches between the spec and the implementation, Manifest V3 API misuse, race conditions in the background service worker (e.g. around `chrome.storage.local` reads/writes, alarms, and tab creation), XSS risk in `log.js`'s HTML rendering of log entries, and general code quality. Report concrete findings with file:line references — do not just say "looks good."

- [ ] **Step 2: Triage findings**

For each finding: confirm it's real (reproduce or reason through it), then either fix it in the relevant file and re-run the affected unit tests (`node --test tests/*.test.js`), or note explicitly why it's not applicable. Do not accept vague feedback without a concrete file:line pointer.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "Address independent code review findings"
```

(Skip this step if no fixes were needed.)

---

## Task 11: Independent functional review

This task is deliberately done by a fresh reviewer that drives the real, running extension — it catches integration issues unit tests and code review can't see.

**Prerequisite (human step, not scriptable):** the unpacked extension from `extension/` must already be loaded in `chrome://extensions` (Developer mode → Load unpacked), and `test-page/` must be served locally (e.g. `python3 -m http.server 8000` from `test-page/`).

- [ ] **Step 1: Dispatch a fresh, context-free functional reviewer**

Use the Agent tool with a fresh `general-purpose` agent (with access to Chrome automation, i.e. after invoking the `claude-in-chrome` skill) and prompt it with:

> An unpacked Chrome extension for attendance check-in/check-out is already loaded, and a dummy attendance page is served at http://localhost:8000/. Using Chrome automation, verify end-to-end against the spec at `docs/superpowers/specs/2026-09-01-attendance-checkin-extension-design.md`: (1) opening the extension popup while checked out shows a "Check In" button; (2) clicking it activates/opens the localhost:8000 tab, clicks its button (now reads "Check Out"), and the popup shows "Check Out" with a ticking elapsed timer; (3) the toolbar badge shows an elapsed-time string; (4) clicking Check In again while the tab is already open reuses that tab rather than opening a new one; (5) clicking "Check Out" in the popup flips the dummy page back to "Check In" and stops the timer; (6) opening "View Log" from the popup shows a table with the check-in and check-out events just performed, newest first. Report pass/fail for each of these six behaviors with evidence (screenshots or observed text), not just a summary verdict.

- [ ] **Step 2: Address any failures**

For each reported failure, reproduce it, fix the responsible file, re-run relevant unit tests (`node --test tests/*.test.js`), and manually re-verify that specific behavior before moving on.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "Address independent functional review findings"
```

(Skip this step if no fixes were needed.)
