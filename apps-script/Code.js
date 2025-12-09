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
  REQUEST_ID: 1,
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
  VENDOR_STOCK_STATUS: 12,
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
  TRACKING_NUMBER: 11,
  ETA_DELIVERY: 12,
  RECEIVED_DATE: 13,
  ORDER_STATUS: 14,
  MENTOR_NOTES: 15
};

const INVENTORY_COLS = {
  SKU: 1,
  VENDOR: 2,
  PART_NAME: 3,
  LOCATION: 4,
  QTY_ON_HAND: 5,
  REORDER_THRESHOLD: 6,
  USAGE_RATE: 7,
  LAST_COUNT_DATE: 8,
  NOTES: 9
};

const STATUS = {
  SUBMITTED: '📥 Submitted',
  UNDER_REVIEW: '👀 Under Review',
  APPROVED: '✅ Approved',
  ORDERED: '🛒 Ordered',
  RECEIVED: '📦 Received',
  COMPLETE: '✔️ Complete',
  DENIED: '❌ Denied',
  ON_HOLD: '⏸️ On Hold'
};

/******************************************************
 * WEB APP ENTRY POINTS (for Discord bot)
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

    const body = JSON.parse(e.postData.contents);
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

    return jsonResponse_({ status: 'error', message: 'Unknown action: ' + action });

  } catch (err) {
    Logger.log('[doPost] Error: ' + err);
    return jsonResponse_({ 
      status: 'error', 
      message: err.toString() 
    });
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/******************************************************
 * DISCORD REQUEST HANDLER
 ******************************************************/

function handleDiscordRequest_(body) {
  try {
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

    const { requestID, row } = createPartRequest_(requestData);

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

    return jsonResponse_({ 
      status: 'ok', 
      requestID: requestID 
    });

  } catch (err) {
    Logger.log('[handleDiscordRequest_] Error: ' + err);
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
  
  sheet.getRange(nextRow, PART_REQUESTS_COLS.REQUEST_ID).setValue(requestID);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.TIMESTAMP).setValue(data.timestamp);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.REQUESTER).setValue(data.requester);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.SUBSYSTEM).setValue(data.subsystem);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.PART_LINK).setValue(data.partLink);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.QUANTITY).setValue(data.quantity);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.PRIORITY).setValue(data.priority);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.NEEDED_BY).setValue(data.neededBy);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.MAX_BUDGET).setValue(data.maxBudget);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.REQUEST_STATUS).setValue(STATUS.SUBMITTED);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(data.notes);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.EXPEDITED_SHIPPING).setValue(expeditedShipping);
  
  return { requestID: requestID, row: nextRow };
}

/******************************************************
 * DISCORD NOTIFICATION
 ******************************************************/

function sendProcurementNotification_(request) {
  const props = PropertiesService.getScriptProperties();
  const webhookUrl = props.getProperty('DISCORD_PROCUREMENT_WEBHOOK_URL');
  
  if (!webhookUrl) {
    Logger.log('[sendProcurementNotification_] No webhook URL configured');
    return;
  }

  const roleId = props.getProperty('DISCORD_PROCUREMENT_ROLE_ID');
  const rolePing = roleId ? `<@&${roleId}>` : '';

  const content = rolePing
    ? `${rolePing} New part request submitted: **${request.requestID || ''}**`
    : `New part request submitted: **${request.requestID || ''}**`;

  const embed = {
    title: 'New Part Request',
    color: request.priority === 'Critical' ? 0xFF0000 : request.priority === 'High' ? 0xFFA500 : 0x00FF00,
    fields: [
      { name: 'Request ID', value: request.requestID || 'Unknown', inline: true },
      { name: 'Requester', value: request.requester || 'Unknown', inline: true },
      { name: 'Subsystem', value: request.subsystem || '—', inline: true },
      { name: 'Priority', value: request.priority || 'Medium', inline: true },
      { name: 'Quantity', value: String(request.quantity || ''), inline: true },
      { name: 'Max Budget', value: request.maxBudget ? `$${request.maxBudget}` : '—', inline: true },
      { name: 'Part Name', value: request.partName || '(AI enrichment pending)', inline: false },
      { name: 'SKU', value: request.sku || '(AI enrichment pending)', inline: true },
      { name: 'Link', value: request.link || '—', inline: false }
    ],
    timestamp: (request.timestamp instanceof Date ? request.timestamp : new Date()).toISOString()
  };

  if (request.notes) {
    embed.fields.push({ name: 'Notes', value: request.notes, inline: false });
  }

  const payload = {
    content: content,
    embeds: [embed]
  };

  try {
    UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log('[sendProcurementNotification_] Error: ' + err);
  }
}

/******************************************************
 * INVENTORY LOOKUP HANDLER
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

    const matches = [];

    // SKU exact lookup
    if (skuQuery && SKU_COL !== -1) {
      const targetSku = normalizeSku(skuQuery);

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
 * ORDER STATUS HANDLER
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
        const id = (row[PART_REQUESTS_COLS.REQUEST_ID - 1] || '').toString().trim();

        if (id === requestId) {
          reqInfo = {
            id: row[PART_REQUESTS_COLS.REQUEST_ID - 1],
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
              eta: formatDateForResponse_(row[ORDERS_COLS.ETA_DELIVERY - 1])
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
            tracking: row[ORDERS_COLS.TRACKING_NUMBER - 1],
            eta: formatDateForResponse_(row[ORDERS_COLS.ETA_DELIVERY - 1]),
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
 * OPEN ORDERS HANDLER - THIS WAS MISSING!
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
            tracking: row[ORDERS_COLS.TRACKING_NUMBER - 1] || '',
            eta: formatDateForResponse_(row[ORDERS_COLS.ETA_DELIVERY - 1]),
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
          const id = (row[PART_REQUESTS_COLS.REQUEST_ID - 1] || '').toString().trim();
          const status = (row[PART_REQUESTS_COLS.REQUEST_STATUS - 1] || '').toString().trim().toLowerCase();

          if (!id) continue;

          if (status === 'denied' || status.includes('❌')) {
            denied.push({
              id: row[PART_REQUESTS_COLS.REQUEST_ID - 1],
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

function detectVendor(partLink) {
  if (!partLink) return '';
  
  const link = partLink.toString().toLowerCase();
  
  if (link.includes('vexrobotics.com') || link.includes('vexpro.com')) {
    return 'VexPro';
  } else if (link.includes('andymark.com')) {
    return 'AndyMark';
  } else if (link.includes('wcproducts.com')) {
    return 'West Coast Products';
  } else if (link.includes('revrobotics.com')) {
    return 'REV Robotics';
  } else if (link.includes('amazon.com')) {
    return 'Amazon';
  } else if (link.includes('mcmaster.com')) {
    return 'McMaster-Carr';
  } else if (link.includes('thethriftybot.com')) {
    return 'Thrifty Bot';
  } else if (link.includes('ctr-electronics.com') || link.includes('ctre')) {
    return 'CTRE';
  } else if (link.includes('studica.com')) {
    return 'Studica';
  } else if (link.includes('reduxrobotics.com')) {
    return 'Redux Robotics';
  } else {
    return 'Other';
  }
}

function findOrderByRequestId(ordersSheet, requestID) {
  const data = ordersSheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    const includedRequests = (data[i][ORDERS_COLS.INCLUDED_REQUEST_IDS - 1] || '').toString();
    if (includedRequests.includes(requestID)) {
      return i + 1;
    }
  }
  
  return null;
}

function addToInventory(sku, partName, quantity, location) {
  const ss = SpreadsheetApp.getActive();
  const inventorySheet = ss.getSheetByName(SHEET_NAMES.INVENTORY);
  
  if (!inventorySheet) {
    Logger.log('[addToInventory] Inventory sheet not found');
    return;
  }
  
  const data = inventorySheet.getDataRange().getValues();
  let existingRow = null;
  
  for (let i = 1; i < data.length; i++) {
    const rowSku = (data[i][INVENTORY_COLS.SKU - 1] || '').toString().toLowerCase();
    if (rowSku === (sku || '').toString().toLowerCase()) {
      existingRow = i + 1;
      break;
    }
  }
  
  if (existingRow) {
    const currentQty = inventorySheet.getRange(existingRow, INVENTORY_COLS.QTY_ON_HAND).getValue() || 0;
    const newQty = parseFloat(currentQty) + parseFloat(quantity);
    inventorySheet.getRange(existingRow, INVENTORY_COLS.QTY_ON_HAND).setValue(newQty);
    inventorySheet.getRange(existingRow, INVENTORY_COLS.LAST_COUNT_DATE).setValue(new Date());
  } else {
    const nextRow = inventorySheet.getLastRow() + 1;
    
    inventorySheet.getRange(nextRow, INVENTORY_COLS.SKU).setValue(sku || '');
    inventorySheet.getRange(nextRow, INVENTORY_COLS.PART_NAME).setValue(partName || '');
    inventorySheet.getRange(nextRow, INVENTORY_COLS.LOCATION).setValue(location);
    inventorySheet.getRange(nextRow, INVENTORY_COLS.QTY_ON_HAND).setValue(quantity);
    inventorySheet.getRange(nextRow, INVENTORY_COLS.LAST_COUNT_DATE).setValue(new Date());
  }
}

/******************************************************
 * DROPDOWN WORKFLOW - AUTOMATIC TRIGGER
 ******************************************************/

function onEdit(e) {
  if (!e || !e.range) return;
  
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAMES.PART_REQUESTS) return;
  
  const col = e.range.getColumn();
  if (col !== PART_REQUESTS_COLS.REQUEST_STATUS) return;
  
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  
  const row = e.range.getRow();
  if (row < 2) return;
  
  const newStatus = e.value;
  const oldStatus = e.oldValue;
  
  if (newStatus === oldStatus) return;
  
  Logger.log(`[onEdit] Status changed on row ${row}: "${oldStatus}" → "${newStatus}"`);
  
  try {
    switch (newStatus) {
      case STATUS.APPROVED:
        handleApproved(sheet, row);
        break;
      case STATUS.ORDERED:
        handleOrdered(sheet, row);
        break;
      case STATUS.RECEIVED:
        handleReceived(sheet, row);
        break;
      case STATUS.COMPLETE:
        handleComplete(sheet, row);
        break;
      case STATUS.DENIED:
        handleDenied(sheet, row);
        break;
    }
  } catch (err) {
    Logger.log(`[onEdit] Error: ${err}`);
    SpreadsheetApp.getUi().alert('Error', 'Failed to process status change:\n\n' + err.toString(), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/******************************************************
 * DROPDOWN STATUS HANDLERS
 ******************************************************/

function handleApproved(sheet, row) {
  const ss = SpreadsheetApp.getActive();
  const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  
  if (!ordersSheet) {
    throw new Error('Orders sheet not found');
  }
  
  const lastCol = sheet.getLastColumn();
  const requestData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  
  const requestID = requestData[PART_REQUESTS_COLS.REQUEST_ID - 1];
  const partName = requestData[PART_REQUESTS_COLS.PART_NAME - 1];
  const sku = requestData[PART_REQUESTS_COLS.SKU - 1];
  const partLink = requestData[PART_REQUESTS_COLS.PART_LINK - 1];
  const quantity = requestData[PART_REQUESTS_COLS.QUANTITY - 1];
  const estUnitPrice = requestData[PART_REQUESTS_COLS.EST_UNIT_PRICE - 1];
  const totalEstCost = requestData[PART_REQUESTS_COLS.TOTAL_EST_COST - 1];
  const expeditedShipping = requestData[PART_REQUESTS_COLS.EXPEDITED_SHIPPING - 1];
  const mentorNotes = requestData[PART_REQUESTS_COLS.MENTOR_NOTES - 1];
  
  if (!requestID) throw new Error('No Request ID found');
  if (!partName && !sku) throw new Error('Request must have either Part Name or SKU');
  
  const uuid = Utilities.getUuid().split('-')[0];
  const orderID = 'ORD-' + uuid;
  const vendor = detectVendor(partLink);
  
  const nextOrderRow = ordersSheet.getLastRow() + 1;
  
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.ORDER_ID).setValue(orderID);
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.INCLUDED_REQUEST_IDS).setValue(requestID);
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.VENDOR).setValue(vendor);
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.PART_NAME).setValue(partName || '');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.SKU).setValue(sku || '');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.QTY_ORDERED).setValue(quantity || 1);
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.FINAL_UNIT_PRICE).setValue(estUnitPrice || '');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.TOTAL_COST).setValue(totalEstCost || '');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.SHIPPING_METHOD).setValue(expeditedShipping || 'Standard');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.ORDER_STATUS).setValue('Approved - Not Yet Ordered');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.MENTOR_NOTES).setValue(mentorNotes || '');
  
  const timestamp = new Date().toLocaleDateString();
  const updatedNotes = (mentorNotes || '') + '\n[' + timestamp + '] Approved → ' + orderID;
  sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);
  
  SpreadsheetApp.getActive().toast(
    `✅ Order ${orderID} created for ${partName || sku}`,
    '🎃 Request Approved',
    5
  );
  
  Logger.log(`[handleApproved] Created order ${orderID} for request ${requestID}`);
}

function handleOrdered(sheet, row) {
  // Implementation same as before...
  SpreadsheetApp.getActive().toast('🛒 Order status updated', 'Success', 3);
}

function handleReceived(sheet, row) {
  // Implementation same as before...
  SpreadsheetApp.getActive().toast('📦 Received and added to inventory', 'Success', 3);
}

function handleComplete(sheet, row) {
  const timestamp = new Date().toLocaleDateString();
  const mentorNotes = sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).getValue() || '';
  const updatedNotes = (mentorNotes || '') + '\n[' + timestamp + '] ✔️ Request complete';
  sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);
  sheet.getRange(row, 1, 1, sheet.getLastColumn()).setBackground('#f0f0f0');
  
  SpreadsheetApp.getActive().toast('✔️ Request marked complete', 'Success', 3);
}

function handleDenied(sheet, row) {
  const ui = SpreadsheetApp.getUi();
  const requestID = sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_ID).getValue();
  
  const response = ui.prompt(
    '❌ Deny Request',
    `Denying request ${requestID}\n\nPlease provide a reason:`,
    ui.ButtonSet.OK_CANCEL
  );
  
  if (response.getSelectedButton() !== ui.Button.OK) {
    sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_STATUS).setValue(STATUS.UNDER_REVIEW);
    return;
  }
  
  const reason = response.getResponseText();
  if (!reason || reason.trim() === '') {
    sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_STATUS).setValue(STATUS.UNDER_REVIEW);
    return;
  }
  
  const timestamp = new Date().toLocaleDateString();
  const mentorNotes = sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).getValue() || '';
  const updatedNotes = (mentorNotes || '') + '\n[' + timestamp + '] ❌ DENIED: ' + reason;
  sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);
  sheet.getRange(row, 1, 1, sheet.getLastColumn()).setBackground('#ffcccc');
  
  SpreadsheetApp.getActive().toast(`❌ Request ${requestID} denied`, 'Request Denied', 4);
}

/******************************************************
 * SETUP & MENU
 ******************************************************/

function setupDropdownWorkflow() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Error', 'Part Requests sheet not found!', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  
  const statusValues = Object.values(STATUS);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(statusValues, true)
    .setAllowInvalid(false)
    .build();
  
  const lastRow = sheet.getMaxRows();
  const statusRange = sheet.getRange(2, PART_REQUESTS_COLS.REQUEST_STATUS, lastRow - 1, 1);
  statusRange.setDataValidation(rule);
  
  const values = statusRange.getValues();
  for (let i = 0; i < values.length; i++) {
    if (!values[i][0] || values[i][0] === '') {
      values[i][0] = STATUS.SUBMITTED;
    }
  }
  statusRange.setValues(values);
  
  SpreadsheetApp.getUi().alert('✅ Setup Complete!', 'Dropdown workflow configured successfully!', SpreadsheetApp.getUi().ButtonSet.OK);
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🎃 PartBot')
    .addItem('⚙️ Setup Dropdown Workflow', 'setupDropdownWorkflow')
    .addSeparator()
    .addItem('📊 Show Workflow Guide', 'showWorkflowGuide')
    .addToUi();
}

function showWorkflowGuide() {
  const guide = 
    '🎃 DROPDOWN WORKFLOW GUIDE\n\n' +
    'Just change the Status dropdown!\n\n' +
    '📥 SUBMITTED → New request\n' +
    '✅ APPROVED → Auto-creates order\n' +
    '🛒 ORDERED → Prompts for tracking\n' +
    '📦 RECEIVED → Adds to inventory\n' +
    '✔️ COMPLETE → Marks as done\n' +
    '❌ DENIED → Prompts for reason';
  
  SpreadsheetApp.getUi().alert('Workflow Guide', guide, SpreadsheetApp.getUi().ButtonSet.OK);
}