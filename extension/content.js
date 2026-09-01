function textMatches(text, kind) {
  const pattern = kind === 'checkin' ? /check.?in/i : /check.?out/i;
  return pattern.test(text.trim());
}

function pickVisibleMatch(elements, kind) {
  return elements.find((el) => el.visible && textMatches(el.text, kind)) || null;
}

// Once you have checked out for the day the portal removes the button entirely,
// so neither pattern matches. Absence is the only signal for that state, but it
// also describes a page that has not finished rendering, so it is only trusted
// when the page is demonstrably ready AND either the Check Out button was seen
// to vanish in this page session or the absence has outlasted this window.
const ABSENCE_CONFIRM_MS = 15000;

function decideStatus(view, options = {}) {
  const confirmMs = options.confirmMs ?? ABSENCE_CONFIRM_MS;
  if (view.hasCheckOut) {
    return 'checked-in';
  }
  if (view.hasCheckIn) {
    return 'checked-out';
  }
  if (!view.pageReady) {
    return null;
  }
  if (view.sawCheckOut) {
    return 'checked-out';
  }
  return view.absentForMs >= confirmMs ? 'checked-out' : null;
}

if (typeof module !== 'undefined') {
  module.exports = { textMatches, pickVisibleMatch, decideStatus, ABSENCE_CONFIRM_MS };
}

if (typeof chrome !== 'undefined') {
  const PORTAL_HOST = 'hrportal.cefalolab.com';
  const PORTAL_PATH_PREFIX = '/attendance';
  const RECHECK_INTERVAL_MS = 2000;

  function isElementVisible(node) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) {
      return false;
    }
    if (node.offsetParent !== null) {
      return true;
    }
    if (style.position === 'fixed') {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    return false;
  }

  function queryClickableElements() {
    const selector = 'button, a, input[type="submit"], [role="button"]';
    return Array.from(document.querySelectorAll(selector)).map((node) => ({
      text: node.textContent || node.value || '',
      visible: isElementVisible(node),
      node,
    }));
  }

  // The portal is a single-page app, so this script stays alive across route
  // changes. Off the attendance route the button is legitimately absent, and
  // reading that as a check-out would clear a live timer.
  function isOnAttendanceRoute() {
    return location.hostname !== PORTAL_HOST || location.pathname.startsWith(PORTAL_PATH_PREFIX);
  }

  let lastReportedStatus = null;
  let sawCheckOutButton = false;
  let absentSince = null;
  let lastPathname = location.pathname;

  function resetRouteTracking() {
    sawCheckOutButton = false;
    absentSince = null;
    lastReportedStatus = null;
  }

  function currentView() {
    const elements = queryClickableElements();
    return {
      hasCheckIn: Boolean(pickVisibleMatch(elements, 'checkin')),
      hasCheckOut: Boolean(pickVisibleMatch(elements, 'checkout')),
      // A React root that has not mounted yet renders no clickable at all, so
      // "something is on screen" separates a rendered page from an empty one.
      pageReady:
        document.readyState === 'complete' &&
        isOnAttendanceRoute() &&
        elements.some((el) => el.visible),
      sawCheckOut: sawCheckOutButton,
      absentForMs: absentSince === null ? 0 : Date.now() - absentSince,
    };
  }

  function reportObservedStatus() {
    if (location.pathname !== lastPathname) {
      lastPathname = location.pathname;
      resetRouteTracking();
    }

    const view = currentView();
    const status = decideStatus(view);

    if (view.hasCheckOut) {
      sawCheckOutButton = true;
    }
    if (view.hasCheckIn || view.hasCheckOut) {
      absentSince = null;
    } else if (absentSince === null && view.pageReady) {
      absentSince = Date.now();
    }

    if (status && status !== lastReportedStatus) {
      lastReportedStatus = status;
      chrome.runtime.sendMessage({ type: 'observed', status }).catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.command === 'click') {
      const elements = queryClickableElements();
      const match = pickVisibleMatch(elements, message.want);
      if (match) {
        match.node.click();
        setTimeout(() => sendResponse({ ok: true }), 250);
      } else {
        sendResponse({ ok: false, error: 'button not found' });
      }
      return true;
    }
    return false;
  });

  reportObservedStatus();

  let observerTimer = null;
  let observerLastRun = 0;
  const OBSERVER_DEBOUNCE_MS = 300;
  const OBSERVER_MAX_WAIT_MS = 2000;
  const observer = new MutationObserver(() => {
    const now = Date.now();
    if (now - observerLastRun >= OBSERVER_MAX_WAIT_MS) {
      clearTimeout(observerTimer);
      observerLastRun = now;
      reportObservedStatus();
      return;
    }
    clearTimeout(observerTimer);
    observerTimer = setTimeout(() => {
      observerLastRun = Date.now();
      reportObservedStatus();
    }, OBSERVER_DEBOUNCE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // A settled page stops mutating, so the observer alone would never revisit an
  // absence that is still inside its confirmation window.
  setInterval(reportObservedStatus, RECHECK_INTERVAL_MS);
}
