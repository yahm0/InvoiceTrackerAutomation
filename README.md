# InvoiceTrackerAutomation

**InvoiceTrackerAutomation** is a Google Apps Script designed to automate the retrieval, extraction, and logging of Google Workspace invoices from Gmail to Google Sheets, with invoice attachments saved to Google Drive. This script helps centralize invoice management, reducing the need for manual data entry.

## Features

- **Automated Gmail Integration:** Fetches Gmail messages with a specific label containing Workspace invoices.
- **Invoice Data Extraction:** Extracts invoice details such as Invoice ID, Billing Account, Service, Amount, and Description.
- **Google Sheets Integration:** Logs invoice data into a Google Sheet for easy tracking and management.
- **Google Drive Integration:** Saves invoice attachments to a designated Google Drive folder.
- **PDF Text Extraction:** Converts attached PDFs to Google Docs for extracting relevant text information.
- **Notification System:** Sends email notifications for success or error scenarios.
- **Duplicate Check:** Ensures that duplicate invoices are not logged in the Google Sheet.
- **Batch Operations:** Collects all new rows and writes them in a single batch for performance.
- **Thread Pagination:** Handles mailboxes with more than 500 threads via paginated fetching.
- **Configuration Validation:** Validates that all required settings are configured before running.

## Recent Changes

- **Best Practices Refactor:** Rewrote script following Google Apps Script best practices (batch reads/writes, minimized service calls in loops, JSDoc documentation).
- **Batch Sheet Writes:** Replaced per-row `appendRow()` with a single `setValues()` batch write for significantly improved performance.
- **Single-Read Duplicate Check:** Invoice numbers and message IDs are loaded once before processing, eliminating redundant sheet reads per message.
- **Unified Amount Extraction:** Merged duplicate `extractAmount()` and `extractAmountFromPDF()` into a single `extractAmountFromText_()` function.
- **Thread Pagination:** Added paginated thread fetching to handle mailboxes with more than 500 invoice threads.
- **Config Validation:** Script validates configuration values on startup and throws a clear error if placeholders remain.
- **Debug Mode:** Added a `DEBUG` flag to toggle verbose logging and label listing (off by default).
- **Error Batching:** Errors are collected and sent in a single summary notification instead of one email per error.
- **Project Manifest:** Added `appsscript.json` with proper OAuth scopes and Drive API v3 dependency.
- **Private Functions:** Helper functions use trailing underscore convention (`functionName_()`) per Google Apps Script standards.

## Setup Instructions

### Prerequisites

- Google Account with access to Gmail, Google Sheets, and Google Drive.
- Google Apps Script Editor: Access via [script.google.com](https://script.google.com).
- Google Drive API Enabled: Enable the Drive API in both Google Apps Script and the Google Cloud Console.

### Configuration

1. **Copy the Script:** Copy `fetchAndSaveWorkspaceInvoices.gs` into the Google Apps Script Editor.
2. **Copy the Manifest:** Replace the default `appsscript.json` with the one from this repository (or manually enable Drive API v3 in Services).
3. **Replace Configuration Variables:**
   - **SPREADSHEET_ID:** Replace with the ID of your Google Sheet where invoice details will be stored.
   - **SHEET_NAME:** Replace with the name of the specific sheet where data should be saved.
   - **LABEL_NAME:** Replace with the label used in Gmail for Workspace invoices.
   - **FOLDER_ID:** Replace with the Google Drive folder ID where attachments will be stored.
   - **SENDER_EMAIL:** Replace with the email address of the sender of invoices (e.g., payments-noreply@google.com).
   - **RECIPIENT_EMAIL:** Replace with your email address to receive error/success notifications.
4. **Enable Advanced Google Services:**
   - Navigate to `Extensions > Apps Script > Services > Enable Drive API`.

### Running the Script

1. **Authorization:** Run the script for the first time and authorize the required permissions.
2. **Execution:** Run the `fetchAndSaveWorkspaceInvoices()` function manually or set up a time-based trigger to run it periodically.

### Automation

- Set up a time-based trigger (e.g., daily or weekly) to run the script automatically and keep your records updated.

### Debug Mode

Set `DEBUG = true` in the configuration section to enable verbose logging and Gmail label listing. This is useful for initial setup and troubleshooting.

## Usage

The script automatically scans Gmail for invoices based on the label specified in **LABEL_NAME**, extracts details, and appends them to your Google Sheet. Attachments are saved to the specified Google Drive folder. The script converts PDFs to Google Docs for text extraction and stores the extracted information.

### Example Workflow

1. **Invoice Received:** An invoice email arrives in Gmail and is automatically labeled (e.g., "Workspace Invoices").
2. **Script Execution:** The script retrieves the email, extracts invoice details, and saves them to Google Sheets.
3. **Attachment Saved:** Attachments (like receipts or PDFs) are saved to Google Drive.
4. **Notification:** A success or error notification is sent to the configured recipient.

### Google Sheet Columns

| Column | Header | Description |
|--------|--------|-------------|
| A | Invoice Number | Extracted invoice number |
| B | Date | Message date |
| C | Payments Profile ID | Billing profile identifier |
| D | Service | Service description |
| E | Amount | Invoice amount |
| F | Currency | Currency type (USD) |
| G | Description | Invoice description |
| H | Receipt Link | Google Drive file URL(s) |
| I | PDF Text | Extracted text from PDF attachments |
| J | Message ID | Unique Gmail message ID |

## Error Handling

- **Configuration Validation:** Throws a clear error if required config values are still set to placeholders.
- **Label Not Found:** Sends an error notification if the Gmail label does not exist.
- **Sheet Not Found:** Sends an error notification if the specified sheet cannot be found in the Google Spreadsheet.
- **Duplicate Entries:** Checks for duplicate invoice numbers and message IDs to prevent reprocessing.
- **PDF Extraction Issues:** Logs any issues related to PDF text extraction.
- **Error Summary:** All errors during processing are collected and sent in a single notification email.

## Project Structure

```
InvoiceTrackerAutomation/
├── fetchAndSaveWorkspaceInvoices.gs   # Main Google Apps Script
├── appsscript.json                     # Project manifest (scopes, services, runtime)
├── .gitignore                          # Git ignore rules
├── LICENSE                             # MIT License
└── README.md                           # This file
```

## Future Enhancements

- **Improved OCR:** Integrate Google Cloud Vision API for improved OCR capabilities on scanned PDF invoices.
- **Enhanced Error Handling:** Add retry logic for transient errors.
- **Logging Enhancements:** Store logs in Google Sheets for better tracking of processed invoices.
- **Currency Detection:** Auto-detect currency from invoice content instead of hardcoding USD.
- **clasp Integration:** Add `.clasp.json` configuration for local development and CI/CD deployment.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Contributions

Contributions are welcome! If you have any suggestions or improvements, feel free to open an issue or submit a pull request.

## Contact

For questions or support, please open an issue on the repository or contact the repository owner.
