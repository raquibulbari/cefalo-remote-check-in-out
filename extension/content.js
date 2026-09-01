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
  function queryClickableElements() {
    const selector = 'button, a, input[type="submit"], [role="button"]';
    return Array.from(document.querySelectorAll(selector)).map((node) => ({
      text: node.textContent || node.value || '',
      visible: !!node.offsetParent,
      node,
    }));
  }

  function reportObservedStatus() {
    const elements = queryClickableElements();
    if (pickVisibleMatch(elements, 'checkout')) {
      chrome.runtime.sendMessage({ type: 'observed', status: 'checked-in' });
    } else if (pickVisibleMatch(elements, 'checkin')) {
      chrome.runtime.sendMessage({ type: 'observed', status: 'checked-out' });
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.command === 'click') {
      const elements = queryClickableElements();
      const match = pickVisibleMatch(elements, message.want);
      if (match) {
        match.node.click();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'button not found' });
      }
      return true;
    }
    return false;
  });

  reportObservedStatus();
}
