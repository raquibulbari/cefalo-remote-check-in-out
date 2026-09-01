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
      for (const value of [row.type, row.date, row.time]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
  render();
}
