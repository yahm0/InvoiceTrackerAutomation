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

// Maximum retry attempts for transient API errors
const MAX_RETRIES = 3;

// ==== Vision OCR Configuration (Optional) ====
// To enable: set ENABLE_VISION_OCR = true and fill in CLOUD_PROJECT_NUMBER.
// When false, the script works exactly as before — zero Vision API calls are made.
// See README for GCP setup instructions.
const ENABLE_VISION_OCR = false;

// Minimum characters from Drive PDF conversion before attempting Vision OCR fallback.
// Text-based PDFs produce hundreds of chars; scanned PDFs return near-zero.
const OCR_MIN_TEXT_LENGTH = 50;

// Your GCP project number (numeric string, e.g. '123456789012').
// Found in GCP Console > Project Info card. Only required when ENABLE_VISION_OCR = true.
const CLOUD_PROJECT_NUMBER = 'YOUR_CLOUD_PROJECT_NUMBER_HERE';

// Logging configuration
const LOG_SHEET_NAME = 'Logs';
const MAX_LOG_ENTRIES = 1000;

// Default currency fallback when auto-detection fails
const DEFAULT_CURRENCY = 'USD';

// Currency symbol to ISO 4217 code mapping
const CURRENCY_SYMBOLS = {
  '$': 'USD',
  '\u20AC': 'EUR',
  '\u00A3': 'GBP',
  '\u00A5': 'JPY',
  '\u20B9': 'INR'
};

// ISO 4217 currency code detection pattern
const CURRENCY_CODE_PATTERN = /\b(USD|EUR|GBP|JPY|CAD|AUD|INR|CHF|NZD|SEK|NOK|DKK|BRL|MXN|KRW|SGD|HKD)\b/i;

// Supported attachment MIME types
const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

// Amount extraction regex patterns (currency-agnostic)
const AMOUNT_PATTERNS = [
  /Total\s+in\s+\w{3}[\s\S]*?[$\u20AC\u00A3\u00A5\u20B9]?\s*([\d,]+\.\d{2})/i,
  /Amount\s*[:\-]?\s*[$\u20AC\u00A3\u00A5\u20B9]?\s*([\d,]+\.\d{2})/i,
  /Total\s*[:\-]?\s*[$\u20AC\u00A3\u00A5\u20B9]?\s*([\d,]+\.\d{2})/i,
  /Amount\s*Due\s*[:\-]?\s*\w{0,3}\s*([\d,]+\.\d{2})/i,
  /Balance\s*[:\-]?\s*[$\u20AC\u00A3\u00A5\u20B9]?\s*([\d,]+\.\d{2})/i
];

// Script-scoped log buffer (flushed to Logs sheet at end of run)
var logBuffer_ = [];

// ==== Retry Logic ====

/**
 * Executes a function with exponential backoff retry for transient errors.
 * @param {string} operationName - Name for logging (e.g., 'GmailApp.getUserLabelByName').
 * @param {Function} fn - The function to execute.
 * @return {*} The return value of fn.
 * @throws {Error} If all retries are exhausted or a permanent error occurs.
 */
function withRetry_(operationName, fn) {
  for (var attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return fn();
    } catch (error) {
      if (!isTransientError_(error) || attempt === MAX_RETRIES) {
        if (attempt > 0) {
          log_('ERROR', 'withRetry_', operationName + ' failed after ' + (attempt + 1) + ' attempts: ' + error);
        }
        throw error;
      }
      var waitMs = Math.pow(2, attempt) * 1000;
      log_('WARN', 'withRetry_', operationName + ' failed (attempt ' + (attempt + 1) + '/' + (MAX_RETRIES + 1) + '). Retrying in ' + waitMs + 'ms. Error: ' + error);
      Utilities.sleep(waitMs);
    }
  }
}

/**
 * Determines if an error is transient and worth retrying.
 * @param {Error} error - The caught error.
 * @return {boolean} True if the error is transient.
 */
function isTransientError_(error) {
  var message = String(error.message || error);
  return /Service invoked too many times|Limit Exceeded|Rate Limit|Timeout|timed out|502|503|500|UNAVAILABLE|temporarily unavailable|Service error/i.test(message);
}

// ==== Logging ====

/**
 * Logs a message to the in-memory buffer and Logger.log.
 * Buffer is flushed to the Logs sheet at end of run via flushLogs_().
 * @param {string} level - Log level: 'INFO', 'WARN', or 'ERROR'.
 * @param {string} functionName - The function where the log originated.
 * @param {string} message - The log message.
 */
function log_(level, functionName, message) {
  logBuffer_.push([new Date(), level, functionName, message]);
  Logger.log(level + ' [' + functionName + '] ' + message);
}

/**
 * Batch writes all buffered log entries to the Logs sheet and trims old entries.
 * @param {Spreadsheet} spreadsheet - The Google Spreadsheet object.
 */
function flushLogs_(spreadsheet) {
  if (logBuffer_.length === 0) return;

  try {
    var logSheet = getOrCreateLogSheet_(spreadsheet);
    var lastRow = logSheet.getLastRow();
    logSheet.getRange(lastRow + 1, 1, logBuffer_.length, 4).setValues(logBuffer_);

    // Trim old entries if over MAX_LOG_ENTRIES (row 1 is header)
    var totalRows = logSheet.getLastRow();
    var excess = totalRows - 1 - MAX_LOG_ENTRIES;
    if (excess > 0) {
      logSheet.deleteRows(2, excess);
    }

    logBuffer_ = [];
  } catch (logError) {
    Logger.log('ERROR [flushLogs_] Failed to write logs to sheet: ' + logError);
  }
}

/**
 * Gets or creates the Logs sheet with headers.
 * @param {Spreadsheet} spreadsheet - The Google Spreadsheet object.
 * @return {Sheet} The Logs sheet.
 */
function getOrCreateLogSheet_(spreadsheet) {
  var logSheet = spreadsheet.getSheetByName(LOG_SHEET_NAME);
  if (!logSheet) {
    logSheet = spreadsheet.insertSheet(LOG_SHEET_NAME);
    logSheet.appendRow(['Timestamp', 'Level', 'Function', 'Message']);
    logSheet.setFrozenRows(1);
  }
  return logSheet;
}

// ==== Main Function ====

/**
 * Fetches Google Workspace invoices from Gmail, extracts data,
 * saves attachments to Drive, and logs everything to a Google Sheet.
 */
function fetchAndSaveWorkspaceInvoices() {
  var spreadsheet = null;

  try {
    validateConfig_();

    if (DEBUG) {
      listAllLabels_();
    }

    var label = withRetry_('GmailApp.getUserLabelByName', function() {
      return GmailApp.getUserLabelByName(LABEL_NAME);
    });

    if (!label) {
      log_('ERROR', 'fetchAndSaveWorkspaceInvoices', 'Label "' + LABEL_NAME + '" not found.');
      sendNotification_('Error', 'The Gmail label "' + LABEL_NAME + '" was not found. Please ensure it exists and is correctly named.');
      return;
    }

    log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Label "' + LABEL_NAME + '" found.');

    // Fetch threads with pagination to handle large mailboxes
    var allThreads = fetchAllThreads_(label);
    log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Found ' + allThreads.length + ' threads with label "' + LABEL_NAME + '".');

    if (allThreads.length === 0) {
      log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'No invoices to process.');
      return;
    }

    spreadsheet = withRetry_('SpreadsheetApp.openById', function() {
      return SpreadsheetApp.openById(SPREADSHEET_ID);
    });
    var sheet = spreadsheet.getSheetByName(SHEET_NAME);

    if (!sheet) {
      log_('ERROR', 'fetchAndSaveWorkspaceInvoices', 'Sheet "' + SHEET_NAME + '" not found.');
      sendNotification_('Error', 'The sheet "' + SHEET_NAME + '" was not found in the spreadsheet. Please ensure it exists and is correctly named.');
      return;
    }

    log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Spreadsheet and sheet "' + SHEET_NAME + '" accessed successfully.');

    var folder = withRetry_('DriveApp.getFolderById', function() {
      return DriveApp.getFolderById(FOLDER_ID);
    });
    log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Drive folder accessed successfully.');

    // Best practice: read existing data ONCE before the loop to minimize service calls
    var existingData = loadExistingData_(sheet);
    log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Loaded ' + existingData.invoiceNumbers.length + ' existing invoice records for duplicate checking.');

    // Collect new rows for batch write
    var newRows = [];
    var errors = [];
    var processedCount = 0;

    allThreads.forEach(function(thread, threadIndex) {
      if (DEBUG) {
        log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Processing thread ' + (threadIndex + 1) + '/' + allThreads.length + ': "' + thread.getFirstMessageSubject() + '"');
      }

      var messages = thread.getMessages();
      var latestMessage = messages[messages.length - 1];
      var messageDate = latestMessage.getDate();

      if (messageDate < ONE_YEAR_AGO) {
        log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Thread date ' + messageDate + ' is older than cutoff. Skipping.');
        return;
      }

      messages.forEach(function(message, messageIndex) {
        var senderEmail = extractEmailAddress_(message.getFrom());

        if (senderEmail !== SENDER_EMAIL) {
          return;
        }

        try {
          var body = message.getPlainBody();
          var messageId = message.getId();
          var invoiceNumber = extractInvoiceNumber_(body);

          if (invoiceNumber === 'N/A') {
            log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Invoice number not found in message ' + (messageIndex + 1) + '. Skipping.');
            return;
          }

          // Check duplicates against pre-loaded data AND newly collected rows
          if (isDuplicate_(existingData, newRows, invoiceNumber, messageId)) {
            log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Invoice ' + invoiceNumber + ' or Message ID ' + messageId + ' already exists. Skipping.');
            return;
          }

          var paymentsProfileId = extractPaymentsProfileId_(body);
          var service = extractService_(body);
          var amountFromBody = extractAmountFromText_(body);
          var pdfText = extractTextFromPDF_(message);
          var amountFromPDF = amountFromBody !== 0 ? 0 : extractAmountFromText_(pdfText);
          var amount = amountFromBody !== 0 ? amountFromBody : amountFromPDF;
          var currency = detectCurrency_(body) || detectCurrency_(pdfText) || DEFAULT_CURRENCY;
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
          log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Queued Invoice ' + invoiceNumber + ' (' + currency + ' ' + amount + ') for batch write.');

        } catch (msgError) {
          log_('ERROR', 'fetchAndSaveWorkspaceInvoices', 'Error processing message: ' + msgError);
          errors.push('Invoice processing error: ' + msgError);
        }
      });
    });

    // Best practice: batch write all new rows at once instead of appendRow in a loop
    if (newRows.length > 0) {
      withRetry_('sheet.setValues', function() {
        var lastRow = sheet.getLastRow();
        sheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
      });
      log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Batch wrote ' + newRows.length + ' new invoice rows to the sheet.');
    }

    log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Processing complete. ' + processedCount + ' new invoices added.');

    // Flush logs to sheet before sending notification
    flushLogs_(spreadsheet);

    // Send a single summary notification (not one per error)
    var notificationBody = 'Successfully processed ' + allThreads.length + ' invoice threads on ' + new Date() + '.\n' +
      processedCount + ' new invoices were added to the sheet.';

    if (errors.length > 0) {
      notificationBody += '\n\n' + errors.length + ' errors occurred:\n' + errors.join('\n');
    }

    sendNotification_(errors.length > 0 ? 'Completed with Errors' : 'Success', notificationBody);

  } catch (error) {
    log_('ERROR', 'fetchAndSaveWorkspaceInvoices', 'Critical error: ' + error);

    // Attempt to flush logs even on critical error
    if (spreadsheet) {
      flushLogs_(spreadsheet);
    }

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

  // Only validate Vision config when it is enabled
  if (ENABLE_VISION_OCR) {
    placeholders.CLOUD_PROJECT_NUMBER = CLOUD_PROJECT_NUMBER;
  }

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
    var batch = withRetry_('label.getThreads', function() {
      return label.getThreads(start, THREAD_BATCH_SIZE);
    });
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
  var data = withRetry_('sheet.getValues', function() {
    return sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  });
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

/**
 * Detects currency from text by looking for ISO codes and currency symbols.
 * Checks for: (1) "Total in XXX" pattern, (2) ISO currency codes, (3) currency symbols.
 * @param {string} text - The text to scan (email body or PDF text).
 * @return {string|null} ISO 4217 currency code, or null if not detected.
 */
function detectCurrency_(text) {
  if (!text) return null;

  // Priority 1: "Total in XXX" pattern (strongest signal for Google invoices)
  var totalInMatch = text.match(/Total\s+in\s+([A-Z]{3})/i);
  if (totalInMatch && totalInMatch[1]) {
    return totalInMatch[1].toUpperCase();
  }

  // Priority 2: Explicit ISO currency code near amount keywords
  var codeNearAmount = text.match(/(?:Amount|Total|Balance|Due|Price)\s*[:\-]?\s*([A-Z]{3})\s*[\d,]/i);
  if (codeNearAmount && codeNearAmount[1]) {
    var code = codeNearAmount[1].toUpperCase();
    if (CURRENCY_CODE_PATTERN.test(code)) {
      return code;
    }
  }

  // Priority 3: Any standalone ISO currency code in the text
  var isoMatch = text.match(CURRENCY_CODE_PATTERN);
  if (isoMatch && isoMatch[1]) {
    return isoMatch[1].toUpperCase();
  }

  // Priority 4: Currency symbols
  for (var symbol in CURRENCY_SYMBOLS) {
    if (text.indexOf(symbol) !== -1) {
      return CURRENCY_SYMBOLS[symbol];
    }
  }

  return null;
}

// ==== Vision OCR (Optional) ====
// These two functions are the entire Vision integration.
// They are only called when ENABLE_VISION_OCR = true in the config above.
// Set ENABLE_VISION_OCR = false to bypass them completely with zero side effects.

/**
 * Returns true if the Drive-extracted text is too short to trust,
 * indicating the PDF is likely a scanned image that needs Vision OCR.
 * @param {string} text - Text extracted by Drive PDF conversion.
 * @return {boolean} True if Vision OCR fallback should be attempted.
 */
function isScannedPDF_(text) {
  return !text || text.trim().length < OCR_MIN_TEXT_LENGTH;
}

/**
 * Calls Cloud Vision API DOCUMENT_TEXT_DETECTION on a PDF blob.
 * Sends the PDF as inline base64 — no GCS bucket or service account required.
 * Handles up to 5 pages per PDF (Vision inline limit). Synchronous.
 * @param {Blob} pdfBlob - The PDF blob to OCR.
 * @return {string} Extracted text from all pages, or empty string on any failure.
 */
function extractTextViaVision_(pdfBlob) {
  try {
    var b64 = Utilities.base64Encode(pdfBlob.getBytes());
    var requestBody = {
      requests: [{
        inputConfig: { content: b64, mimeType: 'application/pdf' },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
      }]
    };

    var response = UrlFetchApp.fetch('https://vision.googleapis.com/v1/files:annotate', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      log_('WARN', 'extractTextViaVision_',
        'Vision API HTTP ' + response.getResponseCode() + ': ' + response.getContentText());
      return '';
    }

    var result = JSON.parse(response.getContentText());
    var pages = result.responses && result.responses[0] && result.responses[0].responses;
    if (!pages) return '';

    // Concatenate fullTextAnnotation.text from each page
    return pages.map(function(page) {
      return page.fullTextAnnotation ? page.fullTextAnnotation.text : '';
    }).join('\n').trim();

  } catch (visionError) {
    log_('ERROR', 'extractTextViaVision_', 'Vision OCR failed: ' + visionError);
    return '';
  }
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
      var file = withRetry_('folder.createFile', function() {
        return folder.createFile(attachment);
      });
      receiptLinks.push(file.getUrl());
      log_('INFO', 'saveAttachmentsToDrive_', 'Saved attachment: ' + attachment.getName());
    } else {
      log_('INFO', 'saveAttachmentsToDrive_', 'Skipped unsupported attachment: ' + attachment.getName() + ' (' + mimeType + ')');
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

    // Per-attachment text, captured separately so Vision fallback can compare lengths
    var attachmentText = '';

    try {
      var tempFile = tempFolder.createFile(attachment);

      var resource = {
        title: attachment.getName(),
        mimeType: MimeType.GOOGLE_DOCS
      };

      var docFile = withRetry_('Drive.Files.create', function() {
        return Drive.Files.create(resource, tempFile.getBlob(), { convert: true });
      });
      var doc = withRetry_('DocumentApp.openById', function() {
        return DocumentApp.openById(docFile.id);
      });
      attachmentText = doc.getBody().getText();

      // Clean up temporary files
      tempFile.setTrashed(true);
      DriveApp.getFileById(docFile.id).setTrashed(true);
    } catch (pdfError) {
      log_('ERROR', 'extractTextFromPDF_', 'Drive conversion error: ' + pdfError);
    }

    // Vision OCR fallback — only runs when ENABLE_VISION_OCR = true
    // and Drive conversion returned suspiciously little text (scanned PDF signal)
    if (ENABLE_VISION_OCR && isScannedPDF_(attachmentText)) {
      log_('INFO', 'extractTextFromPDF_',
        'Drive returned ' + attachmentText.trim().length + ' chars for "' +
        attachment.getName() + '". Trying Vision OCR.');
      var visionText = extractTextViaVision_(attachment.copyBlob());
      if (visionText && visionText.trim().length > attachmentText.trim().length) {
        attachmentText = visionText;
        log_('INFO', 'extractTextFromPDF_',
          'Vision OCR extracted ' + visionText.trim().length + ' chars from "' + attachment.getName() + '".');
      }
    }

    extractedText += attachmentText + '\n';
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
  log_('INFO', 'listAllLabels_', 'Listing all Gmail labels:');
  labels.forEach(function(label) {
    log_('INFO', 'listAllLabels_', '- ' + label.getName());
  });
}
