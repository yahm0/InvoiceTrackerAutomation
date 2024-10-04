# InvoiceTrackerAutomation

InvoiceTrackerAutomation is a Google Apps Script designed to automate the retrieval, extraction, and logging of Google Workspace invoices from Gmail to Google Sheets, with invoice attachments saved to Google Drive. This script helps centralize invoice management, reducing the need for manual data entry.

## Features
- **Automated Gmail Integration**: Fetches Gmail messages with a specific label containing Workspace invoices.
- **Invoice Data Extraction**: Extracts invoice details such as Invoice ID, Billing Account, Service, Amount, and Description.
- **Google Sheets Integration**: Logs invoice data into a Google Sheet for easy tracking and management.
- **Google Drive Integration**: Saves invoice attachments to a designated Google Drive folder.
- **PDF Text Extraction**: Converts attached PDFs to Google Docs for extracting relevant text information.
- **Notification System**: Sends email notifications for success or error scenarios.

## Setup Instructions

### Prerequisites
- **Google Account** with access to Gmail, Google Sheets, and Google Drive.
- **Google Apps Script Editor**: Access via [script.google.com](https://script.google.com).
- **Google Drive API Enabled**: Enable the Drive API in both Google Apps Script and the Google Cloud Console.

### Configuration
1. **Copy the Script**: Copy the provided code into the Google Apps Script Editor.
2. **Replace Configuration Variables**:
   - `SPREADSHEET_ID`: Replace with the ID of your Google Sheet where invoice details will be stored.
   - `SHEET_NAME`: Replace with the name of the specific sheet where data should be saved.
   - `LABEL_NAME`: Replace with the label used in Gmail for Workspace invoices.
   - `FOLDER_ID`: Replace with the Google Drive folder ID where attachments will be stored.
   - `SENDER_EMAIL`: Replace with the email address of the sender of invoices (e.g., `payments-noreply@google.com`).
   - `RECIPIENT_EMAIL`: Replace with your email address to receive error/success notifications.
3. **Enable Advanced Google Services**:
   - Navigate to `Extensions` > `Apps Script` > `Services` > Enable **Drive API**.

### Running the Script
1. **Authorization**: Run the script for the first time and authorize the required permissions.
2. **Execution**: Run the `fetchAndSaveWorkspaceInvoices()` function manually or set up a time-based trigger to run it periodically.

### Automation
- Set up a time-based trigger (e.g., daily or weekly) to run the script automatically and keep your records updated.

## Usage
The script automatically scans Gmail for invoices based on the label specified in `LABEL_NAME`, extracts details, and appends them to your Google Sheet. Attachments are saved to the specified Google Drive folder. The script converts PDFs to Google Docs for text extraction and stores the extracted information.

### Example Workflow
1. **Invoice Received**: An invoice email arrives in Gmail and is automatically labeled (e.g., "Workspace Invoices").
2. **Script Execution**: The script retrieves the email, extracts invoice details, and saves them to Google Sheets.
3. **Attachment Saved**: Attachments (like receipts or PDFs) are saved to Google Drive.
4. **Notification**: A success or error notification is sent to the configured recipient.

## Error Handling
- **Label Not Found**: Sends an error notification if the Gmail label does not exist.
- **Sheet Not Found**: Sends an error notification if the specified sheet cannot be found in the Google Spreadsheet.
- **PDF Extraction Issues**: Logs any issues related to PDF text extraction and sends notifications for critical errors.

## Future Enhancements
- **Improved OCR**: Integrate Google Cloud Vision API for improved OCR capabilities on scanned PDF invoices.
- **Enhanced Error Handling**: Add retry logic for transient errors.
- **Logging Enhancements**: Store logs in Google Sheets for better tracking of processed invoices.

## License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contributions
Contributions are welcome! If you have any suggestions or improvements, feel free to open an issue or submit a pull request.

## Contact
For questions or support, please open an issue on the repository or contact the repository owner.

