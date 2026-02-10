/**
 * Manifest CSV serialization for Exemplar Capture.
 */

const CSV_HEADERS = [
  'Timestamp',
  'Version',
  'Mode',
  'FlowOrSetName',
  'StepOrIndex',
  'PageName',
  'LoginState',
  'Language',
  'Hostname',
  'FullURL',
  'URLPath',
  'PNGFilename',
  'PDFFilename',
  'Description',
  'Duplicate',
];

/**
 * Escape a value for CSV (RFC 4180).
 */
function escapeCsvValue(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Map CSV header names to row object keys.
 */
const HEADER_TO_KEY = {
  Timestamp: 'timestamp',
  Version: 'version',
  Mode: 'mode',
  FlowOrSetName: 'flowOrSetName',
  StepOrIndex: 'stepOrIndex',
  PageName: 'pageName',
  LoginState: 'loginState',
  Language: 'language',
  Hostname: 'hostname',
  FullURL: 'fullURL',
  URLPath: 'urlPath',
  PNGFilename: 'pngFilename',
  PDFFilename: 'pdfFilename',
  Description: 'description',
  Duplicate: 'duplicate',
};

/**
 * Convert a single manifest row object to a CSV line.
 */
function rowToCsvLine(row) {
  return CSV_HEADERS.map(header => {
    const key = HEADER_TO_KEY[header];
    return escapeCsvValue(row[key]);
  }).join(',');
}

/**
 * Generate full CSV content from an array of manifest row objects.
 */
export function generateCsv(rows) {
  const headerLine = CSV_HEADERS.join(',');
  const dataLines = rows.map(rowToCsvLine);
  return headerLine + '\n' + dataLines.join('\n') + '\n';
}

/**
 * Create a manifest row object from capture data.
 */
export function createManifestRow({
  timestamp,
  version,
  mode,
  flowOrSetName,
  stepOrIndex,
  pageName,
  loginState,
  language,
  hostname,
  fullURL,
  urlPath,
  pngFilename,
  pdfFilename,
  description,
  duplicate,
}) {
  return {
    timestamp: timestamp || new Date().toLocaleString(),
    version: version || '',
    mode: mode || '',
    flowOrSetName: flowOrSetName || '',
    stepOrIndex: stepOrIndex ?? '',
    pageName: pageName || '',
    loginState: loginState || '',
    language: language || 'en',
    hostname: hostname || '',
    fullURL: fullURL || '',
    urlPath: urlPath || '',
    pngFilename: pngFilename || '',
    pdfFilename: pdfFilename || '',
    description: description || '',
    duplicate: duplicate ? 'true' : 'false',
  };
}
