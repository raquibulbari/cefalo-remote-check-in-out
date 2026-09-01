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
