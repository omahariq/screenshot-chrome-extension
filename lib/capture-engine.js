/**
 * Exemplar Capture — Capture Engine
 * Runs inside the popup context. Uses the Chrome DevTools Protocol
 * (via chrome.debugger) to capture the full page.
 *
 * Capture strategy:
 *   Always split the page into small vertical clips (≤ 4 000 CSS px)
 *   using captureBeyondViewport + scale 1.  This keeps each bitmap
 *   well under the most conservative GPU texture limit (4 096 px),
 *   avoids viewport-override distortions, and works on every GPU.
 *   The popup stitches the parts onto a canvas for the overlay/PNG,
 *   and the PDF places all parts on a single long page.
 *
 * Also handles: header overlay rendering, PDF generation, file saving.
 */

// ─── Overlay constants ───
const OVERLAY = {
  PADDING: 16,
  FONT_SIZE: 13,
  LINE_HEIGHT: 19,
  BG_COLOR: '#ffffff',        // White background
  TEXT_COLOR: '#111111',      // Dark text for values
  LABEL_COLOR: '#6b6b6b',     // Grey for labels
  FONT_FAMILY: 'Consolas, "SF Mono", "Fira Code", monospace',
};

// ─── Capture constants ───
const PRE_SCROLL_STEP_DELAY = 150; // ms between scroll steps
const LAZY_SETTLE_MS = 2000;       // ms to wait at the bottom for content to render
const SCROLL_TOP_SETTLE = 500;     // ms to wait after scrolling back to top
const MAX_CHUNK_HEIGHT = 4000;     // conservative chunk height that works on all GPUs
const CAPTURE_WIDTH = 1440;        // fixed capture width in CSS px

// A4 ratio: 210mm x 297mm → height/width = 1.4142857
const A4_RATIO = 297 / 210;

// ─── Helpers ───

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Promise wrapper around chrome.debugger.attach */
function dbgAttach(tabId, version = '1.3') {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, version, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

/** Promise wrapper around chrome.debugger.detach */
function dbgDetach(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      resolve();
    });
  });
}

/** Promise wrapper around chrome.debugger.sendCommand */
function dbgSend(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

/**
 * Read the true scrollable dimensions from the DOM.
 * More reliable than Page.getLayoutMetrics on some pages.
 */
async function getDomDimensions(tabId) {
  const result = await dbgSend(tabId, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      scrollWidth: Math.max(
        document.documentElement.scrollWidth  || 0,
        document.documentElement.offsetWidth  || 0,
        document.body ? document.body.scrollWidth  : 0,
        document.body ? document.body.offsetWidth  : 0
      ),
      scrollHeight: Math.max(
        document.documentElement.scrollHeight || 0,
        document.documentElement.offsetHeight || 0,
        document.body ? document.body.scrollHeight : 0,
        document.body ? document.body.offsetHeight : 0
      ),
    })`,
    returnByValue: true,
  });
  return JSON.parse(result.result.value);
}

// ─── Full-Page Capture via DevTools Protocol ───

/**
 * Capture a full-page screenshot using the Chrome DevTools Protocol.
 *
 * Strategy — **always** split into small vertical clips (≤ 4 000 CSS px
 * each at scale 1).  This keeps each bitmap well under even the most
 * conservative GPU texture limit (4 096 px) and avoids the viewport-
 * override approach which can distort 100 vh elements or silently
 * truncate on GPUs with a low max-texture-size.
 *
 * 1. Attach debugger
 * 2. Pre-scroll (half-viewport steps) to trigger lazy content
 * 3. Measure page height from both CDP and DOM (take the larger)
 * 4. Capture in vertical clips with captureBeyondViewport: true
 * 5. Detach
 *
 * @returns {{ parts, cssWidth, cssHeight, devicePixelRatio: 1 }}
 */
export async function captureFullPage(tabId) {
  await dbgAttach(tabId);

  try {
    // Enable required domains
    await dbgSend(tabId, 'Page.enable');
    await dbgSend(tabId, 'Runtime.enable');

    // ── Set viewport to fixed 1440px width ──
    // Get current viewport height to preserve it
    const viewportResult = await dbgSend(tabId, 'Runtime.evaluate', {
      expression: 'window.innerHeight',
      returnByValue: true,
    });
    const viewportHeight = viewportResult?.result?.value || 900;

    await dbgSend(tabId, 'Emulation.setDeviceMetricsOverride', {
      mobile: false,
      width: CAPTURE_WIDTH,
      height: viewportHeight,
      deviceScaleFactor: 1,
    });

    // Wait for layout to settle after viewport change
    await sleep(300);

    // ── Pre-scroll to trigger lazy-loaded content ──
    await dbgSend(tabId, 'Runtime.evaluate', {
      expression: `(async () => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        const vh = window.innerHeight;
        const step = Math.max(Math.floor(vh / 2), 200);
        let maxScroll = Math.max(
          document.documentElement.scrollHeight,
          document.body ? document.body.scrollHeight : 0
        );
        for (let y = 0; y <= maxScroll; y += step) {
          window.scrollTo(0, y);
          await delay(${PRE_SCROLL_STEP_DELAY});
          const newMax = Math.max(
            document.documentElement.scrollHeight,
            document.body ? document.body.scrollHeight : 0
          );
          if (newMax > maxScroll) maxScroll = newMax;
        }
        window.scrollTo(0, document.documentElement.scrollHeight);
        await delay(${LAZY_SETTLE_MS});
        window.scrollTo(0, 0);
        await delay(${SCROLL_TOP_SETTLE});
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });

    // ── Measure full page dimensions ──
    const layout = await dbgSend(tabId, 'Page.getLayoutMetrics');
    const contentSize = layout.cssContentSize || layout.contentSize;
    const domDims = await getDomDimensions(tabId);

    const cssWidth = CAPTURE_WIDTH;
    const cssHeight = Math.max(Math.ceil(contentSize.height), domDims.scrollHeight);

    // ── Capture in small vertical clips ──
    const parts = [];
    const numChunks = Math.ceil(cssHeight / MAX_CHUNK_HEIGHT);

    for (let i = 0; i < numChunks; i++) {
      const clipY = i * MAX_CHUNK_HEIGHT;
      const clipH = Math.min(MAX_CHUNK_HEIGHT, cssHeight - clipY);

      const screenshot = await dbgSend(tabId, 'Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: { x: 0, y: clipY, width: cssWidth, height: clipH, scale: 1 },
      });
      parts.push({
        dataUrl: `data:image/png;base64,${screenshot.data}`,
        width: cssWidth,
        height: clipH,
        cssY: clipY,
        cssHeight: clipH,
      });
    }

    // ── Restore original viewport ──
    await dbgSend(tabId, 'Emulation.clearDeviceMetricsOverride');

    return {
      parts,
      cssWidth,
      cssHeight,
      devicePixelRatio: 1,
    };
  } finally {
    await dbgDetach(tabId);
  }
}

// ─── Image Helpers ───

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Draw a single full-page image onto a canvas.
 */
export async function drawImageToCanvas(canvas, dataUrl) {
  const img = await loadImage(dataUrl);
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/**
 * Stitch multiple capture parts onto a single canvas, top-to-bottom.
 * Use this before drawing the overlay so the header covers the full page.
 *
 * Safe up to ~16 384 px total height (HTML canvas limit on most browsers).
 */
export async function stitchPartsToCanvas(canvas, parts) {
  if (parts.length === 0) return;
  if (parts.length === 1) {
    return drawImageToCanvas(canvas, parts[0].dataUrl);
  }

  const totalHeight = parts.reduce((sum, p) => sum + p.height, 0);
  canvas.width = parts[0].width;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');

  let yOffset = 0;
  for (const part of parts) {
    const img = await loadImage(part.dataUrl);
    ctx.drawImage(img, 0, yOffset);
    yOffset += img.naturalHeight;
  }
  return { width: canvas.width, height: canvas.height };
}

// ─── Header Overlay (prepended above page content) ───

/**
 * Prepend a full-width compliance header strip ABOVE the page content.
 * The canvas is expanded vertically; the original screenshot is shifted down.
 */
export function drawOverlay(canvas, metadata) {
  const dpr = metadata.devicePixelRatio || 1;

  const fontSize = Math.round(OVERLAY.FONT_SIZE * dpr);
  const lineHeight = Math.round(OVERLAY.LINE_HEIGHT * dpr);
  const padding = Math.round(OVERLAY.PADDING * dpr);
  const separatorHeight = Math.max(1, Math.round(dpr));

  // Helper to wrap text if it exceeds max width
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px ${OVERLAY.FONT_FAMILY}`;
  const maxWidth = canvas.width - padding * 2;

  function wrapText(label, value) {
    const labelWidth = ctx.measureText(label).width;
    const valueWidth = ctx.measureText(value).width;
    
    // If it fits on one line, return as single line
    if (labelWidth + valueWidth <= maxWidth) {
      return [{ label, value }];
    }
    
    // Otherwise, wrap the value across multiple lines
    const wrappedLines = [];
    let currentLine = '';
    let isFirstLine = true;
    
    // Split value into characters for precise wrapping
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      const testLine = currentLine + char;
      const availableWidth = isFirstLine ? (maxWidth - labelWidth) : maxWidth;
      const testWidth = ctx.measureText(testLine).width;
      
      if (testWidth <= availableWidth) {
        currentLine = testLine;
      } else {
        // Current line is full, push it and start a new line
        if (currentLine) {
          wrappedLines.push(currentLine);
          isFirstLine = false;
        }
        currentLine = char;
      }
    }
    
    // Push the last line
    if (currentLine) {
      wrappedLines.push(currentLine);
    }
    
    // Return array of line objects
    return wrappedLines.map((line, idx) => ({
      label: idx === 0 ? label : '',
      value: line
    }));
  }

  // Build info lines with wrapping
  const lineData = [];
  if (metadata.flowOrSetName) {
    const label = metadata.mode === 'flow' ? 'Flow:' : 'Set:';
    lineData.push(...wrapText(label, metadata.flowOrSetName));
  }
  if (metadata.stepOrIndex !== undefined) {
    const label = metadata.mode === 'flow' ? 'Step:' : 'Index:';
    lineData.push(...wrapText(label, String(metadata.stepOrIndex)));
  }
  if (metadata.pageName) {
    lineData.push(...wrapText('Page:', metadata.pageName));
  }
  if (metadata.loginState) {
    const state = metadata.loginState === 'logged-in' ? 'Logged In' : 'Logged Out';
    lineData.push(...wrapText('State:', state));
  }
  if (metadata.version) {
    lineData.push(...wrapText('Version:', metadata.version));
  }
  if (metadata.timestamp) {
    lineData.push(...wrapText('Captured:', metadata.timestamp));
  }
  if (metadata.urlPath) {
    lineData.push(...wrapText('Path:', metadata.urlPath));
  }

  const headerHeight = lineData.length * lineHeight + padding * 2 + separatorHeight;

  // Save existing page screenshot to a temp canvas
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  tempCanvas.getContext('2d').drawImage(canvas, 0, 0);

  // Expand the canvas to fit header + original content
  const originalHeight = canvas.height;
  canvas.height = originalHeight + headerHeight;
  ctx.canvas.width = canvas.width;
  ctx.canvas.height = canvas.height;

  // Draw header background (full width)
  ctx.fillStyle = OVERLAY.BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, headerHeight);

  // Draw header text
  ctx.font = `${fontSize}px ${OVERLAY.FONT_FAMILY}`;
  ctx.textBaseline = 'top';
  
  for (let i = 0; i < lineData.length; i++) {
    const { label, value } = lineData[i];
    let xOffset = padding;
    
    if (label) {
      // Draw label in grey
      ctx.fillStyle = OVERLAY.LABEL_COLOR;
      ctx.fillText(label, xOffset, padding + i * lineHeight);
      xOffset += ctx.measureText(label).width;
    } else {
      // Indent continuation lines
      xOffset += ctx.measureText('Path:').width;
    }
    
    // Draw value in dark text
    ctx.fillStyle = OVERLAY.TEXT_COLOR;
    ctx.fillText(value, xOffset, padding + i * lineHeight);
  }

  // Draw separator line between header and page content
  ctx.fillStyle = OVERLAY.LABEL_COLOR;
  ctx.fillRect(0, headerHeight - separatorHeight, canvas.width, separatorHeight);

  // Draw original page content below the header
  ctx.drawImage(tempCanvas, 0, headerHeight);
}

// ─── PDF Generation ───

/**
 * Generate a multi-page PDF with A4-ratio pages from the captured parts.
 *
 * @param {HTMLCanvasElement} firstPageCanvas - First part with the overlay already drawn.
 * @param {Array<string>} additionalPartDataUrls - Data URLs for remaining parts (may be empty).
 * @returns {Promise<string>} PDF as a data URI string.
 *
 * The screenshot is split into A4-ratio pages (210:297 aspect ratio).
 * Each PDF page is sized to match the screenshot width, with height
 * calculated from the A4 ratio. The screenshot is sliced vertically
 * and each slice becomes one PDF page.
 */
export async function generatePdf(firstPageCanvas, additionalPartDataUrls = []) {
  const { jsPDF } = window.jspdf;
  if (!jsPDF) throw new Error('jsPDF not loaded');

  // ── First, stitch everything onto one tall canvas ──
  const additionalImages = [];
  let totalHeightPx = firstPageCanvas.height;
  for (const dataUrl of additionalPartDataUrls) {
    const img = await loadImage(dataUrl);
    additionalImages.push(img);
    totalHeightPx += img.naturalHeight;
  }

  const fullWidth = firstPageCanvas.width;
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = fullWidth;
  fullCanvas.height = totalHeightPx;
  const fullCtx = fullCanvas.getContext('2d');

  // Draw first part (with overlay)
  fullCtx.drawImage(firstPageCanvas, 0, 0);

  // Draw additional parts below
  let yOffset = firstPageCanvas.height;
  for (const img of additionalImages) {
    fullCtx.drawImage(img, 0, yOffset);
    yOffset += img.naturalHeight;
  }

  // ── Calculate A4-ratio page dimensions ──
  // Page width = screenshot width, page height = width * A4_RATIO
  const pageWidthPx = fullWidth;
  const pageHeightPx = Math.round(fullWidth * A4_RATIO);

  // Convert to mm for PDF (using ~144 DPI)
  const pxToMm = 0.1764;
  const pageWidthMm = pageWidthPx * pxToMm;
  const pageHeightMm = pageHeightPx * pxToMm;

  // ── Create PDF with A4-ratio pages ──
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [pageWidthMm, pageHeightMm],
  });

  // ── Slice the full canvas into pages ──
  const numPages = Math.ceil(totalHeightPx / pageHeightPx);
  const sliceCanvas = document.createElement('canvas');
  sliceCanvas.width = pageWidthPx;

  for (let i = 0; i < numPages; i++) {
    const srcY = i * pageHeightPx;
    const srcH = Math.min(pageHeightPx, totalHeightPx - srcY);

    // Add new page (except for first)
    if (i > 0) {
      pdf.addPage([pageWidthMm, pageHeightMm]);
    }

    // Extract this slice from the full canvas
    sliceCanvas.height = srcH;
    const sliceCtx = sliceCanvas.getContext('2d');
    sliceCtx.fillStyle = '#ffffff';
    sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    sliceCtx.drawImage(fullCanvas, 0, srcY, pageWidthPx, srcH, 0, 0, pageWidthPx, srcH);

    // Add to PDF as JPEG
    const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.92);
    const sliceHeightMm = srcH * pxToMm;
    pdf.addImage(sliceData, 'JPEG', 0, 0, pageWidthMm, sliceHeightMm);
  }

  return pdf.output('datauristring');
}

/**
 * Threshold in CSS pixels above which a page is considered "long".
 * Long pages only get a PDF; short pages get both PNG and PDF.
 */
export const LONG_PAGE_THRESHOLD = 5000;

// ─── Thumbnail ───

export function createThumbnail(canvas, maxWidth = 128) {
  const thumbCanvas = document.createElement('canvas');
  const ratio = canvas.height / canvas.width;
  thumbCanvas.width = maxWidth;
  thumbCanvas.height = Math.round(maxWidth * ratio);
  const ctx = thumbCanvas.getContext('2d');
  ctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  return thumbCanvas.toDataURL('image/png', 0.7);
}

// ─── File Saving ───

export function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i);
  }
  return new Blob([arr], { type: mime });
}

/**
 * Save a data URL as a file via Downloads API.
 */
export async function saveViaDownloads(dataUrl, filePath) {
  const blob = dataUrlToBlob(dataUrl);
  const objectUrl = URL.createObjectURL(blob);

  try {
    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url: objectUrl, filename: filePath, saveAs: false, conflictAction: 'uniquify' },
        (id) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(id);
        }
      );
    });

    await waitForDownload(downloadId);
    return downloadId;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Save a CSV string via Downloads API.
 */
export async function saveCsvViaDownloads(csvContent, filePath) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url: objectUrl, filename: filePath, saveAs: false, conflictAction: 'overwrite' },
        (id) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(id);
        }
      );
    });

    await waitForDownload(downloadId);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    const listener = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state && delta.state.current === 'complete') {
        chrome.downloads.onChanged.removeListener(listener);
        resolve();
      } else if (delta.state && delta.state.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error('Download interrupted'));
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

/**
 * Save via File System Access API.
 */
export async function saveViaFSA(baseHandle, folderPath, filename, dataUrl) {
  const dir = await getNestedDir(baseHandle, folderPath);
  const blob = dataUrlToBlob(dataUrl);
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function saveCsvViaFSA(baseHandle, folderPath, filename, csvContent) {
  const dir = await getNestedDir(baseHandle, folderPath);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function getNestedDir(baseHandle, relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  let current = baseHandle;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}
