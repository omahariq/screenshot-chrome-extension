/**
 * Exemplar Capture — Offscreen Document
 * Handles canvas stitching, header overlay, and PDF generation.
 * Runs in an offscreen document context (has DOM access).
 */

const OVERLAY = {
  PADDING: 12,
  FONT_SIZE: 11,
  LINE_HEIGHT: 16,
  BG_COLOR: 'rgba(0, 0, 0, 0.78)',
  TEXT_COLOR: '#ffffff',
  FONT_FAMILY: 'Consolas, "SF Mono", "Fira Code", monospace',
  MAX_WIDTH: 520,
  BORDER_RADIUS: 6,
};

/**
 * Load an image from a data URL.
 */
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Failed to load image slice'));
    img.src = dataUrl;
  });
}

/**
 * Stitch multiple viewport slices into a single full-page canvas.
 * @param {Array<{dataUrl: string, y: number}>} slices - Captured viewport slices
 * @param {number} fullWidth - Full page width in device pixels
 * @param {number} fullHeight - Full page height in device pixels
 * @param {number} viewportHeight - Viewport height in device pixels
 * @returns {HTMLCanvasElement}
 */
async function stitchSlices(slices, fullWidth, fullHeight, viewportHeight) {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  // Load first image to get actual pixel dimensions
  const firstImg = await loadImage(slices[0].dataUrl);
  const slicePixelWidth = firstImg.naturalWidth;
  const slicePixelHeight = firstImg.naturalHeight;

  // The ratio of image pixels to CSS pixels (effectively the device pixel ratio)
  const ratio = slicePixelWidth / fullWidth;
  const canvasWidth = slicePixelWidth;
  // Cap canvas height to browser limit (~16384 px). Beyond this, canvas operations fail silently.
  const MAX_CANVAS_HEIGHT = 16384;
  const rawHeight = Math.ceil(fullHeight * ratio);
  const canvasHeight = Math.min(rawHeight, MAX_CANVAS_HEIGHT);

  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  // Draw each slice
  for (let i = 0; i < slices.length; i++) {
    const img = i === 0 ? firstImg : await loadImage(slices[i].dataUrl);
    const yOffset = Math.round(slices[i].y * ratio);

    // For the last slice, we may need to crop it
    if (i === slices.length - 1) {
      const remainingHeight = canvasHeight - yOffset;
      if (remainingHeight < slicePixelHeight) {
        // Draw only the portion we need from the bottom of the last slice
        const sourceY = slicePixelHeight - remainingHeight;
        ctx.drawImage(
          img,
          0, sourceY, slicePixelWidth, remainingHeight,
          0, yOffset, canvasWidth, remainingHeight
        );
        continue;
      }
    }

    ctx.drawImage(img, 0, yOffset);
  }

  return canvas;
}

/**
 * Draw the compliance header overlay on the canvas.
 * Renders in the top-right corner.
 */
function drawOverlay(canvas, metadata) {
  const ctx = canvas.getContext('2d');
  const dpr = metadata.devicePixelRatio || 1;

  // Scale font sizes by DPR for crisp rendering
  const fontSize = Math.round(OVERLAY.FONT_SIZE * dpr);
  const lineHeight = Math.round(OVERLAY.LINE_HEIGHT * dpr);
  const padding = Math.round(OVERLAY.PADDING * dpr);
  const borderRadius = Math.round(OVERLAY.BORDER_RADIUS * dpr);

  ctx.font = `${fontSize}px ${OVERLAY.FONT_FAMILY}`;

  // Build overlay lines
  const lines = [];
  if (metadata.flowOrSetName) {
    const modeLabel = metadata.mode === 'flow' ? 'Flow' : 'Set';
    lines.push(`${modeLabel}: ${metadata.flowOrSetName}`);
  }
  if (metadata.stepOrIndex !== undefined) {
    const stepLabel = metadata.mode === 'flow' ? 'Step' : 'Index';
    lines.push(`${stepLabel}: ${metadata.stepOrIndex}`);
  }
  if (metadata.pageName) lines.push(`Page: ${metadata.pageName}`);
  if (metadata.loginState) {
    lines.push(`State: ${metadata.loginState === 'logged-in' ? 'Logged In' : 'Logged Out'}`);
  }
  if (metadata.version) lines.push(`Version: ${metadata.version}`);
  if (metadata.timestamp) lines.push(`Captured: ${metadata.timestamp}`);
  if (metadata.urlPath) lines.push(`Path: ${metadata.urlPath}`);

  // Calculate box dimensions
  let maxTextWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxTextWidth) maxTextWidth = w;
  }

  const maxWidth = Math.round(OVERLAY.MAX_WIDTH * dpr);
  const boxWidth = Math.min(maxTextWidth + padding * 2, maxWidth);
  const boxHeight = lines.length * lineHeight + padding * 2;

  // Position: top-right corner with margin
  const margin = Math.round(10 * dpr);
  const boxX = canvas.width - boxWidth - margin;
  const boxY = margin;

  // Draw rounded rectangle background
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(boxX + borderRadius, boxY);
  ctx.lineTo(boxX + boxWidth - borderRadius, boxY);
  ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + borderRadius);
  ctx.lineTo(boxX + boxWidth, boxY + boxHeight - borderRadius);
  ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - borderRadius, boxY + boxHeight);
  ctx.lineTo(boxX + borderRadius, boxY + boxHeight);
  ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - borderRadius);
  ctx.lineTo(boxX, boxY + borderRadius);
  ctx.quadraticCurveTo(boxX, boxY, boxX + borderRadius, boxY);
  ctx.closePath();
  ctx.fillStyle = OVERLAY.BG_COLOR;
  ctx.fill();

  // Draw text
  ctx.fillStyle = OVERLAY.TEXT_COLOR;
  ctx.font = `${fontSize}px ${OVERLAY.FONT_FAMILY}`;
  ctx.textBaseline = 'top';

  for (let i = 0; i < lines.length; i++) {
    const textX = boxX + padding;
    const textY = boxY + padding + i * lineHeight;
    ctx.fillText(lines[i], textX, textY, boxWidth - padding * 2);
  }

  ctx.restore();
}

/**
 * Generate a PDF from the canvas using jsPDF.
 * The PDF page is sized to match the image dimensions.
 * @returns {string} PDF as base64 data URL
 */
function generatePdf(canvas) {
  // Convert canvas to PNG data URL
  const imgDataUrl = canvas.toDataURL('image/png');

  // Page dimensions in mm (jsPDF uses mm by default)
  // We'll use a scale where 1 pixel = 0.264583 mm (96 DPI)
  // But since these are screenshots, we want them to look good at ~150 DPI
  const pxToMm = 0.1764; // ~144 DPI for good balance
  const widthMm = canvas.width * pxToMm;
  const heightMm = canvas.height * pxToMm;

  // jsPDF with custom page size
  const { jsPDF } = window.jspdf;
  const orientation = widthMm > heightMm ? 'landscape' : 'portrait';

  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: [widthMm, heightMm],
  });

  pdf.addImage(imgDataUrl, 'PNG', 0, 0, widthMm, heightMm);
  return pdf.output('datauristring');
}

/**
 * Create a small thumbnail from the canvas.
 */
function createThumbnail(canvas, maxWidth = 128) {
  const thumbCanvas = document.createElement('canvas');
  const ratio = canvas.height / canvas.width;
  thumbCanvas.width = maxWidth;
  thumbCanvas.height = Math.round(maxWidth * ratio);
  const ctx = thumbCanvas.getContext('2d');
  ctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  return thumbCanvas.toDataURL('image/png', 0.7);
}

// ─── Message Handler ───
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'processCapture') {
    handleProcessCapture(msg.data)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true; // async
  }

  if (msg.action === 'reprocessOverlay') {
    handleReprocessOverlay(msg.data)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true; // async
  }

  if (msg.action === 'generatePdfFromPng') {
    handleGeneratePdfFromPng(msg.data)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true; // async
  }
});

/**
 * Process captured slices: stitch, overlay, generate PDF.
 */
async function handleProcessCapture(data) {
  const { slices, fullWidth, fullHeight, viewportHeight, metadata } = data;

  // Stitch slices
  const canvas = await stitchSlices(slices, fullWidth, fullHeight, viewportHeight);

  // Draw overlay
  drawOverlay(canvas, metadata);

  // Get PNG data URL
  const pngDataUrl = canvas.toDataURL('image/png');

  // Generate PDF
  let pdfDataUrl = null;
  try {
    pdfDataUrl = generatePdf(canvas);
  } catch (err) {
    console.error('PDF generation failed:', err);
  }

  // Create thumbnail
  const thumbnailDataUrl = createThumbnail(canvas);

  return {
    pngDataUrl,
    pdfDataUrl,
    thumbnailDataUrl,
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * Generate PDF from an existing PNG data URL (no overlay modification).
 */
async function handleGeneratePdfFromPng(data) {
  const { pngDataUrl } = data;

  const img = await loadImage(pngDataUrl);
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);

  let pdfDataUrl = null;
  try {
    pdfDataUrl = generatePdf(canvas);
  } catch (err) {
    console.error('PDF generation failed:', err);
  }

  const thumbnailDataUrl = createThumbnail(canvas);

  return { pdfDataUrl, thumbnailDataUrl };
}

/**
 * Reprocess overlay for edit: takes existing PNG, re-draws overlay with new metadata.
 */
async function handleReprocessOverlay(data) {
  const { pngDataUrl, metadata } = data;

  const img = await loadImage(pngDataUrl);
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);

  // Draw new overlay
  drawOverlay(canvas, metadata);

  const newPngDataUrl = canvas.toDataURL('image/png');

  let pdfDataUrl = null;
  try {
    pdfDataUrl = generatePdf(canvas);
  } catch (err) {
    console.error('PDF generation failed:', err);
  }

  const thumbnailDataUrl = createThumbnail(canvas);

  return {
    pngDataUrl: newPngDataUrl,
    pdfDataUrl,
    thumbnailDataUrl,
  };
}
