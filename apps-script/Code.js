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

/*
 * 8793PartBot – Dropdown Status Workflow Implementation
 * 
 * This replaces the button-based approval with an automated dropdown workflow.
 * Add this code to your Apps Script (Code.gs file).
 * 
 * HOW IT WORKS:
 * 1. Mentor changes Status dropdown in Part Requests sheet
 * 2. Script automatically triggers and performs the action
 * 3. No buttons needed - just change the status!
 * 
 * WORKFLOW STATES:
 * 📥 Submitted         → Initial state (default)
 * 👀 Under Review      → Mentor is reviewing
 * ✅ Approved          → Auto-creates order, moves to Orders sheet
 * 🛒 Ordered           → Mentor has placed the order (prompt for details)
 * 📦 Received          → Order arrived (prompt for inventory)
 * ✔️ Complete          → In inventory (archives request)
 * ❌ Denied            → Request rejected (prompt for reason)
 * ⏸️ On Hold           → Waiting for more info
 */

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

/******************************************************
 * STATUS VALUES - MUST MATCH DROPDOWN OPTIONS
 ******************************************************/

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
 * SETUP - RUN THIS ONCE TO ADD DROPDOWNS
 ******************************************************/

function setupDropdownWorkflow() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Error', 'Part Requests sheet not found!', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }
  
  // Create dropdown validation
  const statusValues = Object.values(STATUS);
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(statusValues, true)
    .setAllowInvalid(false)
    .build();
  
  // Apply to Status column (all rows except header)
  const lastRow = sheet.getMaxRows();
  const statusRange = sheet.getRange(2, PART_REQUESTS_COLS.REQUEST_STATUS, lastRow - 1, 1);
  statusRange.setDataValidation(rule);
  
  // Set default value for empty cells
  const values = statusRange.getValues();
  for (let i = 0; i < values.length; i++) {
    if (!values[i][0] || values[i][0] === '') {
      values[i][0] = STATUS.SUBMITTED;
    }
  }
  statusRange.setValues(values);
  
  SpreadsheetApp.getUi().alert(
    '✅ Setup Complete!',
    'Dropdown workflow has been configured.\n\n' +
    'Status options:\n' +
    '• 📥 Submitted (default)\n' +
    '• 👀 Under Review\n' +
    '• ✅ Approved (auto-creates order)\n' +
    '• 🛒 Ordered (prompt for details)\n' +
    '• 📦 Received (prompt for inventory)\n' +
    '• ✔️ Complete (archives)\n' +
    '• ❌ Denied (prompt for reason)\n' +
    '• ⏸️ On Hold\n\n' +
    'Just change the dropdown and the script handles the rest!',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
  
  Logger.log('[setupDropdownWorkflow] Configuration complete');
}

/******************************************************
 * AUTOMATIC TRIGGER - RUNS ON ANY EDIT
 ******************************************************/

function onEdit(e) {
  // Only process if edit is in Part Requests sheet
  if (!e || !e.range) return;
  
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAMES.PART_REQUESTS) return;
  
  // Only process if Status column was edited
  const col = e.range.getColumn();
  if (col !== PART_REQUESTS_COLS.REQUEST_STATUS) return;
  
  // Only process single cell edits (not ranges)
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  
  const row = e.range.getRow();
  if (row < 2) return; // Skip header row
  
  const newStatus = e.value;
  const oldStatus = e.oldValue;
  
  // Don't process if status didn't actually change
  if (newStatus === oldStatus) return;
  
  Logger.log(`[onEdit] Status changed on row ${row}: "${oldStatus}" → "${newStatus}"`);
  
  try {
    // Route to appropriate handler based on new status
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
        
      case STATUS.UNDER_REVIEW:
        handleUnderReview(sheet, row);
        break;
        
      case STATUS.ON_HOLD:
        handleOnHold(sheet, row);
        break;
    }
  } catch (err) {
    Logger.log(`[onEdit] Error handling status change: ${err}`);
    SpreadsheetApp.getUi().alert(
      'Error',
      'Failed to process status change:\n\n' + err.toString(),
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  }
}

/******************************************************
 * STATUS HANDLERS
 ******************************************************/

/**
 * APPROVED → Auto-create order
 */
function handleApproved(sheet, row) {
  Logger.log(`[handleApproved] Processing row ${row}`);
  
  const ss = SpreadsheetApp.getActive();
  const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  
  if (!ordersSheet) {
    throw new Error('Orders sheet not found');
  }
  
  // Get request data
  const lastCol = sheet.getLastColumn();
  const requestData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  
  const requestID = requestData[PART_REQUESTS_COLS.REQUEST_ID - 1];
  const requester = requestData[PART_REQUESTS_COLS.REQUESTER - 1];
  const subsystem = requestData[PART_REQUESTS_COLS.SUBSYSTEM - 1];
  const partName = requestData[PART_REQUESTS_COLS.PART_NAME - 1];
  const sku = requestData[PART_REQUESTS_COLS.SKU - 1];
  const partLink = requestData[PART_REQUESTS_COLS.PART_LINK - 1];
  const quantity = requestData[PART_REQUESTS_COLS.QUANTITY - 1];
  const priority = requestData[PART_REQUESTS_COLS.PRIORITY - 1];
  const estUnitPrice = requestData[PART_REQUESTS_COLS.EST_UNIT_PRICE - 1];
  const totalEstCost = requestData[PART_REQUESTS_COLS.TOTAL_EST_COST - 1];
  const expeditedShipping = requestData[PART_REQUESTS_COLS.EXPEDITED_SHIPPING - 1];
  const mentorNotes = requestData[PART_REQUESTS_COLS.MENTOR_NOTES - 1];
  
  // Validate required fields
  if (!requestID) {
    throw new Error('No Request ID found');
  }
  
  if (!partName && !sku) {
    throw new Error('Request must have either Part Name or SKU');
  }
  
  // Generate Order ID
  const uuid = Utilities.getUuid().split('-')[0];
  const orderID = 'ORD-' + uuid;
  
  // Detect vendor from URL
  const vendor = detectVendor(partLink);
  
  // Create order in Orders sheet
  const nextOrderRow = ordersSheet.getLastRow() + 1;
  
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.ORDER_ID).setValue(orderID);
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.INCLUDED_REQUEST_IDS).setValue(requestID);
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.VENDOR).setValue(vendor);
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.PART_NAME).setValue(partName || '');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.SKU).setValue(sku || '');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.QTY_ORDERED).setValue(quantity || 1);
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.FINAL_UNIT_PRICE).setValue(estUnitPrice || '');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.TOTAL_COST).setValue(totalEstCost || '');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.ORDER_DATE).setValue('');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.SHIPPING_METHOD).setValue(expeditedShipping || 'Standard');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.TRACKING_NUMBER).setValue('');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.ETA_DELIVERY).setValue('');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.RECEIVED_DATE).setValue('');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.ORDER_STATUS).setValue('Approved - Not Yet Ordered');
  ordersSheet.getRange(nextOrderRow, ORDERS_COLS.MENTOR_NOTES).setValue(mentorNotes || '');
  
  // Update mentor notes in Part Requests
  const timestamp = new Date().toLocaleDateString();
  const updatedNotes = (mentorNotes || '') + '\n[' + timestamp + '] Approved → ' + orderID;
  sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);
  
  // Send notification
  sendDiscordNotification('approved', {
    requestID: requestID,
    orderID: orderID,
    requester: requester,
    partName: partName || sku,
    quantity: quantity,
    vendor: vendor
  });
  
  Logger.log(`[handleApproved] Created order ${orderID} for request ${requestID}`);
  
  // Show toast notification
  SpreadsheetApp.getActive().toast(
    `✅ Order ${orderID} created for ${partName || sku}`,
    '🎃 Request Approved',
    5
  );
}

/**
 * ORDERED → Prompt for order details
 */
function handleOrdered(sheet, row) {
  Logger.log(`[handleOrdered] Processing row ${row}`);
  
  const ss = SpreadsheetApp.getActive();
  const requestData = sheet.getRange(row, 1, sheet.getLastColumn()).getValues()[0];
  const requestID = requestData[PART_REQUESTS_COLS.REQUEST_ID - 1];
  const mentorNotes = requestData[PART_REQUESTS_COLS.MENTOR_NOTES - 1];
  
  // Find the order in Orders sheet
  const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  const orderRow = findOrderByRequestId(ordersSheet, requestID);
  
  if (!orderRow) {
    SpreadsheetApp.getActive().toast(
      'No order found for this request. Create order first by setting status to "✅ Approved"',
      '⚠️ Warning',
      5
    );
    return;
  }
  
  // Prompt for order details
  const ui = SpreadsheetApp.getUi();
  
  const orderDateResponse = ui.prompt(
    '🛒 Order Placed',
    'Enter order date (or leave blank for today):',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (orderDateResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  
  const orderDate = orderDateResponse.getResponseText() || new Date();
  
  const trackingResponse = ui.prompt(
    '📦 Tracking Number',
    'Enter tracking number (optional):',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (trackingResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  
  const tracking = trackingResponse.getResponseText();
  
  // Update Orders sheet
  ordersSheet.getRange(orderRow, ORDERS_COLS.ORDER_DATE).setValue(orderDate);
  ordersSheet.getRange(orderRow, ORDERS_COLS.TRACKING_NUMBER).setValue(tracking);
  ordersSheet.getRange(orderRow, ORDERS_COLS.ORDER_STATUS).setValue('Ordered');
  
  // Update mentor notes
  const timestamp = new Date().toLocaleDateString();
  const updatedNotes = (mentorNotes || '') + '\n[' + timestamp + '] Order placed' + 
                       (tracking ? ', tracking: ' + tracking : '');
  sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);
  
  SpreadsheetApp.getActive().toast(
    '🛒 Order details updated',
    'Success',
    3
  );
  
  Logger.log(`[handleOrdered] Updated order details for ${requestID}`);
}

/**
 * RECEIVED → Prompt for inventory entry
 */
function handleReceived(sheet, row) {
  Logger.log(`[handleReceived] Processing row ${row}`);
  
  const ss = SpreadsheetApp.getActive();
  const requestData = sheet.getRange(row, 1, sheet.getLastColumn()).getValues()[0];
  const requestID = requestData[PART_REQUESTS_COLS.REQUEST_ID - 1];
  const partName = requestData[PART_REQUESTS_COLS.PART_NAME - 1];
  const sku = requestData[PART_REQUESTS_COLS.SKU - 1];
  const quantity = requestData[PART_REQUESTS_COLS.QUANTITY - 1];
  const mentorNotes = requestData[PART_REQUESTS_COLS.MENTOR_NOTES - 1];
  
  // Update order status
  const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  const orderRow = findOrderByRequestId(ordersSheet, requestID);
  
  if (orderRow) {
    ordersSheet.getRange(orderRow, ORDERS_COLS.RECEIVED_DATE).setValue(new Date());
    ordersSheet.getRange(orderRow, ORDERS_COLS.ORDER_STATUS).setValue('Received');
  }
  
  // Prompt for inventory location
  const ui = SpreadsheetApp.getUi();
  const locationResponse = ui.prompt(
    '📦 Add to Inventory',
    `Part: ${partName || sku}\nQuantity: ${quantity}\n\nEnter storage location (e.g., BIN-001):`,
    ui.ButtonSet.OK_CANCEL
  );
  
  if (locationResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }
  
  const location = locationResponse.getResponseText();
  
  if (!location) {
    SpreadsheetApp.getActive().toast(
      'Location required to add to inventory',
      '⚠️ Warning',
      3
    );
    return;
  }
  
  // Add to inventory (or update if exists)
  addToInventory(sku, partName, quantity, location);
  
  // Update mentor notes
  const timestamp = new Date().toLocaleDateString();
  const updatedNotes = (mentorNotes || '') + '\n[' + timestamp + '] Received, added to inventory at ' + location;
  sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);
  
  SpreadsheetApp.getActive().toast(
    `✅ Added ${quantity}x ${partName || sku} to ${location}`,
    'Inventory Updated',
    4
  );
  
  Logger.log(`[handleReceived] Added to inventory: ${sku} at ${location}`);
}

/**
 * COMPLETE → Archive and mark complete
 */
function handleComplete(sheet, row) {
  Logger.log(`[handleComplete] Processing row ${row}`);
  
  const requestData = sheet.getRange(row, 1, sheet.getLastColumn()).getValues()[0];
  const requestID = requestData[PART_REQUESTS_COLS.REQUEST_ID - 1];
  const mentorNotes = requestData[PART_REQUESTS_COLS.MENTOR_NOTES - 1];
  
  // Update mentor notes with completion
  const timestamp = new Date().toLocaleDateString();
  const updatedNotes = (mentorNotes || '') + '\n[' + timestamp + '] ✔️ Request complete - in inventory';
  sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);
  
  // Optional: Apply gray background to mark as complete
  sheet.getRange(row, 1, 1, sheet.getLastColumn()).setBackground('#f0f0f0');
  
  SpreadsheetApp.getActive().toast(
    '✔️ Request marked complete',
    'Success',
    3
  );
  
  Logger.log(`[handleComplete] Marked ${requestID} as complete`);
}

/**
 * DENIED → Prompt for reason
 */
function handleDenied(sheet, row) {
  Logger.log(`[handleDenied] Processing row ${row}`);
  
  const requestData = sheet.getRange(row, 1, sheet.getLastColumn()).getValues()[0];
  const requestID = requestData[PART_REQUESTS_COLS.REQUEST_ID - 1];
  const requester = requestData[PART_REQUESTS_COLS.REQUESTER - 1];
  const mentorNotes = requestData[PART_REQUESTS_COLS.MENTOR_NOTES - 1];
  
  // Prompt for denial reason
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    '❌ Deny Request',
    `Denying request ${requestID}\n\nPlease provide a reason:`,
    ui.ButtonSet.OK_CANCEL
  );
  
  if (response.getSelectedButton() !== ui.Button.OK) {
    // User cancelled - revert status
    sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_STATUS).setValue(STATUS.UNDER_REVIEW);
    return;
  }
  
  const reason = response.getResponseText();
  
  if (!reason || reason.trim() === '') {
    SpreadsheetApp.getActive().toast(
      'Reason required for denial',
      '⚠️ Warning',
      3
    );
    sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_STATUS).setValue(STATUS.UNDER_REVIEW);
    return;
  }
  
  // Update mentor notes
  const timestamp = new Date().toLocaleDateString();
  const updatedNotes = (mentorNotes || '') + '\n[' + timestamp + '] ❌ DENIED: ' + reason;
  sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);
  
  // Apply red background
  sheet.getRange(row, 1, 1, sheet.getLastColumn()).setBackground('#ffcccc');
  
  // Notify via Discord
  sendDiscordNotification('denied', {
    requestID: requestID,
    requester: requester,
    reason: reason
  });
  
  SpreadsheetApp.getActive().toast(
    `❌ Request ${requestID} denied: ${reason}`,
    'Request Denied',
    4
  );
  
  Logger.log(`[handleDenied] Denied ${requestID}: ${reason}`);
}

/**
 * UNDER REVIEW → Just log it
 */
function handleUnderReview(sheet, row) {
  Logger.log(`[handleUnderReview] Row ${row} marked for review`);
  
  SpreadsheetApp.getActive().toast(
    '👀 Request marked for review',
    'Status Updated',
    2
  );
}

/**
 * ON HOLD → Just log it
 */
function handleOnHold(sheet, row) {
  Logger.log(`[handleOnHold] Row ${row} placed on hold`);
  
  SpreadsheetApp.getActive().toast(
    '⏸️ Request placed on hold',
    'Status Updated',
    2
  );
}

/******************************************************
 * HELPER FUNCTIONS
 ******************************************************/

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
      return i + 1; // Return 1-indexed row number
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
  
  // Check if item already exists
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
    // Update existing quantity
    const currentQty = inventorySheet.getRange(existingRow, INVENTORY_COLS.QTY_ON_HAND).getValue() || 0;
    const newQty = parseFloat(currentQty) + parseFloat(quantity);
    inventorySheet.getRange(existingRow, INVENTORY_COLS.QTY_ON_HAND).setValue(newQty);
    inventorySheet.getRange(existingRow, INVENTORY_COLS.LAST_COUNT_DATE).setValue(new Date());
    
    Logger.log(`[addToInventory] Updated ${sku}: ${currentQty} → ${newQty}`);
  } else {
    // Add new row
    const nextRow = inventorySheet.getLastRow() + 1;
    
    inventorySheet.getRange(nextRow, INVENTORY_COLS.SKU).setValue(sku || '');
    inventorySheet.getRange(nextRow, INVENTORY_COLS.PART_NAME).setValue(partName || '');
    inventorySheet.getRange(nextRow, INVENTORY_COLS.LOCATION).setValue(location);
    inventorySheet.getRange(nextRow, INVENTORY_COLS.QTY_ON_HAND).setValue(quantity);
    inventorySheet.getRange(nextRow, INVENTORY_COLS.LAST_COUNT_DATE).setValue(new Date());
    
    Logger.log(`[addToInventory] Added new item ${sku} with qty ${quantity}`);
  }
}

function sendDiscordNotification(type, data) {
  try {
    const props = PropertiesService.getScriptProperties();
    const webhookUrl = props.getProperty('DISCORD_PROCUREMENT_WEBHOOK_URL');
    
    if (!webhookUrl) {
      Logger.log('[sendDiscordNotification] No webhook configured');
      return;
    }
    
    let embed;
    
    if (type === 'approved') {
      embed = {
        title: '✅ Request Approved',
        color: 0x00FF00,
        fields: [
          { name: 'Request ID', value: data.requestID, inline: true },
          { name: 'Order ID', value: data.orderID, inline: true },
          { name: 'Requester', value: data.requester || 'Unknown', inline: true },
          { name: 'Part', value: data.partName, inline: false },
          { name: 'Quantity', value: String(data.quantity), inline: true },
          { name: 'Vendor', value: data.vendor || 'TBD', inline: true }
        ],
        footer: { text: '🎃 Ready to order!' },
        timestamp: new Date().toISOString()
      };
    } else if (type === 'denied') {
      embed = {
        title: '❌ Request Denied',
        color: 0xFF0000,
        fields: [
          { name: 'Request ID', value: data.requestID, inline: true },
          { name: 'Requester', value: data.requester || 'Unknown', inline: true },
          { name: 'Reason', value: data.reason, inline: false }
        ],
        timestamp: new Date().toISOString()
      };
    }
    
    if (embed) {
      const payload = {
        embeds: [embed]
      };
      
      UrlFetchApp.fetch(webhookUrl, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      
      Logger.log('[sendDiscordNotification] Sent ' + type + ' notification');
    }
  } catch (err) {
    Logger.log('[sendDiscordNotification] Error: ' + err);
  }
}

/******************************************************
 * MENU SETUP
 ******************************************************/

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🎃 PartBot')
    .addItem('⚙️ Setup Dropdown Workflow', 'setupDropdownWorkflow')
    .addSeparator()
    .addItem('📊 Show Workflow Guide', 'showWorkflowGuide')
    .addToUi();
}

function showWorkflowGuide() {
  const ui = SpreadsheetApp.getUi();
  
  const guide = 
    '🎃 DROPDOWN WORKFLOW GUIDE\n\n' +
    'Just change the Status dropdown - automation handles the rest!\n\n' +
    '📥 SUBMITTED → New request (default)\n' +
    '👀 UNDER REVIEW → Mentor reviewing\n' +
    '✅ APPROVED → Auto-creates order in Orders sheet\n' +
    '🛒 ORDERED → Prompts for order date & tracking\n' +
    '📦 RECEIVED → Prompts for inventory location\n' +
    '✔️ COMPLETE → Marks as done, archives\n' +
    '❌ DENIED → Prompts for reason, notifies student\n' +
    '⏸️ ON HOLD → Waiting for more info\n\n' +
    'FLOW:\n' +
    'Submitted → Under Review → Approved → Ordered → Received → Complete\n\n' +
    'TIP: Use keyboard shortcuts!\n' +
    '• Tab to Status column\n' +
    '• Type to filter dropdown (e.g., "app" for Approved)\n' +
    '• Enter to confirm\n' +
    '• Down arrow to next request';
  
  ui.alert('Workflow Guide', guide, ui.ButtonSet.OK);
}