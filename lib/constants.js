/**
 * Shared constants for Exemplar Capture extension.
 */

export const MODES = {
  FLOW: 'flow',
  SET: 'set',
};

export const LOGIN_STATES = {
  LOGGED_IN: 'logged-in',
  LOGGED_OUT: 'logged-out',
};

export const DESCRIPTION_MODES = {
  SHORT: 'short',
  COMPLIANCE: 'compliance',
  VERBOSE: 'verbose',
};

export const LANGUAGE = 'en';

export const STORAGE_KEYS = {
  SESSION: 'exemplar_session',
  MANIFEST: 'exemplar_manifest',
  PAGE_NAMES: 'exemplar_page_names',
  CAPTURE_HISTORY: 'exemplar_capture_history',
  LAST_CAPTURE: 'exemplar_last_capture',
  STEP_COUNTER: 'exemplar_step_counter',
  FOLDER_NAME: 'exemplar_folder_name',
};

export const COMPLIANCE_KEYWORDS = [
  'refund',
  'cancel',
  'cancellation',
  'renewal',
  'renew',
  'subscription',
  'billing',
  'policy',
  'terms',
];

export const OVERLAY_STYLE = {
  PADDING: 12,
  FONT_SIZE: 11,
  LINE_HEIGHT: 16,
  BG_COLOR: 'rgba(0, 0, 0, 0.75)',
  TEXT_COLOR: '#ffffff',
  FONT_FAMILY: 'monospace',
  MAX_WIDTH: 500,
};
