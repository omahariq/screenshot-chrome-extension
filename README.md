# Exemplar Capture — Chrome Extension

A Manifest V3 Chrome extension for capturing and preserving exemplars of customer-facing web materials with compliance labeling. Designed for legal documentation workflows where each capture must be labeled with version, date, and identifying information.

## Features

- **Full-page screenshots** via scroll-and-stitch capture
- **Compliance header overlay** embedded in every PNG and PDF (version, date, page name, login state, URL, etc.)
- **Dual output**: Full-page PNG + PDF for every capture
- **Structured naming convention**: Files auto-named with step/index, page name, login state, version, and date
- **Manifest CSV**: Auto-generated audit trail of all captures per session
- **Session management**: Configure mode (Flow/Set), version, login state once per session
- **Page name memory**: Remembers names for pages within a session
- **Duplicate detection**: Warns when capturing the same URL + login state combination
- **Edit last capture**: Rename, re-describe, or adjust the most recent capture
- **Two save modes**: Downloads API (default) or File System Access API (power users)

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select this project's root folder
5. The Exemplar Capture icon will appear in your toolbar

## Usage

### 1. Start a Session

Click the extension icon to open the popup. Configure:

- **Mode**: Flow (ordered steps) or Set (unordered collection)
- **Version**: e.g., `v3.12.0` (required)
- **Date**: Auto-filled, editable
- **Login State**: Logged In or Logged Out
- **Flow/Set Name**: e.g., "Checkout Flow" or "Landing Pages"
- **Save Location**: Optionally pick a custom folder (File System Access API)

Click **Start Session** to begin.

### 2. Capture Pages

1. Navigate to the page you want to capture in the active tab
2. Click **Capture** in the popup
3. Name the page when prompted (names are remembered per URL + login state)
4. Add a description (Short, Compliance-focused, or Verbose mode)
5. Click **Save Capture**

Files are saved to: `Downloads/Exemplars/{date}_{version}/{Flow|Set}_{name}/`

### 3. File Output

Each capture produces:

- **PNG**: `Step01_CheckoutPage_LoggedIn_en_v3.12.0_2026-02-09.png`
- **PDF**: `Step01_CheckoutPage_LoggedIn_en_v3.12.0_2026-02-09.pdf`
- **Manifest CSV**: Updated after every capture

### 4. Edit & Export

- **Edit Last**: Rename page, change description, adjust step/index or login state
- **Toggle Login State**: Quick switch between Logged In / Logged Out
- **Export Manifest**: Manually export the manifest CSV at any time
- **End Session**: Clear session data and start fresh

## Folder Structure

```
Exemplars/
  2026-02-09_v3.12.0/
    Flow_CheckoutFlow/
      Step01_LandingPage_LoggedOut_en_v3.12.0_2026-02-09.png
      Step01_LandingPage_LoggedOut_en_v3.12.0_2026-02-09.pdf
      Step02_CheckoutPage_LoggedIn_en_v3.12.0_2026-02-09.png
      Step02_CheckoutPage_LoggedIn_en_v3.12.0_2026-02-09.pdf
      manifest_2026-02-09_v3.12.0.csv
    Set_LandingPages/
      LP01_MasterclassLanding_LoggedOut_en_v3.12.0_2026-02-09.png
      ...
```

## Manifest CSV Columns

| Column | Description |
|---|---|
| Timestamp | Local capture time |
| Version | Software version |
| Mode | Flow or Set |
| FlowOrSetName | Name of the flow or set |
| StepOrIndex | Step number (Flow) or index (Set) |
| PageName | User-assigned page name |
| LoginState | Logged In / Logged Out |
| Language | Always "en" for v1 |
| Hostname | e.g., www.example.com |
| FullURL | Complete URL |
| URLPath | Path + query string |
| PNGFilename | PNG file name |
| PDFFilename | PDF file name |
| Description | User-provided description |
| Duplicate | true/false |

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab` | Capture screenshot of the current tab |
| `scripting` | Inject content script for page measurement |
| `downloads` | Save files to disk |
| `storage` | Persist session data and page name memory |
| `offscreen` | Canvas operations for image stitching and PDF generation |
| `<all_urls>` | Required for content script injection on any site |

## Technical Architecture

- **Popup** (`popup/`): Single-page app with three views (Setup, Capture, Edit)
- **Service Worker** (`background/`): Orchestrates capture pipeline and file saving
- **Content Script** (`content/`): Measures page dimensions and coordinates scrolling
- **Offscreen Document** (`offscreen/`): Canvas stitching, header overlay, PDF generation via jsPDF
- **Libraries** (`lib/`): Shared naming conventions, CSV serialization, constants

## Known Limitations

- Canvas max height is capped at 16,384 pixels. Very tall pages may be truncated.
- File System Access API requires a user gesture once per session.
- PDF is derived from the PNG screenshot (not a native page print).
- Cannot capture `chrome://` or other browser-internal pages.
- Downloads API saves files relative to the browser's Downloads folder.
