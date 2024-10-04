## Features
- **Automated Gmail Integration**: Fetches emails with a specific label containing Google Workspace invoices.
- **Invoice Parsing**: Extracts key details such as Invoice ID, Billing Account, Service, Amount, and Description.
- **Google Sheet Integration**: Appends invoice details to a specified Google Sheet for easy tracking.
- **Google Drive Integration**: Saves invoice attachments to a specified folder on Google Drive.
- **PDF Extraction**: Converts PDF invoices to Google Docs for text extraction, allowing for additional information parsing.
- **Notifications**: Sends success or error notifications via email.

## Prerequisites
- A Google Workspace account with invoices labeled appropriately.
- A Google Sheet to store invoice details.
- A Google Drive folder to store invoice attachments.
- Permission to run Google Apps Script, including access to Gmail, Google Drive, and Google Sheets.

## Setup Instructions
1. **Clone or Copy the Script**:
   - Copy the code from the repository into your Google Apps Script Editor (https://script.google.com).
2. **Configuration**:
   - Update the following constants in the script with your own information:
     - `SPREADSHEET_ID`: Google Sheet ID where the invoice details will be saved.
     - `SHEET_NAME`: Name of the specific sheet inside the spreadsheet.
     - `LABEL_NAME`: Gmail label name used to filter the invoice emails.
     - `FOLDER_ID`: Google Drive folder ID where the attachments will be saved.
     - `SENDER_EMAIL`: The email address that sends the invoices (e.g., `payments-noreply@google.com`).
     - `RECIPIENT_EMAIL`: Your email address for notifications.
3. **Grant Permissions**:
   - Run the script for the first time and follow the prompts to grant necessary permissions.
4. **Test the Script**:
   - Add the appropriate Gmail label to some sample invoice emails and run the script manually to ensure everything works.
5. **Automation**:
   - Set up a trigger in Google Apps Script to run `fetchAndSaveWorkspaceInvoices` automatically at a regular interval (e.g., once a day).

## Usage
The script automatically scans your Gmail inbox for emails with the specified label (`Workspace Invoices`), extracts invoice details, and logs them into the specified Google Sheet. The attachments are saved in a designated Google Drive folder, and if a PDF is attached, it will also extract text from the PDF for additional processing.

### Example Workflow
1. An invoice email is received in Gmail.
2. The email is automatically labeled (or manually labeled) with `Workspace Invoices`.
3. The script fetches emails with the label, extracts relevant information, and logs it into Google Sheets.
4. Attachments are saved to Google Drive, and PDFs are converted to Google Docs for text extraction.
5. The script sends a success notification when the process is complete.

## Error Handling
- If a Gmail label or sheet is not found, the script sends an error email to `RECIPIENT_EMAIL`.
- If an error occurs during message processing, the script logs the error and sends an email notification.

## Tech Stack
- **Google Apps Script** for automation.
- **Google Sheets** for data storage.
- **Google Drive** for attachment storage.

## Future Enhancements
- **Error Recovery**: Add more robust retry mechanisms for transient errors.
- **Detailed Logging**: Store logs in Google Sheets for easier monitoring.
- **Extended Support**: Expand parsing capabilities to handle more complex invoice formats.

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributions
Contributions are welcome! Feel free to open an issue or submit a pull request if you have suggestions or improvements.

## Contact
For questions or support, please email [anuccio@terminalsoftware.gg](mailto:anuccio@terminalsoftware.gg).

---

### Notes
- This script will require permissions to access Gmail, Google Drive, and Google Sheets. Ensure that the permissions are only granted if you trust the script.
- Always test with sample data before using it in a production environment to avoid data loss or unauthorized access.
