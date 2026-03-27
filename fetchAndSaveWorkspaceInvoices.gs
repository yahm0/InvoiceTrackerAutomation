// ==== Configuration (defaults — override via Script Properties for production) ====

// To override any constant below, open Script Editor > Project Settings > Script Properties
// and add a property with the EXACT constant name (e.g. key: SPREADSHEET_ID, value: abc123).
// Script Properties take precedence; these values are only used as fallbacks.

const SPREADSHEET_ID = getConfig_('SPREADSHEET_ID', 'YOUR_SPREADSHEET_ID_HERE');
const SHEET_NAME = getConfig_('SHEET_NAME', 'Workspace Invoices Tracker');
const LABEL_NAME = getConfig_('LABEL_NAME', 'Workspace Invoices');
const FOLDER_ID = getConfig_('FOLDER_ID', 'YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE');
// Allowed sender email addresses. Add any invoice senders you want to process.
// Leave empty [] to accept invoices from ANY sender that has the Gmail label applied.
// In Script Properties, store as comma-separated: "a@b.com,c@d.com"
const SENDER_EMAILS = getConfigArray_('SENDER_EMAILS', ['payments-noreply@google.com']);
const RECIPIENT_EMAIL = getConfig_('RECIPIENT_EMAIL', 'YOUR_EMAIL_ADDRESS_HERE');

// Date range: only process emails from the last year
const ONE_YEAR_AGO = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

// Debug mode: set to true to enable verbose logging and label listing
const DEBUG = getConfig_('DEBUG', 'false') === 'true';

// Maximum threads per batch (Gmail API limit is 500)
const THREAD_BATCH_SIZE = 100;

// Maximum retry attempts for transient API errors
const MAX_RETRIES = 3;

// Execution time guard — stop processing before Apps Script kills us (6 min limit)
// Leave 30s buffer for batch write + log flush + notification
const MAX_EXECUTION_MS = 5.5 * 60 * 1000;

// ==== Vision OCR Configuration (Optional) ====
const ENABLE_VISION_OCR = getConfig_('ENABLE_VISION_OCR', 'false') === 'true';
const OCR_MIN_TEXT_LENGTH = 50;
const CLOUD_PROJECT_NUMBER = getConfig_('CLOUD_PROJECT_NUMBER', 'YOUR_CLOUD_PROJECT_NUMBER_HERE');

// Logging configuration
const LOG_SHEET_NAME = 'Logs';
const MAX_LOG_ENTRIES = 1000;

// Default currency fallback when auto-detection fails
const DEFAULT_CURRENCY = 'USD';

// Whether to send email on successful runs with 0 errors
const NOTIFY_ON_SUCCESS = getConfig_('NOTIFY_ON_SUCCESS', 'true') === 'true';

// ==== Column Index Management ====
// Single source of truth for sheet column positions (0-based).
// Update these if you add/remove/reorder columns.
var COLUMNS = {
  INVOICE_NUMBER: 0,
  DATE: 1,
  VENDOR_REF: 2,
  SERVICE: 3,
  AMOUNT: 4,
  CURRENCY: 5,
  DESCRIPTION: 6,
  RECEIPT_LINK: 7,
  PDF_TEXT: 8,
  MESSAGE_ID: 9
};

var COLUMN_HEADERS = [
  'Invoice Number', 'Date', 'Vendor Ref', 'Service',
  'Amount', 'Currency', 'Description', 'Receipt Link',
  'PDF Text', 'Message ID'
];

var COLUMN_COUNT = COLUMN_HEADERS.length;

// Currency symbol to ISO 4217 code mapping
var CURRENCY_SYMBOLS = {
  '$': 'USD',
  '\u20AC': 'EUR',
  '\u00A3': 'GBP',
  '\u00A5': 'JPY',
  '\u20B9': 'INR'
};

// ISO 4217 currency code detection pattern
var CURRENCY_CODE_PATTERN = /\b(USD|EUR|GBP|JPY|CAD|AUD|INR|CHF|NZD|SEK|NOK|DKK|BRL|MXN|KRW|SGD|HKD)\b/i;

// Supported attachment MIME types
var SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

// Invoice number extraction patterns (tried in order — first match wins)
var INVOICE_NUMBER_PATTERNS = [
  /Invoice\s*number\s*[:\-]?\s*([\w\-]+)/i,
  /Invoice\s*#\s*([\w\-]+)/i,
  /Invoice\s*ID\s*[:\-]?\s*([\w\-]+)/i,
  /Invoice\s*No\.?\s*[:\-]?\s*([\w\-]+)/i,
  /Inv[.\s#\-]+([\w\-]+)/i,
  /Bill\s*(?:number|#|No\.?)\s*[:\-]?\s*([\w\-]+)/i,
  /Reference\s*(?:number|#|No\.?)\s*[:\-]?\s*([\w\-]+)/i
];

// Amount extraction regex patterns (currency-agnostic)
// Standard format: 1,234.56 or 1234.56
var AMOUNT_PATTERNS_STANDARD = [
  /Total\s+in\s+\w{3}[\s\S]*?[$\u20AC\u00A3\u00A5\u20B9]?\s*([\d,]+\.\d{1,2})/i,
  /Amount\s*[:\-]?\s*[$\u20AC\u00A3\u00A5\u20B9]?\s*([\d,]+\.\d{1,2})/i,
  /Total\s*[:\-]?\s*[$\u20AC\u00A3\u00A5\u20B9]?\s*([\d,]+\.\d{1,2})/i,
  /Amount\s*Due\s*[:\-]?\s*\w{0,3}\s*([\d,]+\.\d{1,2})/i,
  /Balance\s*[:\-]?\s*[$\u20AC\u00A3\u00A5\u20B9]?\s*([\d,]+\.\d{1,2})/i,
  /Grand\s*Total\s*[:\-]?\s*[$\u20AC\u00A3\u00A5\u20B9]?\s*([\d,]+\.\d{1,2})/i
];

// European format: 1.234,56
var AMOUNT_PATTERNS_EUROPEAN = [
  /Total\s*[:\-]?\s*[$\u20AC\u00A3\u00A5\u20B9]?\s*([\d.]+,\d{2})/i,
  /Amount\s*[:\-]?\s*[$\u20AC\u00A3\u00A5\u20B9]?\s*([\d.]+,\d{2})/i,
  /Balance\s*[:\-]?\s*[$\u20AC\u00A3\u00A5\u20B9]?\s*([\d.]+,\d{2})/i
];

// Whole number amounts (no decimals): $1,234 or $1234
var AMOUNT_PATTERNS_WHOLE = [
  /Total\s*[:\-]?\s*[$\u20AC\u00A3\u00A5\u20B9]\s*([\d,]+)(?!\.\d)/i,
  /Amount\s*[:\-]?\s*[$\u20AC\u00A3\u00A5\u20B9]\s*([\d,]+)(?!\.\d)/i
];

// Script-scoped log buffer (flushed to Logs sheet at end of run)
var logBuffer_ = [];

// Execution start time for time-guard
var executionStartTime_ = Date.now();

// ==== Configuration Helpers ====

/**
 * Reads a configuration value from Script Properties, falling back to a default.
 * @param {string} key - The property key.
 * @param {string} defaultValue - Fallback value if property is not set.
 * @return {string} The configuration value.
 */
function getConfig_(key, defaultValue) {
  try {
    var value = PropertiesService.getScriptProperties().getProperty(key);
    return (value !== null && value !== '') ? value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

/**
 * Reads a comma-separated array configuration from Script Properties.
 * @param {string} key - The property key.
 * @param {string[]} defaultValue - Fallback array.
 * @return {string[]} The configuration array.
 */
function getConfigArray_(key, defaultValue) {
  try {
    var value = PropertiesService.getScriptProperties().getProperty(key);
    if (value !== null && value !== '') {
      return value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    }
    return defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

// ==== Retry Logic ====

/**
 * Executes a function with exponential backoff retry for transient errors.
 * @param {string} operationName - Name for logging.
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

// ==== Execution Time Guard ====

/**
 * Returns true if we are approaching the Apps Script execution time limit.
 * Leaves a buffer for batch write, log flush, and notification.
 * @return {boolean} True if execution should stop.
 */
function isApproachingTimeLimit_() {
  return (Date.now() - executionStartTime_) >= MAX_EXECUTION_MS;
}

/**
 * Saves a checkpoint so the next run can resume where we left off.
 * @param {string} lastProcessedMessageId - The last successfully processed Gmail message ID.
 * @param {number} threadIndex - The thread index we stopped at.
 */
function saveCheckpoint_(lastProcessedMessageId, threadIndex) {
  var props = PropertiesService.getScriptProperties();
  props.setProperties({
    'CHECKPOINT_MESSAGE_ID': lastProcessedMessageId || '',
    'CHECKPOINT_THREAD_INDEX': String(threadIndex),
    'CHECKPOINT_TIMESTAMP': new Date().toISOString()
  });
  log_('INFO', 'saveCheckpoint_', 'Checkpoint saved at thread ' + threadIndex + ', message ' + lastProcessedMessageId);
}

/**
 * Loads checkpoint from a previous interrupted run.
 * @return {{messageId: string, threadIndex: number, timestamp: string}|null} Checkpoint data or null.
 */
function loadCheckpoint_() {
  var props = PropertiesService.getScriptProperties();
  var msgId = props.getProperty('CHECKPOINT_MESSAGE_ID');
  var threadIdx = props.getProperty('CHECKPOINT_THREAD_INDEX');
  if (msgId === null && threadIdx === null) return null;
  return {
    messageId: msgId || '',
    threadIndex: parseInt(threadIdx || '0', 10),
    timestamp: props.getProperty('CHECKPOINT_TIMESTAMP') || ''
  };
}

/**
 * Clears checkpoint data after a successful full run.
 */
function clearCheckpoint_() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('CHECKPOINT_MESSAGE_ID');
  props.deleteProperty('CHECKPOINT_THREAD_INDEX');
  props.deleteProperty('CHECKPOINT_TIMESTAMP');
}

// ==== Logging ====

/**
 * Logs a message to the in-memory buffer and Logger.log.
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

// ==== Sheet Initialization ====

/**
 * Gets or creates the main invoice tracking sheet with headers.
 * @param {Spreadsheet} spreadsheet - The Google Spreadsheet object.
 * @return {Sheet} The main tracking sheet.
 */
function getOrCreateMainSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.appendRow(COLUMN_HEADERS);
    sheet.setFrozenRows(1);
    log_('INFO', 'getOrCreateMainSheet_', 'Created sheet "' + SHEET_NAME + '" with headers.');
  }
  return sheet;
}

// ==== Main Function ====

/**
 * Fetches invoice emails from Gmail, extracts data,
 * saves attachments to Drive, and logs everything to a Google Sheet.
 * Supports incremental processing and checkpointed resumption.
 */
function fetchAndSaveWorkspaceInvoices() {
  executionStartTime_ = Date.now();
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
      sendNotification_('Error', 'The Gmail label "' + LABEL_NAME + '" was not found.');
      return;
    }

    log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Label "' + LABEL_NAME + '" found.');

    var allThreads = fetchAllThreads_(label);
    log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Found ' + allThreads.length + ' threads with label "' + LABEL_NAME + '".');

    if (allThreads.length === 0) {
      log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'No invoices to process.');
      clearCheckpoint_();
      return;
    }

    spreadsheet = withRetry_('SpreadsheetApp.openById', function() {
      return SpreadsheetApp.openById(SPREADSHEET_ID);
    });
    var sheet = getOrCreateMainSheet_(spreadsheet);

    log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Spreadsheet and sheet "' + SHEET_NAME + '" accessed successfully.');

    var folder = withRetry_('DriveApp.getFolderById', function() {
      return DriveApp.getFolderById(FOLDER_ID);
    });
    log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Drive folder accessed successfully.');

    var existingData = loadExistingData_(sheet);
    log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Loaded ' + existingData.invoiceNumbers.size + ' existing invoice records for duplicate checking.');

    // Load checkpoint for resumption after a previous timeout
    var checkpoint = loadCheckpoint_();
    var startThreadIndex = 0;
    if (checkpoint) {
      startThreadIndex = checkpoint.threadIndex;
      log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Resuming from checkpoint at thread ' + startThreadIndex + ' (saved ' + checkpoint.timestamp + ').');
    }

    var newRows = [];
    var errors = [];
    var processedCount = 0;
    var timedOut = false;
    var lastProcessedMessageId = '';

    for (var threadIndex = startThreadIndex; threadIndex < allThreads.length; threadIndex++) {
      // Execution time guard
      if (isApproachingTimeLimit_()) {
        log_('WARN', 'fetchAndSaveWorkspaceInvoices', 'Approaching execution time limit. Saving checkpoint at thread ' + threadIndex + '.');
        saveCheckpoint_(lastProcessedMessageId, threadIndex);
        timedOut = true;
        break;
      }

      var thread = allThreads[threadIndex];

      if (DEBUG) {
        log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Processing thread ' + (threadIndex + 1) + '/' + allThreads.length + ': "' + thread.getFirstMessageSubject() + '"');
      }

      var messages = thread.getMessages();

      for (var messageIndex = 0; messageIndex < messages.length; messageIndex++) {
        var message = messages[messageIndex];
        var messageDate = message.getDate();

        // Per-message date filtering (not just thread-level)
        if (messageDate < ONE_YEAR_AGO) {
          if (DEBUG) {
            log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Message date ' + messageDate + ' is older than cutoff. Skipping.');
          }
          continue;
        }

        var senderEmail = extractEmailAddress_(message.getFrom());

        if (SENDER_EMAILS.length > 0 && SENDER_EMAILS.indexOf(senderEmail) === -1) {
          continue;
        }

        try {
          var body = message.getPlainBody();
          var messageId = message.getId();
          var invoiceNumber = extractInvoiceNumber_(body);

          if (invoiceNumber === 'N/A') {
            log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Invoice number not found in message ' + (messageIndex + 1) + '. Skipping.');
            continue;
          }

          // Check duplicates against pre-loaded data AND newly collected rows
          if (isDuplicate_(existingData, newRows, invoiceNumber, messageId)) {
            log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Invoice ' + invoiceNumber + ' or Message ID ' + messageId + ' already exists. Skipping.');
            continue;
          }

          var vendorRef = extractVendorRef_(body);
          var service = extractService_(body);
          var amountFromBody = extractAmountFromText_(body);
          var pdfText = extractTextFromPDF_(message, folder);
          var amountFromPDF = amountFromBody !== 0 ? 0 : extractAmountFromText_(pdfText);
          var amount = amountFromBody !== 0 ? amountFromBody : amountFromPDF;
          var currency = detectCurrency_(body) || detectCurrency_(pdfText) || DEFAULT_CURRENCY;
          var description = extractDescription_(body);

          var receiptLink = saveAttachmentsToDrive_(message, folder);

          var row = buildRow_(invoiceNumber, message.getDate(), vendorRef, service,
            amount, currency, description, receiptLink, pdfText, messageId);

          newRows.push(row);
          processedCount++;
          lastProcessedMessageId = messageId;
          log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Queued Invoice ' + invoiceNumber + ' (' + currency + ' ' + amount + ') for batch write.');

        } catch (msgError) {
          log_('ERROR', 'fetchAndSaveWorkspaceInvoices', 'Error processing message: ' + msgError);
          errors.push('Invoice processing error: ' + msgError);
        }
      }
    }

    // Batch write all new rows
    if (newRows.length > 0) {
      withRetry_('sheet.setValues', function() {
        var lastRow = sheet.getLastRow();
        sheet.getRange(lastRow + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
      });
      log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Batch wrote ' + newRows.length + ' new invoice rows to the sheet.');
    }

    // Clear checkpoint only if we finished all threads
    if (!timedOut) {
      clearCheckpoint_();
    }

    log_('INFO', 'fetchAndSaveWorkspaceInvoices', 'Processing complete. ' + processedCount + ' new invoices added.' + (timedOut ? ' (partial — will resume next run)' : ''));

    flushLogs_(spreadsheet);

    // Build notification
    var notificationBody = 'Processed ' + allThreads.length + ' invoice threads on ' + new Date() + '.\n' +
      processedCount + ' new invoices were added to the sheet.';

    if (timedOut) {
      notificationBody += '\n\nNote: Execution time limit approached. Processing will resume on the next trigger run.';
    }

    if (errors.length > 0) {
      notificationBody += '\n\n' + errors.length + ' errors occurred:\n' + errors.join('\n');
    }

    var hasErrors = errors.length > 0;
    var notificationType = timedOut ? 'Partial Run' : (hasErrors ? 'Completed with Errors' : 'Success');

    // Only send success notifications if configured to do so
    if (hasErrors || timedOut || NOTIFY_ON_SUCCESS) {
      sendNotification_(notificationType, notificationBody);
    }

  } catch (error) {
    log_('ERROR', 'fetchAndSaveWorkspaceInvoices', 'Critical error: ' + error);

    if (spreadsheet) {
      flushLogs_(spreadsheet);
    }

    sendNotification_('Critical Error', 'A critical error occurred:\n\n' + error);
  }
}

// ==== Row Builder ====

/**
 * Builds a sheet row array using the COLUMNS mapping.
 * Single source of truth for column ordering.
 * @return {Array} A row array matching the sheet column layout.
 */
function buildRow_(invoiceNumber, date, vendorRef, service, amount, currency, description, receiptLink, pdfText, messageId) {
  var row = new Array(COLUMN_COUNT);
  row[COLUMNS.INVOICE_NUMBER] = invoiceNumber;
  row[COLUMNS.DATE] = date;
  row[COLUMNS.VENDOR_REF] = vendorRef;
  row[COLUMNS.SERVICE] = service;
  row[COLUMNS.AMOUNT] = amount;
  row[COLUMNS.CURRENCY] = currency;
  row[COLUMNS.DESCRIPTION] = description;
  row[COLUMNS.RECEIPT_LINK] = receiptLink;
  row[COLUMNS.PDF_TEXT] = pdfText;
  row[COLUMNS.MESSAGE_ID] = messageId;
  return row;
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

  if (ENABLE_VISION_OCR) {
    placeholders.CLOUD_PROJECT_NUMBER = CLOUD_PROJECT_NUMBER;
  }

  var missing = [];
  for (var key in placeholders) {
    if (String(placeholders[key]).indexOf('YOUR_') === 0) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error('Configuration incomplete. Please set: ' + missing.join(', '));
  }
}

/**
 * Fetches all threads for a label with pagination.
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
 * Loads existing invoice numbers and message IDs from the sheet using Set for O(1) lookups.
 * Only reads the two columns needed (invoice number and message ID).
 * @param {Sheet} sheet - The Google Sheet to read from.
 * @return {{invoiceNumbers: Set, messageIds: Set}} Existing data for duplicate checking.
 */
function loadExistingData_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { invoiceNumbers: new Set(), messageIds: new Set() };
  }

  var numRows = lastRow - 1;

  // Read only the two columns we need: invoice number (col 1) and message ID (col 10)
  var invoiceCol = withRetry_('sheet.getValues(invoiceNumbers)', function() {
    return sheet.getRange(2, COLUMNS.INVOICE_NUMBER + 1, numRows, 1).getValues();
  });
  var messageIdCol = withRetry_('sheet.getValues(messageIds)', function() {
    return sheet.getRange(2, COLUMNS.MESSAGE_ID + 1, numRows, 1).getValues();
  });

  var invoiceNumbers = new Set();
  var messageIds = new Set();

  for (var i = 0; i < numRows; i++) {
    if (invoiceCol[i][0]) invoiceNumbers.add(String(invoiceCol[i][0]));
    if (messageIdCol[i][0]) messageIds.add(String(messageIdCol[i][0]));
  }

  return { invoiceNumbers: invoiceNumbers, messageIds: messageIds };
}

/**
 * Checks if an invoice number or message ID already exists.
 * Uses Set.has() for O(1) lookups against existing sheet data,
 * and linear scan for the (typically small) in-memory newRows buffer.
 * @param {{invoiceNumbers: Set, messageIds: Set}} existingData - Pre-loaded sheet data.
 * @param {Array[]} newRows - Rows collected in this run but not yet written.
 * @param {string} invoiceNumber - Invoice number to check.
 * @param {string} messageId - Message ID to check.
 * @return {boolean} True if duplicate found.
 */
function isDuplicate_(existingData, newRows, invoiceNumber, messageId) {
  if (existingData.invoiceNumbers.has(String(invoiceNumber)) ||
      existingData.messageIds.has(String(messageId))) {
    return true;
  }

  for (var i = 0; i < newRows.length; i++) {
    if (newRows[i][COLUMNS.INVOICE_NUMBER] === invoiceNumber ||
        newRows[i][COLUMNS.MESSAGE_ID] === messageId) {
      return true;
    }
  }

  return false;
}

/**
 * Sends an email notification with a standardized subject prefix.
 * @param {string} type - Notification type (e.g., 'Error', 'Success').
 * @param {string} body - The email body text.
 */
function sendNotification_(type, body) {
  try {
    MailApp.sendEmail({
      to: RECIPIENT_EMAIL,
      subject: 'Invoice Tracker Automation - ' + type,
      body: body
    });
  } catch (mailError) {
    Logger.log('ERROR [sendNotification_] Failed to send notification: ' + mailError);
  }
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
 * Extracts invoice number from email body text using multiple patterns.
 * Tries patterns in priority order — first match wins.
 * @param {string} body - The email body text.
 * @return {string} The invoice number or 'N/A' if not found.
 */
function extractInvoiceNumber_(body) {
  if (!body) return 'N/A';

  for (var i = 0; i < INVOICE_NUMBER_PATTERNS.length; i++) {
    var match = body.match(INVOICE_NUMBER_PATTERNS[i]);
    if (match && match[1]) return match[1];
  }
  return 'N/A';
}

/**
 * Extracts a vendor reference ID from email body text.
 * @param {string} body - The email body text.
 * @return {string} The vendor reference ID or 'N/A' if not found.
 */
function extractVendorRef_(body) {
  var patterns = [
    /Payments\s*profile\s*ID\s*[:\-]?\s*([\d\-]+)/i,
    /Account\s*(?:ID|number|#)\s*[:\-]?\s*([\w\-]+)/i,
    /Customer\s*(?:ID|number|#)\s*[:\-]?\s*([\w\-]+)/i,
    /Billing\s*(?:ID|reference)\s*[:\-]?\s*([\w\-]+)/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var match = body.match(patterns[i]);
    if (match && match[1]) return match[1];
  }
  return 'N/A';
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
 * Supports standard (1,234.56), European (1.234,56), and whole-number formats.
 * @param {string} text - The text to search for amounts.
 * @return {number} The extracted amount or 0 if not found.
 */
function extractAmountFromText_(text) {
  if (!text) return 0;

  // Try standard format first (most common)
  for (var i = 0; i < AMOUNT_PATTERNS_STANDARD.length; i++) {
    var match = text.match(AMOUNT_PATTERNS_STANDARD[i]);
    if (match && match[1]) {
      return parseFloat(match[1].replace(/,/g, ''));
    }
  }

  // Try European format (1.234,56)
  for (var j = 0; j < AMOUNT_PATTERNS_EUROPEAN.length; j++) {
    var euroMatch = text.match(AMOUNT_PATTERNS_EUROPEAN[j]);
    if (euroMatch && euroMatch[1]) {
      return parseFloat(euroMatch[1].replace(/\./g, '').replace(',', '.'));
    }
  }

  // Try whole number format ($1,234 without decimals)
  for (var k = 0; k < AMOUNT_PATTERNS_WHOLE.length; k++) {
    var wholeMatch = text.match(AMOUNT_PATTERNS_WHOLE[k]);
    if (wholeMatch && wholeMatch[1]) {
      return parseFloat(wholeMatch[1].replace(/,/g, ''));
    }
  }

  return 0;
}

/**
 * Extracts description from email body text (capped at 500 chars).
 * @param {string} body - The email body text.
 * @return {string} The description or empty string if not found.
 */
function extractDescription_(body) {
  var match = body.match(/Description\s*[:\-]?\s*(.*)/i);
  if (match && match[1]) {
    var desc = match[1].trim();
    return desc.length > 500 ? desc.substring(0, 500) : desc;
  }
  return '';
}

/**
 * Detects currency from text by looking for ISO codes and currency symbols.
 * Includes disambiguation for $ symbol (checks for CA$, AU$, NZ$ prefixes).
 * @param {string} text - The text to scan.
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

  // Priority 4: Disambiguated currency symbols
  // Check for prefixed dollar signs first (CA$, AU$, NZ$, HK$, SG$)
  if (/CA\$/i.test(text)) return 'CAD';
  if (/AU\$/i.test(text)) return 'AUD';
  if (/NZ\$/i.test(text)) return 'NZD';
  if (/HK\$/i.test(text)) return 'HKD';
  if (/SG\$/i.test(text)) return 'SGD';

  // Check for "Canadian Dollar", "Australian Dollar" etc. near a $ sign
  if (/Canadian/i.test(text) && text.indexOf('$') !== -1) return 'CAD';
  if (/Australian/i.test(text) && text.indexOf('$') !== -1) return 'AUD';

  // Fall back to generic symbol matching
  for (var symbol in CURRENCY_SYMBOLS) {
    if (text.indexOf(symbol) !== -1) {
      return CURRENCY_SYMBOLS[symbol];
    }
  }

  return null;
}

// ==== Vision OCR (Optional) ====

/**
 * Returns true if the Drive-extracted text is too short to trust.
 * @param {string} text - Text extracted by Drive PDF conversion.
 * @return {boolean} True if Vision OCR fallback should be attempted.
 */
function isScannedPDF_(text) {
  return !text || text.trim().length < OCR_MIN_TEXT_LENGTH;
}

/**
 * Calls Cloud Vision API DOCUMENT_TEXT_DETECTION on a PDF blob.
 * @param {Blob} pdfBlob - The PDF blob to OCR.
 * @return {string} Extracted text from all pages, or empty string on failure.
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
 * Checks for existing files by name to prevent duplicates on re-runs.
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
      var fileName = attachment.getName();

      // Check if file already exists in folder to prevent duplicates on re-run
      var existing = folder.getFilesByName(fileName);
      if (existing.hasNext()) {
        var existingFile = existing.next();
        receiptLinks.push(existingFile.getUrl());
        log_('INFO', 'saveAttachmentsToDrive_', 'File already exists, skipping upload: ' + fileName);
        return;
      }

      var file = withRetry_('folder.createFile', function() {
        return folder.createFile(attachment);
      });
      receiptLinks.push(file.getUrl());
      log_('INFO', 'saveAttachmentsToDrive_', 'Saved attachment: ' + fileName);
    } else {
      log_('INFO', 'saveAttachmentsToDrive_', 'Skipped unsupported attachment: ' + attachment.getName() + ' (' + mimeType + ')');
    }
  });

  return receiptLinks.join(', ');
}

/**
 * Extracts text from PDF attachments by converting them to Google Docs via Drive API.
 * Creates a temporary folder under the configured Drive folder, converts PDFs,
 * extracts text, then cleans up. Uses finally blocks to ensure cleanup on error.
 * @param {GmailMessage} message - The Gmail message with PDF attachments.
 * @param {Folder} parentFolder - The parent Drive folder for temp storage.
 * @return {string} Extracted text from all PDF attachments.
 */
function extractTextFromPDF_(message, parentFolder) {
  var attachments = message.getAttachments();
  if (attachments.length === 0) return '';

  var extractedText = '';
  var tempFolder = getOrCreateTempFolder_(parentFolder);

  attachments.forEach(function(attachment) {
    if (attachment.getContentType() !== 'application/pdf') return;

    var attachmentText = '';
    var tempFile = null;
    var docFileId = null;

    try {
      tempFile = tempFolder.createFile(attachment);

      var resource = {
        title: attachment.getName(),
        mimeType: MimeType.GOOGLE_DOCS
      };

      var docFile = withRetry_('Drive.Files.create', function() {
        return Drive.Files.create(resource, tempFile.getBlob(), { convert: true });
      });
      docFileId = docFile.id;

      var doc = withRetry_('DocumentApp.openById', function() {
        return DocumentApp.openById(docFile.id);
      });
      attachmentText = doc.getBody().getText();
    } catch (pdfError) {
      log_('ERROR', 'extractTextFromPDF_', 'Drive conversion error: ' + pdfError);
    } finally {
      // Always clean up temp files, even on error
      try {
        if (tempFile) tempFile.setTrashed(true);
      } catch (cleanupError) {
        log_('WARN', 'extractTextFromPDF_', 'Failed to trash temp file: ' + cleanupError);
      }
      try {
        if (docFileId) DriveApp.getFileById(docFileId).setTrashed(true);
      } catch (cleanupError) {
        log_('WARN', 'extractTextFromPDF_', 'Failed to trash doc file: ' + cleanupError);
      }
    }

    // Vision OCR fallback
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
 * Gets or creates the temporary PDF folder under the specified parent folder.
 * Uses the parent folder to avoid global Drive searches.
 * @param {Folder} parentFolder - The parent Drive folder.
 * @return {Folder} The temporary folder for PDF processing.
 */
function getOrCreateTempFolder_(parentFolder) {
  var existingFolders = parentFolder.getFoldersByName('TempPDF');
  if (existingFolders.hasNext()) {
    return existingFolders.next();
  }
  return parentFolder.createFolder('TempPDF');
}

// ==== Trigger Management ====

/**
 * Installs a time-driven trigger to run the invoice processor on a schedule.
 * Run this function once manually to set up automated processing.
 * Default: every 6 hours. Adjust as needed.
 */
function installTrigger() {
  // Remove existing triggers for this function first to avoid duplicates
  removeTrigger();

  ScriptApp.newTrigger('fetchAndSaveWorkspaceInvoices')
    .timeBased()
    .everyHours(6)
    .create();

  Logger.log('Trigger installed: fetchAndSaveWorkspaceInvoices will run every 6 hours.');
}

/**
 * Removes all triggers for fetchAndSaveWorkspaceInvoices.
 * Run this to stop automated processing.
 */
function removeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'fetchAndSaveWorkspaceInvoices') {
      ScriptApp.deleteTrigger(triggers[i]);
      Logger.log('Removed existing trigger for fetchAndSaveWorkspaceInvoices.');
    }
  }
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

/**
 * Public wrapper for listing labels (runnable from Script Editor).
 */
function listAllLabels() {
  listAllLabels_();
}
