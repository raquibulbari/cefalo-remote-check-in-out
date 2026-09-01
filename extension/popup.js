const actionBtn = document.getElementById('action-btn');
const timerEl = document.getElementById('timer');
const errorEl = document.getElementById('error');
const viewLogLink = document.getElementById('view-log');
const clearSessionLink = document.getElementById('clear-session');

let tickHandle = null;
let clearArmed = false;

function formatTimer(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function resetClearLink() {
  clearArmed = false;
  clearSessionLink.textContent = 'Already checked out? Stop the timer';
}

function render(state) {
  clearInterval(tickHandle);
  clearSessionLink.classList.toggle('visible', Boolean(state.checkedIn));
  if (!state.checkedIn) {
    resetClearLink();
  }
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
  const action = actionBtn.textContent === 'Check In' ? 'checkin' : 'gotocheckout';
  try {
    const response = await chrome.runtime.sendMessage({ action });
    if (!response || !response.ok) {
      errorEl.textContent = (response && response.error) || 'Something went wrong';
    }
  } catch (err) {
    errorEl.textContent = err.message || 'Could not reach the extension background';
  } finally {
    actionBtn.disabled = false;
  }
});

// Two clicks, because this writes a check-out entry to the log and there is no
// undo. The first click arms it, the second commits.
clearSessionLink.addEventListener('click', async (event) => {
  event.preventDefault();
  errorEl.textContent = '';
  if (!clearArmed) {
    clearArmed = true;
    clearSessionLink.textContent = 'Confirm: log check-out now';
    return;
  }
  resetClearLink();
  try {
    const response = await chrome.runtime.sendMessage({ action: 'clearsession' });
    if (!response || !response.ok) {
      errorEl.textContent = (response && response.error) || 'Could not stop the timer';
    }
  } catch (err) {
    errorEl.textContent = err.message || 'Could not reach the extension background';
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
