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

function logEntryForTransition(prevCheckedIn, nextCheckedIn, checkInTime, now) {
  if (nextCheckedIn && !prevCheckedIn) {
    return { type: 'checkin', timestamp: checkInTime };
  }
  if (!nextCheckedIn && prevCheckedIn) {
    return { type: 'checkout', timestamp: now };
  }
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = { formatBadgeElapsed, reconcile, appendLogEntry, logEntryForTransition };
}

if (typeof chrome !== 'undefined') {
  const STORAGE_KEYS = { CHECKED_IN: 'checkedIn', CHECK_IN_TIME: 'checkInTime', LOG: 'log' };
  const MAX_LOG_ENTRIES = 30;
  const BADGE_ALARM = 'badge-tick';
  // Set to true only while developing against the local test-page harness
  // (test-page/) — when true, the extension will reuse/activate ANY open
  // localhost tab, which can hijack an unrelated local dev server.
  const INCLUDE_LOCALHOST_TARGET = false;
  const TARGET_URL_PATTERNS = INCLUDE_LOCALHOST_TARGET
    ? ['https://hrportal.cefalolab.com/attendance/*', 'http://localhost/*']
    : ['https://hrportal.cefalolab.com/attendance/*'];
  const TARGET_URL = 'https://hrportal.cefalolab.com/attendance/';

  let storageQueue = Promise.resolve();
  function serialize(fn) {
    const result = storageQueue.then(fn, fn);
    storageQueue = result.then(() => {}, () => {});
    return result;
  }

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

  async function updateBadge() {
    try {
      const state = await getState();
      if (!state.checkedIn) {
        await chrome.action.setBadgeText({ text: '' });
        return;
      }
      const elapsed = Date.now() - state.checkInTime;
      await chrome.action.setBadgeText({ text: formatBadgeElapsed(elapsed) });
      await chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' });
    } catch (err) {
      console.error('updateBadge failed:', err);
    }
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
      const cleanup = () => {
        chrome.tabs.onUpdated.removeListener(updateListener);
        chrome.tabs.onRemoved.removeListener(removedListener);
        clearTimeout(timer);
      };
      function updateListener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          cleanup();
          resolve();
        }
      }
      function removedListener(tabId) {
        if (tabId === tab.id) {
          cleanup();
          resolve();
        }
      }
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, 15000);
      chrome.tabs.onUpdated.addListener(updateListener);
      chrome.tabs.onRemoved.addListener(removedListener);
    });
    return tab;
  }

  async function performAction() {
    const tab = await findOrCreateTargetTab();
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { command: 'click', want: 'checkin' });
    } catch (err) {
      return { ok: false, error: err.message || 'could not reach the page' };
    }
    if (!response || !response.ok) {
      return { ok: false, error: (response && response.error) || 'no response from page' };
    }
    const now = Date.now();
    await serialize(async () => {
      const state = await getState();
      const entry = logEntryForTransition(state.checkedIn, true, now, now);
      if (entry) {
        await setState({ checkedIn: true, checkInTime: now });
        await appendLog(entry);
      }
    });
    await updateBadge();
    return { ok: true };
  }

  async function navigateToTarget() {
    try {
      await findOrCreateTargetTab();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'could not open the page' };
    }
  }

  // Detection reads the portal's DOM, so it can always miss a transition. This
  // is the escape hatch: it closes the session at a caller-supplied time and
  // writes the matching log entry so the log does not keep an open check-in.
  async function clearSession(checkoutTime) {
    let cleared = false;
    await serialize(async () => {
      const state = await getState();
      if (!state.checkedIn) {
        return;
      }
      const entry = logEntryForTransition(true, false, state.checkInTime, checkoutTime);
      await setState({ checkedIn: false, checkInTime: null });
      if (entry) {
        await appendLog(entry);
      }
      cleared = true;
    });
    await updateBadge();
    return { ok: true, cleared };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'checkin') {
      performAction()
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: err.message || 'unexpected error' }));
      return true;
    }
    if (message.action === 'gotocheckout') {
      navigateToTarget().then(sendResponse);
      return true;
    }
    if (message.action === 'clearsession') {
      clearSession(message.checkoutTime ?? Date.now())
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: err.message || 'unexpected error' }));
      return true;
    }
    if (message.type === 'observed') {
      (async () => {
        try {
          let changed = false;
          await serialize(async () => {
            const state = await getState();
            const next = reconcile(state, message.status, Date.now);
            if (next !== state) {
              const entry = logEntryForTransition(state.checkedIn, next.checkedIn, next.checkInTime, Date.now());
              await setState(next);
              if (entry) {
                await appendLog(entry);
              }
              changed = true;
            }
          });
          if (changed) {
            await updateBadge();
          }
        } catch (err) {
          console.error('Error reconciling observed status:', err);
        }
      })();
    }
    return false;
  });

  chrome.alarms.get(BADGE_ALARM, (existing) => {
    if (!existing) {
      chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 });
    }
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BADGE_ALARM) {
      updateBadge();
    }
  });

  chrome.runtime.onInstalled.addListener(updateBadge);
  chrome.runtime.onStartup.addListener(updateBadge);
}
