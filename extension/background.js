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
