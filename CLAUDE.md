# CLAUDE.md - InvoiceTrackerAutomation

## Project Overview
Google Apps Script automation that retrieves invoice emails from Gmail, extracts data (invoice number, amount, currency, vendor ref, service, description), saves attachments to Google Drive, and logs everything to a Google Sheet. Supports 17+ currencies, PDF text extraction via Drive conversion with Cloud Vision OCR fallback, and multi-sender filtering.

## Tech Stack
- **Language:** Google Apps Script (JavaScript, V8 runtime)
- **Platform:** Google Workspace (Gmail, Sheets, Drive, Docs)
- **APIs:** Gmail API, Sheets API, Drive API v3, Cloud Vision API (optional)
- **Dev Tool:** clasp (Google Apps Script CLI)

## Project Structure
```
fetchAndSaveWorkspaceInvoices.gs  # Main script (all logic)
appsscript.json                    # Manifest with OAuth scopes & services
.clasp.json.example                # clasp config template
.claspignore                       # Files excluded from clasp push
.eslintrc.json                     # ESLint config with Apps Script globals
```

## Key Entry Points
- `fetchAndSaveWorkspaceInvoices()` - Main entry point, orchestrates the full pipeline
- `installTrigger()` / `removeTrigger()` - Manage time-driven triggers
- `listAllLabels()` - Debug utility to list all Gmail labels
- `validateConfig_()` - Pre-run configuration validation

## Development
- No build step required - this is a pure Apps Script project
- Use `clasp push` to deploy, `clasp pull` to sync from remote
- Copy `.clasp.json.example` to `.clasp.json` and add your Script ID
- Testing is manual via Apps Script Editor or time-based triggers
- Set `DEBUG = true` for verbose logging (or set via Script Properties)

## Configuration
All config can be set two ways:
1. **Script Properties** (recommended for production): Project Settings > Script Properties
2. **Hardcoded defaults** (top of .gs file): used as fallbacks when no Script Property exists

Key settings:
- `SPREADSHEET_ID` - Target Google Sheet
- `FOLDER_ID` - Google Drive folder for attachments
- `LABEL_NAME` - Gmail label to watch (default: 'Workspace Invoices')
- `SENDER_EMAILS` - Comma-separated allowed senders (empty = accept all)
- `RECIPIENT_EMAIL` - Notification recipient
- `ENABLE_VISION_OCR` - Toggle Cloud Vision API for scanned PDFs ('true'/'false')
- `NOTIFY_ON_SUCCESS` - Whether to email on successful runs ('true'/'false')
- `DEBUG` - Enable verbose logging ('true'/'false')

## Conventions
- Private/helper functions use trailing underscore: `functionName_()`
- Logs go to a dedicated "Logs" sheet tab via `log_()` and `flushLogs_()`
- All Drive/Gmail calls wrapped in `withRetry_()` for exponential backoff
- Duplicate detection uses both invoice number and Gmail message ID (Set-based O(1) lookups)
- Column positions managed via `COLUMNS` object  - never use magic index numbers
- Sheet auto-creates with headers if missing (`getOrCreateMainSheet_()`)
- Execution time guard with checkpoint/resume prevents Apps Script timeout
- Temp files cleaned up in `finally` blocks to prevent Drive leaks
