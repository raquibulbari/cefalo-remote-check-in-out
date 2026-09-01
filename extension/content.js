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

if (typeof chrome !== 'undefined') {
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

  let lastReportedStatus = null;

  function reportObservedStatus() {
    const elements = queryClickableElements();
    let status = null;
    if (pickVisibleMatch(elements, 'checkout')) {
      status = 'checked-in';
    } else if (pickVisibleMatch(elements, 'checkin')) {
      status = 'checked-out';
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
}
