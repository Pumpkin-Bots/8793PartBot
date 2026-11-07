/*
 * 8793PartBot – Automated Parts Management System
 * Copyright (c) 2025 FRC Team 8793 – Pumpkin Bots
 *
 * Licensed under the MIT License with Use Notification Requirement.
 * Full license text available in the project root LICENSE file.
 */

/******************************************************
 * CONFIGURATION
 ******************************************************/

const SHEET_NAMES = {
  PART_REQUESTS: 'Part Requests',
  ORDERS: 'Orders',
  INVENTORY: 'Inventory',
  BUDGET: 'Budget'
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
  EXPEDITED_SHIPPING: 19,
  IN_INVENTORY: 20
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
  ON_HOLD: '⏸️ On Hold',
  CANCELLED: '🚫 Cancelled'
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

    if (action === 'cancelRequest') {
      return handleCancelRequest_(body);
    }

    if (action === 'budgetStatus') {
      return handleBudgetStatus_(body);
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
      sku: body.sku || '',
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
      sku: requestData.sku || '',
      link: requestData.partLink,
      quantity: requestData.quantity,
      priority: requestData.priority,
      neededBy: requestData.neededBy,
      maxBudget: requestData.maxBudget,
      notes: requestData.notes
    });

    // Get budget snapshot to return with response
    let budgetSnapshot = null;
    try {
      budgetSnapshot = getBudgetStatus_();
    } catch (budgetErr) {
      Logger.log('[handleDiscordRequest_] Budget check failed (non-fatal): ' + budgetErr);
    }

    return jsonResponse_({ 
      status: 'ok', 
      requestID: requestID,
      budget: budgetSnapshot
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
  
  if (data.sku) {
    sheet.getRange(nextRow, PART_REQUESTS_COLS.SKU).setValue(data.sku);
    Logger.log('[createPartRequest_] User provided SKU: ' + data.sku);
  }
  
  sheet.getRange(nextRow, PART_REQUESTS_COLS.QUANTITY).setValue(data.quantity);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.PRIORITY).setValue(data.priority);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.NEEDED_BY).setValue(data.neededBy);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.MAX_BUDGET).setValue(data.maxBudget);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.REQUEST_STATUS).setValue(STATUS.SUBMITTED);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(data.notes);
  sheet.getRange(nextRow, PART_REQUESTS_COLS.EXPEDITED_SHIPPING).setValue(expeditedShipping);
  
  if (data.partLink) {
    try {
      enrichPartRequest(requestID, nextRow);
    } catch (err) {
      Logger.log('[createPartRequest_] Enrichment failed: ' + err);
    }
  }

  // Write initial budget status (may be "No price yet" if enrichment pending)
  try {
    updateBudgetStatus_(sheet, nextRow);
  } catch (err) {
    Logger.log('[createPartRequest_] Budget status failed (non-fatal): ' + err);
  }

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

function debugBudgetV3() {
  const ss    = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Budget');
  
  for (let i = 1; i <= 14; i++) {
    const a = sheet.getRange('A' + i).getValue();
    const b = sheet.getRange('B' + i).getValue();
    Logger.log(`Row ${i}: A="${a}" | B="${b}" (type: ${typeof b})`);
  }
}

/******************************************************
 * AI ENRICHMENT SYSTEM - Gemini API
 ******************************************************/

function enrichPartRequest(requestID, row) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  
  if (!sheet) {
    Logger.log('[enrichPartRequest] Part Requests sheet not found');
    return;
  }
  
  try {
    Logger.log(`[enrichPartRequest] Starting enrichment for ${requestID} at row ${row}`);
    
    const partLink = sheet.getRange(row, PART_REQUESTS_COLS.PART_LINK).getValue();
    const existingPartName = sheet.getRange(row, PART_REQUESTS_COLS.PART_NAME).getValue();
    const existingSku = sheet.getRange(row, PART_REQUESTS_COLS.SKU).getValue();
    
    if (existingSku) {
      Logger.log('[enrichPartRequest] User provided SKU - will only enrich Part Name and Price');
    }
    
    if (!partLink || (existingPartName && existingSku)) {
      Logger.log('[enrichPartRequest] No link or already has name/SKU, skipping');
      return;
    }
    
    const pageContent = fetchPageContent_(partLink);
    if (!pageContent) {
      Logger.log('[enrichPartRequest] ERROR: Could not fetch page content');
      return;
    }
    
    let extracted = extractWithGemini_(pageContent, partLink);
    
    if (!extracted) {
      extracted = { partName: null, sku: null, price: null };
    }
    
    // McMaster fallback
    if ((!extracted.partName || !extracted.sku) && partLink.toLowerCase().includes('mcmaster.com')) {
      const urlMatch = partLink.match(/mcmaster\.com\/([0-9A-Z\-]+)/i);
      if (urlMatch && urlMatch[1]) {
        const mcmasterSku = urlMatch[1].toUpperCase();
        if (!extracted.partName) extracted.partName = `McMaster ${mcmasterSku}`;
        if (!extracted.sku) extracted.sku = mcmasterSku;
      }
    }
    
    // Amazon fallback
    if ((!extracted.partName || !extracted.sku) && partLink.toLowerCase().includes('amazon.com')) {
      const nameMatch = partLink.match(/amazon\.com\/([^\/]+)\/dp\//i);
      if (nameMatch && nameMatch[1]) {
        const urlSlug = decodeURIComponent(nameMatch[1].replace(/-/g, ' '));
        if (!extracted.partName && urlSlug.length > 3 && urlSlug.length < 150) {
          extracted.partName = urlSlug;
        }
      }
      const asinMatch = partLink.match(/\/dp\/([A-Z0-9]{10})/i);
      if (asinMatch && asinMatch[1] && !extracted.sku) {
        extracted.sku = asinMatch[1].toUpperCase();
      }
    }
    
    let updated = false;
    
    if (extracted.partName && !existingPartName) {
      sheet.getRange(row, PART_REQUESTS_COLS.PART_NAME).setValue(extracted.partName);
      updated = true;
    }
    
    if (extracted.sku && !existingSku) {
      sheet.getRange(row, PART_REQUESTS_COLS.SKU).setValue(extracted.sku);
      updated = true;
    } else if (existingSku) {
      Logger.log(`[enrichPartRequest] Skipping SKU write - user provided: ${existingSku}`);
    }
    
    if (extracted.price) {
      sheet.getRange(row, PART_REQUESTS_COLS.EST_UNIT_PRICE).setValue(extracted.price);
      // Calculate and write Total Est Cost
      const quantity = sheet.getRange(row, PART_REQUESTS_COLS.QUANTITY).getValue() || 1;
      sheet.getRange(row, PART_REQUESTS_COLS.TOTAL_EST_COST).setValue(extracted.price * quantity);
      updated = true;
    }

    if (updated) {
      const timestamp = new Date().toLocaleString();
      const currentNotes = sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).getValue() || '';
      sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(currentNotes + `\n[${timestamp}] ✨ AI enriched`);
    }

    // Always update budget status after enrichment (price may have changed)
    try {
      updateBudgetStatus_(sheet, row);
    } catch (budgetErr) {
      Logger.log('[enrichPartRequest] Budget status update failed (non-fatal): ' + budgetErr);
    }
    
  } catch (err) {
    Logger.log(`[enrichPartRequest] ERROR: ${err}`);
  }
}

function fetchPageContent_(url) {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    };
    
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: headers
    });
    
    if (response.getResponseCode() !== 200) {
      Logger.log(`[fetchPageContent_] HTTP ${response.getResponseCode()} for ${url}`);
      return null;
    }
    
    const html = response.getContentText();
    
    if (url.toLowerCase().includes('mcmaster.com')) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        const title = titleMatch[1].trim();
        if (title !== 'McMaster-Carr' && !title.includes('JavaScript')) {
          return `Product Title: ${title}\n\n${html}`;
        }
      }
      const metaMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
      if (metaMatch && metaMatch[1]) {
        return `Product: ${metaMatch[1]}\n\n${html}`;
      }
    }
    
    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (text.length > 8000) text = text.substring(0, 8000);
    
    return text;
    
  } catch (err) {
    Logger.log(`[fetchPageContent_] Error: ${err}`);
    return null;
  }
}

// ★ IMPROVED: More aggressive price extraction prompt
function extractWithGemini_(pageContent, url) {
  try {
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty('GEMINI_API_KEY');
    
    if (!apiKey) {
      Logger.log('[extractWithGemini_] No GEMINI_API_KEY found in script properties');
      return null;
    }
    
    const vendor = detectVendor(url);
    
    const prompt = `You are a price extraction specialist for an FRC robotics parts ordering system.

URL: ${url}
Vendor: ${vendor}

Page content:
${pageContent}

Extract the following in JSON format:
{
  "partName": "the full product name/title",
  "sku": "the product SKU/part number/model number",
  "price": <unit price as a plain number, no currency symbol, no quotes>
}

PRICE EXTRACTION RULES (critical — follow carefully):
- Find the UNIT price (not total, not shipping)
- Look for patterns like: "$12.99", "Price: 12.99", "USD 12.99", "12.99 each", "Add to cart $12.99"
- For WCP/REV/AndyMark/VexPro: price is shown near "Add to Cart" button, often as "$XX.XX"
- For McMaster-Carr: price appears near the part number, often formatted as "$XX.XX Each"
- For Amazon: use the main displayed price (ignore "List Price" or crossed-out prices)
- For Thrifty Bot / Redux / CTRE / Studica: look for the product price near the buy button
- If multiple prices shown (e.g. pack pricing), use the LOWEST unit price
- If you see a price range like "$10-$20", use the lower bound
- ALWAYS return a number if ANY price is visible on the page
- Only return null if absolutely no price information exists anywhere on the page

PART NAME RULES:
- Use the exact product title from the page
- Keep it under 100 characters
- Include key specs (size, material, quantity in pack)

SKU RULES:
- Use the vendor's part number (e.g. "WCP-0785", "REV-21-2103", "91251A537")
- For Amazon, use the ASIN if no other SKU visible
- For McMaster, use the catalog number from the URL or page

Return ONLY valid JSON. No markdown, no explanation, no backticks.
Example of correct output: {"partName":"WCP Flanged Bearing 1/2 Hex","sku":"WCP-0783","price":4.99}`;
    
    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
    
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { 
        temperature: 0.1,
        maxOutputTokens: 1024
      }
    };
    
    const response = UrlFetchApp.fetch(`${apiUrl}?key=${apiKey}`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      Logger.log(`[extractWithGemini_] API returned ${response.getResponseCode()}: ${response.getContentText()}`);
      return null;
    }
    
    const data = JSON.parse(response.getContentText());
    
    if (!data.candidates || data.candidates.length === 0) {
      Logger.log('[extractWithGemini_] No candidates in response');
      return null;
    }
    
    let jsonText = data.candidates[0].content.parts[0].text.trim();
    Logger.log(`[extractWithGemini_] Raw response: ${jsonText}`);
    
    // Strip markdown backticks if present
    jsonText = jsonText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    
    const extracted = JSON.parse(jsonText);
    Logger.log(`[extractWithGemini_] Extracted: ${JSON.stringify(extracted)}`);
    
    return {
      partName: extracted.partName || null,
      sku:      extracted.sku      || null,
      price:    extracted.price    ? parseFloat(extracted.price) : null
    };
    
  } catch (err) {
    Logger.log(`[extractWithGemini_] Error: ${err}`);
    return null;
  }
}

function enrichSelectedRequest() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const ui = SpreadsheetApp.getUi();
  
  const selection = sheet.getActiveRange();
  if (!selection || selection.getRow() < 2) {
    ui.alert('Please select a request row first');
    return;
  }
  
  const row = selection.getRow();
  const requestID = sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_ID).getValue();
  
  if (!requestID) {
    ui.alert('No request ID found in selected row');
    return;
  }
  
  ui.alert('AI Enrichment', `Enriching ${requestID}...`, ui.ButtonSet.OK);
  enrichPartRequest(requestID, row);
  ui.alert('✅ Done!', 'Check the spreadsheet and Execution log for results.', ui.ButtonSet.OK);
}

/******************************************************
 * INVENTORY LOOKUP HANDLER
 ******************************************************/

function handleInventoryLookup_(body) {
  const ss = SpreadsheetApp.getActive();
  const inventorySheet = ss.getSheetByName(SHEET_NAMES.INVENTORY);

  if (!inventorySheet) {
    return jsonResponse_({ status: 'error', message: 'Inventory sheet not found' });
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

    const SKU_COL    = findColumnIndex_(header, h => h.includes('sku') || h.includes('part number'));
    const VENDOR_COL = findColumnIndex_(header, h => h.includes('vendor'));
    const NAME_COL   = findColumnIndex_(header, h => h.includes('part name'));
    const LOC_COL    = findColumnIndex_(header, h => h.includes('location'));
    const QTY_COL    = findColumnIndex_(header, h => h.includes('qty') || h.includes('on-hand'));

    const matches = [];

    if (skuQuery && SKU_COL !== -1) {
      const targetSku = normalizeSku(skuQuery);
      for (let i = 0; i < rows.length; i++) {
        if (normalizeSku(rows[i][SKU_COL]) === targetSku) {
          matches.push({
            sku: rows[i][SKU_COL],
            vendor: VENDOR_COL !== -1 ? rows[i][VENDOR_COL] : '',
            name: NAME_COL !== -1 ? rows[i][NAME_COL] : '',
            location: LOC_COL !== -1 ? rows[i][LOC_COL] : '',
            quantity: QTY_COL !== -1 ? rows[i][QTY_COL] : ''
          });
        }
      }
    }

    const fallbackQuery = (searchText || skuQuery).toLowerCase();
    if (matches.length === 0 && fallbackQuery && SKU_COL !== -1 && NAME_COL !== -1) {
      for (let i = 0; i < rows.length; i++) {
        const rowSku      = (rows[i][SKU_COL]  || '').toString().toLowerCase();
        const rowName     = (rows[i][NAME_COL]  || '').toString().toLowerCase();
        const rowLocation = LOC_COL !== -1 ? (rows[i][LOC_COL] || '').toString().toLowerCase() : '';

        if (rowSku.indexOf(fallbackQuery) !== -1 ||
            rowName.indexOf(fallbackQuery) !== -1 ||
            rowLocation.indexOf(fallbackQuery) !== -1) {
          matches.push({
            sku: rows[i][SKU_COL],
            vendor: VENDOR_COL !== -1 ? rows[i][VENDOR_COL] : '',
            name: rows[i][NAME_COL],
            location: LOC_COL !== -1 ? rows[i][LOC_COL] : '',
            quantity: rows[i][QTY_COL]
          });
        }
        if (matches.length >= 10) break;
      }
    }

    return jsonResponse_({ status: 'ok', matches: matches });

  } catch (err) {
    Logger.log('[handleInventoryLookup_] Error: ' + err);
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

/******************************************************
 * ORDER STATUS HANDLER
 ******************************************************/

function handleOrderStatus_(body) {
  const ss = SpreadsheetApp.getActive();
  const reqSheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const ordSheet  = ss.getSheetByName(SHEET_NAMES.ORDERS);

  const requestId = (body.requestId || '').toString().trim();
  const orderId   = (body.orderId   || '').toString().trim();

  if (!requestId && !orderId) {
    return jsonResponse_({ status: 'error', message: 'requestId or orderId is required' });
  }

  try {
    const result = { status: 'ok' };

    if (requestId && reqSheet) {
      const values = reqSheet.getDataRange().getValues();
      let reqInfo = null;

      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const id = (row[PART_REQUESTS_COLS.REQUEST_ID - 1] || '').toString().trim();

        if (id === requestId) {
          reqInfo = {
            id:            row[PART_REQUESTS_COLS.REQUEST_ID - 1],
            timestamp:     formatDateForResponse_(row[PART_REQUESTS_COLS.TIMESTAMP - 1]),
            requester:     row[PART_REQUESTS_COLS.REQUESTER - 1],
            subsystem:     row[PART_REQUESTS_COLS.SUBSYSTEM - 1],
            partName:      row[PART_REQUESTS_COLS.PART_NAME - 1],
            sku:           row[PART_REQUESTS_COLS.SKU - 1],
            link:          row[PART_REQUESTS_COLS.PART_LINK - 1],
            qty:           row[PART_REQUESTS_COLS.QUANTITY - 1],
            priority:      row[PART_REQUESTS_COLS.PRIORITY - 1],
            neededBy:      formatDateForResponse_(row[PART_REQUESTS_COLS.NEEDED_BY - 1]),
            requestStatus: row[PART_REQUESTS_COLS.REQUEST_STATUS - 1]
          };
          break;
        }
      }

      if (!reqInfo) {
        return jsonResponse_({ status: 'error', message: 'Request not found: ' + requestId });
      }

      result.request = reqInfo;

      if (ordSheet) {
        const ovals = ordSheet.getDataRange().getValues();
        const linkedOrders = [];

        for (let i = 1; i < ovals.length; i++) {
          const row = ovals[i];
          const ids = (row[ORDERS_COLS.INCLUDED_REQUEST_IDS - 1] || '').toString()
            .split(',').map(s => s.trim()).filter(Boolean);

          if (ids.includes(requestId)) {
            linkedOrders.push({
              orderId:   row[ORDERS_COLS.ORDER_ID - 1],
              vendor:    row[ORDERS_COLS.VENDOR - 1],
              status:    row[ORDERS_COLS.ORDER_STATUS - 1],
              orderDate: formatDateForResponse_(row[ORDERS_COLS.ORDER_DATE - 1]),
              eta:       formatDateForResponse_(row[ORDERS_COLS.ETA_DELIVERY - 1])
            });
          }
        }

        result.orders = linkedOrders;
      }
    }

    if (orderId && ordSheet) {
      const ovals = ordSheet.getDataRange().getValues();
      let orderInfo = null;

      for (let i = 1; i < ovals.length; i++) {
        const row = ovals[i];
        const id = (row[ORDERS_COLS.ORDER_ID - 1] || '').toString().trim();

        if (id === orderId) {
          orderInfo = {
            orderId:          row[ORDERS_COLS.ORDER_ID - 1],
            includedRequests: row[ORDERS_COLS.INCLUDED_REQUEST_IDS - 1],
            vendor:           row[ORDERS_COLS.VENDOR - 1],
            partName:         row[ORDERS_COLS.PART_NAME - 1],
            sku:              row[ORDERS_COLS.SKU - 1],
            qty:              row[ORDERS_COLS.QTY_ORDERED - 1],
            orderDate:        formatDateForResponse_(row[ORDERS_COLS.ORDER_DATE - 1]),
            shipping:         row[ORDERS_COLS.SHIPPING_METHOD - 1],
            tracking:         row[ORDERS_COLS.TRACKING_NUMBER - 1],
            eta:              formatDateForResponse_(row[ORDERS_COLS.ETA_DELIVERY - 1]),
            receivedDate:     formatDateForResponse_(row[ORDERS_COLS.RECEIVED_DATE - 1]),
            status:           row[ORDERS_COLS.ORDER_STATUS - 1]
          };
          break;
        }
      }

      if (!orderInfo) {
        return jsonResponse_({ status: 'error', message: 'Order not found: ' + orderId });
      }

      result.order = orderInfo;
    }

    return jsonResponse_(result);

  } catch (err) {
    Logger.log('[handleOrderStatus_] Error: ' + err);
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

/******************************************************
 * OPEN ORDERS HANDLER
 ******************************************************/

function handleOpenOrders_(body) {
  const ss = SpreadsheetApp.getActive();

  let debugSheet = ss.getSheetByName('Debug Log');
  if (!debugSheet) debugSheet = ss.insertSheet('Debug Log');

  function logToSheet(message) {
    const nextRow = debugSheet.getLastRow() + 1;
    debugSheet.getRange(nextRow, 1).setValue(new Date().toLocaleTimeString());
    debugSheet.getRange(nextRow, 2).setValue(message);
    Logger.log(message);
  }

  try {
    logToSheet('[START] handleOpenOrders_ called');

    const ordSheet = ss.getSheetByName('Orders');
    if (!ordSheet) {
      return jsonResponse_({ status: 'error', message: 'Orders sheet not found' });
    }

    const ordValues = ordSheet.getDataRange().getValues();
    const orders = [];

    if (ordValues && ordValues.length > 1) {
      for (let i = 1; i < ordValues.length; i++) {
        const row = ordValues[i];
        const orderId = row[0];
        if (!orderId || orderId.toString().trim() === '') continue;

        const received  = row[12];
        const status    = row[13] ? row[13].toString().trim() : '';
        const hasReceived = (received !== null && received !== undefined && received !== '');
        const isCancelled = status.toLowerCase().includes('cancel');

        if (!hasReceived && !isCancelled) {
          orders.push({
            orderId:          orderId.toString().trim(),
            includedRequests: row[1] ? row[1].toString() : '',
            vendor:           row[2] ? row[2].toString() : '',
            partName:         row[3] ? row[3].toString() : '',
            sku:              row[4] ? row[4].toString() : '',
            qty:              row[5] || '',
            orderDate:        row[8] || null,
            shipping:         row[9] ? row[9].toString() : '',
            tracking:         row[10] ? row[10].toString() : '',
            eta:              row[11] || null,
            status:           status || 'Unknown'
          });
        }
      }
    }

    const reqSheet = ss.getSheetByName('Part Requests');
    const denied = [];

    if (reqSheet) {
      const reqValues = reqSheet.getDataRange().getValues();
      if (reqValues && reqValues.length > 1) {
        for (let i = 1; i < reqValues.length; i++) {
          const row    = reqValues[i];
          const id     = row[0];
          if (!id || id.toString().trim() === '') continue;

          const status = row[16] ? row[16].toString().trim().toLowerCase() : '';
          if (status === 'denied' || status.includes('❌')) {
            denied.push({
              id:          id.toString(),
              requester:   row[2] ? row[2].toString() : '',
              partName:    row[4] ? row[4].toString() : '',
              mentorNotes: row[17] ? row[17].toString() : ''
            });
          }
        }
      }
    }

    return jsonResponse_({ status: 'ok', orders: orders, denied: denied });

  } catch (err) {
    logToSheet('[ERROR] Exception: ' + err.toString());
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

/******************************************************
 * CANCEL REQUEST HANDLER
 ******************************************************/

function handleCancelRequest_(body) {
  try {
    const requestId = (body.requestId || '').toString().trim().toUpperCase();
    const canceller = (body.canceller || '').toString().trim();
    const reason    = (body.reason    || 'No reason provided').toString().trim();

    if (!requestId) {
      return jsonResponse_({ status: 'error', message: 'Request ID is required' });
    }

    const ss    = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);

    if (!sheet) {
      return jsonResponse_({ status: 'error', message: 'Part Requests sheet not found' });
    }

    const data = sheet.getDataRange().getValues();
    let foundRow    = null;
    let requestData = null;

    for (let i = 1; i < data.length; i++) {
      const id = (data[i][PART_REQUESTS_COLS.REQUEST_ID - 1] || '').toString().trim().toUpperCase();
      if (id === requestId) {
        foundRow    = i + 1;
        requestData = data[i];
        break;
      }
    }

    if (!foundRow) {
      return jsonResponse_({ status: 'error', message: `Request ${requestId} not found` });
    }

    const originalRequester = (requestData[PART_REQUESTS_COLS.REQUESTER - 1] || '').toString().trim();
    if (originalRequester !== canceller) {
      return jsonResponse_({
        status: 'error',
        message: `You can only cancel your own requests. This request belongs to ${originalRequester}.`
      });
    }

    const currentStatus = (requestData[PART_REQUESTS_COLS.REQUEST_STATUS - 1] || '').toString().trim();

    if (currentStatus.includes('Ordered') || currentStatus.includes('🛒') ||
        currentStatus.includes('Received') || currentStatus.includes('📦') ||
        currentStatus.includes('Complete') || currentStatus.includes('✔️')) {
      return jsonResponse_({
        status: 'error',
        message: `Cannot cancel - request is already ${currentStatus}. Please contact a mentor.`
      });
    }

    if (currentStatus.includes('Cancel') || currentStatus.includes('🚫')) {
      return jsonResponse_({ status: 'error', message: 'Request is already cancelled' });
    }

    const timestamp    = new Date().toLocaleString();
    const currentNotes = sheet.getRange(foundRow, PART_REQUESTS_COLS.MENTOR_NOTES).getValue() || '';

    sheet.getRange(foundRow, PART_REQUESTS_COLS.REQUEST_STATUS).setValue(STATUS.CANCELLED);
    sheet.getRange(foundRow, PART_REQUESTS_COLS.MENTOR_NOTES)
      .setValue(currentNotes + `\n[${timestamp}] 🚫 Cancelled by ${canceller}: ${reason}`);
    sheet.getRange(foundRow, 1, 1, sheet.getLastColumn()).setBackground('#e0e0e0');

    return jsonResponse_({ status: 'ok', message: 'Request cancelled successfully', requestId: requestId });

  } catch (err) {
    Logger.log('[handleCancelRequest_] Error: ' + err);
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

/******************************************************
 * HELPER FUNCTIONS
 ******************************************************/

function normalizeSku(value) {
  return String(value || '').trim().toLowerCase();
}

function findColumnIndex_(header, matchFn) {
  for (let i = 0; i < header.length; i++) {
    if (matchFn((header[i] || '').toString().trim().toLowerCase())) return i;
  }
  return -1;
}

function formatDateForResponse_(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d.toISOString();
  return value.toString();
}

function detectVendor(partLink) {
  if (!partLink) return '';
  const link = partLink.toString().toLowerCase();
  if (link.includes('vexrobotics.com') || link.includes('vexpro.com')) return 'VexPro';
  if (link.includes('andymark.com'))   return 'AndyMark';
  if (link.includes('wcproducts.com')) return 'West Coast Products';
  if (link.includes('revrobotics.com')) return 'REV Robotics';
  if (link.includes('amazon.com'))     return 'Amazon';
  if (link.includes('mcmaster.com'))   return 'McMaster-Carr';
  if (link.includes('thethriftybot.com')) return 'Thrifty Bot';
  if (link.includes('ctr-electronics.com') || link.includes('ctre')) return 'CTRE';
  if (link.includes('studica.com'))    return 'Studica';
  if (link.includes('reduxrobotics.com')) return 'Redux Robotics';
  return 'Other';
}

function findOrderByRequestId(ordersSheet, requestID) {
  const data = ordersSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const includedRequests = (data[i][ORDERS_COLS.INCLUDED_REQUEST_IDS - 1] || '').toString();
    if (includedRequests.includes(requestID)) return i + 1;
  }
  return null;
}

function extractPartNameFromUrl(url) {
  if (!url) return 'Unknown Part';
  try {
    const urlStr = url.toString();
    if (urlStr.includes('amazon.com')) {
      const match = urlStr.match(/\/([^\/]+)\/dp\//);
      if (match) return decodeURIComponent(match[1].replace(/-/g, ' '));
    }
    if (urlStr.includes('mcmaster.com')) {
      const match = urlStr.match(/\/(\d+[A-Z]\d+)/);
      if (match) return 'McMaster ' + match[1];
    }
    const match = urlStr.match(/\/products\/([^\/\?]+)/);
    if (match) return decodeURIComponent(match[1].replace(/-/g, ' '));
    const parts = urlStr.split('/').filter(p => p.length > 0);
    if (parts.length > 0) return decodeURIComponent(parts[parts.length - 1].split('?')[0].replace(/[-_]/g, ' '));
  } catch (e) {
    Logger.log('[extractPartNameFromUrl] Error: ' + e);
  }
  return 'Part from ' + url.toString().substring(0, 50);
}

function addToInventory(sku, partName, quantity, location, vendor) {
  const ss             = SpreadsheetApp.getActive();
  const inventorySheet = ss.getSheetByName(SHEET_NAMES.INVENTORY);

  if (!inventorySheet) throw new Error('Inventory sheet not found');

  const data = inventorySheet.getDataRange().getValues();
  let existingRow = null;

  if (sku) {
    const skuToMatch = sku.toString().toLowerCase().trim();
    for (let i = 1; i < data.length; i++) {
      const rowSku = (data[i][INVENTORY_COLS.SKU - 1] || '').toString().toLowerCase().trim();
      if (rowSku && rowSku === skuToMatch) {
        existingRow = i + 1;
        break;
      }
    }
  }

  if (existingRow) {
    const currentQtyCell = inventorySheet.getRange(existingRow, INVENTORY_COLS.QTY_ON_HAND);
    const currentQty     = parseFloat(currentQtyCell.getValue()) || 0;
    currentQtyCell.setValue(currentQty + parseFloat(quantity));
    inventorySheet.getRange(existingRow, INVENTORY_COLS.LAST_COUNT_DATE).setValue(new Date());

    if (location) {
      const currentLocation = inventorySheet.getRange(existingRow, INVENTORY_COLS.LOCATION).getValue();
      if (!currentLocation) {
        inventorySheet.getRange(existingRow, INVENTORY_COLS.LOCATION).setValue(location);
      } else if (currentLocation !== location && !currentLocation.includes(location)) {
        inventorySheet.getRange(existingRow, INVENTORY_COLS.LOCATION).setValue(currentLocation + ', ' + location);
      }
    }
  } else {
    const nextRow = inventorySheet.getLastRow() + 1;
    inventorySheet.getRange(nextRow, INVENTORY_COLS.SKU).setValue(sku || '');
    inventorySheet.getRange(nextRow, INVENTORY_COLS.VENDOR).setValue(vendor || '');
    inventorySheet.getRange(nextRow, INVENTORY_COLS.PART_NAME).setValue(partName || '');
    inventorySheet.getRange(nextRow, INVENTORY_COLS.LOCATION).setValue(location);
    inventorySheet.getRange(nextRow, INVENTORY_COLS.QTY_ON_HAND).setValue(parseFloat(quantity));
    inventorySheet.getRange(nextRow, INVENTORY_COLS.LAST_COUNT_DATE).setValue(new Date());
  }

  return true;
}

/******************************************************
 * DROPDOWN WORKFLOW - AUTOMATIC TRIGGER
 ******************************************************/

function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAMES.PART_REQUESTS) return;
  if (e.range.getColumn() !== PART_REQUESTS_COLS.REQUEST_STATUS) return;
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  const row       = e.range.getRow();
  if (row < 2) return;

  const newStatus = e.value;
  const oldStatus = e.oldValue;
  if (newStatus === oldStatus) return;

  Logger.log(`[onEdit] Status changed on row ${row}: "${oldStatus}" → "${newStatus}"`);

  try {
    switch (newStatus) {
      case STATUS.APPROVED:  handleApproved(sheet, row);  break;
      case STATUS.ORDERED:   handleOrdered(sheet, row);   break;
      case STATUS.RECEIVED:  handleReceived(sheet, row);  break;
      case STATUS.COMPLETE:  handleComplete(sheet, row);  break;
      case STATUS.DENIED:    handleDenied(sheet, row);    break;
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
  const ss          = SpreadsheetApp.getActive();
  const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);

  if (!ordersSheet) throw new Error('Orders sheet not found');

  const lastCol    = sheet.getLastColumn();
  const requestData = sheet.getRange(row, 1, 1, lastCol).getValues()[0];

  const requestID       = requestData[PART_REQUESTS_COLS.REQUEST_ID - 1];
  const partName        = requestData[PART_REQUESTS_COLS.PART_NAME - 1];
  const sku             = requestData[PART_REQUESTS_COLS.SKU - 1];
  const partLink        = requestData[PART_REQUESTS_COLS.PART_LINK - 1];
  const quantity        = requestData[PART_REQUESTS_COLS.QUANTITY - 1];
  const estUnitPrice    = requestData[PART_REQUESTS_COLS.EST_UNIT_PRICE - 1];
  const totalEstCost    = requestData[PART_REQUESTS_COLS.TOTAL_EST_COST - 1];
  const expeditedShipping = requestData[PART_REQUESTS_COLS.EXPEDITED_SHIPPING - 1];
  const mentorNotes     = requestData[PART_REQUESTS_COLS.MENTOR_NOTES - 1];

  if (!requestID)           throw new Error('No Request ID found');
  if (!partName && !sku)    throw new Error('Request must have either Part Name or SKU');

  const uuid    = Utilities.getUuid().split('-')[0];
  const orderID = 'ORD-' + uuid;
  const vendor  = detectVendor(partLink);
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

  const timestamp    = new Date().toLocaleDateString();
  const updatedNotes = (mentorNotes || '') + '\n[' + timestamp + '] Approved → ' + orderID;
  sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);

  SpreadsheetApp.getActive().toast(`✅ Order ${orderID} created for ${partName || sku}`, '🎃 Request Approved', 5);
}

function handleOrdered(sheet, row) {
  SpreadsheetApp.getActive().toast('🛒 Order status updated', 'Success', 3);
}

function handleReceived(sheet, row) {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();

  const requestID  = sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_ID).getValue();
  let partName     = sheet.getRange(row, PART_REQUESTS_COLS.PART_NAME).getValue();
  let sku          = sheet.getRange(row, PART_REQUESTS_COLS.SKU).getValue();
  const partLink   = sheet.getRange(row, PART_REQUESTS_COLS.PART_LINK).getValue();
  let quantity     = sheet.getRange(row, PART_REQUESTS_COLS.QUANTITY).getValue();
  const mentorNotes = sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).getValue();

  partName = partName ? partName.toString().trim() : '';
  sku      = sku      ? sku.toString().trim()      : '';

  if (!partName && !sku) {
    const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
    if (ordersSheet) {
      const orderRow = findOrderByRequestId(ordersSheet, requestID);
      if (orderRow) {
        partName = ordersSheet.getRange(orderRow, ORDERS_COLS.PART_NAME).getValue() || '';
        sku      = ordersSheet.getRange(orderRow, ORDERS_COLS.SKU).getValue()       || '';
        if (!quantity || isNaN(parseFloat(quantity))) {
          quantity = ordersSheet.getRange(orderRow, ORDERS_COLS.QTY_ORDERED).getValue();
        }
      }
    }
  }

  if (!partName && !sku) {
    if (partLink) {
      partName = extractPartNameFromUrl(partLink);
      sku      = partLink;
    } else {
      ui.alert('Error', `Request ${requestID} has no identifiable information.`, ui.ButtonSet.OK);
      return;
    }
  }

  let validQuantity = null;
  if (quantity !== null && quantity !== undefined && quantity !== '') {
    const parsed = parseFloat(quantity);
    if (!isNaN(parsed) && parsed > 0) validQuantity = parsed;
  }

  if (validQuantity === null) {
    const qtyResponse = ui.prompt(
      '⚠️ Quantity Issue',
      `Request ${requestID}\nPart: ${partName || sku}\n\nEnter the quantity received:`,
      ui.ButtonSet.OK_CANCEL
    );
    if (qtyResponse.getSelectedButton() !== ui.Button.OK) return;
    const parsedUserQty = parseFloat(qtyResponse.getResponseText().trim());
    if (isNaN(parsedUserQty) || parsedUserQty <= 0) {
      ui.alert('Error', 'Invalid quantity.', ui.ButtonSet.OK);
      return;
    }
    validQuantity = parsedUserQty;
    sheet.getRange(row, PART_REQUESTS_COLS.QUANTITY).setValue(validQuantity);
  }

  quantity = validQuantity;

  const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (ordersSheet) {
    const orderRow = findOrderByRequestId(ordersSheet, requestID);
    if (orderRow) {
      ordersSheet.getRange(orderRow, ORDERS_COLS.RECEIVED_DATE).setValue(new Date());
      ordersSheet.getRange(orderRow, ORDERS_COLS.ORDER_STATUS).setValue('Received');
    }
  }

  const locationResponse = ui.prompt(
    '📦 Add to Inventory',
    `Request: ${requestID}\nPart: ${partName || '(from link)'}\nSKU: ${sku || '(from link)'}\nQuantity: ${quantity}\n\nEnter storage location (e.g., BIN-001):`,
    ui.ButtonSet.OK_CANCEL
  );

  if (locationResponse.getSelectedButton() !== ui.Button.OK) {
    ss.toast('Cancelled - Order marked received but NOT added to inventory', '⚠️ Warning', 4);
    return;
  }

  const location = locationResponse.getResponseText().trim();
  if (!location) {
    ui.alert('Error', 'Location required.', ui.ButtonSet.OK);
    return;
  }

  try {
    addToInventory(sku, partName, quantity, location, detectVendor(partLink));
    const timestamp    = new Date().toLocaleDateString();
    const updatedNotes = (mentorNotes || '') + `\n[${timestamp}] Received ${quantity}x, added to inventory at ${location}`;
    sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);
    ss.toast(`✅ Added ${quantity}x ${partName || sku} to ${location}`, 'Inventory Updated', 5);
  } catch (err) {
    ui.alert('Error', 'Order marked received, but failed to add to inventory:\n\n' + err.toString(), ui.ButtonSet.OK);
  }
}

function handleComplete(sheet, row) {
  const timestamp    = new Date().toLocaleDateString();
  const mentorNotes  = sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).getValue() || '';
  sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES)
    .setValue(mentorNotes + '\n[' + timestamp + '] ✔️ Request complete');
  sheet.getRange(row, 1, 1, sheet.getLastColumn()).setBackground('#f0f0f0');
  SpreadsheetApp.getActive().toast('✔️ Request marked complete', 'Success', 3);
}

function handleDenied(sheet, row) {
  const ui        = SpreadsheetApp.getUi();
  const requestID = sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_ID).getValue();

  const response = ui.prompt(
    '❌ Deny Request',
    `Denying request ${requestID}\n\nPlease provide a reason:`,
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK || !response.getResponseText().trim()) {
    sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_STATUS).setValue(STATUS.UNDER_REVIEW);
    return;
  }

  const reason       = response.getResponseText();
  const timestamp    = new Date().toLocaleDateString();
  const mentorNotes  = sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).getValue() || '';
  sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES)
    .setValue(mentorNotes + '\n[' + timestamp + '] ❌ DENIED: ' + reason);
  sheet.getRange(row, 1, 1, sheet.getLastColumn()).setBackground('#ffcccc');
  SpreadsheetApp.getActive().toast(`❌ Request ${requestID} denied`, 'Request Denied', 4);
}

/******************************************************
 * UTILITY FUNCTIONS
 ******************************************************/

function cleanupEmptyRows() {
  const ui     = SpreadsheetApp.getUi();
  const result = ui.alert('🧹 Clean Up Empty Rows', 'Delete all empty rows? Continue?', ui.ButtonSet.YES_NO);
  if (result !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActive();

  [SHEET_NAMES.ORDERS, SHEET_NAMES.PART_REQUESTS].forEach(sheetName => {
    const sheet   = ss.getSheetByName(sheetName);
    if (!sheet) return;
    const lastRow = sheet.getMaxRows();
    const idCol   = sheetName === SHEET_NAMES.ORDERS ? ORDERS_COLS.ORDER_ID : PART_REQUESTS_COLS.REQUEST_ID;

    for (let row = lastRow; row >= 2; row--) {
      const id = sheet.getRange(row, idCol).getValue();
      if (!id || id.toString().trim() === '') sheet.deleteRow(row);
    }
  });

  ui.alert('✅ Cleanup Complete!', 'Empty rows have been removed.', ui.ButtonSet.OK);
}

/******************************************************
 * BUDGET FUNCTIONS
 ******************************************************/

function getBudgetConfig_() {
  const ss    = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.BUDGET);

  if (!sheet) throw new Error('Budget sheet not found.');

  // Confirmed cell positions (debugBudgetV3 Aug 21 2026):
  // B1  = Season Name
  // B2  = Season Start
  // B3  = Season End
  // B6  = Total Allocated
  // B8  = Event 1 Budget
  // B9  = Event 2 Budget
  // B10 = PartBot Orders Spent  ← script writes here
  // B11 = Total Spent           ← script writes here
  // B12 = Remaining             ← script writes here
  // B13 = % Used                ← script writes here

  const seasonName     = sheet.getRange('B1').getValue();
  const seasonStart    = new Date(sheet.getRange('B2').getValue());
  const seasonEnd      = new Date(sheet.getRange('B3').getValue());
  const totalAllocated = parseFloat(sheet.getRange('B6').getValue()) || 0;
  const event1Budget   = parseFloat(sheet.getRange('B8').getValue()) || 0;
  const event2Budget   = parseFloat(sheet.getRange('B9').getValue()) || 0;
  const nonPartsCost   = event1Budget + event2Budget;
  const partsAvailable = totalAllocated - nonPartsCost;

  return {
    seasonName,
    seasonStart,
    seasonEnd,
    totalAllocated,
    event1Budget,
    event2Budget,
    nonPartsCost,
    partsAvailable,
    openingBalance: 0
  };
}

function calculatePartBotSpend_(seasonStart, seasonEnd) {
  const ss          = SpreadsheetApp.getActive();
  const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (!ordersSheet) return 0;

  const data       = ordersSheet.getDataRange().getValues();
  let totalSpend   = 0;

  for (let i = 1; i < data.length; i++) {
    const row         = data[i];
    const orderStatus = row[ORDERS_COLS.ORDER_STATUS - 1];
    const orderDate   = new Date(row[ORDERS_COLS.ORDER_DATE - 1]);
    const finalPrice  = parseFloat(row[ORDERS_COLS.FINAL_UNIT_PRICE - 1]) || 0;
    const totalCost   = parseFloat(row[ORDERS_COLS.TOTAL_COST - 1])       || 0;
    const qtyOrdered  = parseFloat(row[ORDERS_COLS.QTY_ORDERED - 1])      || 0;

    const statusValue  = orderStatus ? orderStatus.toString() : '';
    const isCountable  = [STATUS.ORDERED, STATUS.RECEIVED, STATUS.COMPLETE]
      .some(s => statusValue === s || statusValue.includes(s.replace(/[^\w\s]/g, '').trim()));

    if (!isCountable) continue;
    if (!orderDate || isNaN(orderDate.getTime())) continue;
    if (orderDate < seasonStart || orderDate > seasonEnd) continue;

    totalSpend += totalCost > 0 ? totalCost : (finalPrice * qtyOrdered);
  }

  return totalSpend;
}

function testBudgetResponse() {
  const result = getBudgetStatus_();
  Logger.log(JSON.stringify(result));
}

function getBudgetStatus_() {
  const config       = getBudgetConfig_();
  const partBotSpend = calculatePartBotSpend_(config.seasonStart, config.seasonEnd);

  // Sum all active submitted/approved requests with prices within season
  const ss    = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);

  const skipStatuses = [
    STATUS.CANCELLED, STATUS.DENIED,
    STATUS.ORDERED,   STATUS.RECEIVED, STATUS.COMPLETE
  ];

  let pendingSpend = 0;
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const id      = (data[i][PART_REQUESTS_COLS.REQUEST_ID - 1]     || '').toString();
      const status  = (data[i][PART_REQUESTS_COLS.REQUEST_STATUS - 1] || '').toString();
      const ts      = data[i][PART_REQUESTS_COLS.TIMESTAMP - 1];
      const estCost = parseFloat(data[i][PART_REQUESTS_COLS.TOTAL_EST_COST - 1]) || 0;

      if (!id) continue;
      if (skipStatuses.some(s => status === s)) continue;
      if (estCost <= 0) continue;

      // Only count requests within offseason window
      if (ts) {
        const reqDate = new Date(ts);
        if (reqDate < config.seasonStart || reqDate > config.seasonEnd) continue;
      }

      pendingSpend += estCost;
    }
  }

  const totalPartSpend = partBotSpend + pendingSpend;
  const totalSpent     = config.nonPartsCost + totalPartSpend;
  const remaining      = config.totalAllocated - totalSpent;
  const percentUsed    = config.totalAllocated > 0
    ? (totalSpent / config.totalAllocated * 100) : 0;

  // Update Budget tab calculated cells
  try {
    const budgetSheet = ss.getSheetByName(SHEET_NAMES.BUDGET);
    budgetSheet.getRange('B10').setValue(totalPartSpend);   // PartBot Orders Spent
    budgetSheet.getRange('B11').setValue(totalSpent);        // Total Spent
    budgetSheet.getRange('B12').setValue(remaining);         // Remaining
    budgetSheet.getRange('B13').setValue(percentUsed / 100); // % Used
  } catch (e) {
    Logger.log('[getBudgetStatus_] Could not update Budget sheet: ' + e);
  }

  return {
    seasonName:     config.seasonName,
    seasonStart:    config.seasonStart.toLocaleDateString(),
    seasonEnd:      config.seasonEnd.toLocaleDateString(),
    totalAllocated: config.totalAllocated,
    event1Budget:   config.event1Budget,
    event2Budget:   config.event2Budget,
    nonPartsCost:   config.nonPartsCost,
    partsAvailable: config.partsAvailable,
    partBotSpend:   totalPartSpend,
    totalSpent:     totalSpent,
    remaining:      remaining,
    percentUsed:    percentUsed.toFixed(1)
  };
}

function handleBudgetStatus_(body) {
  try {
    const status = getBudgetStatus_();
    const filled = Math.min(20, Math.round(parseFloat(status.percentUsed) / 5));
    const empty  = 20 - filled;
    const bar    = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
    return jsonResponse_({ status: 'ok', budget: status, bar: bar });
  } catch (err) {
    Logger.log('[handleBudgetStatus_] Error: ' + err);
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

function showBudgetStatus() {
  try {
    const status = getBudgetStatus_();
    const filled = Math.round(parseFloat(status.percentUsed) / 5);
    const empty  = 20 - filled;
    const bar    = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
    const fmt    = v => '$' + parseFloat(v).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    SpreadsheetApp.getUi().alert('💰 Budget Status',
      `Season: ${status.seasonName}\n` +
      `${status.seasonStart} → ${status.seasonEnd}\n\n` +
      `Total Budget:          ${fmt(status.totalAllocated)}\n` +
      `Event 1 (non-parts):   ${fmt(status.event1Budget)}\n` +
      `Event 2 (non-parts):   ${fmt(status.event2Budget)}\n` +
      `PartBot Orders+Reqs:   ${fmt(status.partBotSpend)}\n` +
      `─────────────────────────────\n` +
      `Total Spent:           ${fmt(status.totalSpent)} (${status.percentUsed}%)\n` +
      `Remaining:             ${fmt(status.remaining)}\n\n` +
      `[${bar}] ${status.percentUsed}%`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (err) {
    SpreadsheetApp.getUi().alert('❌ Error', err.toString(), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

/******************************************************
 * BUDGET STATUS PER REQUEST (Column P)
 ******************************************************/

function updateBudgetStatus_(sheet, row) {
  // Single-row update — just triggers a full refresh
  // so all rows stay consistent with each other
  refreshAllBudgetStatuses_(sheet);
}

function refreshAllBudgetStatuses_(sheet) {
  try {
    const ss = SpreadsheetApp.getActive();
    if (!sheet) sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
    if (!sheet) return;

    // Get base budget
    const config       = getBudgetConfig_();
    const partBotSpend = calculatePartBotSpend_(config.seasonStart, config.seasonEnd);
    const baseRemaining = config.totalAllocated - config.openingBalance - partBotSpend;

    Logger.log(`[refreshAllBudgetStatuses_] Base remaining: ${baseRemaining}`);

    // Read all rows
    const data    = sheet.getDataRange().getValues();
    const lastCol = sheet.getLastColumn();

    // Skip statuses that don't consume budget
    const skipStatuses = [
      STATUS.CANCELLED,
      STATUS.DENIED
    ];

    // Collect active requests with prices, sorted by timestamp
    const activeRows = [];
    for (let i = 1; i < data.length; i++) {
      const id        = (data[i][PART_REQUESTS_COLS.REQUEST_ID - 1]     || '').toString();
      const status    = (data[i][PART_REQUESTS_COLS.REQUEST_STATUS - 1] || '').toString();
      const timestamp = data[i][PART_REQUESTS_COLS.TIMESTAMP - 1];
      const estCost   = parseFloat(data[i][PART_REQUESTS_COLS.TOTAL_EST_COST - 1]) || 0;

      if (!id) continue;
      if (skipStatuses.some(s => status === s)) continue;

      activeRows.push({
        rowIndex:  i + 1,    // 1-based sheet row
        id:        id,
        status:    status,
        timestamp: timestamp ? new Date(timestamp) : new Date(0),
        estCost:   estCost
      });
    }

    // Sort by timestamp ascending (oldest first = first to reserve budget)
    activeRows.sort((a, b) => a.timestamp - b.timestamp);

    // Calculate running budget decrement
    let running = baseRemaining;

    for (const req of activeRows) {
      const costHere = req.estCost;

      if (costHere <= 0) {
        // No price — write placeholder
        sheet.getRange(req.rowIndex, PART_REQUESTS_COLS.BUDGET_STATUS)
          .setValue('⚪ No price yet');
        continue;
      }

      running -= costHere;

      const pctRemaining = config.totalAllocated > 0
        ? (running / config.totalAllocated * 100)
        : 100;

      const fmt = v => '$' + Math.abs(v).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

      let statusText;
      if (running < 0) {
        statusText = `🔴 -${fmt(running)} over budget`;
      } else if (pctRemaining <= 10) {
        statusText = `🟡 ${fmt(running)} remaining`;
      } else {
        statusText = `🟢 ${fmt(running)} remaining`;
      }

      sheet.getRange(req.rowIndex, PART_REQUESTS_COLS.BUDGET_STATUS)
        .setValue(statusText);

      Logger.log(`[refreshAllBudgetStatuses_] ${req.id}: -${fmt(costHere)} → ${statusText}`);
    }

  } catch (err) {
    Logger.log('[refreshAllBudgetStatuses_] Error: ' + err);
  }
}

// Menu-callable version
function refreshAllBudgetStatuses() {
  const ss    = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const ui    = SpreadsheetApp.getUi();

  refreshAllBudgetStatuses_(sheet);
  ui.alert('✅ Done!', 'Budget status updated for all active requests.', ui.ButtonSet.OK);
}

/******************************************************
 * SETUP & MENU
 ******************************************************/

function setupDropdownWorkflow() {
  const ss    = SpreadsheetApp.getActive();
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

  const lastRow     = sheet.getMaxRows();
  const statusRange = sheet.getRange(2, PART_REQUESTS_COLS.REQUEST_STATUS, lastRow - 1, 1);
  statusRange.setDataValidation(rule);

  const values = statusRange.getValues();
  for (let i = 0; i < values.length; i++) {
    if (!values[i][0] || values[i][0] === '') values[i][0] = STATUS.SUBMITTED;
  }
  statusRange.setValues(values);

  for (let i = 2; i <= lastRow; i++) {
    const formula = `=IF(OR(Q${i}="${STATUS.RECEIVED}", Q${i}="${STATUS.COMPLETE}"), IF(REGEXMATCH(R${i}, "added to inventory"), "✅", "⚠️"), "")`;
    sheet.getRange(i, PART_REQUESTS_COLS.IN_INVENTORY).setFormula(formula);
  }

  sheet.getRange(2, PART_REQUESTS_COLS.IN_INVENTORY, lastRow - 1, 1).setHorizontalAlignment('center');
  setupConditionalFormatting_(sheet, lastRow);

  SpreadsheetApp.getUi().alert('✅ Setup Complete!', 'Dropdown workflow, inventory indicator, and row highlighting configured successfully!', SpreadsheetApp.getUi().ButtonSet.OK);
}

function setupConditionalFormatting_(sheet, lastRow) {
  const range = sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns());
  sheet.clearConditionalFormatRules();

  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($Q2="${STATUS.RECEIVED}", REGEXMATCH($R2, "added to inventory"))`)
      .setBackground('#d9ead3').setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($Q2="${STATUS.RECEIVED}", NOT(REGEXMATCH($R2, "added to inventory")))`)
      .setBackground('#fff3cd').setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$Q2="${STATUS.CANCELLED}"`)
      .setBackground('#f3f3f3').setFontColor('#666666').setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$Q2="${STATUS.DENIED}"`)
      .setBackground('#f4cccc').setRanges([range]).build()
  ];

  sheet.setConditionalFormatRules(rules);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🎃 PartBot')
    .addItem('⚙️ Setup Dropdown Workflow',       'setupDropdownWorkflow')
    .addSeparator()
    .addItem('📊 Show Workflow Guide',            'showWorkflowGuide')
    .addItem('💰 Show Budget Status',             'showBudgetStatus')
    .addSeparator()
    .addItem('🧹 Clean Up Empty Rows',            'cleanupEmptyRows')
    .addItem('✨ Enrich Part Request',             'enrichSelectedRequest')
    .addItem('📦 Retry Add to Inventory',         'retryAddToInventory')
    .addItem('🔍 Find Missing Inventory Items',   'findMissingInventoryItems')
    .addItem('💰 Refresh All Budget Statuses',    'refreshAllBudgetStatuses')
    .addToUi();
}

function showWorkflowGuide() {
  SpreadsheetApp.getUi().alert('Workflow Guide',
    '🎃 DROPDOWN WORKFLOW GUIDE\n\n' +
    'Just change the Status dropdown!\n\n' +
    '📥 SUBMITTED → New request\n' +
    '✅ APPROVED → Auto-creates order\n' +
    '🛒 ORDERED → Prompts for tracking\n' +
    '📦 RECEIVED → Adds to inventory\n' +
    '✔️ COMPLETE → Marks as done\n' +
    '❌ DENIED → Prompts for reason\n' +
    '🚫 CANCELLED → Student cancelled\n\n' +
    '🟢 Green row = In inventory\n' +
    '🟡 Yellow row = Missing from inventory\n' +
    '🔴 Red row = Denied\n' +
    '⚪ Gray row = Cancelled',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/******************************************************
 * RETRY ADD TO INVENTORY (Manual Fix)
 ******************************************************/

function retryAddToInventory() {
  const ui    = SpreadsheetApp.getUi();
  const ss    = SpreadsheetApp.getActive();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== SHEET_NAMES.PART_REQUESTS) {
    ui.alert('Please select a row in the Part Requests sheet');
    return;
  }

  const row = sheet.getActiveRange().getRow();
  if (row < 2) { ui.alert('Please select a request row'); return; }

  const status = sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_STATUS).getValue();
  if (status !== STATUS.RECEIVED && status !== STATUS.COMPLETE) {
    ui.alert('Invalid Status', 'Must be "📦 Received" or "✔️ Complete".', ui.ButtonSet.OK);
    return;
  }

  const requestID   = sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_ID).getValue();
  let partName      = (sheet.getRange(row, PART_REQUESTS_COLS.PART_NAME).getValue() || '').toString().trim();
  let sku           = (sheet.getRange(row, PART_REQUESTS_COLS.SKU).getValue()       || '').toString().trim();
  const partLink    = sheet.getRange(row, PART_REQUESTS_COLS.PART_LINK).getValue();
  const quantity    = sheet.getRange(row, PART_REQUESTS_COLS.QUANTITY).getValue();
  const mentorNotes = sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).getValue();

  if (!partName && !sku) { ui.alert('Error', 'Missing both Part Name and SKU', ui.ButtonSet.OK); return; }
  if (!quantity || isNaN(parseFloat(quantity))) { ui.alert('Error', 'Invalid quantity', ui.ButtonSet.OK); return; }

  const locationResponse = ui.prompt(
    '📦 Add to Inventory',
    `Request: ${requestID}\nPart: ${partName || sku}\nQuantity: ${quantity}\n\nEnter storage location:`,
    ui.ButtonSet.OK_CANCEL
  );

  if (locationResponse.getSelectedButton() !== ui.Button.OK) return;

  const location = locationResponse.getResponseText().trim();
  if (!location) { ui.alert('Error', 'Location required', ui.ButtonSet.OK); return; }

  try {
    addToInventory(sku, partName, quantity, location, detectVendor(partLink));
    const timestamp    = new Date().toLocaleDateString();
    sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES)
      .setValue((mentorNotes || '') + `\n[${timestamp}] Manually added ${quantity}x to inventory at ${location}`);
    ui.alert('✅ Success!', `Added ${quantity}x ${partName || sku} to ${location}`, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('❌ Error', err.toString(), ui.ButtonSet.OK);
  }
}

/******************************************************
 * FIND MISSING INVENTORY ITEMS (Diagnostic)
 ******************************************************/

function findMissingInventoryItems() {
  const ss    = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const ui    = SpreadsheetApp.getUi();

  if (!sheet) { ui.alert('Part Requests sheet not found'); return; }

  const data         = sheet.getDataRange().getValues();
  const missingItems = [];

  for (let i = 1; i < data.length; i++) {
    const row         = data[i];
    const status      = row[PART_REQUESTS_COLS.REQUEST_STATUS - 1];
    const inInventory = row[PART_REQUESTS_COLS.IN_INVENTORY - 1];

    if ((status === STATUS.RECEIVED || status === STATUS.COMPLETE) && inInventory === '⚠️') {
      missingItems.push({
        row:       i + 1,
        requestId: row[PART_REQUESTS_COLS.REQUEST_ID - 1],
        partName:  row[PART_REQUESTS_COLS.PART_NAME - 1] || row[PART_REQUESTS_COLS.SKU - 1] || 'Unknown'
      });
    }
  }

  if (missingItems.length === 0) {
    ui.alert('✅ All Good!', 'All received items are properly added to inventory.', ui.ButtonSet.OK);
  } else {
    let message = `Found ${missingItems.length} received item(s) missing from inventory:\n\n`;
    missingItems.slice(0, 10).forEach(item => {
      message += `• Row ${item.row}: ${item.requestId} - ${item.partName}\n`;
    });
    if (missingItems.length > 10) message += `\n... and ${missingItems.length - 10} more.`;
    message += `\n\nUse "📦 Retry Add to Inventory" on each row to fix.`;
    ui.alert('⚠️ Missing Inventory Items', message, ui.ButtonSet.OK);
  }
}
