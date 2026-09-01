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
