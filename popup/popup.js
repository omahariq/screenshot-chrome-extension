/**
 * Exemplar Capture — Popup Controller
 * All capture, processing, and saving runs directly in the popup.
 * No service worker message passing needed.
 */

import { MODES, LOGIN_STATES, DESCRIPTION_MODES, COMPLIANCE_KEYWORDS, STORAGE_KEYS } from '../lib/constants.js';
import { generateFullPath, generateFolderPath, manifestFilename } from '../lib/naming.js';
import { generateCsv, createManifestRow } from '../lib/csv.js';
import {
  captureFullPage,
  drawImageToCanvas,
  stitchPartsToCanvas,
  drawOverlay,
  generatePdf,
  createThumbnail,
  saveViaDownloads,
  saveCsvViaDownloads,
  saveViaFSA,
  saveCsvViaFSA,
} from '../lib/capture-engine.js';

// ─── DOM References ───
const views = {
  setup: document.getElementById('view-setup'),
  capture: document.getElementById('view-capture'),
  edit: document.getElementById('view-edit'),
};

const setupForm = document.getElementById('setup-form');
const modeToggles = document.querySelectorAll('#view-setup .toggle-btn[data-mode]');
const inputDate = document.getElementById('input-date');
const inputFlowSetName = document.getElementById('input-flow-set-name');
const labelFlowSet = document.getElementById('label-flow-set');
const btnPickFolder = document.getElementById('btn-pick-folder');
const folderPathDisplay = document.getElementById('folder-path-display');

const badgeMode = document.getElementById('badge-mode');
const bannerName = document.getElementById('banner-name');
const bannerState = document.getElementById('banner-state');
const bannerDate = document.getElementById('banner-date');
const counterLabel = document.getElementById('counter-label');
const counterValue = document.getElementById('counter-value');
const btnCounterDec = document.getElementById('btn-counter-dec');
const btnCounterInc = document.getElementById('btn-counter-inc');
const btnCapture = document.getElementById('btn-capture');
const captureStatus = document.getElementById('capture-status');
const pageNamePrompt = document.getElementById('page-name-prompt');
const loginStateToggle = document.getElementById('login-state-toggle');
const captureStateBtns = document.querySelectorAll('.capture-state-btn');
const inputPageName = document.getElementById('input-page-name');
const inputPageVersion = document.getElementById('input-page-version');
const btnConfirmName = document.getElementById('btn-confirm-name');
const descriptionSection = document.getElementById('description-section');
const descModeButtons = document.querySelectorAll('.desc-mode-btn');
const inputDescription = document.getElementById('input-description');
const btnSaveCapture = document.getElementById('btn-save-capture');
const duplicateWarning = document.getElementById('duplicate-warning');
const dupPageName = document.getElementById('dup-page-name');
const btnDupProceed = document.getElementById('btn-dup-proceed');
const btnDupCancel = document.getElementById('btn-dup-cancel');
const lastCaptureEl = document.getElementById('last-capture');
const lastCaptureThumb = document.getElementById('last-capture-thumb');
const lastCaptureName = document.getElementById('last-capture-name');
const lastCaptureFile = document.getElementById('last-capture-file');
const btnEditLast = document.getElementById('btn-edit-last');
const btnEndSession = document.getElementById('btn-end-session');

const editForm = document.getElementById('edit-form');
const editPageName = document.getElementById('edit-page-name');
const editVersion = document.getElementById('edit-version');
const editDescription = document.getElementById('edit-description');
const editStepIndex = document.getElementById('edit-step-index');
const editStateBtns = document.querySelectorAll('.edit-state-btn');
const btnCancelEdit = document.getElementById('btn-cancel-edit');

const stitchCanvas = document.getElementById('stitch-canvas');

// ─── State ───
let session = null;
let stepCounter = 1;
let currentMode = MODES.FLOW;
let currentCaptureState = LOGIN_STATES.LOGGED_OUT; // Default to logged-out
let currentDescMode = DESCRIPTION_MODES.SHORT;
let pendingCapture = null;
let isDuplicate = false;
let dirHandle = null;

// ─── IndexedDB for FileSystemDirectoryHandle persistence ───
const DB_NAME = 'ExemplarCaptureDB';
const DB_STORE = 'handles';
const DIR_HANDLE_KEY = 'dirHandle';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
  });
}

async function saveDirHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const request = store.put(handle, DIR_HANDLE_KEY);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

async function loadDirHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const request = store.get(DIR_HANDLE_KEY);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

async function clearDirHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const request = store.delete(DIR_HANDLE_KEY);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Ensure we have access to the selected folder.
 * If a folder was previously selected but handle is lost, prompt user to re-select.
 * Returns true if we have folder access, false if user should use Downloads.
 */
async function ensureFolderAccess() {
  // Check if a folder name was saved (meaning user selected a folder before)
  const stored = await chrome.storage.local.get(STORAGE_KEYS.FOLDER_NAME);
  const savedFolderName = stored[STORAGE_KEYS.FOLDER_NAME];
  
  // If no folder was ever selected, use Downloads (return false)
  if (!savedFolderName) {
    return false;
  }
  
  // If we already have a valid handle, we're good
  if (dirHandle) {
    try {
      const permission = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        return true;
      }
    } catch (e) {
      // Handle is invalid
    }
  }
  
  // Try to load from IndexedDB
  try {
    const savedHandle = await loadDirHandle();
    if (savedHandle) {
      // Request permission (this works because we're in a click handler)
      const permission = await savedHandle.requestPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        dirHandle = savedHandle;
        folderPathDisplay.textContent = dirHandle.name;
        return true;
      }
    }
  } catch (e) {
    console.warn('Failed to restore folder handle:', e);
  }
  
  // Handle is lost, prompt user to re-select the same folder
  showStatus(`Please re-select folder: ${savedFolderName}`, 'info');
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    folderPathDisplay.textContent = dirHandle.name;
    await saveDirHandle(dirHandle);
    await chrome.storage.local.set({ [STORAGE_KEYS.FOLDER_NAME]: dirHandle.name });
    return true;
  } catch (err) {
    if (err.name === 'AbortError') {
      // User cancelled, fall back to Downloads
      showStatus('Using Downloads folder instead.', 'info');
      dirHandle = null;
      await chrome.storage.local.remove(STORAGE_KEYS.FOLDER_NAME);
      await clearDirHandle();
      folderPathDisplay.textContent = '~/Downloads/Exemplars/';
      return false;
    }
    throw err;
  }
}

// ─── Utilities ───
function showView(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
}

function showStatus(message, type = 'info') {
  captureStatus.textContent = message;
  captureStatus.className = `status-msg ${type}`;
  captureStatus.classList.remove('hidden');
  if (type === 'success' || type === 'info') {
    setTimeout(() => captureStatus.classList.add('hidden'), 5000);
  }
}

function todayString() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function nowTimestamp() {
  return new Date().toLocaleString();
}

function getUrlKey(urlPath, loginState) {
  return `${urlPath}|${loginState}`;
}

// ─── Toggle Helpers ───
function setupToggle(buttons, callback) {
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      callback(btn);
    });
  });
}

// ─── Init ───
async function init() {
  inputDate.value = todayString();

  // Restore folder name display and try to restore handle
  const folderStored = await chrome.storage.local.get(STORAGE_KEYS.FOLDER_NAME);
  const savedFolderName = folderStored[STORAGE_KEYS.FOLDER_NAME];
  
  if (savedFolderName) {
    // Show the folder name (handle will be restored on first capture click)
    folderPathDisplay.textContent = savedFolderName;
    
    // Try to restore handle silently (may fail without user gesture)
    try {
      const savedHandle = await loadDirHandle();
      if (savedHandle) {
        const permission = await savedHandle.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          dirHandle = savedHandle;
        }
        // Don't request permission here - it requires user gesture
      }
    } catch (err) {
      console.warn('Failed to restore folder handle:', err);
    }
  }

  const stored = await chrome.storage.local.get([STORAGE_KEYS.SESSION, STORAGE_KEYS.STEP_COUNTER, STORAGE_KEYS.LAST_CAPTURE]);
  if (stored[STORAGE_KEYS.SESSION]) {
    session = stored[STORAGE_KEYS.SESSION];
    stepCounter = stored[STORAGE_KEYS.STEP_COUNTER] || 1;
    currentMode = session.mode;
    currentCaptureState = session.loginState;
    updateCaptureView();
    showView('capture');
    if (stored[STORAGE_KEYS.LAST_CAPTURE]) {
      displayLastCapture(stored[STORAGE_KEYS.LAST_CAPTURE]);
    }
  } else {
    showView('setup');
  }

  setupToggle(modeToggles, (btn) => {
    currentMode = btn.dataset.mode;
    labelFlowSet.textContent = currentMode === MODES.FLOW ? 'Flow Name' : 'Set Name';
    inputFlowSetName.placeholder = currentMode === MODES.FLOW ? 'e.g. Checkout Flow' : 'e.g. Landing Pages';
  });

  setupToggle(captureStateBtns, (btn) => { currentCaptureState = btn.dataset.state; });
  setupToggle(editStateBtns, () => {});
  setupToggle(descModeButtons, (btn) => {
    currentDescMode = btn.dataset.desc;
    updateDescriptionPlaceholder();
  });

  setupForm.addEventListener('submit', handleStartSession);
  btnCapture.addEventListener('click', handleCapture);

  btnCounterDec.addEventListener('click', () => {
    if (stepCounter > 1) { stepCounter--; counterValue.textContent = stepCounter; saveStepCounter(); }
  });
  btnCounterInc.addEventListener('click', () => {
    stepCounter++; counterValue.textContent = stepCounter; saveStepCounter();
  });

  btnConfirmName.addEventListener('click', handlePageNameConfirm);
  inputPageName.addEventListener('keydown', (e) => { if (e.key === 'Enter') handlePageNameConfirm(); });

  // Login state toggle in the page name prompt
  captureStateBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      captureStateBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCaptureState = btn.dataset.state;
    });
  });

  btnSaveCapture.addEventListener('click', handleSaveCapture);

  btnDupProceed.addEventListener('click', () => {
    isDuplicate = true;
    duplicateWarning.classList.add('hidden');
    showPageNamePrompt();
  });
  btnDupCancel.addEventListener('click', () => {
    duplicateWarning.classList.add('hidden');
    btnCapture.classList.remove('capturing');
    pendingCapture = null;
  });

  btnEditLast.addEventListener('click', handleEditLast);
  editForm.addEventListener('submit', handleSaveEdit);
  btnCancelEdit.addEventListener('click', () => showView('capture'));

  btnEndSession.addEventListener('click', handleEndSession);
  btnPickFolder.addEventListener('click', handlePickFolder);
}

// ─── Session Management ───
async function handleStartSession(e) {
  e.preventDefault();
  const flowOrSetName = inputFlowSetName.value.trim();
  if (!flowOrSetName) { inputFlowSetName.focus(); return; }

  session = {
    mode: currentMode, date: inputDate.value,
    language: 'en', flowOrSetName,
  };
  stepCounter = 1;
  currentCaptureState = LOGIN_STATES.LOGGED_OUT; // Reset to default on new session

  await chrome.storage.local.set({
    [STORAGE_KEYS.SESSION]: session,
    [STORAGE_KEYS.STEP_COUNTER]: stepCounter,
    [STORAGE_KEYS.MANIFEST]: [],
    [STORAGE_KEYS.PAGE_NAMES]: {},
    [STORAGE_KEYS.CAPTURE_HISTORY]: {},
  });

  updateCaptureView();
  showView('capture');
}

function updateCaptureView() {
  if (!session) return;
  badgeMode.textContent = session.mode === MODES.FLOW ? 'Flow' : 'Set';
  bannerName.textContent = session.flowOrSetName;
  
  // Only show login state for Flow mode
  if (session.mode === MODES.FLOW) {
    bannerState.textContent = currentCaptureState === LOGIN_STATES.LOGGED_IN ? 'Logged In' : 'Logged Out';
    bannerState.style.display = '';
  } else {
    bannerState.style.display = 'none';
  }
  
  bannerDate.textContent = session.date;
  counterLabel.textContent = session.mode === MODES.FLOW ? 'Step' : 'Index';
  counterValue.textContent = stepCounter;
}

async function saveStepCounter() {
  await chrome.storage.local.set({ [STORAGE_KEYS.STEP_COUNTER]: stepCounter });
}

async function handleEndSession() {
  if (!confirm('End this session? Manifest will be exported.')) return;
  
  // Export manifest before ending
  try {
    const storedManifest = await chrome.storage.local.get(STORAGE_KEYS.MANIFEST);
    const rows = storedManifest[STORAGE_KEYS.MANIFEST] || [];
    if (rows.length > 0) {
      const csvContent = generateCsv(rows);
      const folder = generateFolderPath(session.date, '', session.mode, session.flowOrSetName);
      const mFilename = manifestFilename(session.date, '');
      if (dirHandle) {
        await saveCsvViaFSA(dirHandle, folder, mFilename, csvContent);
      } else {
        await saveCsvViaDownloads(csvContent, `${folder}/${mFilename}`);
      }
      showStatus('Manifest exported.', 'success');
    }
  } catch (err) {
    console.warn('Manifest export failed:', err);
  }

  await chrome.storage.local.remove([
    STORAGE_KEYS.SESSION, STORAGE_KEYS.STEP_COUNTER, STORAGE_KEYS.LAST_CAPTURE,
    STORAGE_KEYS.PAGE_NAMES, STORAGE_KEYS.CAPTURE_HISTORY, STORAGE_KEYS.MANIFEST,
    STORAGE_KEYS.FOLDER_NAME,
  ]);
  
  // Clear the persisted folder handle
  try {
    await clearDirHandle();
  } catch (err) {
    console.warn('Failed to clear folder handle:', err);
  }
  
  session = null; stepCounter = 1; dirHandle = null;
  folderPathDisplay.textContent = '~/Downloads/Exemplars/';
  lastCaptureEl.classList.add('hidden');
  showView('setup');
}

// ─── Capture Flow ───
async function handleCapture() {
  if (!session) return;
  btnCapture.classList.add('capturing');
  
  try {
    // Ensure folder access first (this is a user gesture, so permission prompts work)
    await ensureFolderAccess();
    
    showStatus('Preparing capture...', 'info');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) throw new Error('Cannot capture this tab.');

    const url = new URL(tab.url);
    if (['chrome:', 'chrome-extension:', 'about:'].includes(url.protocol)) {
      throw new Error('Cannot capture browser internal pages.');
    }

    const urlPath = url.pathname + url.search;

    pendingCapture = {
      tabId: tab.id, fullURL: tab.url, hostname: url.hostname,
      urlPath, timestamp: nowTimestamp(),
    };

    const stored = await chrome.storage.local.get([STORAGE_KEYS.CAPTURE_HISTORY, STORAGE_KEYS.PAGE_NAMES]);
    const history = stored[STORAGE_KEYS.CAPTURE_HISTORY] || {};

    // Check for duplicate (any login state)
    const loggedInKey = getUrlKey(urlPath, LOGIN_STATES.LOGGED_IN);
    const loggedOutKey = getUrlKey(urlPath, LOGIN_STATES.LOGGED_OUT);
    const existingKey = history[loggedInKey] ? loggedInKey : (history[loggedOutKey] ? loggedOutKey : null);

    if (existingKey) {
      isDuplicate = false;
      const pageNames = stored[STORAGE_KEYS.PAGE_NAMES] || {};
      dupPageName.textContent = pageNames[existingKey] || urlPath;
      duplicateWarning.classList.remove('hidden');
      return;
    }

    isDuplicate = false;
    showPageNamePrompt();
  } catch (err) {
    showStatus(err.message, 'error');
    btnCapture.classList.remove('capturing');
  }
}

function showPageNamePrompt() {
  // Show/hide login state toggle based on mode
  if (session.mode === MODES.SET) {
    loginStateToggle.style.display = 'none';
    // For sets, always use logged-out as default
    currentCaptureState = LOGIN_STATES.LOGGED_OUT;
  } else {
    loginStateToggle.style.display = 'flex';
    // Set toggle to current persisted state
    captureStateBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.state === currentCaptureState);
    });
  }

  // Update pendingCapture with current state
  pendingCapture.loginState = currentCaptureState;
  pendingCapture.urlKey = getUrlKey(pendingCapture.urlPath, currentCaptureState);

  // Check if we have a remembered page name for this URL + state
  chrome.storage.local.get(STORAGE_KEYS.PAGE_NAMES).then(stored => {
    const pageNames = stored[STORAGE_KEYS.PAGE_NAMES] || {};
    if (pageNames[pendingCapture.urlKey]) {
      // Auto-fill the page name but still show prompt to allow state change
      inputPageName.value = pageNames[pendingCapture.urlKey];
    } else {
      inputPageName.value = '';
    }
    pageNamePrompt.classList.remove('hidden');
    inputPageName.focus();
  });
}

function handlePageNameConfirm() {
  const name = inputPageName.value.trim();
  if (!name) { 
    inputPageName.focus(); 
    return; 
  }
  
  const version = inputPageVersion.value.trim() || ''; // Optional
  
  // Update pendingCapture with current toggle state (may have changed)
  pendingCapture.loginState = currentCaptureState;
  pendingCapture.urlKey = getUrlKey(pendingCapture.urlPath, currentCaptureState);
  pendingCapture.pageName = name;
  pendingCapture.version = version;
  
  pageNamePrompt.classList.add('hidden');
  proceedWithCapture();
}

async function proceedWithCapture() {
  showStatus('Capturing full page (DevTools Protocol)...', 'info');

  try {
    // 1. Capture full page via chrome.debugger (always returns ≥ 1 part)
    const captureResult = await captureFullPage(pendingCapture.tabId);
    const { parts } = captureResult;

    showStatus('Processing screenshot...', 'info');

    // 2. Stitch all parts onto the hidden canvas.
    const MAX_CANVAS_HEIGHT = 16384;
    const totalPartHeight = parts.reduce((s, p) => s + p.height, 0);
    const allStitched = totalPartHeight <= MAX_CANVAS_HEIGHT;

    if (allStitched) {
      await stitchPartsToCanvas(stitchCanvas, parts);
    } else {
      await drawImageToCanvas(stitchCanvas, parts[0].dataUrl);
    }

    // 3. Draw compliance overlay (prepended as a header strip)
    drawOverlay(stitchCanvas, {
      mode: session.mode,
      flowOrSetName: session.flowOrSetName,
      stepOrIndex: stepCounter,
      pageName: pendingCapture.pageName,
      loginState: pendingCapture.loginState,
      version: pendingCapture.version, // Now per-page version
      timestamp: pendingCapture.timestamp,
      urlPath: pendingCapture.urlPath,
      devicePixelRatio: captureResult.devicePixelRatio,
    });

    // 4. Thumbnail for preview
    const thumbnailDataUrl = createThumbnail(stitchCanvas);

    // Store for the save step.
    pendingCapture.captureResult = {
      thumbnailDataUrl,
      pageHeight: captureResult.cssHeight,
      additionalPartDataUrls: allStitched
        ? []
        : parts.slice(1).map(p => p.dataUrl),
    };

    const numParts = parts.length;
    const statusMsg = numParts > 1
      ? `Screenshot captured (${numParts} parts stitched). Add a description below.`
      : 'Screenshot captured. Add a description below.';
    showStatus(statusMsg, 'success');

    const urlLower = pendingCapture.urlPath.toLowerCase();
    const hasCompliance = COMPLIANCE_KEYWORDS.some(kw => urlLower.includes(kw));
    if (hasCompliance) {
      currentDescMode = DESCRIPTION_MODES.COMPLIANCE;
      descModeButtons.forEach(b => b.classList.toggle('active', b.dataset.desc === 'compliance'));
    }
    updateDescriptionPlaceholder();
    descriptionSection.classList.remove('hidden');
    inputDescription.focus();

  } catch (err) {
    showStatus(`Capture failed: ${err.message}`, 'error');
    btnCapture.classList.remove('capturing');
    pendingCapture = null;
  }
}

function updateDescriptionPlaceholder() {
  const placeholders = {
    [DESCRIPTION_MODES.SHORT]: 'Page purpose + main CTA',
    [DESCRIPTION_MODES.COMPLIANCE]: 'Describe refund/cancellation/renewal policies shown',
    [DESCRIPTION_MODES.VERBOSE]: 'Headings, CTAs, detected prices, key content',
  };
  inputDescription.placeholder = placeholders[currentDescMode] || placeholders.short;
}

// ─── Save Capture ───
async function handleSaveCapture() {
  if (!pendingCapture || !pendingCapture.captureResult) return;

  const description = inputDescription.value.trim() || '(no description)';
  showStatus('Generating PDF...', 'info');

  try {
    const { thumbnailDataUrl, additionalPartDataUrls } = pendingCapture.captureResult;

    // Generate file path for PDF only (using per-page version)
    const pdfPaths = generateFullPath(
      { ...session, version: pendingCapture.version }, 
      stepCounter, 
      pendingCapture.pageName, 
      'pdf'
    );

    // Generate PDF
    let pdfDataUrl = null;
    let pdfFilename = '';
    try {
      pdfDataUrl = await generatePdf(stitchCanvas, additionalPartDataUrls);
      pdfFilename = pdfPaths.filename;
    } catch (pdfErr) {
      console.warn('PDF generation failed:', pdfErr);
      throw new Error('PDF generation failed');
    }

    // Save PDF only
    showStatus('Saving PDF...', 'info');
    if (dirHandle) {
      await saveViaFSA(dirHandle, pdfPaths.folder, pdfPaths.filename, pdfDataUrl);
    } else {
      await saveViaDownloads(pdfDataUrl, pdfPaths.fullPath);
    }

    // Create manifest row and persist
    const manifestRow = createManifestRow({
      timestamp: pendingCapture.timestamp,
      version: pendingCapture.version, // Now per-page version
      mode: session.mode === MODES.FLOW ? 'Flow' : 'Set',
      flowOrSetName: session.flowOrSetName,
      stepOrIndex: stepCounter,
      pageName: pendingCapture.pageName,
      loginState: pendingCapture.loginState === 'logged-in' ? 'Logged In' : 'Logged Out',
      language: 'en',
      hostname: pendingCapture.hostname,
      fullURL: pendingCapture.fullURL,
      urlPath: pendingCapture.urlPath,
      pngFilename: '',
      pdfFilename,
      description,
      duplicate: !!isDuplicate,
    });

    const storedManifest = await chrome.storage.local.get(STORAGE_KEYS.MANIFEST);
    const rows = storedManifest[STORAGE_KEYS.MANIFEST] || [];
    rows.push(manifestRow);
    await chrome.storage.local.set({ [STORAGE_KEYS.MANIFEST]: rows });

    // Update page name memory and capture history
    const stored = await chrome.storage.local.get([STORAGE_KEYS.PAGE_NAMES, STORAGE_KEYS.CAPTURE_HISTORY]);
    const pageNames = stored[STORAGE_KEYS.PAGE_NAMES] || {};
    const captureHistory = stored[STORAGE_KEYS.CAPTURE_HISTORY] || {};
    pageNames[pendingCapture.urlKey] = pendingCapture.pageName;
    captureHistory[pendingCapture.urlKey] = true;

    const lastCaptureData = {
      pageName: pendingCapture.pageName,
      version: pendingCapture.version,
      pngFilename: '', pdfFilename, description,
      stepOrIndex: stepCounter, loginState: pendingCapture.loginState,
      urlPath: pendingCapture.urlPath, urlKey: pendingCapture.urlKey,
      thumbnailDataUrl,
    };

    await chrome.storage.local.set({
      [STORAGE_KEYS.PAGE_NAMES]: pageNames,
      [STORAGE_KEYS.CAPTURE_HISTORY]: captureHistory,
      [STORAGE_KEYS.LAST_CAPTURE]: lastCaptureData,
    });

    displayLastCapture(lastCaptureData);

    stepCounter++;
    counterValue.textContent = stepCounter;
    await saveStepCounter();

    // Reset
    descriptionSection.classList.add('hidden');
    inputDescription.value = '';
    pendingCapture = null;
    isDuplicate = false;
    btnCapture.classList.remove('capturing');

    const savedTo = dirHandle ? dirHandle.name : 'Downloads';
    showStatus(`Saved: ${pdfFilename} (${savedTo})`, 'success');

  } catch (err) {
    showStatus(`Save failed: ${err.message}`, 'error');
  }
}

function displayLastCapture(data) {
  if (!data) return;
  lastCaptureName.textContent = data.pageName;
  lastCaptureFile.textContent = data.pdfFilename;
  if (data.thumbnailDataUrl) lastCaptureThumb.src = data.thumbnailDataUrl;
  lastCaptureEl.classList.remove('hidden');
}

// ─── Edit Last Capture ───
async function handleEditLast() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.LAST_CAPTURE);
  const data = stored[STORAGE_KEYS.LAST_CAPTURE];
  if (!data) return;

  editPageName.value = data.pageName || '';
  editVersion.value = data.version || '';
  editDescription.value = data.description || '';
  editStepIndex.value = data.stepOrIndex || 1;
  editStateBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.state === (data.loginState || currentCaptureState));
  });
  showView('edit');
}

async function handleSaveEdit(e) {
  e.preventDefault();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.LAST_CAPTURE);
  const lastData = stored[STORAGE_KEYS.LAST_CAPTURE];
  if (!lastData) return;

  const newPageName = editPageName.value.trim();
  const newVersion = editVersion.value.trim() || '';
  const newDescription = editDescription.value.trim();
  const newStepIndex = parseInt(editStepIndex.value, 10);
  const activeEditState = document.querySelector('.edit-state-btn.active');
  const newLoginState = activeEditState ? activeEditState.dataset.state : currentCaptureState;

  if (!newPageName) { editPageName.focus(); return; }

  try {
    // Generate new filename
    const updatedSession = { ...session, version: newVersion, loginState: newLoginState };
    const newPdfPaths = generateFullPath(updatedSession, newStepIndex, newPageName, 'pdf');

    // Update manifest row in storage
    const manifestStored = await chrome.storage.local.get(STORAGE_KEYS.MANIFEST);
    const rows = manifestStored[STORAGE_KEYS.MANIFEST] || [];
    const idx = rows.findIndex(r => r.pdfFilename === lastData.pdfFilename);
    if (idx >= 0) {
      rows[idx] = createManifestRow({
        timestamp: new Date().toLocaleString(),
        version: newVersion,
        mode: session.mode === MODES.FLOW ? 'Flow' : 'Set',
        flowOrSetName: session.flowOrSetName,
        stepOrIndex: newStepIndex,
        pageName: newPageName,
        loginState: newLoginState === 'logged-in' ? 'Logged In' : 'Logged Out',
        language: 'en', hostname: '', fullURL: '',
        urlPath: lastData.urlPath || '',
        pngFilename: '',
        pdfFilename: newPdfPaths.filename,
        description: newDescription, duplicate: false,
      });
      await chrome.storage.local.set({ [STORAGE_KEYS.MANIFEST]: rows });
    }

    // Update stored last capture
    const updatedCapture = {
      ...lastData,
      pageName: newPageName, version: newVersion, description: newDescription,
      stepOrIndex: newStepIndex, loginState: newLoginState,
      pngFilename: '', pdfFilename: newPdfPaths.filename,
    };

    // Update page name memory
    const pageNamesStored = await chrome.storage.local.get(STORAGE_KEYS.PAGE_NAMES);
    const pageNames = pageNamesStored[STORAGE_KEYS.PAGE_NAMES] || {};
    delete pageNames[lastData.urlKey];
    const newKey = getUrlKey(lastData.urlPath, newLoginState);
    pageNames[newKey] = newPageName;
    updatedCapture.urlKey = newKey;

    await chrome.storage.local.set({
      [STORAGE_KEYS.LAST_CAPTURE]: updatedCapture,
      [STORAGE_KEYS.PAGE_NAMES]: pageNames,
    });

    displayLastCapture(updatedCapture);
    showView('capture');
    showStatus('Capture updated successfully.', 'success');
  } catch (err) {
    showStatus(`Edit failed: ${err.message}`, 'error');
    showView('capture');
  }
}

// ─── Folder Picker ───
async function handlePickFolder() {
  try {
    if (!('showDirectoryPicker' in window)) {
      showStatus('Folder picker not supported. Files will save to Downloads.', 'error');
      return;
    }
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    folderPathDisplay.textContent = dirHandle.name;
    
    // Persist the handle to IndexedDB and folder name to chrome.storage
    await saveDirHandle(dirHandle);
    await chrome.storage.local.set({ [STORAGE_KEYS.FOLDER_NAME]: dirHandle.name });
  } catch (err) {
    if (err.name !== 'AbortError') {
      showStatus('Failed to select folder.', 'error');
    }
  }
}

// ─── Bootstrap ───
init();
