/**
 * Exemplar Capture — Content Script (minimal stub)
 *
 * The core capture flow now uses the Chrome DevTools Protocol
 * (chrome.debugger API) which handles scrolling, measurement,
 * and screenshot capture directly. This content script is no
 * longer required for the primary capture pipeline.
 *
 * It is kept as a stub in case future features need DOM access.
 */

(function () {
  if (window.__exemplarCaptureInjected) return;
  window.__exemplarCaptureInjected = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
      return false;
    }
  });
})();
