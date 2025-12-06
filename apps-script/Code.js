/*
 * 8793PartBot – Automated Parts Management System
 * Copyright (c) 2025 FRC Team 8793 – Pumpkin Bots
 *
 * Licensed under the MIT License with Use Notification Requirement.
 * Full license text available in the project root LICENSE file.
 *
 * Use Notification Requirement:
 * Any team or individual who uses, copies, modifies, or distributes this
 * software must make a reasonable effort to notify FRC Team 8793 – Pumpkin
 * Bots. Notification may be sent via email (pumpkinbots@hmbrobotics.org) 
 * or by opening an issue or discussion on the project's GitHub repository. 
 * This requirement is intended to foster collaboration and does not restrict 
 * the permitted uses granted under this license.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to use, copy, modify, merge, publish, and distribute the Software without
 * restriction, subject to the conditions above.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

/*
 * Code.js (Apps Script) - Modifications to use shared-constants.js
 * 
 * INSTALLATION:
 * 1. Copy the contents of shared-constants.js
 * 2. In your Apps Script project, create a new script file called "SharedConstants"
 * 3. Paste the shared-constants.js content into SharedConstants.gs
 * 4. Apply these modifications to Code.js
 * 
 * NOTE: Apps Script automatically makes all top-level functions and variables
 * in one file available to other files in the same project.
 */

// ============================================
// NO IMPORTS NEEDED IN APPS SCRIPT
// All constants from SharedConstants.gs are automatically available
// ============================================

// ============================================
// UPDATE doPost TO USE CONSTANTS AND VALIDATION
// ============================================

function doPost(e) {
  let traceId = null;
  
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_(
        createErrorResponse(
          ERROR_CODES.MISSING_PARAMETER,
          'No post data provided',
          false
        )
      );
    }

    const raw = e.postData.contents;
    Logger.log('[doPost] Raw body: ' + raw);

    const body = JSON.parse(raw);
    
    // Generate trace ID for request tracking
    traceId = body[REQUEST_FIELDS.TRACE_ID] || generateTraceId_();
    Logger.log(`[${traceId}] Processing action: ${body[REQUEST_FIELDS.ACTION]}`);

    const action = body[REQUEST_FIELDS.ACTION];

    // Route to appropriate handler using constants
    switch (action) {
      case API_ACTIONS.HEALTH:
        return handleHealth_(traceId);
        
      case API_ACTIONS.INVENTORY:
        Logger.log(`[${traceId}] Inventory action, sku="${body[REQUEST_FIELDS.SKU] || ''}" search="${body[REQUEST_FIELDS.SEARCH] || ''}"`);
        return handleInventoryLookup_({
          [REQUEST_FIELDS.SKU]: body[REQUEST_FIELDS.SKU] || '',
          [REQUEST_FIELDS.SEARCH]: body[REQUEST_FIELDS.SEARCH] || ''
        }, traceId);
        
      case API_ACTIONS.DISCORD_REQUEST:
        return handleDiscordRequest_(body, traceId);
        
      case API_ACTIONS.ORDER_STATUS:
        return handleOrderStatus_(body, traceId);
        
      case API_ACTIONS.OPEN_ORDERS:
        return handleOpenOrders_(body, traceId);
        
      default:
        return jsonResponse_(
          createErrorResponse(
            ERROR_CODES.INVALID_ACTION,
            `Unknown action: ${action}`,
            false,
            { receivedAction: action, validActions: Object.values(API_ACTIONS) },
            traceId
          )
        );
    }

  } catch (err) {
    Logger.log(`[${traceId || 'unknown'}] doPost error: ${err}`);
    return jsonResponse_(
      createErrorResponse(
        ERROR_CODES.INTERNAL_ERROR,
        'Internal server error',
        true,
        { error: err.toString() },
        traceId
      )
    );
  }
}

// ============================================
// ADD NEW HELPER FUNCTIONS
// ============================================

/**
 * Generates a unique trace ID for request tracking
 * @returns {string} Trace ID
 */
function generateTraceId_() {
  return `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Creates JSON response from response object
 * @param {object} responseObj - Response object
 * @returns {ContentService.TextOutput} JSON response
 */
function jsonResponse_(responseObj) {
  return ContentService
    .createTextOutput(JSON.stringify(responseObj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handles health check requests
 * @param {string} traceId - Trace ID for logging
 * @returns {ContentService.TextOutput} Health check response
 */
function handleHealth_(traceId) {
  return jsonResponse_(
    createSuccessResponse(
      {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: API_VERSION
      },
      traceId
    )
  );
}

// ============================================
// UPDATE handleDiscordRequest_ TO USE CONSTANTS AND VALIDATION
// ============================================

function handleDiscordRequest_(body, traceId) {
  try {
    // Validate required fields
    const requiredFieldsError = validateRequiredFields(body, [
      REQUEST_FIELDS.SUBSYSTEM
    ]);
    
    if (requiredFieldsError) {
      return jsonResponse_(requiredFieldsError);
    }

    // Validate subsystem
    const subsystemError = validateSubsystem(body[REQUEST_FIELDS.SUBSYSTEM]);
    if (subsystemError) {
      return jsonResponse_(subsystemError);
    }

    // Validate quantity if provided
    const quantity = body[REQUEST_FIELDS.QUANTITY] || 1;
    const quantityError = validateQuantity(quantity);
    if (quantityError) {
      return jsonResponse_(quantityError);
    }

    // Validate budget if provided
    const budgetError = validateBudget(body[REQUEST_FIELDS.MAX_BUDGET]);
    if (budgetError) {
      return jsonResponse_(budgetError);
    }

    // Validate priority if provided
    const priority = body[REQUEST_FIELDS.PRIORITY] || PRIORITIES.MEDIUM;
    const priorityError = validatePriority(priority);
    if (priorityError) {
      return jsonResponse_(priorityError);
    }

    // Extract and validate data using constants
    const requestData = {
      timestamp: new Date(),
      requester: body[REQUEST_FIELDS.REQUESTER] || 'Discord User',
      subsystem: body[REQUEST_FIELDS.SUBSYSTEM],
      partLink: body[REQUEST_FIELDS.PART_LINK] || '',
      quantity: quantity,
      neededBy: body[REQUEST_FIELDS.NEEDED_BY] || '',
      maxBudget: body[REQUEST_FIELDS.MAX_BUDGET] || '',
      priority: priority,
      notes: body[REQUEST_FIELDS.NOTES] || ''
    };

    const { requestID, row } = createPartRequest_(requestData);

    Logger.log(`[${traceId}] Created request ${requestID} at row ${row}`);

    // Enrich with AI
    try {
      Logger.log(`[${traceId}] Calling enrichPartRequest for row ${row}`);
      enrichPartRequest(row, requestData.notes);
    } catch (err) {
      Logger.log(`[${traceId}] Enrichment error for row ${row}: ${err}`);
    }

    // Send Discord notification
    sendProcurementNotification_({
      requestID: requestID,
      timestamp: requestData.timestamp,
      requester: requestData.requester,
      subsystem: requestData.subsystem,
      partName: '',
      sku: '',
      link: requestData.partLink,
      quantity: requestData.quantity,
      priority: requestData.priority,
      neededBy: requestData.neededBy,
      maxBudget: requestData.maxBudget,
      notes: requestData.notes
    });

    // Return success response using standard format
    return jsonResponse_(
      createSuccessResponse(
        { 
          [RESPONSE_FIELDS.REQUEST_ID]: requestID,
          row: row
        },
        traceId
      )
    );

  } catch (err) {
    Logger.log(`[${traceId}] handleDiscordRequest_ error: ${err}`);
    return jsonResponse_(
      createErrorResponse(
        ERROR_CODES.INTERNAL_ERROR,
        'Failed to create request',
        true,
        { error: err.toString() },
        traceId
      )
    );
  }
}

// ============================================
// UPDATE handleOrderStatus_ TO USE CONSTANTS
// ============================================

function handleOrderStatus_(body, traceId) {
  const ss = SpreadsheetApp.getActive();
  const reqSheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const ordSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);

  const requestId = (body[REQUEST_FIELDS.REQUEST_ID] || '').toString().trim();
  const orderId = (body[REQUEST_FIELDS.ORDER_ID] || '').toString().trim();

  if (!requestId && !orderId) {
    return jsonResponse_(
      createErrorResponse(
        ERROR_CODES.MISSING_PARAMETER,
        'Either requestId or orderId is required',
        false,
        { requiredFields: [REQUEST_FIELDS.REQUEST_ID, REQUEST_FIELDS.ORDER_ID] },
        traceId
      )
    );
  }

  try {
    const result = {};

    // Lookup by Request ID
    if (requestId && reqSheet) {
      const values = reqSheet.getDataRange().getValues();
      let reqInfo = null;

      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const id = (row[PART_REQUESTS_COLS.ID - 1] || '').toString().trim();

        if (id === requestId) {
          reqInfo = {
            id: row[PART_REQUESTS_COLS.ID - 1],
            timestamp: formatDateForResponse_(row[PART_REQUESTS_COLS.TIMESTAMP - 1]),
            requester: row[PART_REQUESTS_COLS.REQUESTER - 1],
            subsystem: row[PART_REQUESTS_COLS.SUBSYSTEM - 1],
            partName: row[PART_REQUESTS_COLS.PART_NAME - 1],
            sku: row[PART_REQUESTS_COLS.SKU - 1],
            link: row[PART_REQUESTS_COLS.PART_LINK - 1],
            qty: row[PART_REQUESTS_COLS.QUANTITY - 1],
            priority: row[PART_REQUESTS_COLS.PRIORITY - 1],
            neededBy: formatDateForResponse_(row[PART_REQUESTS_COLS.NEEDED_BY - 1]),
            inventoryOnHand: row[PART_REQUESTS_COLS.INVENTORY_ON_HAND - 1],
            vendorStock: row[PART_REQUESTS_COLS.VENDOR_STOCK - 1],
            estUnitPrice: row[PART_REQUESTS_COLS.EST_UNIT_PRICE - 1],
            totalEstCost: row[PART_REQUESTS_COLS.TOTAL_EST_COST - 1],
            maxBudget: row[PART_REQUESTS_COLS.MAX_BUDGET - 1],
            budgetStatus: row[PART_REQUESTS_COLS.BUDGET_STATUS - 1],
            requestStatus: row[PART_REQUESTS_COLS.REQUEST_STATUS - 1],
            mentorNotes: row[PART_REQUESTS_COLS.MENTOR_NOTES - 1],
            shipping: row[PART_REQUESTS_COLS.EXPEDITED_SHIPPING - 1]
          };
          break;
        }
      }

      if (!reqInfo) {
        return jsonResponse_(
          createErrorResponse(
            ERROR_CODES.NOT_FOUND,
            `Request not found: ${requestId}`,
            false,
            { requestId: requestId },
            traceId
          )
        );
      }

      result.request = reqInfo;

      // Find linked orders
      if (ordSheet) {
        const ovals = ordSheet.getDataRange().getValues();
        const linkedOrders = [];

        for (let i = 1; i < ovals.length; i++) {
          const row = ovals[i];
          const includedRaw = (row[ORDERS_COLS.INCLUDED_REQUEST_IDS - 1] || '').toString();
          const ids = includedRaw.split(',').map(s => s.trim()).filter(Boolean);

          if (ids.includes(requestId)) {
            linkedOrders.push(formatOrderForResponse_(row));
          }
        }

        result.orders = linkedOrders;
      }
    }

    // Lookup by Order ID
    if (orderId && ordSheet) {
      const ovals = ordSheet.getDataRange().getValues();
      let orderInfo = null;

      for (let i = 1; i < ovals.length; i++) {
        const row = ovals[i];
        const id = (row[ORDERS_COLS.ORDER_ID - 1] || '').toString().trim();

        if (id === orderId) {
          orderInfo = formatOrderForResponse_(row);
          break;
        }
      }

      if (!orderInfo) {
        return jsonResponse_(
          createErrorResponse(
            ERROR_CODES.NOT_FOUND,
            `Order not found: ${orderId}`,
            false,
            { orderId: orderId },
            traceId
          )
        );
      }

      result.order = orderInfo;
    }

    return jsonResponse_(createSuccessResponse(result, traceId));

  } catch (err) {
    Logger.log(`[${traceId}] handleOrderStatus_ error: ${err}`);
    return jsonResponse_(
      createErrorResponse(
        ERROR_CODES.SHEET_ERROR,
        'Failed to lookup status',
        true,
        { error: err.toString() },
        traceId
      )
    );
  }
}

// ============================================
// ADD HELPER FUNCTIONS FOR DATE AND ORDER FORMATTING
// ============================================

/**
 * Formats a date for JSON response (ISO 8601)
 * @param {Date|string|null} value - Date value
 * @returns {string|null} ISO 8601 string or null
 */
function formatDateForResponse_(value) {
  if (!value) return null;
  
  if (value instanceof Date) {
    return value.toISOString();
  }
  
  // Try to parse as date
  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }
  
  // Return as-is if can't parse
  return value.toString();
}

/**
 * Formats an order row for response
 * @param {Array} row - Order row data
 * @returns {object} Formatted order object
 */
function formatOrderForResponse_(row) {
  return {
    orderId: row[ORDERS_COLS.ORDER_ID - 1],
    includedRequests: row[ORDERS_COLS.INCLUDED_REQUEST_IDS - 1],
    vendor: row[ORDERS_COLS.VENDOR - 1],
    partName: row[ORDERS_COLS.PART_NAME - 1],
    sku: row[ORDERS_COLS.SKU - 1],
    qty: row[ORDERS_COLS.QTY_ORDERED - 1],
    unitPrice: row[ORDERS_COLS.FINAL_UNIT_PRICE - 1],
    totalCost: row[ORDERS_COLS.TOTAL_COST - 1],
    orderDate: formatDateForResponse_(row[ORDERS_COLS.ORDER_DATE - 1]),
    shipping: row[ORDERS_COLS.SHIPPING_METHOD - 1],
    tracking: row[ORDERS_COLS.TRACKING - 1],
    eta: formatDateForResponse_(row[ORDERS_COLS.ETA - 1]),
    receivedDate: formatDateForResponse_(row[ORDERS_COLS.RECEIVED_DATE - 1]),
    status: row[ORDERS_COLS.ORDER_STATUS - 1],
    mentorNotes: row[ORDERS_COLS.MENTOR_NOTES - 1]
  };
}

// ============================================
// UPDATE handleInventoryLookup_ TO USE CONSTANTS
// ============================================

function handleInventoryLookup_(body, traceId) {
  const ss = SpreadsheetApp.getActive();
  const inventorySheet = ss.getSheetByName(SHEET_NAMES.INVENTORY);

  if (!inventorySheet) {
    return jsonResponse_(
      createErrorResponse(
        ERROR_CODES.SHEET_ERROR,
        'Inventory sheet not found',
        false,
        {},
        traceId
      )
    );
  }

  const skuQuery = (body[REQUEST_FIELDS.SKU] || '').toString().trim();
  const searchText = (body[REQUEST_FIELDS.SEARCH] || '').toString().trim();

  Logger.log(`[${traceId}] Inventory lookup: sku="${skuQuery}" search="${searchText}"`);

  try {
    const values = inventorySheet.getDataRange().getValues();
    if (!values || values.length < 2) {
      return jsonResponse_(createSuccessResponse({ matches: [] }, traceId));
    }

    const header = values[0];
    const rows = values.slice(1);

    const SKU_COL = findColumnIndex_(header, h => h.includes('sku') || h.includes('part number'));
    const VENDOR_COL = findColumnIndex_(header, h => h.includes('vendor'));
    const NAME_COL = findColumnIndex_(header, h => h.includes('part name'));
    const LOC_COL = findColumnIndex_(header, h => h.includes('location'));
    const QTY_COL = findColumnIndex_(header, h => h.includes('qty') || h.includes('on-hand'));

    const matches = [];

    // Location lookup
    const upperSearch = searchText.toUpperCase();
    const isLocationLookup = upperSearch.startsWith('BIN-') || upperSearch.startsWith('RACK-');

    if (isLocationLookup && LOC_COL !== -1 && QTY_COL !== -1 && NAME_COL !== -1) {
      Logger.log(`[${traceId}] Location lookup for "${upperSearch}"`);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const locValRaw = (row[LOC_COL] || '').toString().trim();
        const locVal = locValRaw.toUpperCase();

        if (locVal === upperSearch) {
          matches.push({
            sku: SKU_COL !== -1 ? row[SKU_COL] : '',
            vendor: VENDOR_COL !== -1 ? row[VENDOR_COL] : '',
            name: NAME_COL !== -1 ? row[NAME_COL] : '',
            location: locValRaw,
            quantity: QTY_COL !== -1 ? row[QTY_COL] : ''
          });
        }
      }

      return jsonResponse_(createSuccessResponse({ matches: matches }, traceId));
    }

    // SKU exact lookup
    if (skuQuery) {
      const rec = getInventoryRecordBySku_(inventorySheet, skuQuery);
      if (rec) {
        matches.push({
          sku: rec.sku,
          vendor: rec.vendor,
          name: rec.name,
          location: rec.location,
          quantity: rec.quantity
        });
      }
    }

    // Fuzzy search fallback
    const fallbackQuery = (searchText || skuQuery).toLowerCase();
    if (matches.length === 0 && fallbackQuery && SKU_COL !== -1 && NAME_COL !== -1 && QTY_COL !== -1) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowSku = (row[SKU_COL] || '').toString().toLowerCase();
        const rowName = (row[NAME_COL] || '').toString().toLowerCase();

        if (rowSku.indexOf(fallbackQuery) !== -1 || rowName.indexOf(fallbackQuery) !== -1) {
          matches.push({
            sku: row[SKU_COL],
            vendor: VENDOR_COL !== -1 ? row[VENDOR_COL] : '',
            name: row[NAME_COL],
            location: LOC_COL !== -1 ? row[LOC_COL] : '',
            quantity: row[QTY_COL]
          });
        }

        if (matches.length >= DISPLAY_LIMITS.MAX_INVENTORY_DISPLAY) break;
      }
    }

    Logger.log(`[${traceId}] Inventory result: ${matches.length} matches`);
    return jsonResponse_(createSuccessResponse({ matches: matches }, traceId));

  } catch (err) {
    Logger.log(`[${traceId}] handleInventoryLookup_ error: ${err}`);
    return jsonResponse_(
      createErrorResponse(
        ERROR_CODES.SHEET_ERROR,
        'Failed to lookup inventory',
        true,
        { error: err.toString() },
        traceId
      )
    );
  }
}

// ============================================
// UPDATE handleOpenOrders_ TO USE CONSTANTS
// ============================================

function handleOpenOrders_(body, traceId) {
  const ss = SpreadsheetApp.getActive();
  const ordSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  const reqSheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);

  if (!ordSheet) {
    return jsonResponse_(
      createErrorResponse(
        ERROR_CODES.SHEET_ERROR,
        'Orders sheet not found',
        false,
        {},
        traceId
      )
    );
  }

  try {
    const ordValues = ordSheet.getDataRange().getValues();
    const orders = [];

    if (ordValues && ordValues.length > 1) {
      const rows = ordValues.slice(1);

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        const orderId = (row[ORDERS_COLS.ORDER_ID - 1] || '').toString().trim();
        const received = row[ORDERS_COLS.RECEIVED_DATE - 1];
        const status = (row[ORDERS_COLS.ORDER_STATUS - 1] || '').toString().trim();

        const hasReceivedDate = !!received;
        const isCancelled = status.toLowerCase() === ORDER_STATUS.CANCELLED.toLowerCase();

        if (!hasReceivedDate && !isCancelled && orderId) {
          orders.push({
            orderId: orderId,
            includedRequests: row[ORDERS_COLS.INCLUDED_REQUEST_IDS - 1] || '',
            vendor: row[ORDERS_COLS.VENDOR - 1] || '',
            partName: row[ORDERS_COLS.PART_NAME - 1] || '',
            sku: row[ORDERS_COLS.SKU - 1] || '',
            qty: row[ORDERS_COLS.QTY_ORDERED - 1] || '',
            orderDate: formatDateForResponse_(row[ORDERS_COLS.ORDER_DATE - 1]),
            shipping: row[ORDERS_COLS.SHIPPING_METHOD - 1] || '',
            tracking: row[ORDERS_COLS.TRACKING - 1] || '',
            eta: formatDateForResponse_(row[ORDERS_COLS.ETA - 1]),
            status: status
          });
        }
      }
    }

    // Collect denied requests
    const denied = [];
    if (reqSheet) {
      const reqValues = reqSheet.getDataRange().getValues();

      if (reqValues && reqValues.length > 1) {
        const rRows = reqValues.slice(1);

        for (let i = 0; i < rRows.length; i++) {
          const row = rRows[i];
          const id = (row[PART_REQUESTS_COLS.ID - 1] || '').toString().trim();
          const status = (row[PART_REQUESTS_COLS.REQUEST_STATUS - 1] || '').toString().trim().toLowerCase();

          if (!id) continue;

          if (status === REQUEST_STATUS.DENIED.toLowerCase()) {
            denied.push({
              id: row[PART_REQUESTS_COLS.ID - 1],
              timestamp: formatDateForResponse_(row[PART_REQUESTS_COLS.TIMESTAMP - 1]),
              requester: row[PART_REQUESTS_COLS.REQUESTER - 1],
              subsystem: row[PART_REQUESTS_COLS.SUBSYSTEM - 1],
              partName: row[PART_REQUESTS_COLS.PART_NAME - 1],
              sku: row[PART_REQUESTS_COLS.SKU - 1],
              link: row[PART_REQUESTS_COLS.PART_LINK - 1],
              qty: row[PART_REQUESTS_COLS.QUANTITY - 1],
              priority: row[PART_REQUESTS_COLS.PRIORITY - 1],
              neededBy: formatDateForResponse_(row[PART_REQUESTS_COLS.NEEDED_BY - 1]),
              mentorNotes: row[PART_REQUESTS_COLS.MENTOR_NOTES - 1] || ''
            });
          }
        }
      }
    }

    Logger.log(`[${traceId}] Found ${orders.length} open orders and ${denied.length} denied requests`);

    return jsonResponse_(
      createSuccessResponse(
        {
          orders: orders,
          denied: denied
        },
        traceId
      )
    );

  } catch (err) {
    Logger.log(`[${traceId}] handleOpenOrders_ error: ${err}`);
    return jsonResponse_(
      createErrorResponse(
        ERROR_CODES.SHEET_ERROR,
        'Failed to fetch open orders',
        true,
        { error: err.toString() },
        traceId
      )
    );
  }
}

// ============================================
// SUMMARY OF CHANGES
// ============================================

/*
 * CHANGES MADE TO CODE.JS:
 * 
 * 1. Added SharedConstants.gs file to Apps Script project
 * 2. Updated doPost() to use API_ACTIONS constants and structured responses
 * 3. Added trace ID generation and tracking for all requests
 * 4. Added handleHealth_() endpoint
 * 5. Updated all handlers to use REQUEST_FIELDS constants
 * 6. Added comprehensive input validation using shared validators
 * 7. Updated all responses to use createSuccessResponse() and createErrorResponse()
 * 8. Added formatDateForResponse_() for consistent ISO 8601 dates
 * 9. Added formatOrderForResponse_() helper function
 * 10. Updated all error responses with proper error codes
 * 11. Maintained backward compatibility where possible
 * 
 * BENEFITS:
 * - Consistent field names with bot.js
 * - Structured error responses with error codes
 * - Request tracking with trace IDs
 * - Input validation on server side
 * - ISO 8601 date formatting
 * - Health check endpoint
 * - Better error handling and logging
 */