/**
 * File and folder naming conventions for Exemplar Capture.
 */

import { MODES, LOGIN_STATES } from './constants.js';

/**
 * Remove non-alphanumeric characters (except hyphens) and convert to PascalCase.
 */
export function sanitize(name) {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/**
 * Format login state for filenames.
 */
export function formatState(state) {
  return state === LOGIN_STATES.LOGGED_IN ? 'LoggedIn' : 'LoggedOut';
}

/**
 * Generate filename for Flow mode.
 * Pattern: Step{NN}_{PageName}_{State}_en_{Version}_{YYYY-MM-DD}.{ext}
 */
export function flowFilename(step, pageName, state, version, date, ext) {
  const s = String(step).padStart(2, '0');
  const p = sanitize(pageName);
  const st = formatState(state);
  return `Step${s}_${p}_${st}_en_${version}_${date}.${ext}`;
}

/**
 * Generate filename for Set mode.
 * Pattern: LP{NN}_{PageName}_{State}_en_{Version}_{YYYY-MM-DD}.{ext}
 */
export function setFilename(index, pageName, state, version, date, ext) {
  const i = String(index).padStart(2, '0');
  const p = sanitize(pageName);
  const st = formatState(state);
  return `LP${i}_${p}_${st}_en_${version}_${date}.${ext}`;
}

/**
 * Generate filename based on mode.
 */
export function generateFilename(mode, stepOrIndex, pageName, state, version, date, ext) {
  if (mode === MODES.FLOW) {
    return flowFilename(stepOrIndex, pageName, state, version, date, ext);
  }
  return setFilename(stepOrIndex, pageName, state, version, date, ext);
}

/**
 * Generate the folder path for saving artifacts.
 * Pattern: Exemplars/{YYYY-MM-DD}_{Version}/{Mode}_{Name}/
 */
export function generateFolderPath(date, version, mode, name) {
  const modePrefix = mode === MODES.FLOW ? 'Flow' : 'Set';
  const safeName = sanitize(name);
  return `Exemplars/${date}_${version}/${modePrefix}_${safeName}`;
}

/**
 * Generate full file path including folder.
 */
export function generateFullPath(session, stepOrIndex, pageName, ext) {
  const folder = generateFolderPath(session.date, session.version, session.mode, session.flowOrSetName);
  const filename = generateFilename(session.mode, stepOrIndex, pageName, session.loginState, session.version, session.date, ext);
  return { folder, filename, fullPath: `${folder}/${filename}` };
}

/**
 * Generate manifest filename.
 * Pattern: manifest_{YYYY-MM-DD}_{Version}.csv
 */
export function manifestFilename(date, version) {
  return `manifest_${date}_${version}.csv`;
}
