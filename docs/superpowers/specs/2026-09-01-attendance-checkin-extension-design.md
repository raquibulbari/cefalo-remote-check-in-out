# Attendance Check-in/Check-out Chrome Extension — Design

Date: 2026-09-01

## Purpose

A Manifest V3 Chrome extension that automates clicking the "Check in" /
"Check out" button on the company HR attendance portal
(`https://hrportal.cefalolab.com/attendance/`), tracks elapsed time
since check-in, and keeps a short local history log. Includes a local
dummy test page so the whole flow can be developed and verified
without touching the real portal.

## Non-goals

- No login/authentication handling — the user is assumed already
  logged into the HR portal in their normal browsing session.
- No editing or exporting the history log; it's a passive audit trail.
- No sync across devices/profiles — `chrome.storage.local` only.
- No support for browsers other than Chrome (MV3 target).

## Components

```
extension/
  manifest.json
  background.js      # service worker: source of truth, orchestration
  content.js          # injected into hrportal + local test page
  popup.html
  popup.js
  log.html
  log.js
  icons/
    icon16.png
    icon48.png
    icon128.png

test-page/
  index.html           # dummy attendance page for local testing
```

No build step or bundler — plain HTML/CSS/JS, loaded as an unpacked
extension.

### manifest.json

- `manifest_version: 3`
- `permissions`: `storage`, `tabs`, `alarms`
- `host_permissions`: `https://hrportal.cefalolab.com/*`,
  `http://localhost/*` (for the local test page during development)
- `background.service_worker`: `background.js`
- `action.default_popup`: `popup.html`
- `content_scripts`: matches both
  `https://hrportal.cefalolab.com/attendance/*` and
  `http://localhost:*/*`, running `content.js` at `document_idle`

### background.js — source of truth

Holds all persistent state in `chrome.storage.local`:

| key | shape | meaning |
|---|---|---|
| `checkedIn` | boolean | current status |
| `checkInTime` | number (epoch ms) \| null | when the current session started |
| `log` | array of `{type: 'checkin'\|'checkout', timestamp}` | newest-first, capped at 30 entries |

Responsibilities:

1. **Handle popup actions.** On `{action: 'checkin'}` or
   `{action: 'checkout'}` from the popup:
   - Find an existing tab matching the target URL
     (`chrome.tabs.query`). If found, activate it and its window.
     Otherwise create a new tab with the target URL and wait for
     `tabs.onUpdated` status `complete`.
   - Send `{command: 'click', want: 'checkin'|'checkout'}` to the
     content script in that tab.
   - On success response: update `checkedIn`/`checkInTime`, prepend an
     entry to `log` (trim to 30), update the badge. On failure
     response: relay the error back to the popup (no state change).

2. **Reconcile drift.** Content script also reports current page
   status unprompted on every load (see content.js below), tagged
   `{source: 'observed'}`. Background compares against stored
   `checkedIn`:
   - Page shows checked-in, extension thought checked-out → adopt
     checked-in; if `checkInTime` is null, set it to "now" (best
     effort — the true original check-in time isn't recoverable from
     page state alone). This does **not** write a log entry, since it
     wasn't an action the extension performed.
   - Page shows checked-out, extension thought checked-in → clear
     `checkedIn`/`checkInTime`. Also no log entry (same reasoning).

3. **Badge.** A `chrome.alarms` timer (period: 1 minute, the MV3
   minimum) recomputes elapsed time from `checkInTime` and sets the
   badge text (e.g. `23m`, `1h05m`); clears the badge when checked
   out. Recomputing from the stored timestamp (rather than
   incrementing a counter) avoids drift if the service worker is
   unloaded and restarted by Chrome.

### content.js — page interaction

Runs on both the real portal and the local test page (same code path,
which is the point of the test harness).

- **On load**: scans all visible clickable elements (`button`, `a`,
  `input[type=submit]`, `[role=button]`) for text matching
  `/check.?in/i` or `/check.?out/i`. Reports whichever is found to
  background as an `observed` status message (for drift
  reconciliation). If neither is found, reports nothing (page may not
  be the attendance view yet).
- **On `{command: 'click', want}` message from background**: re-scans
  for a visible element whose text matches the pattern for `want`
  (`/check.?in/i` for checkin, `/check.?out/i` for checkout), clicks
  it, waits briefly, and responds `{ok: true}`. If no matching element
  is found, responds `{ok: false, error: 'button not found'}`.

### popup.html/js

- Reads state from `chrome.storage.local` on open; subscribes to
  `chrome.storage.onChanged` to stay live while open.
- Shows one button, label driven by `checkedIn`: "Check In" or "Check
  Out". Clicking sends the corresponding action to background and
  shows a spinner/disabled state until a response arrives; on error,
  shows the error inline.
- When checked in, shows elapsed time text, ticking every second via
  `setInterval` computed from `checkInTime` (only while the popup is
  open — this is separate from the toolbar badge, which ticks every
  minute in the background).
- A "View Log" link at the bottom opens `log.html` in a new tab
  (`chrome.tabs.create`).

### log.html/js

- Simple read-only page: reads the `log` array from
  `chrome.storage.local` and renders a table (Type | Date | Time),
  newest first. No pagination needed (capped at 30 rows).

## Local test harness

`test-page/index.html`: a static page with one button that toggles
between "Check In" and "Check Out" text on click (mirroring the
expected real-portal behavior) and a status line showing the current
state. Served via `python3 -m http.server` from the `test-page/`
directory — no dependencies. The extension's content script matches
`http://localhost:*/*`, so exercising this dummy page runs the exact
same `content.js` logic that will run against the real portal.

Because the real portal's markup is unknown in this environment, the
text-match heuristic in `content.js` cannot be validated against it
directly — the dummy page is the primary validation surface. This is
a known limitation: if the real button's visible text doesn't contain
"check in"/"check out" in some recognizable form, the heuristic will
need adjustment once tried against the live site.

## Testing approach

No meaningful headless unit-test story exists for MV3
popup/background/content-script interaction. Validation is
end-to-end, manual + browser-automated:

1. User loads the unpacked extension via `chrome://extensions` (native
   file picker — not scriptable).
2. Serve `test-page/` locally.
3. Automated (browser-driven) pass: open the popup, click "Check In",
   verify the dummy page's button was clicked and now reads "Check
   Out", verify the popup shows the elapsed timer and the toolbar
   badge updates, verify a log entry was recorded, verify tab reuse
   (clicking Check In again while the tab is already open activates
   the same tab rather than opening a new one), click "Check Out",
   verify the timer stops and a second log entry is recorded, open
   "View Log" and verify both entries render correctly.

## Known limitations

- Real-portal button text/markup is unverified in this session; the
  heuristic may need a follow-up tweak once tried live.
- Drift reconciliation's "best effort now() timestamp" means elapsed
  time can be inaccurate if check-in happens outside the extension.
- Chrome's badge/alarm resolution is 1 minute; sub-minute badge
  updates aren't possible in MV3.
