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
 * CONSOLIDATED CONFIGURATION
 ******************************************************/

// Sheet names
const SHEET_NAMES = {
  PART_REQUESTS: 'Part Requests',
  ORDERS: 'Orders',
  INVENTORY: 'Inventory',
  BOM_IMPORT: 'Onshape_BOM'
};

// Script property keys
const SCRIPT_PROPERTIES = {
  DISCORD_PROCUREMENT_WEBHOOK: 'DISCORD_PROCUREMENT_WEBHOOK_URL',
  DISCORD_PROCUREMENT_ROLE: 'DISCORD_PROCUREMENT_ROLE_ID',
  OPENAI_API_KEY: 'OPENAI_API_KEY'
};

// API Configuration
const API_CONFIG = {
  OPENAI_MODEL: 'gpt-4o-mini',
  OPENAI_ENDPOINT: 'https://api.openai.com/v1/chat/completions'
};

/******************************************************
 * COLUMN INDEX CONSTANTS
 ******************************************************/

// Part Requests sheet columns (1-based indexing for Google Sheets)
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

// Orders sheet columns (1-based indexing)
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

// Inventory sheet columns (1-based indexing)
const INVENTORY_COLS = {
  SKU: 1,
  VENDOR: 2,
  PART_NAME: 3,
  LOCATION: 4,
  QTY_ON_HAND: 5
};

// Form response columns (0-based indexing - matches form data array)
const FORM_COLS = {
  TIMESTAMP: 0,
  REQUESTER: 1,
  SUBSYSTEM: 2,
  PART_LINK: 3,
  NEEDED_BY: 4,
  QUANTITY: 5,
  MAX_BUDGET: 6,
  PRIORITY: 7,
  NOTES: 8
};

/******************************************************
 * NORMALIZATION & HEADER HELPERS
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

/******************************************************
 * TEMPORARY - FOR TEST
 ******************************************************/

function doGet(e) {
  return ContentService
    .createTextOutput('OK FROM FRC PURCHASING WEB APP')
    .setMimeType(ContentService.MimeType.TEXT);
}

/******************************************************
 * MENU AND UI
 ******************************************************/

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('FRC Purchasing')
    .addItem('Approve selected request', 'approveSelectedRequest')
    .addItem('Enrich selected request (AI)', 'enrichSelectedFromMenu')
    .addToUi();
}

/******************************************************
 * FORM → PART REQUESTS
 * Trigger: From spreadsheet → On form submit
 ******************************************************/

function onFormSubmit(e) {
  const ss = SpreadsheetApp.getActive();
  const formResponsesSheet = e.range.getSheet();
  
  const formRow = e.range.getRow();
  const formData = formResponsesSheet
    .getRange(formRow, 1, 1, formResponsesSheet.getLastColumn())
    .getValues()[0];
  
  // Extract form data using constants
  const requestData = {
    timestamp: formData[FORM_COLS.TIMESTAMP],
    requester: formData[FORM_COLS.REQUESTER],
    subsystem: formData[FORM_COLS.SUBSYSTEM],
    partLink: formData[FORM_COLS.PART_LINK],
    neededBy: formData[FORM_COLS.NEEDED_BY],
    quantity: formData[FORM_COLS.QUANTITY],
    maxBudget: formData[FORM_COLS.MAX_BUDGET],
    priority: formData[FORM_COLS.PRIORITY],
    notes: formData[FORM_COLS.NOTES] || ''
  };
  
  const { requestID, row } = createPartRequest_(requestData);
  
  // Enrich with AI
  try {
    enrichPartRequest(row, requestData.notes);
  } catch (err) {
    Logger.log('[onFormSubmit] Enrichment error for row ' + row + ': ' + err);
  }
}

/******************************************************
 * CREATE PART REQUEST (shared by form and Discord)
 ******************************************************/

/**
 * Creates a new part request in the Part Requests sheet
 * @param {Object} data - Request data
 * @param {Date} data.timestamp - Request timestamp
 * @param {string} data.requester - Name of requester
 * @param {string} data.subsystem - Subsystem name
 * @param {string} data.partLink - URL to part
 * @param {number} data.quantity - Quantity needed
 * @param {string} data.priority - Priority level
 * @param {string} data.neededBy - Date needed by
 * @param {string} data.maxBudget - Maximum budget
 * @param {string} data.notes - Additional notes
 * @returns {Object} Object containing requestID and row number
 */
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
  
  // Use column constants instead of magic numbers
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
  
  return { requestID, row: nextRow };
}

/******************************************************
 * doPost – Web App endpoint for Discord
 ******************************************************/

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ status: 'error', message: 'No post data' });
    }

    const raw = e.postData.contents;
    Logger.log('[doPost] Raw body: ' + raw);

    const body = JSON.parse(raw);

    // Inventory lookup
    if (body.action === 'inventory') {
      Logger.log('[doPost] Inventory action, sku="%s" search="%s"', body.sku || '', body.search || '');
      return handleInventoryLookup_({
        sku: body.sku || '',
        search: body.search || ''
      });
    }

    // Discord part request
    if (body.action === 'discordRequest') {
      return handleDiscordRequest_(body);
    }

    // Order / request status lookup
    if (body.action === 'orderStatus') {
      return handleOrderStatus_(body);
    }

    // Open (not yet received) orders
    if (body.action === 'openOrders') {
      return handleOpenOrders_(body);
    }

    return jsonResponse_({ status: 'error', message: 'Unknown action' });

  } catch (err) {
    Logger.log('[doPost] Error: ' + err);
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/******************************************************
 * DISCORD PROCUREMENT NOTIFICATION (via Webhook)
 ******************************************************/

function sendProcurementNotification_(request) {
  const props = PropertiesService.getScriptProperties();
  const webhookUrl = props.getProperty(SCRIPT_PROPERTIES.DISCORD_PROCUREMENT_WEBHOOK);
  
  if (!webhookUrl) {
    Logger.log('[sendProcurementNotification_] No webhook URL configured; skipping.');
    return;
  }

  const roleId = props.getProperty(SCRIPT_PROPERTIES.DISCORD_PROCUREMENT_ROLE);
  const rolePing = roleId ? `<@&${roleId}>` : '';

  const {
    requestID,
    timestamp,
    requester,
    subsystem,
    partName,
    sku,
    link,
    quantity,
    priority,
    neededBy,
    maxBudget,
    notes
  } = request;

  const content = rolePing
    ? `${rolePing} New part request submitted: **${requestID || ''}**`
    : `New part request submitted: **${requestID || ''}**`;

  const embed = {
    title: 'New Part Request',
    fields: [
      { name: 'Requester', value: requester || 'Unknown', inline: true },
      { name: 'Subsystem', value: subsystem || '—', inline: true },
      { name: 'Priority', value: priority || 'Medium', inline: true },
      { name: 'Quantity', value: String(quantity || ''), inline: true },
      { name: 'Needed By', value: neededBy ? String(neededBy) : '—', inline: true },
      { name: 'Max Budget', value: maxBudget ? String(maxBudget) : '—', inline: true },
      { name: 'Part Name', value: partName || '—', inline: false },
      { name: 'SKU', value: sku || '—', inline: true },
      { name: 'Link', value: link || '—', inline: false },
      { name: 'Notes', value: notes || '—', inline: false }
    ],
    timestamp: (timestamp instanceof Date ? timestamp : new Date()).toISOString()
  };

  const payload = {
    content: content,
    embeds: [embed]
  };

  try {
    const resp = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    Logger.log('[sendProcurementNotification_] Response: %s %s',
               resp.getResponseCode(), resp.getContentText());
  } catch (err) {
    Logger.log('[sendProcurementNotification_] Error: ' + err);
  }
}

/******************************************************
 * DISCORD → PART REQUESTS
 ******************************************************/

function handleDiscordRequest_(body) {
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
  
  // Enrich with AI
  try {
    Logger.log('[handleDiscordRequest_] Calling enrichPartRequest for row ' + row);
    enrichPartRequest(row, requestData.notes);
  } catch (err) {
    Logger.log('[handleDiscordRequest_] Enrichment error for row ' + row + ': ' + err);
  }
  
  // Send Discord notification
  sendProcurementNotification_({
    requestID: requestID,
    timestamp: requestData.timestamp,
    requester: requestData.requester,
    subsystem: requestData.subsystem,
    partName: '',   // AI fills later
    sku: '',
    link: requestData.partLink,
    quantity: requestData.quantity,
    priority: requestData.priority,
    neededBy: requestData.neededBy,
    maxBudget: requestData.maxBudget,
    notes: requestData.notes
  });
  
  return jsonResponse_({ status: 'ok', requestID: requestID });
}

/******************************************************
 * FUNCTION TO HANDLE STATUS CHANGE TO "APPROVED"
 ******************************************************/

function onEdit(e) {
  if (!e || !e.range) return;
  
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAMES.PART_REQUESTS) return;
  
  const row = e.range.getRow();
  const col = e.range.getColumn();
  
  if (row === 1) return; // Skip header
  if (col !== PART_REQUESTS_COLS.REQUEST_STATUS) return; // Only watch status column
  
  const newValue = (e.value || '').toString().trim();
  
  if (newValue.toLowerCase() !== 'approved') return;
  
  try {
    approveRequest(row);
  } catch (err) {
    Logger.log('[onEdit] approveRequest error for row ' + row + ': ' + err);
  }
}

/******************************************************
 * AI ENRICHMENT (Part Name, SKU, Price, Vendor Stock)
 ******************************************************/

/**
 * Enriches a part request with AI-generated data
 * @param {number} row - The row number in Part Requests sheet
 * @param {string} hintText - Optional hint text to guide AI part selection
 */
function enrichPartRequest(row, hintText) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const inventorySheet = ss.getSheetByName(SHEET_NAMES.INVENTORY);
  
  const url = sheet.getRange(row, PART_REQUESTS_COLS.PART_LINK).getValue();
  if (!url) {
    Logger.log('[enrichPartRequest] No URL in row ' + row);
    return;
  }
  
  let htmlSnippet = '';
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    htmlSnippet = resp.getContentText().substring(0, 15000);
  } catch (err) {
    Logger.log('[enrichPartRequest] Error fetching URL for row ' + row + ': ' + err);
  }
  
  const notes = sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).getValue() || hintText || '';
  
  const aiData = getPartInfoFromAI_(url, htmlSnippet, notes);
  if (!aiData) {
    Logger.log('[enrichPartRequest] AI enrichment failed for row ' + row);
    return;
  }
  
  let partName = aiData.partName || '';
  let sku = aiData.sku || '';
  const price = aiData.estimatedPrice || '';
  const stockState = aiData.stockStatus || '';
  
  // Validate SKU appears in HTML
  sku = validateSku_(sku, htmlSnippet, url, row);
  
  // Update sheet using column constants
  if (partName) sheet.getRange(row, PART_REQUESTS_COLS.PART_NAME).setValue(partName);
  if (sku) sheet.getRange(row, PART_REQUESTS_COLS.SKU).setValue(sku);
  if (price) sheet.getRange(row, PART_REQUESTS_COLS.EST_UNIT_PRICE).setValue(price);
  if (stockState) sheet.getRange(row, PART_REQUESTS_COLS.VENDOR_STOCK).setValue(stockState);
  
  // Update inventory on-hand
  if (inventorySheet && sku) {
    const rec = getInventoryRecordBySku_(inventorySheet, sku);
    const invOnHand = rec ? rec.quantity : 0;
    
    Logger.log('[enrichPartRequest] Row %s: SKU="%s", invOnHand=%s', row, sku, invOnHand);
    
    sheet.getRange(row, PART_REQUESTS_COLS.INVENTORY_ON_HAND).setValue(invOnHand);
  } else {
    Logger.log('[enrichPartRequest] Row %s: inventory lookup skipped (inventorySheet=%s, sku="%s")',
               row, !!inventorySheet, sku);
  }
}

/**
 * Menu-triggered enrichment for selected row
 */
function enrichSelectedFromMenu() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const active = sheet.getActiveRange();
  
  if (!active) {
    SpreadsheetApp.getUi().alert('Select a row in the Part Requests sheet.');
    return;
  }
  
  const row = active.getRow();
  if (row === 1) {
    SpreadsheetApp.getUi().alert('Row 1 is headers. Select a data row.');
    return;
  }
  
  const notes = sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).getValue() || '';
  enrichPartRequest(row, notes);
  SpreadsheetApp.getUi().alert('AI enrichment attempted for row ' + row + '.');
}

/**
 * Validates SKU by checking if it appears in HTML content
 * @param {string} sku - SKU to validate
 * @param {string} html - HTML content to search
 * @param {string} url - URL for special case handling
 * @param {number} row - Row number for logging
 * @returns {string} Validated SKU or empty string
 */
function validateSku_(sku, html, url, row) {
  if (!sku) return '';
  
  const urlLower = url.toLowerCase();
  const normalizedHtml = html.toLowerCase();
  const normalizedSku = sku.toString().toLowerCase();
  
  // Special handling: WCP ball bearings multi-variant page
  if (urlLower.includes('wcproducts.com/collections/cnc-hardware/products/ball-bearings')) {
    if (!normalizedHtml.includes(normalizedSku)) {
      Logger.log('[validateSku_] Discarding AI SKU for WCP bearings page row ' + row);
      return '';
    }
  }
  
  // General validation: SKU must appear in HTML
  if (!normalizedHtml.includes(normalizedSku)) {
    Logger.log('[validateSku_] Discarding AI SKU "' + sku + '" for row ' + row + ' – not found in HTML.');
    return '';
  }
  
  return sku;
}

/**
 * Calls OpenAI API to extract part information
 * @param {string} url - Part URL
 * @param {string} htmlSnippet - HTML content snippet
 * @param {string} hintText - User hint text
 * @returns {Object|null} Part information or null if failed
 */
function getPartInfoFromAI_(url, htmlSnippet, hintText) {
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty(SCRIPT_PROPERTIES.OPENAI_API_KEY);
  
  if (!apiKey) {
    throw new Error(SCRIPT_PROPERTIES.OPENAI_API_KEY + ' is not set in Script properties.');
  }
  
  const systemPrompt = `
You help a high school FRC robotics team identify parts from vendor pages
(REV Robotics, AndyMark, VEX, McMaster-Carr, DigiKey, Amazon, West Coast Products, etc.).

Given the URL, some HTML content, and an optional user hint (what they want),
extract this info and return STRICT JSON:

{
  "partName": "...",
  "sku": "...",
  "estimatedPrice": number or null,
  "stockStatus": "In stock" | "Low stock" | "Out of stock" | "Unknown"
}

Rules:
- The page may contain MANY variants (e.g., a table of bearings).
- Use the USER HINT to choose ONE best matching part (size, bore, OD, flanged vs not, etc.).
- If no hint is provided, choose the most typical FRC-appropriate part.

- partName: concise but descriptive, e.g. "WCP 0.5\\" Flanged Hex ID Ball Bearing".
- sku: vendor part number IF AND ONLY IF you clearly see it in the HTML text.
  If unsure, use "" (empty string) instead of guessing.
- estimatedPrice: numeric USD (no currency symbol) if visible.
- stockStatus:
    "Out of stock" if clearly unavailable,
    "Low stock" if backordered/limited/pre-order,
    "In stock" if normal add-to-cart with no warnings,
    "Unknown" if unclear.
`;
  
  const hintSection = hintText
    ? `USER HINT:\n${hintText}\n`
    : 'USER HINT: (none)\n';
  
  const userContent = `
URL: ${url}

${hintSection}

HTML SNIPPET (may be truncated):
${htmlSnippet}
`;
  
  const payload = {
    model: API_CONFIG.OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    response_format: { type: 'json_object' }
  };
  
  try {
    const response = UrlFetchApp.fetch(API_CONFIG.OPENAI_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    const code = response.getResponseCode();
    if (code !== 200) {
      Logger.log('[getPartInfoFromAI_] OpenAI error: ' + code + ' ' + response.getContentText());
      return null;
    }
    
    const data = JSON.parse(response.getContentText());
    const content = data.choices[0].message.content;
    const ai = JSON.parse(content);
    
    Logger.log('[getPartInfoFromAI_] AI part info for URL ' + url + ': ' + JSON.stringify(ai));
    return ai;
    
  } catch (err) {
    Logger.log('[getPartInfoFromAI_] Error: ' + err);
    return null;
  }
}

/******************************************************
 * ORDER STATUS LOOKUP
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

  const result = { status: 'ok' };

  // ---------- Lookup by Request ID ----------
  if (requestId && reqSheet) {
    const values = reqSheet.getDataRange().getValues();
    let reqInfo = null;

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const id = (row[PART_REQUESTS_COLS.ID - 1] || '').toString().trim();
      
      if (id === requestId) {
        reqInfo = {
          id: row[PART_REQUESTS_COLS.ID - 1],
          timestamp: row[PART_REQUESTS_COLS.TIMESTAMP - 1],
          requester: row[PART_REQUESTS_COLS.REQUESTER - 1],
          subsystem: row[PART_REQUESTS_COLS.SUBSYSTEM - 1],
          partName: row[PART_REQUESTS_COLS.PART_NAME - 1],
          sku: row[PART_REQUESTS_COLS.SKU - 1],
          link: row[PART_REQUESTS_COLS.PART_LINK - 1],
          qty: row[PART_REQUESTS_COLS.QUANTITY - 1],
          priority: row[PART_REQUESTS_COLS.PRIORITY - 1],
          neededBy: row[PART_REQUESTS_COLS.NEEDED_BY - 1],
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

    result.request = reqInfo;

    // Also find any orders linked to this request ID
    if (ordSheet && reqInfo) {
      const ovals = ordSheet.getDataRange().getValues();
      const linkedOrders = [];

      for (let i = 1; i < ovals.length; i++) {
        const row = ovals[i];
        const includedRaw = (row[ORDERS_COLS.INCLUDED_REQUEST_IDS - 1] || '').toString();
        const ids = includedRaw
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        if (ids.includes(requestId)) {
          linkedOrders.push({
            orderId: row[ORDERS_COLS.ORDER_ID - 1],
            includedRequests: includedRaw,
            vendor: row[ORDERS_COLS.VENDOR - 1],
            partName: row[ORDERS_COLS.PART_NAME - 1],
            sku: row[ORDERS_COLS.SKU - 1],
            qty: row[ORDERS_COLS.QTY_ORDERED - 1],
            unitPrice: row[ORDERS_COLS.FINAL_UNIT_PRICE - 1],
            totalCost: row[ORDERS_COLS.TOTAL_COST - 1],
            orderDate: row[ORDERS_COLS.ORDER_DATE - 1],
            shipping: row[ORDERS_COLS.SHIPPING_METHOD - 1],
            tracking: row[ORDERS_COLS.TRACKING - 1],
            eta: row[ORDERS_COLS.ETA - 1],
            receivedDate: row[ORDERS_COLS.RECEIVED_DATE - 1],
            status: row[ORDERS_COLS.ORDER_STATUS - 1],
            mentorNotes: row[ORDERS_COLS.MENTOR_NOTES - 1]
          });
        }
      }

      result.orders = linkedOrders;
    }
  }

  // ---------- Lookup by Order ID ----------
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
          unitPrice: row[ORDERS_COLS.FINAL_UNIT_PRICE - 1],
          totalCost: row[ORDERS_COLS.TOTAL_COST - 1],
          orderDate: row[ORDERS_COLS.ORDER_DATE - 1],
          shipping: row[ORDERS_COLS.SHIPPING_METHOD - 1],
          tracking: row[ORDERS_COLS.TRACKING - 1],
          eta: row[ORDERS_COLS.ETA - 1],
          receivedDate: row[ORDERS_COLS.RECEIVED_DATE - 1],
          status: row[ORDERS_COLS.ORDER_STATUS - 1],
          mentorNotes: row[ORDERS_COLS.MENTOR_NOTES - 1]
        };
        break;
      }
    }

    result.order = orderInfo;
  }

  return jsonResponse_(result);
}

/******************************************************
 * INVENTORY LOOKUP – FULL RECORD BY SKU (AGGREGATES MULTIPLE ROWS)
 ******************************************************/

/**
 * Gets aggregated inventory record by SKU
 * @param {Sheet} inventorySheet - The inventory sheet
 * @param {string} sku - SKU to look up
 * @returns {Object|null} Aggregated inventory record or null
 */
function getInventoryRecordBySku_(inventorySheet, sku) {
  if (!sku) {
    Logger.log('[getInventoryRecordBySku_] No SKU provided');
    return null;
  }

  const values = inventorySheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    Logger.log('[getInventoryRecordBySku_] Inventory empty');
    return null;
  }

  const header = values[0];
  const rows = values.slice(1);

  const skuCol = findColumnIndex_(header, h =>
    h.includes('sku') || h.includes('part number')
  );
  const qtyCol = findColumnIndex_(header, h =>
    h.includes('qty') || h.includes('on-hand')
  );
  const vendorCol = findColumnIndex_(header, h => h.includes('vendor'));
  const nameCol = findColumnIndex_(header, h => h.includes('part name'));
  const locCol = findColumnIndex_(header, h => h.includes('location'));

  Logger.log('[getInventoryRecordBySku_] Header: ' + JSON.stringify(header));
  Logger.log('[getInventoryRecordBySku_] Columns: skuCol=%s qtyCol=%s vendorCol=%s nameCol=%s locCol=%s',
             skuCol, qtyCol, vendorCol, nameCol, locCol);

  if (skuCol === -1 || qtyCol === -1) {
    Logger.log('[getInventoryRecordBySku_] Could not find SKU or Qty column');
    return null;
  }

  const target = normalizeSku(sku);
  Logger.log('[getInventoryRecordBySku_] Search target="%s"', target);

  let firstMatch = null;
  let totalQty = 0;
  const locations = [];
  const rowIndexes = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowSkuRaw = row[skuCol];
    const rowSkuNorm = normalizeSku(rowSkuRaw);

    if (!rowSkuNorm || rowSkuNorm !== target) {
      continue;
    }

    const qty = Number(row[qtyCol]) || 0;
    totalQty += qty;
    rowIndexes.push(i + 2); // 1-based + header row

    if (locCol !== -1) {
      const loc = (row[locCol] || '').toString().trim();
      if (loc && !locations.includes(loc)) {
        locations.push(loc);
      }
    }

    if (!firstMatch) {
      firstMatch = {
        sku: row[skuCol],
        quantity: 0, // we'll fill in after the loop
        vendor: vendorCol !== -1 ? row[vendorCol] : '',
        name: nameCol !== -1 ? row[nameCol] : '',
        location: locCol !== -1 ? row[locCol] : '',
        rowIndex: i + 2
      };
    }
  }

  if (!firstMatch) {
    Logger.log('[getInventoryRecordBySku_] No match for "%s"', sku);
    return null;
  }

  // Aggregate quantity and locations
  firstMatch.quantity = totalQty;
  if (locations.length > 0) {
    firstMatch.location = locations.join(' | ');
  }
  firstMatch.rowIndexes = rowIndexes;

  Logger.log('[getInventoryRecordBySku_] Aggregated record: ' + JSON.stringify(firstMatch));
  return firstMatch;
}

/**
 * Compatibility wrapper – quantity only
 * @deprecated Use getInventoryRecordBySku_ for full record
 */
function lookupInventoryBySKU(inventorySheet, sku) {
  const rec = getInventoryRecordBySku_(inventorySheet, sku);
  return rec ? rec.quantity : 0;
}

/******************************************************
 * INVENTORY LOOKUP
 ******************************************************/

function handleInventoryLookup_(body) {
  const ss = SpreadsheetApp.getActive();
  const inventorySheet = ss.getSheetByName(SHEET_NAMES.INVENTORY);
  
  if (!inventorySheet) {
    return jsonResponse_({ status: 'error', message: 'Inventory sheet not found' });
  }

  const skuQuery = (body.sku || '').toString().trim();
  const searchText = (body.search || '').toString().trim();

  Logger.log('[handleInventoryLookup_] sku="%s" search="%s"', skuQuery, searchText);

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

  Logger.log('[handleInventoryLookup_] Header=' + JSON.stringify(header));
  Logger.log('[handleInventoryLookup_] Columns: SKU=%s Vendor=%s Name=%s Loc=%s Qty=%s',
             SKU_COL, VENDOR_COL, NAME_COL, LOC_COL, QTY_COL);

  const matches = [];

  /******************************************************
   * LOCATION LOOKUP (BIN-xxx, RACK-xxx)
   ******************************************************/
  const upperSearch = searchText.toUpperCase();
  const isLocationLookup =
    upperSearch.startsWith('BIN-') ||
    upperSearch.startsWith('RACK-');

  if (isLocationLookup && LOC_COL !== -1 && QTY_COL !== -1 && NAME_COL !== -1) {
    Logger.log('[handleInventoryLookup_] Location lookup for "%s"', upperSearch);

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

    Logger.log('[handleInventoryLookup_] Location result: ' + JSON.stringify(matches));
    return jsonResponse_({ status: 'ok', matches: matches });
  }

  /******************************************************
   * SKU EXACT LOOKUP
   ******************************************************/
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

  /******************************************************
   * FUZZY SEARCH FALLBACK
   ******************************************************/
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

  Logger.log('[handleInventoryLookup_] Result: ' + JSON.stringify(matches));
  return jsonResponse_({ status: 'ok', matches });
}

/******************************************************
 * OPEN ORDERS
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

  const ordValues = ordSheet.getDataRange().getValues();
  const orders = [];

  if (ordValues && ordValues.length > 1) {
    const rows = ordValues.slice(1);
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      const orderId = (row[ORDERS_COLS.ORDER_ID - 1] || '').toString().trim();
      const vendor = row[ORDERS_COLS.VENDOR - 1] || '';
      const partName = row[ORDERS_COLS.PART_NAME - 1] || '';
      const sku = row[ORDERS_COLS.SKU - 1] || '';
      const qty = row[ORDERS_COLS.QTY_ORDERED - 1] || '';
      const orderDate = row[ORDERS_COLS.ORDER_DATE - 1] || '';
      const shipping = row[ORDERS_COLS.SHIPPING_METHOD - 1] || '';
      const tracking = row[ORDERS_COLS.TRACKING - 1] || '';
      const eta = row[ORDERS_COLS.ETA - 1] || '';
      const received = row[ORDERS_COLS.RECEIVED_DATE - 1];
      const status = (row[ORDERS_COLS.ORDER_STATUS - 1] || '').toString().trim();
      const reqIds = row[ORDERS_COLS.INCLUDED_REQUEST_IDS - 1] || '';

      // "Not received" definition:
      // - No Received Date
      // - AND status is not "Cancelled"
      const hasReceivedDate = !!received;
      const isCancelled = status.toLowerCase() === 'cancelled';

      if (!hasReceivedDate && !isCancelled && orderId) {
        orders.push({
          orderId: orderId,
          includedRequests: reqIds,
          vendor: vendor,
          partName: partName,
          sku: sku,
          qty: qty,
          orderDate: orderDate,
          shipping: shipping,
          tracking: tracking,
          eta: eta,
          status: status
        });
      }
    }
  }

  // ---- Collect "Denied" requests from Part Requests sheet ----
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
            timestamp: row[PART_REQUESTS_COLS.TIMESTAMP - 1],
            requester: row[PART_REQUESTS_COLS.REQUESTER - 1],
            subsystem: row[PART_REQUESTS_COLS.SUBSYSTEM - 1],
            partName: row[PART_REQUESTS_COLS.PART_NAME - 1],
            sku: row[PART_REQUESTS_COLS.SKU - 1],
            link: row[PART_REQUESTS_COLS.PART_LINK - 1],
            qty: row[PART_REQUESTS_COLS.QUANTITY - 1],
            priority: row[PART_REQUESTS_COLS.PRIORITY - 1],
            neededBy: row[PART_REQUESTS_COLS.NEEDED_BY - 1],
            mentorNotes: row[PART_REQUESTS_COLS.MENTOR_NOTES - 1] || ''
          });
        }
      }
    }
  }

  Logger.log('[handleOpenOrders_] Found %s open orders and %s denied requests', 
             orders.length, denied.length);

  return jsonResponse_({
    status: 'ok',
    orders: orders,
    denied: denied
  });
}

/******************************************************
 * APPROVAL WORKFLOW
 ******************************************************/

function approveSelectedRequest() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const activeRange = sheet.getActiveRange();

  if (!activeRange) {
    SpreadsheetApp.getUi().alert('Select a cell in the request row first.');
    return;
  }

  const row = activeRange.getRow();
  if (row === 1) {
    SpreadsheetApp.getUi().alert('Row 1 is headers. Select a data row.');
    return;
  }

  approveRequest(row);
  SpreadsheetApp.getUi().alert('Request on row ' + row + ' approved and added to Orders.');
}

/**
 * Approves a request and creates an order
 * @param {number} requestRow - Row number of the request to approve
 */
function approveRequest(requestRow) {
  const ss = SpreadsheetApp.getActive();
  const requestSheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const orderSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  
  // Read request data using column constants
  const requestID = requestSheet.getRange(requestRow, PART_REQUESTS_COLS.ID).getValue();
  const partName = requestSheet.getRange(requestRow, PART_REQUESTS_COLS.PART_NAME).getValue();
  const sku = requestSheet.getRange(requestRow, PART_REQUESTS_COLS.SKU).getValue();
  const link = requestSheet.getRange(requestRow, PART_REQUESTS_COLS.PART_LINK).getValue();
  const qty = requestSheet.getRange(requestRow, PART_REQUESTS_COLS.QUANTITY).getValue();
  const estUnit = requestSheet.getRange(requestRow, PART_REQUESTS_COLS.EST_UNIT_PRICE).getValue();
  const totalEst = requestSheet.getRange(requestRow, PART_REQUESTS_COLS.TOTAL_EST_COST).getValue();
  const budgetStatus = requestSheet.getRange(requestRow, PART_REQUESTS_COLS.BUDGET_STATUS).getValue();
  const shipping = requestSheet.getRange(requestRow, PART_REQUESTS_COLS.EXPEDITED_SHIPPING).getValue() || 'Standard';
  
  if (!requestID) {
    throw new Error('No Request ID found in row ' + requestRow);
  }
  
  if (budgetStatus && budgetStatus.toString().startsWith('Over Budget')) {
    throw new Error('Request ' + requestID + ' exceeds budget. Fix or override before approving.');
  }
  
  const orderID = 'ORD-' + Utilities.getUuid().split('-')[0];
  const vendor = extractVendorFromURL(link);
  
  // Append to Orders sheet using column constants
  const orderData = new Array(ORDERS_COLS.MENTOR_NOTES).fill('');
  orderData[ORDERS_COLS.ORDER_ID - 1] = orderID;
  orderData[ORDERS_COLS.INCLUDED_REQUEST_IDS - 1] = requestID;
  orderData[ORDERS_COLS.VENDOR - 1] = vendor;
  orderData[ORDERS_COLS.PART_NAME - 1] = partName;
  orderData[ORDERS_COLS.SKU - 1] = sku;
  orderData[ORDERS_COLS.QTY_ORDERED - 1] = qty;
  orderData[ORDERS_COLS.FINAL_UNIT_PRICE - 1] = estUnit;
  orderData[ORDERS_COLS.TOTAL_COST - 1] = totalEst;
  orderData[ORDERS_COLS.ORDER_DATE - 1] = new Date();
  orderData[ORDERS_COLS.SHIPPING_METHOD - 1] = shipping;
  orderData[ORDERS_COLS.ORDER_STATUS - 1] = 'Ordered';
  
  orderSheet.appendRow(orderData);
  
  // Update request status
  requestSheet.getRange(requestRow, PART_REQUESTS_COLS.REQUEST_STATUS).setValue('Ordered');
}

/******************************************************
 * VENDOR EXTRACTION HELPER
 ******************************************************/

function extractVendorFromURL(url) {
  if (!url) return 'Other Vendor';
  
  const lower = url.toLowerCase();
  
  if (lower.includes('revrobotics')) return 'REV Robotics';
  if (lower.includes('andymark')) return 'AndyMark';
  if (lower.includes('mcmaster')) return 'McMaster-Carr';
  if (lower.includes('vexrobotics')) return 'VEX Robotics';
  if (lower.includes('digikey')) return 'DigiKey';
  if (lower.includes('amazon')) return 'Amazon';
  if (lower.includes('wcproducts')) return 'West Coast Products';
  if (lower.includes('ctr-electronics')) return 'CTR Electronics';
  if (lower.includes('reduxrobotics')) return 'ReduxRobotics';
  if (lower.includes('thethirftybot')) return 'ThriftyBot';
  if (lower.includes('homedepot')) return 'Home Depot';
  if (lower.includes('powerwerx')) return 'PowerWorx';
  if (lower.includes('sendcutsend')) return 'SendCutSend';
  if (lower.includes('foamorder')) return 'Foam Order';
  
  return 'Other Vendor';
}