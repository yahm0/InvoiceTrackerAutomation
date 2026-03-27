# InvoiceTrackerAutomation

**InvoiceTrackerAutomation** is a Google Apps Script that automatically retrieves, extracts, and logs invoice emails from Gmail into a Google Sheet, with attachments saved to Google Drive. It supports invoices from any sender — Google Workspace, Stripe, AWS, Notion, or any other vendor — and centralizes invoice management to eliminate manual data entry.

## Features

- **Multi-Sender Support:** Process invoices from one sender, a list of senders, or any sender with the Gmail label applied.
- **Invoice Data Extraction:** Extracts invoice number, vendor reference, service, amount, currency, and description.
- **Currency Auto-Detection:** Detects currency from invoice content (USD, EUR, GBP, JPY, CAD, AUD, INR, and more).
- **Google Sheets Integration:** Logs invoice data into a Google Sheet for easy tracking and management.
- **Google Drive Integration:** Saves invoice attachments to a designated Google Drive folder.
- **PDF Text Extraction:** Converts attached PDFs to Google Docs for extracting relevant text information.
- **Vision OCR (Optional):** Falls back to Google Cloud Vision API `DOCUMENT_TEXT_DETECTION` for scanned image PDFs that Drive conversion cannot read.
- **Retry Logic:** Automatic exponential backoff retry for transient API errors (rate limits, timeouts, 5xx).
- **Persistent Logging:** Structured logs written to a "Logs" sheet with timestamp, level, function, and message.
- **Notification System:** Sends a single summary email notification for success or error scenarios.
- **Duplicate Check:** Prevents reprocessing using both invoice number and Gmail message ID.
- **Batch Operations:** Reads existing data once and writes all new rows in a single batch for performance.
- **Thread Pagination:** Handles mailboxes with more than 500 labeled threads.
- **Configuration Validation:** Validates that all required settings are configured before running.
- **clasp Integration:** Template config for local development and CI/CD deployment.

## Setup Instructions

### Prerequisites

- Google Account with access to Gmail, Google Sheets, and Google Drive.
- Google Apps Script Editor: Access via [script.google.com](https://script.google.com).
- Google Drive API Enabled: Enable Drive API v3 in Apps Script Services.

### Configuration

1. **Copy the Script:** Copy `fetchAndSaveWorkspaceInvoices.gs` into the Google Apps Script Editor.
2. **Copy the Manifest:** Replace the default `appsscript.json` with the one from this repository (enables Drive API v3 and the correct OAuth scopes).
3. **Replace Configuration Variables:**
   - **SPREADSHEET_ID:** ID of your Google Sheet where invoice data will be stored.
   - **SHEET_NAME:** Name of the sheet tab (default: `'Invoice Tracker'`).
   - **LABEL_NAME:** The Gmail label applied to invoice emails (default: `'Workspace Invoices'`).
   - **FOLDER_ID:** Google Drive folder ID where attachments will be saved.
   - **SENDER_EMAILS:** Array of allowed sender addresses. Use `[]` to accept all labeled senders.
     - Google Workspace only: `['payments-noreply@google.com']`
     - Multiple vendors: `['payments-noreply@google.com', 'billing@stripe.com', 'invoices@aws.amazon.com']`
     - Any sender with the label: `[]`
   - **RECIPIENT_EMAIL:** Your email address for success/error notifications.
4. **Enable Advanced Google Services:**
   - Navigate to `Extensions > Apps Script > Services` and enable **Drive API v3**.

### Vision API Setup (Optional)

Required only if you want OCR on scanned image PDFs. Skip this section if you only receive text-based PDF invoices.

1. **Link your Apps Script project to a GCP project:** Apps Script Editor → Project Settings → Google Cloud Platform (GCP) Project → Change project. Enter your GCP project number.
2. **Enable Cloud Vision API:** GCP Console → APIs & Services → Library → search "Cloud Vision API" → Enable.
3. **Enable billing** on the GCP project (free tier: 1,000 pages/month — sufficient for most invoice workflows).
4. **Set config values in the script:**
   - `ENABLE_VISION_OCR = true`
   - `CLOUD_PROJECT_NUMBER = 'your-numeric-project-number'`
5. **Re-authorize the script** — the next run will prompt for the new `cloud-vision` scope.

> No service account or API key required. The script uses the authorized user's OAuth token.

### Running the Script

1. **Authorization:** Run the script for the first time and authorize the required permissions.
2. **Execution:** Run `fetchAndSaveWorkspaceInvoices()` manually or set up a time-based trigger to run it periodically (see Runbook 6).

### clasp Setup (Local Development)

[clasp](https://github.com/google/clasp) allows you to develop and deploy Google Apps Script projects from the command line.

1. **Install clasp:**
   ```bash
   npm install -g @google/clasp
   ```
2. **Login:**
   ```bash
   clasp login
   ```
3. **Copy the config template:**
   ```bash
   cp .clasp.json.example .clasp.json
   ```
4. **Set your Script ID:** Open your Apps Script project → Project Settings → copy the Script ID → replace `YOUR_SCRIPT_ID_HERE` in `.clasp.json`.
5. **Push changes:**
   ```bash
   clasp push
   ```
6. **Pull changes:**
   ```bash
   clasp pull
   ```

> **Note:** `.clasp.json` is gitignored to prevent leaking your Script ID.

### Debug Mode

Set `DEBUG = true` in the configuration section to enable verbose logging and Gmail label listing. Useful for initial setup and troubleshooting.

## Usage

The script scans Gmail for emails with the label specified in **LABEL_NAME**, optionally filtered to specific senders in **SENDER_EMAILS**. It extracts invoice details and appends them to your Google Sheet. Attachments are saved to the specified Drive folder. PDFs are converted for text extraction; scanned PDFs automatically fall back to Vision OCR when enabled.

### Example Workflow

1. **Invoice Received:** An invoice email arrives in Gmail and is labeled (e.g., "Workspace Invoices").
2. **Script Execution:** The script retrieves the email, extracts invoice details, and saves them to Google Sheets.
3. **Attachment Saved:** Attachments (PDFs, images) are saved to Google Drive.
4. **Notification:** A summary notification is sent to the configured recipient email.

### Google Sheet Columns

| Column | Header | Description |
|--------|--------|-------------|
| A | Invoice Number | Extracted invoice number |
| B | Date | Message date |
| C | Vendor Reference | Account/customer/billing ID (varies by sender) |
| D | Service | Service or product description |
| E | Amount | Invoice amount |
| F | Currency | Auto-detected ISO currency code (e.g., USD, EUR, GBP) |
| G | Description | Invoice description |
| H | Receipt Link | Google Drive file URL(s) of saved attachments |
| I | PDF Text | Extracted text from PDF attachments |
| J | Message ID | Unique Gmail message ID (used for duplicate detection) |

## Error Handling

- **Automatic Retry:** Transient errors (rate limits, timeouts, 5xx) are retried up to 3 times with exponential backoff.
- **Configuration Validation:** Throws a clear error if required config values are still set to placeholders.
- **Label Not Found:** Sends an error notification if the Gmail label does not exist.
- **Sheet Not Found:** Sends an error notification if the specified sheet cannot be found.
- **Duplicate Entries:** Checks for duplicate invoice numbers and message IDs to prevent reprocessing.
- **PDF Extraction Issues:** Logs any issues related to PDF text extraction; processing continues.
- **Vision OCR Failure:** If Vision API returns an error, the script falls back to the Drive conversion result and logs a warning — processing continues.
- **Error Summary:** All errors during a run are collected and sent in a single notification email.
- **Persistent Logs:** All log entries are written to a "Logs" sheet for post-run analysis and audit trails.

## Project Structure

```
InvoiceTrackerAutomation/
├── fetchAndSaveWorkspaceInvoices.gs   # Main Google Apps Script
├── appsscript.json                     # Project manifest (scopes, services, runtime)
├── .clasp.json.example                 # clasp config template (copy to .clasp.json)
├── .gitignore                          # Git ignore rules
├── LICENSE                             # MIT License
└── README.md                           # This file
```

## Runbooks

Common operational tasks for maintaining and extending the script.

---

### Runbook 1: Add a New Invoice Sender

1. Create a Gmail label for the invoices (e.g., `Invoices` as a catch-all, or `Invoices/Stripe`).
2. Set up a Gmail filter: **From** `billing@stripe.com` → apply the label.
3. Add the sender to `SENDER_EMAILS` in the script:
   ```javascript
   const SENDER_EMAILS = ['payments-noreply@google.com', 'billing@stripe.com'];
   ```
4. Alternatively, set `SENDER_EMAILS = []` to accept all senders with the label.
5. Save and re-run `fetchAndSaveWorkspaceInvoices()`.

---

### Runbook 2: Re-process All Invoices from Scratch

1. Clear all rows **below the header row** in the Invoice Tracker sheet (keep row 1).
2. Clear all rows **below the header row** in the Logs sheet (keep row 1).
3. Re-run `fetchAndSaveWorkspaceInvoices()`.
4. Duplicate detection uses Message ID — no duplicates will appear as long as the same emails are in Gmail.

---

### Runbook 3: Script Fails with "Configuration incomplete"

1. Open the script in Apps Script editor.
2. Check `SPREADSHEET_ID`, `FOLDER_ID`, `RECIPIENT_EMAIL` — replace all `YOUR_*` placeholders with real values.
3. If `ENABLE_VISION_OCR = true`, also check `CLOUD_PROJECT_NUMBER`.
4. Save and re-run.

---

### Runbook 4: Enable Vision OCR for Scanned PDFs

1. Set `ENABLE_VISION_OCR = true` in the config.
2. Set `CLOUD_PROJECT_NUMBER = 'your-numeric-project-number'`.
3. Follow the **Vision API Setup** steps in this README.
4. Re-run — check the Logs sheet for `extractTextViaVision_` entries to confirm it fired.

---

### Runbook 5: Invoices Processed but Amount Shows 0

1. Open the Logs sheet and find the row for the affected invoice (search by Message ID).
2. Open the original email and note the exact format of the total/amount line.
3. Add a new regex pattern to `AMOUNT_PATTERNS` in the script config:
   ```javascript
   /Your\s*Total\s*[:\-]?\s*\$?([\d,]+\.\d{2})/i
   ```
4. Delete the affected row from the sheet and re-run — the script will re-extract with the new pattern.

---

### Runbook 6: Set Up an Automated Daily Trigger

1. In Apps Script editor: click the **Triggers** icon (clock) → **Add Trigger**.
2. Function: `fetchAndSaveWorkspaceInvoices` | Event source: **Time-driven** | Type: **Day timer**.
3. Choose a time window (e.g., 6am–7am).
4. Save — the script runs automatically each day and sends you a summary email.

---

### Runbook 7: Duplicate Invoice Rows Appeared

1. In the Invoice Tracker sheet, sort by Column A (Invoice Number) to surface duplicates.
2. Delete the extra rows manually, keeping one row per invoice.
3. The next run will not re-add them — duplicate detection checks both Invoice Number and Message ID.

---

### Runbook 8: Change the Gmail Label Being Watched

1. Create the new label in Gmail if it doesn't exist.
2. Set up a Gmail filter to apply the new label to incoming invoice emails.
3. Update `LABEL_NAME` in the script to the new label name.
4. Save and run — only emails with the new label will be processed going forward.
5. Old processed invoices stay in the sheet and are not removed.

---

### Runbook 9: Vision OCR Returns Garbled or Empty Text

1. Open the Logs sheet and filter by **Function** = `extractTextViaVision_`.
2. **HTTP 403:** Vision API is not enabled in GCP, or the script is not linked to the correct project — re-check the Vision API Setup section.
3. **HTTP 429:** Free-tier quota exceeded (1,000 pages/month) — set `ENABLE_VISION_OCR = false` temporarily or upgrade billing.
4. **Text returned but amount is 0:** The scanned PDF has an unusual amount format — follow Runbook 5 to add a new pattern.

---

### Runbook 10: Logs Sheet is Getting Too Large or Slow

1. Open the Logs sheet and delete all rows below the header (row 1).
2. Optionally lower `MAX_LOG_ENTRIES` (default `1000`) in the config to keep the sheet smaller going forward.
3. The script automatically trims the oldest entries once the limit is reached each run.

---

### Runbook 11: Drive Folder is Running Out of Space

1. Open the Drive folder specified in `FOLDER_ID`.
2. Sort by **Last modified** and archive or delete old attachments that are no longer needed.
3. Alternatively, create a new Drive folder, update `FOLDER_ID`, and re-run — new attachments go to the new folder, old sheet rows retain their original Drive links.

---

### Runbook 12: Deploy Updated Script via clasp

1. Ensure clasp is installed: `npm install -g @google/clasp`
2. Login: `clasp login`
3. Copy the config template: `cp .clasp.json.example .clasp.json`
4. Set `scriptId` in `.clasp.json` to your Apps Script project ID (from Project Settings).
5. Push changes: `clasp push`
6. Verify in browser: `clasp open`
7. Test by running `fetchAndSaveWorkspaceInvoices()` manually in the Apps Script editor.

---

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Contributions

Contributions are welcome! If you have suggestions or improvements, feel free to open an issue or submit a pull request.

## Contact

For questions or support, please open an issue on the repository.
