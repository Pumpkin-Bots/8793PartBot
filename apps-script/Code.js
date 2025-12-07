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

/******************************************************
 * CONFIGURATION
 ******************************************************/

const SHEET_NAMES = {
  PART_REQUESTS: 'Part Requests',
  ORDERS: 'Orders',
  INVENTORY: 'Inventory'
};

const PART_REQUESTS_COLS = {
  ID: 1,
  TIMESTAMP: 2,
  REQUESTER: 3,
  SUBSYSTEM: 4,
  PART_NAME: 5,
  SKU: 6,
  PART_LINK: 7,
  QUANTITY: 8,
  PRIORITY: 9,
  NEEDED_BY: 10,
  INVENTORY_ON_HAND: 11,
  VENDOR_STOCK: 12,
  EST_UNIT_PRICE: 13,
  TOTAL_EST_COST: 14,
  MAX_BUDGET: 15,
  BUDGET_STATUS: 16,
  REQUEST_STATUS: 17,
  MENTOR_NOTES: 18,
  EXPEDITED_SHIPPING: 19
};

const ORDERS_COLS = {
  ORDER_ID: 1,
  INCLUDED_REQUEST_IDS: 2,
  VENDOR: 3,
  PART_NAME: 4,
  SKU: 5,
  QTY_ORDERED: 6,
  FINAL_UNIT_PRICE: 7,
  TOTAL_COST: 8,
  ORDER_DATE: 9,
  SHIPPING_METHOD: 10,
  TRACKING: 11,
  ETA: 12,
  RECEIVED_DATE: 13,
  ORDER_STATUS: 14,
  MENTOR_NOTES: 15
};

/******************************************************
 * HELPER FUNCTIONS
 ******************************************************/

function normalizeSku(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function findColumnIndex_(header, matchFn) {
  for (let i = 0; i < header.length; i++) {
    const raw = header[i] || '';
    const norm = raw.toString().trim().toLowerCase();
    if (matchFn(norm)) return i;
  }
  return -1;
}

function formatDateForResponse_(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString();
  }
  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }
  return value.toString();
}

/******************************************************
 * WEB APP HANDLERS
 ******************************************************/

function doGet(e) {
  return ContentService
    .createTextOutput('OK FROM FRC PURCHASING WEB APP')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ status: 'error', message: 'No post data' });
    }

    const raw = e.postData.contents;
    Logger.log('[doPost] Raw body: ' + raw);

    const body = JSON.parse(raw);
    const action = body.action;

    Logger.log('[doPost] Action: ' + action);

    if (action === 'health') {
      return jsonResponse_({
        status: 'ok',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      });
    }

    if (action === 'discordRequest') {
      return handleDiscordRequest_(body);
    }

    if (action === 'inventory') {
      return handleInventoryLookup_(body);
    }

    if (action === 'orderStatus') {
      return handleOrderStatus_(body);
    }

    if (action === 'openOrders') {
      return handleOpenOrders_(body);
    }

    Logger.log('[doPost] Unknown action: ' + action);
    return jsonResponse_({ status: 'error', message: 'Unknown action: ' + action });

  } catch (err) {
    Logger.log('[doPost] Error: ' + err);
    Logger.log('[doPost] Stack: ' + err.stack);
    return jsonResponse_({ 
      status: 'error', 
      message: err.toString() 
    });
  }
}

function jsonResponse_(obj) {
  Logger.log('[jsonResponse_] Sending: ' + JSON.stringify(obj));
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/******************************************************
 * DISCORD REQUEST HANDLER
 ******************************************************/

function handleDiscordRequest_(body) {
  try {
    Logger.log('[handleDiscordRequest_] Processing request');
    
    const requestData = {
      timestamp: new Date(),
      requester: body.requester || 'Discord User',
      subsystem: body.subsystem || '',
      partLink: body.partLink || '',
      quantity: body.quantity || 1,
      neededBy: body.neededBy || '',
      maxBudget: body.maxBudget || '',
      priority: body.priority || 'Medium',
      notes: body.notes || ''
    };

    Logger.log('[handleDiscordRequest_] Request data: ' + JSON.stringify(requestData));

    const { requestID, row } = createPartRequest_(requestData);
    
    Logger.log('[handleDiscordRequest_] Created request: ' + requestID + ' at row ' + row);

    return jsonResponse_({ 
      status: 'ok', 
      requestID: requestID 
    });

  } catch (err) {
    Logger.log('[handleDiscordRequest_] Error: ' + err);
    Logger.log('[handleDiscordRequest_] Stack: ' + err.stack);
    return jsonResponse_({ 
      status: 'error', 
      message: err.toString() 
    });
  }
}

/******************************************************
 * CREATE PART REQUEST
 ******************************************************/

function createPartRequest_(data) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  
  if (!sheet) {
    throw new Error('Sheet not found: ' + SHEET_NAMES.PART_REQUESTS);
  }
  
  const uuid = Utilities.getUuid().split('-')[0];
  const requestID = 'REQ-' + uuid;
  const nextRow = sheet.getLastRow() + 1;
  
  const expeditedShipping = (data.priority === 'Critical') ? 'Expedited' : 'Standard';
  
  Logger.log('[createPartRequest_] Creating request at row ' + nextRow);
  
  sheet.getRange(nextRow, PART_REQUESTS_COLS.ID).setValue(requestID);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.TIMESTAMP).setValue(data.timestamp);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.REQUESTER).setValue(data.requester);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.SUBSYSTEM).setValue(data.subsystem);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.PART_LINK).setValue(data.partLink);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.QUANTITY).setValue(data.quantity);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.PRIORITY).setValue(data.priority);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.NEEDED_BY).setValue(data.neededBy);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.MAX_BUDGET).setValue(data.maxBudget);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.REQUEST_STATUS).setValue('Requested');
  sheet.getRange(nextRow, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(data.notes);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.EXPEDITED_SHIPPING).setValue(expeditedShipping);
  
  Logger.log('[createPartRequest_] Request created successfully');
  
  return { requestID: requestID, row: nextRow };
}

/******************************************************
 * INVENTORY LOOKUP - FULLY IMPLEMENTED
 ******************************************************/

function handleInventoryLookup_(body) {
  const ss = SpreadsheetApp.getActive();
  const inventorySheet = ss.getSheetByName(SHEET_NAMES.INVENTORY);

  if (!inventorySheet) {
    return jsonResponse_({
      status: 'error',
      message: 'Inventory sheet not found'
    });
  }

  const skuQuery = (body.sku || '').toString().trim();
  const searchText = (body.search || '').toString().trim();

  Logger.log('[handleInventoryLookup_] sku="' + skuQuery + '" search="' + searchText + '"');

  try {
    const values = inventorySheet.getDataRange().getValues();
    if (!values || values.length < 2) {
      return jsonResponse_({ status: 'ok', matches: [] });
    }

    const header = values[0];
    const rows = values.slice(1);

    const SKU_COL = findColumnIndex_(header, h => h.includes('sku') || h.includes('part number'));
    const VENDOR_COL = findColumnIndex_(header, h => h.includes('vendor'));
    const NAME_COL = findColumnIndex_(header, h => h.includes('part name'));
    const LOC_COL = findColumnIndex_(header, h => h.includes('location'));
    const QTY_COL = findColumnIndex_(header, h => h.includes('qty') || h.includes('on-hand'));

    Logger.log('[handleInventoryLookup_] Columns: SKU=' + SKU_COL + ' Name=' + NAME_COL + ' Qty=' + QTY_COL);

    const matches = [];

    // Location lookup (BIN-xxx, RACK-xxx)
    const upperSearch = searchText.toUpperCase();
    const isLocationLookup = upperSearch.startsWith('BIN-') || upperSearch.startsWith('RACK-');

    if (isLocationLookup && LOC_COL !== -1 && QTY_COL !== -1 && NAME_COL !== -1) {
      Logger.log('[handleInventoryLookup_] Location lookup for "' + upperSearch + '"');

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

      Logger.log('[handleInventoryLookup_] Location result: ' + matches.length + ' matches');
      return jsonResponse_({ status: 'ok', matches: matches });
    }

    // SKU exact lookup
    if (skuQuery && SKU_COL !== -1) {
      const targetSku = normalizeSku(skuQuery);
      Logger.log('[handleInventoryLookup_] SKU exact lookup for "' + targetSku + '"');

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowSkuNorm = normalizeSku(row[SKU_COL]);

        if (rowSkuNorm === targetSku) {
          matches.push({
            sku: row[SKU_COL],
            vendor: VENDOR_COL !== -1 ? row[VENDOR_COL] : '',
            name: NAME_COL !== -1 ? row[NAME_COL] : '',
            location: LOC_COL !== -1 ? row[LOC_COL] : '',
            quantity: QTY_COL !== -1 ? row[QTY_COL] : ''
          });
        }
      }
    }

    // Fuzzy search fallback
    const fallbackQuery = (searchText || skuQuery).toLowerCase();
    if (matches.length === 0 && fallbackQuery && SKU_COL !== -1 && NAME_COL !== -1 && QTY_COL !== -1) {
      Logger.log('[handleInventoryLookup_] Fuzzy search for "' + fallbackQuery + '"');

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

        if (matches.length >= 10) break;
      }
    }

    Logger.log('[handleInventoryLookup_] Result: ' + matches.length + ' matches');
    return jsonResponse_({ status: 'ok', matches: matches });

  } catch (err) {
    Logger.log('[handleInventoryLookup_] Error: ' + err);
    return jsonResponse_({
      status: 'error',
      message: err.toString()
    });
  }
}

/******************************************************
 * ORDER STATUS - FULLY IMPLEMENTED
 ******************************************************/

function handleOrderStatus_(body) {
  const ss = SpreadsheetApp.getActive();
  const reqSheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const ordSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);

  const requestId = (body.requestId || '').toString().trim();
  const orderId = (body.orderId || '').toString().trim();

  if (!requestId && !orderId) {
    return jsonResponse_({
      status: 'error',
      message: 'requestId or orderId is required'
    });
  }

  try {
    const result = { status: 'ok' };

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
            requestStatus: row[PART_REQUESTS_COLS.REQUEST_STATUS - 1]
          };
          break;
        }
      }

      if (!reqInfo) {
        return jsonResponse_({
          status: 'error',
          message: 'Request not found: ' + requestId
        });
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
            linkedOrders.push({
              orderId: row[ORDERS_COLS.ORDER_ID - 1],
              vendor: row[ORDERS_COLS.VENDOR - 1],
              status: row[ORDERS_COLS.ORDER_STATUS - 1],
              orderDate: formatDateForResponse_(row[ORDERS_COLS.ORDER_DATE - 1]),
              eta: formatDateForResponse_(row[ORDERS_COLS.ETA - 1])
            });
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
          orderInfo = {
            orderId: row[ORDERS_COLS.ORDER_ID - 1],
            includedRequests: row[ORDERS_COLS.INCLUDED_REQUEST_IDS - 1],
            vendor: row[ORDERS_COLS.VENDOR - 1],
            partName: row[ORDERS_COLS.PART_NAME - 1],
            sku: row[ORDERS_COLS.SKU - 1],
            qty: row[ORDERS_COLS.QTY_ORDERED - 1],
            orderDate: formatDateForResponse_(row[ORDERS_COLS.ORDER_DATE - 1]),
            shipping: row[ORDERS_COLS.SHIPPING_METHOD - 1],
            tracking: row[ORDERS_COLS.TRACKING - 1],
            eta: formatDateForResponse_(row[ORDERS_COLS.ETA - 1]),
            receivedDate: formatDateForResponse_(row[ORDERS_COLS.RECEIVED_DATE - 1]),
            status: row[ORDERS_COLS.ORDER_STATUS - 1]
          };
          break;
        }
      }

      if (!orderInfo) {
        return jsonResponse_({
          status: 'error',
          message: 'Order not found: ' + orderId
        });
      }

      result.order = orderInfo;
    }

    return jsonResponse_(result);

  } catch (err) {
    Logger.log('[handleOrderStatus_] Error: ' + err);
    return jsonResponse_({
      status: 'error',
      message: err.toString()
    });
  }
}

/******************************************************
 * OPEN ORDERS - FULLY IMPLEMENTED
 ******************************************************/

function handleOpenOrders_(body) {
  const ss = SpreadsheetApp.getActive();
  const ordSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  const reqSheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);

  if (!ordSheet) {
    return jsonResponse_({
      status: 'error',
      message: 'Orders sheet not found'
    });
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
        const isCancelled = status.toLowerCase() === 'cancelled';

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

          if (status === 'denied') {
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
              mentorNotes: row[PART_REQUESTS_COLS.MENTOR_NOTES - 1] || ''
            });
          }
        }
      }
    }

    Logger.log('[handleOpenOrders_] Found ' + orders.length + ' open orders and ' + denied.length + ' denied requests');

    return jsonResponse_({
      status: 'ok',
      orders: orders,
      denied: denied
    });

  } catch (err) {
    Logger.log('[handleOpenOrders_] Error: ' + err);
    return jsonResponse_({
      status: 'error',
      message: err.toString()
    });
  }
}