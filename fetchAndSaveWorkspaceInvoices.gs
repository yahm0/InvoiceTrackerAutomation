// ==== Configuration ====

const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
const SHEET_NAME = 'Workspace Invoices Tracker';
const LABEL_NAME = 'Workspace Invoices';
const FOLDER_ID = 'YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE';
const SENDER_EMAIL = 'payments-noreply@google.com';
const RECIPIENT_EMAIL = 'YOUR_EMAIL_ADDRESS_HERE';

// Date range: only process emails from the last year
const ONE_YEAR_AGO = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

// Debug mode: set to true to enable verbose logging and label listing
const DEBUG = false;

// Maximum threads per batch (Gmail API limit is 500)
const THREAD_BATCH_SIZE = 100;

// Supported attachment MIME types
const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

// Amount extraction regex patterns (shared between body and PDF extraction)
const AMOUNT_PATTERNS = [
  /Total\s+in\s+USD[\s\S]*?\$?([\d,]+\.\d{2})/i,
  /Amount\s*[:\-]?\s*\$?([\d,]+\.\d{2})/i,
  /Total\s*[:\-]?\s*\$?([\d,]+\.\d{2})/i,
  /Amount\s*Due\s*[:\-]?\s*USD\s*([\d,]+\.\d{2})/i,
  /Balance\s*[:\-]?\s*\$?([\d,]+\.\d{2})/i
];

// ==== Main Function ====

/**
 * Fetches Google Workspace invoices from Gmail, extracts data,
 * saves attachments to Drive, and logs everything to a Google Sheet.
 */
function fetchAndSaveWorkspaceInvoices() {
  try {
    validateConfig_();

    if (DEBUG) {
      listAllLabels_();
    }

    const label = GmailApp.getUserLabelByName(LABEL_NAME);
    if (!label) {
      Logger.log('Label "' + LABEL_NAME + '" not found.');
      sendNotification_('Error', 'The Gmail label "' + LABEL_NAME + '" was not found. Please ensure it exists and is correctly named.');
      return;
    }

    Logger.log('Label "' + LABEL_NAME + '" found.');

    // Fetch threads with pagination to handle large mailboxes
    const allThreads = fetchAllThreads_(label);
    Logger.log('Found ' + allThreads.length + ' threads with label "' + LABEL_NAME + '".');

    if (allThreads.length === 0) {
      Logger.log('No invoices to process.');
      return;
    }

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(SHEET_NAME);

    if (!sheet) {
      Logger.log('Sheet "' + SHEET_NAME + '" not found.');
      sendNotification_('Error', 'The sheet "' + SHEET_NAME + '" was not found in the spreadsheet. Please ensure it exists and is correctly named.');
      return;
    }

    Logger.log('Spreadsheet and sheet "' + SHEET_NAME + '" accessed successfully.');

    const folder = DriveApp.getFolderById(FOLDER_ID);
    Logger.log('Drive folder accessed successfully.');

    // Best practice: read existing data ONCE before the loop to minimize service calls
    const existingData = loadExistingData_(sheet);
    Logger.log('Loaded ' + existingData.invoiceNumbers.length + ' existing invoice records for duplicate checking.');

    // Collect new rows for batch write
    const newRows = [];
    const errors = [];
    let processedCount = 0;

    allThreads.forEach(function(thread, threadIndex) {
      if (DEBUG) {
        Logger.log('Processing thread ' + (threadIndex + 1) + '/' + allThreads.length + ': "' + thread.getFirstMessageSubject() + '"');
      }

      const messages = thread.getMessages();
      const latestMessage = messages[messages.length - 1];
      const messageDate = latestMessage.getDate();

      if (messageDate < ONE_YEAR_AGO) {
        Logger.log('  Thread date ' + messageDate + ' is older than cutoff. Skipping.');
        return;
      }

      messages.forEach(function(message, messageIndex) {
        const senderEmail = extractEmailAddress_(message.getFrom());

        if (senderEmail !== SENDER_EMAIL) {
          return;
        }

        try {
          const body = message.getPlainBody();
          const messageId = message.getId();
          const invoiceNumber = extractInvoiceNumber_(body);

          if (invoiceNumber === 'N/A') {
            Logger.log('    Invoice number not found in message ' + (messageIndex + 1) + '. Skipping.');
            return;
          }

          // Check duplicates against pre-loaded data AND newly collected rows
          if (isDuplicate_(existingData, newRows, invoiceNumber, messageId)) {
            Logger.log('    Invoice ' + invoiceNumber + ' or Message ID ' + messageId + ' already exists. Skipping.');
            return;
          }

          var paymentsProfileId = extractPaymentsProfileId_(body);
          var service = extractService_(body);
          var amountFromBody = extractAmountFromText_(body);
          var pdfText = extractTextFromPDF_(message);
          var amountFromPDF = amountFromBody !== 0 ? 0 : extractAmountFromText_(pdfText);
          var amount = amountFromBody !== 0 ? amountFromBody : amountFromPDF;
          var currency = 'USD';
          var description = extractDescription_(body);

          // Save attachments to Drive
          var receiptLink = saveAttachmentsToDrive_(message, folder);

          var row = [
            invoiceNumber,
            message.getDate(),
            paymentsProfileId,
            service,
            amount,
            currency,
            description,
            receiptLink,
            pdfText,
            messageId
          ];

          newRows.push(row);
          processedCount++;
          Logger.log('    Queued Invoice ' + invoiceNumber + ' for batch write.');

        } catch (msgError) {
          Logger.log('    Error processing message: ' + msgError);
          errors.push('Invoice processing error: ' + msgError);
        }
      });
    });

    // Best practice: batch write all new rows at once instead of appendRow in a loop
    if (newRows.length > 0) {
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
      Logger.log('Batch wrote ' + newRows.length + ' new invoice rows to the sheet.');
    }

    Logger.log('Processing complete. ' + processedCount + ' new invoices added.');

    // Send a single summary notification (not one per error)
    var notificationBody = 'Successfully processed ' + allThreads.length + ' invoice threads on ' + new Date() + '.\n' +
      processedCount + ' new invoices were added to the sheet.';

    if (errors.length > 0) {
      notificationBody += '\n\n' + errors.length + ' errors occurred:\n' + errors.join('\n');
    }

    sendNotification_(errors.length > 0 ? 'Completed with Errors' : 'Success', notificationBody);

  } catch (error) {
    Logger.log('Critical error in fetchAndSaveWorkspaceInvoices: ' + error);
    sendNotification_('Critical Error', 'A critical error occurred:\n\n' + error);
  }
}

// ==== Core Helper Functions ====

/**
 * Validates that configuration constants are not still set to placeholder values.
 * @throws {Error} If any required config value is a placeholder.
 */
function validateConfig_() {
  var placeholders = {
    SPREADSHEET_ID: SPREADSHEET_ID,
    FOLDER_ID: FOLDER_ID,
    RECIPIENT_EMAIL: RECIPIENT_EMAIL
  };

  var missing = [];
  for (var key in placeholders) {
    if (placeholders[key].indexOf('YOUR_') === 0) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error('Configuration incomplete. Please set: ' + missing.join(', '));
  }
}

/**
 * Fetches all threads for a label with pagination to handle >500 threads.
 * @param {GmailLabel} label - The Gmail label to fetch threads from.
 * @return {GmailThread[]} All threads with the label.
 */
function fetchAllThreads_(label) {
  var allThreads = [];
  var start = 0;

  while (true) {
    var batch = label.getThreads(start, THREAD_BATCH_SIZE);
    if (batch.length === 0) {
      break;
    }
    allThreads = allThreads.concat(batch);
    start += batch.length;

    if (batch.length < THREAD_BATCH_SIZE) {
      break;
    }
  }

  return allThreads;
}

/**
 * Loads existing invoice numbers and message IDs from the sheet in a single read.
 * Best practice: minimizes service calls by reading once instead of per-message.
 * @param {Sheet} sheet - The Google Sheet to read from.
 * @return {{invoiceNumbers: string[], messageIds: string[]}} Existing data for duplicate checking.
 */
function loadExistingData_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { invoiceNumbers: [], messageIds: [] };
  }

  // Read both columns in a single batch read
  var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var invoiceNumbers = data.map(function(row) { return row[0]; });
  var messageIds = data.map(function(row) { return row[9]; });

  return { invoiceNumbers: invoiceNumbers, messageIds: messageIds };
}

/**
 * Checks if an invoice number or message ID already exists.
 * Checks both pre-loaded sheet data and newly collected rows in this run.
 * @param {{invoiceNumbers: string[], messageIds: string[]}} existingData - Pre-loaded sheet data.
 * @param {Array[]} newRows - Rows collected in this run but not yet written.
 * @param {string} invoiceNumber - Invoice number to check.
 * @param {string} messageId - Message ID to check.
 * @return {boolean} True if duplicate found.
 */
function isDuplicate_(existingData, newRows, invoiceNumber, messageId) {
  // Check against existing sheet data
  if (existingData.invoiceNumbers.indexOf(invoiceNumber) !== -1 ||
      existingData.messageIds.indexOf(messageId) !== -1) {
    return true;
  }

  // Check against rows collected in this run (prevents duplicates within a single batch)
  for (var i = 0; i < newRows.length; i++) {
    if (newRows[i][0] === invoiceNumber || newRows[i][9] === messageId) {
      return true;
    }
  }

  return false;
}

/**
 * Sends an email notification with a standardized subject prefix.
 * @param {string} type - Notification type (e.g., 'Error', 'Success', 'Critical Error').
 * @param {string} body - The email body text.
 */
function sendNotification_(type, body) {
  MailApp.sendEmail({
    to: RECIPIENT_EMAIL,
    subject: 'Workspace Invoices Automation - ' + type,
    body: body
  });
}

// ==== Extraction Functions ====

/**
 * Extracts email address from the 'From' field (e.g., "Name <email@example.com>").
 * @param {string} fromField - The raw From field value.
 * @return {string} The extracted email address.
 */
function extractEmailAddress_(fromField) {
  var match = fromField.match(/<(.+)>/);
  return match && match[1] ? match[1] : fromField;
}

/**
 * Extracts invoice number from email body text.
 * @param {string} body - The email body text.
 * @return {string} The invoice number or 'N/A' if not found.
 */
function extractInvoiceNumber_(body) {
  var match = body.match(/Invoice\s*number\s*[:\-]?\s*([\w\-]+)/i);
  return match && match[1] ? match[1] : 'N/A';
}

/**
 * Extracts payments profile ID from email body text.
 * @param {string} body - The email body text.
 * @return {string} The payments profile ID or 'N/A' if not found.
 */
function extractPaymentsProfileId_(body) {
  var match = body.match(/Payments\s*profile\s*ID\s*[:\-]?\s*([\d\-]+)/i);
  return match && match[1] ? match[1] : 'N/A';
}

/**
 * Extracts service name from email body text.
 * @param {string} body - The email body text.
 * @return {string} The service name or 'N/A' if not found.
 */
function extractService_(body) {
  var match = body.match(/Service\s*[:\-]?\s*([\w\s]{1,50})/i);
  return match && match[1] ? match[1].trim() : 'N/A';
}

/**
 * Extracts a monetary amount from text using multiple regex patterns.
 * Used for both email body and PDF text extraction (eliminates code duplication).
 * @param {string} text - The text to search for amounts.
 * @return {number} The extracted amount or 0 if not found.
 */
function extractAmountFromText_(text) {
  if (!text) return 0;

  for (var i = 0; i < AMOUNT_PATTERNS.length; i++) {
    var match = text.match(AMOUNT_PATTERNS[i]);
    if (match && match[1]) {
      return parseFloat(match[1].replace(/,/g, ''));
    }
  }
  return 0;
}

/**
 * Extracts description from email body text.
 * @param {string} body - The email body text.
 * @return {string} The description or empty string if not found.
 */
function extractDescription_(body) {
  var match = body.match(/Description\s*[:\-]?\s*(.*)/i);
  return match && match[1] ? match[1].trim() : '';
}

// ==== Drive Functions ====

/**
 * Saves supported attachments from a message to a Google Drive folder.
 * @param {GmailMessage} message - The Gmail message with attachments.
 * @param {Folder} folder - The Google Drive folder to save to.
 * @return {string} Comma-separated URLs of saved files.
 */
function saveAttachmentsToDrive_(message, folder) {
  var attachments = message.getAttachments();
  if (attachments.length === 0) return '';

  var receiptLinks = [];

  attachments.forEach(function(attachment) {
    var mimeType = attachment.getContentType();
    if (SUPPORTED_MIME_TYPES.indexOf(mimeType) !== -1) {
      var file = folder.createFile(attachment);
      receiptLinks.push(file.getUrl());
      Logger.log('        Saved attachment: ' + attachment.getName());
    } else {
      Logger.log('        Skipped unsupported attachment: ' + attachment.getName() + ' (' + mimeType + ')');
    }
  });

  return receiptLinks.join(', ');
}

/**
 * Extracts text from PDF attachments by converting them to Google Docs via Drive API.
 * Creates a temporary folder, converts PDFs, extracts text, then cleans up.
 * @param {GmailMessage} message - The Gmail message with PDF attachments.
 * @return {string} Extracted text from all PDF attachments.
 */
function extractTextFromPDF_(message) {
  var attachments = message.getAttachments();
  if (attachments.length === 0) return '';

  var extractedText = '';

  // Find or create temp folder once (not per-attachment)
  var tempFolder = getOrCreateTempFolder_();

  attachments.forEach(function(attachment) {
    if (attachment.getContentType() !== 'application/pdf') return;

    try {
      var tempFile = tempFolder.createFile(attachment);

      var resource = {
        title: attachment.getName(),
        mimeType: MimeType.GOOGLE_DOCS
      };

      var docFile = Drive.Files.create(resource, tempFile.getBlob(), { convert: true });
      var doc = DocumentApp.openById(docFile.id);
      var text = doc.getBody().getText();

      extractedText += text + '\n';

      // Clean up temporary files
      tempFile.setTrashed(true);
      DriveApp.getFileById(docFile.id).setTrashed(true);
    } catch (pdfError) {
      Logger.log('        Error extracting text from PDF: ' + pdfError);
    }
  });

  return extractedText.trim();
}

/**
 * Gets or creates the temporary PDF folder in Google Drive.
 * @return {Folder} The temporary folder for PDF processing.
 */
function getOrCreateTempFolder_() {
  var existingFolders = DriveApp.getFoldersByName('TempPDF');
  if (existingFolders.hasNext()) {
    return existingFolders.next();
  }
  return DriveApp.createFolder('TempPDF');
}

// ==== Debug Functions ====

/**
 * Lists all Gmail labels for debugging purposes.
 * Only called when DEBUG is set to true.
 */
function listAllLabels_() {
  var labels = GmailApp.getUserLabels();
  Logger.log('Listing all Gmail labels:');
  labels.forEach(function(label) {
    Logger.log('- ' + label.getName());
  });
}
