/**
 * Exemplar Capture — Background Service Worker (minimal)
 *
 * All capture, processing, and saving logic runs directly in the popup.
 * This service worker exists because MV3 requires it, but it only handles
 * extension lifecycle events.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('Exemplar Capture extension installed.');
});
