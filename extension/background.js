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

if (typeof chrome !== 'undefined') {
  const STORAGE_KEYS = { CHECKED_IN: 'checkedIn', CHECK_IN_TIME: 'checkInTime', LOG: 'log' };
  const MAX_LOG_ENTRIES = 30;
  const BADGE_ALARM = 'badge-tick';
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

  async function performAction(want) {
    const tab = await findOrCreateTargetTab();
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { command: 'click', want });
    } catch (err) {
      return { ok: false, error: err.message || 'could not reach the page' };
    }
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
    await updateBadge();
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'checkin' || message.action === 'checkout') {
      performAction(message.action).then(sendResponse);
      return true;
    }
    if (message.type === 'observed') {
      (async () => {
        try {
          const state = await getState();
          const next = reconcile(state, message.status, Date.now);
          if (next !== state) {
            await setState(next);
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
