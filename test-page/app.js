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
