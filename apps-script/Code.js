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
  BUDGET: 'Budget',
  SETTINGS: 'Settings',
  LOCATIONS: 'Locations',
  MOVES: 'Inventory Moves'
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
  MAX_BUDGET: 15,  // no longer filled; /requestpart dropped the maxbudget option (2026-11-08)
  BUDGET_STATUS: 16,
  REQUEST_STATUS: 17,
  MENTOR_NOTES: 18,
  EXPEDITED_SHIPPING: 19,
  IN_INVENTORY: 20,
  BUDGET_CATEGORY: 21,
  BUILD_SEASON: 22,
  REIMBURSED: 23
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

    // Shared secret from the bot's .env (PARTBOT_SECRET). Enforced once the Script Property is set.
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('PARTBOT_SECRET');
    if (expectedSecret && action !== 'health' && body.secret !== expectedSecret) {
      Logger.log('[doPost] Rejected request with missing or wrong secret, action: ' + action);
      return jsonResponse_({ status: 'error', message: 'Unauthorized' });
    }

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

    if (action === 'receiveOptions') {
      return handleReceiveOptions_(body);
    }

    if (action === 'receive') {
      return handleReceive_(body);
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
    const budgetCategory = (body.budgetCategory || '').toString().trim();
    const buildSeason    = (body.buildSeason    || '').toString().trim();
    if (budgetCategory && !BUDGET_CATEGORIES[budgetCategory]) {
      return jsonResponse_({ status: 'error', message: `Unknown category: ${budgetCategory}` });
    }
    if (buildSeason && BUILD_SEASONS.indexOf(buildSeason) < 0) {
      return jsonResponse_({ status: 'error', message: `Unknown season: ${buildSeason}` });
    }

    // Pull the latest finance numbers before computing the budget reply
    trySyncFinanceBudget_();

    const requestData = {
      timestamp: new Date(),
      requester: body.requester || 'Discord User',
      subsystem: body.subsystem || '',
      partLink: body.partLink || '',
      sku: body.sku || '',
      quantity: body.quantity || 1,
      neededBy: body.neededBy || '',
      priority: body.priority || 'Medium',
      notes: body.notes || '',
      budgetCategory: budgetCategory,
      buildSeason: buildSeason
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
      notes: requestData.notes
    });

    // Budget line remaining after this request, for the Discord reply
    let budgetSnapshot = null;
    try {
      budgetSnapshot = budgetAfterRequest_(row);
    } catch (budgetErr) {
      Logger.log('[handleDiscordRequest_] Budget check failed (non-fatal): ' + budgetErr);
    }

    // When mentors place orders, from the Settings tab, for the Discord reply
    let orderSchedule = null;
    try {
      orderSchedule = getOrderSchedule_();
    } catch (scheduleErr) {
      Logger.log('[handleDiscordRequest_] Order schedule lookup failed (non-fatal): ' + scheduleErr);
    }

    return jsonResponse_({
      status: 'ok',
      requestID: requestID,
      budget: budgetSnapshot,
      orderSchedule: orderSchedule
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
  const expeditedShipping = (data.priority === 'Critical') ? 'Expedited' : 'Standard';

  const C = PART_REQUESTS_COLS;
  const rowValues = new Array(C.BUILD_SEASON).fill('');
  rowValues[C.REQUEST_ID - 1]         = requestID;
  rowValues[C.TIMESTAMP - 1]          = data.timestamp;
  rowValues[C.REQUESTER - 1]          = data.requester;
  rowValues[C.SUBSYSTEM - 1]          = data.subsystem;
  rowValues[C.PART_LINK - 1]          = data.partLink;
  rowValues[C.SKU - 1]                = data.sku || '';
  rowValues[C.QUANTITY - 1]           = data.quantity;
  rowValues[C.PRIORITY - 1]           = data.priority;
  rowValues[C.NEEDED_BY - 1]          = data.neededBy;
  rowValues[C.REQUEST_STATUS - 1]     = STATUS.SUBMITTED;
  rowValues[C.MENTOR_NOTES - 1]       = data.notes;
  rowValues[C.EXPEDITED_SHIPPING - 1] = expeditedShipping;
  rowValues[C.BUDGET_CATEGORY - 1]    = data.budgetCategory || '';
  rowValues[C.BUILD_SEASON - 1]       = data.buildSeason || '';
  if (data.sku) Logger.log('[createPartRequest_] User provided SKU: ' + data.sku);

  // Two requests arriving together must not pick the same row
  const nextRow = withScriptLock_(() => {
    const r = sheet.getLastRow() + 1;
    if (r > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    sheet.getRange(r, 1, 1, rowValues.length).setValues([rowValues]);
    applyRequestRowDefaults_(sheet, r);
    SpreadsheetApp.flush();
    return r;
  });

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

// Script-wide lock shared by the web app and onEdit, so concurrent writers don't pick the same row
function withScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Read-only In Inventory indicator (column T); see CLAUDE.md before changing the phrase
function inInventoryFormula_(row) {
  return `=IF(OR(Q${row}="${STATUS.RECEIVED}", Q${row}="${STATUS.COMPLETE}"), IF(REGEXMATCH(R${row}, "added to inventory"), "✅", "⚠️"), "")`;
}

// A new request row gets the same dropdowns as row 2 and the In Inventory formula
function applyRequestRowDefaults_(sheet, row) {
  if (row > 2) {
    const width = sheet.getLastColumn();
    sheet.getRange(2, 1, 1, width).copyTo(sheet.getRange(row, 1, 1, width),
      SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }
  sheet.getRange(row, PART_REQUESTS_COLS.IN_INVENTORY).setFormula(inInventoryFormula_(row));
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
    const existingPrice = parseFloat(sheet.getRange(row, PART_REQUESTS_COLS.EST_UNIT_PRICE).getValue()) || 0;

    if (existingSku) {
      Logger.log('[enrichPartRequest] User provided SKU - will only enrich Part Name and Price');
    }

    if (!partLink || (existingPartName && existingSku && existingPrice > 0)) {
      Logger.log('[enrichPartRequest] No link or already has name/SKU/price, skipping');
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

    // The vendor's own price metadata (og:price:amount etc.) beats the AI's reading of the page
    const listed = pageContent.match(/^Listed Price: ([0-9.]+)/m);
    if (listed) extracted.price = parseFloat(listed[1]);

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
    
    // Never overwrite a price already on the row (a mentor may have typed the real one)
    if (extracted.price && existingPrice <= 0) {
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

    // Shopify-style stores (WCP, AndyMark, etc.) put the price in meta tags,
    // which the tag-stripping below would discard
    const listedPrice = getListedPrice_(html);
    const pricePrefix = listedPrice ? `Listed Price: ${listedPrice}\n\n` : '';

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

    return pricePrefix + text;

  } catch (err) {
    Logger.log(`[fetchPageContent_] Error: ${err}`);
    return null;
  }
}

function getListedPrice_(html) {
  const patterns = [
    /<meta[^>]+property=["'](?:og|product):price:amount["'][^>]+content=["']([0-9.,]+)["']/i,
    /<meta[^>]+content=["']([0-9.,]+)["'][^>]+property=["'](?:og|product):price:amount["']/i,
    /itemprop=["']price["'][^>]+content=["']([0-9.,]+)["']/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const price = parseFloat(m[1].replace(/,/g, ''));
      if (price > 0) return price;
    }
  }
  return null;
}

// "1,299.00" or "$12.99" -> number; parseFloat alone turns "1,299.00" into 1
function parsePrice_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value > 0 ? value : null;
  const n = parseFloat(value.toString().replace(/[^0-9.]/g, ''));
  return n > 0 ? n : null;
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
        maxOutputTokens: 1024,
        // 2.5-flash thinking tokens count against maxOutputTokens and can leave no room for the JSON
        thinkingConfig: { thinkingBudget: 0 }
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
      price:    parsePrice_(extracted.price)
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

  const skuQuery   = (body.sku || '').toString().trim();
  const searchText = (body.search || '').toString().trim();
  const terms = (searchText || skuQuery).toLowerCase().split(/\s+/).filter(Boolean);
  const MAX_RESULTS = 15;

  try {
    const values = inventorySheet.getDataRange().getValues();
    if (!values || values.length < 2) {
      return jsonResponse_({ status: 'ok', matches: [], total: 0, onOrder: [] });
    }

    const header = values[0];
    const rows = values.slice(1);

    const SKU_COL    = findColumnIndex_(header, h => h.includes('sku') || h.includes('part number'));
    const VENDOR_COL = findColumnIndex_(header, h => h.includes('vendor'));
    const NAME_COL   = findColumnIndex_(header, h => h.includes('part name'));
    const LOC_COL    = findColumnIndex_(header, h => h.includes('location'));
    const QTY_COL    = findColumnIndex_(header, h => h.includes('qty') || h.includes('on-hand'));
    const cell = (r, c) => (c !== -1 ? (r[c] === null || r[c] === undefined ? '' : r[c]) : '');
    const toMatch = r => ({
      sku: cell(r, SKU_COL), vendor: cell(r, VENDOR_COL), name: cell(r, NAME_COL),
      location: cell(r, LOC_COL), quantity: cell(r, QTY_COL)
    });

    let found = [];

    // Exact SKU first
    if (skuQuery) {
      const targetSku = normalizeSku(skuQuery);
      found = rows.filter(r => normalizeSku(cell(r, SKU_COL)) === targetSku).map(toMatch);
    }

    // Otherwise every word must appear somewhere in SKU, name, vendor or location,
    // so "hex bearing" finds "Flanged Bearing 1/2 Hex"
    if (found.length === 0 && terms.length) {
      found = rows.filter(r => {
        const hay = [cell(r, SKU_COL), cell(r, NAME_COL), cell(r, VENDOR_COL), cell(r, LOC_COL)]
          .join(' ').toLowerCase();
        return hay.trim() && terms.every(t => hay.indexOf(t) !== -1);
      }).map(toMatch);
    }

    // In stock first, then by name
    found.sort((a, b) => {
      const qa = parseFloat(a.quantity) > 0 ? 0 : 1, qb = parseFloat(b.quantity) > 0 ? 0 : 1;
      return qa - qb || a.name.toString().localeCompare(b.name.toString());
    });

    return jsonResponse_({
      status: 'ok',
      matches: found.slice(0, MAX_RESULTS),
      total: found.length,
      onOrder: findOnOrder_(skuQuery, terms)
    });

  } catch (err) {
    Logger.log('[handleInventoryLookup_] Error: ' + err);
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

// Approved/Ordered requests matching the search, so students see it's already coming before requesting it again
function findOnOrder_(skuQuery, terms) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.PART_REQUESTS);
  if (!sheet || (!skuQuery && !terms.length)) return [];
  const C = PART_REQUESTS_COLS;
  const target = normalizeSku(skuQuery);
  return sheet.getDataRange().getValues().slice(1).filter(r => {
    if (!isReceivable_((r[C.REQUEST_STATUS - 1] || '').toString())) return false;
    if (target && normalizeSku(r[C.SKU - 1]) === target) return true;
    const hay = [r[C.SKU - 1], r[C.PART_NAME - 1]].join(' ').toLowerCase();
    return terms.length && terms.every(t => hay.indexOf(t) !== -1);
  }).slice(0, 5).map(r => ({
    requestId: r[C.REQUEST_ID - 1], partName: r[C.PART_NAME - 1] || r[C.SKU - 1] || '',
    qty: r[C.QUANTITY - 1], status: r[C.REQUEST_STATUS - 1], requester: r[C.REQUESTER - 1]
  }));
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

    if (currentStatus.includes('Approved') || currentStatus === STATUS.APPROVED ||
        currentStatus.includes('Ordered') || currentStatus.includes('🛒') ||
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

    // Cancelled requests no longer consume budget
    refreshAllBudgetStatuses_(sheet);

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
  // Two receipts of the same SKU at once must not both read the old quantity
  return withScriptLock_(() => addToInventoryUnlocked_(sku, partName, quantity, location, vendor));
}

function addToInventoryUnlocked_(sku, partName, quantity, location, vendor) {
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
      // Same spelling rules as the cleanup menu, so "UKNOWN" and repeats don't creep back in
      const locationCell    = inventorySheet.getRange(existingRow, INVENTORY_COLS.LOCATION);
      const currentLocation = (locationCell.getValue() || '').toString();
      const merged = cleanLocation_(currentLocation ? currentLocation + ', ' + location : location);
      if (merged !== currentLocation) locationCell.setValue(merged);
    }
  } else {
    const nextRow = inventorySheet.getLastRow() + 1;
    const I = INVENTORY_COLS;
    const rowValues = new Array(I.LAST_COUNT_DATE).fill('');
    rowValues[I.SKU - 1]             = sku || '';
    rowValues[I.VENDOR - 1]          = vendor || '';
    rowValues[I.PART_NAME - 1]       = partName || '';
    rowValues[I.LOCATION - 1]        = cleanLocation_(location);
    rowValues[I.QTY_ON_HAND - 1]     = parseFloat(quantity);
    rowValues[I.LAST_COUNT_DATE - 1] = new Date();
    // Write only the columns we own, so Reorder Threshold / Usage Rate stay blank, not overwritten
    inventorySheet.getRange(nextRow, I.SKU, 1, I.QTY_ON_HAND).setValues([rowValues.slice(0, I.QTY_ON_HAND)]);
    inventorySheet.getRange(nextRow, I.LAST_COUNT_DATE).setValue(rowValues[I.LAST_COUNT_DATE - 1]);
  }
  SpreadsheetApp.flush();

  return true;
}

/******************************************************
 * DROPDOWN WORKFLOW - AUTOMATIC TRIGGER
 ******************************************************/

function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAMES.PART_REQUESTS) return;
  if (e.range.getRow() < 2) return;

  // Edits that change what a request costs or which budget it counts against
  const budgetCols = [
    PART_REQUESTS_COLS.QUANTITY,
    PART_REQUESTS_COLS.EST_UNIT_PRICE,
    PART_REQUESTS_COLS.TOTAL_EST_COST,
    PART_REQUESTS_COLS.BUDGET_CATEGORY,
    PART_REQUESTS_COLS.REIMBURSED
  ];
  const firstCol = e.range.getColumn();
  const lastCol  = firstCol + e.range.getNumColumns() - 1;
  if (budgetCols.some(c => c >= firstCol && c <= lastCol)) {
    // A typed unit price or quantity updates Total Est Cost
    if (firstCol <= PART_REQUESTS_COLS.EST_UNIT_PRICE && lastCol >= PART_REQUESTS_COLS.QUANTITY) {
      for (let r = e.range.getRow(); r <= e.range.getLastRow(); r++) {
        const price = parseFloat(sheet.getRange(r, PART_REQUESTS_COLS.EST_UNIT_PRICE).getValue()) || 0;
        const qty   = parseFloat(sheet.getRange(r, PART_REQUESTS_COLS.QUANTITY).getValue()) || 1;
        if (price > 0) sheet.getRange(r, PART_REQUESTS_COLS.TOTAL_EST_COST).setValue(price * qty);
      }
    }
    refreshAllBudgetStatuses_(sheet);
    return;
  }

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

    // Status changes can add or remove a request from the budget
    refreshAllBudgetStatuses_(sheet);
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
  const vendor  = detectVendor(partLink);
  const O = ORDERS_COLS;

  // Re-selecting Approved (or two quick edits) must not create a second order
  const result = withScriptLock_(() => {
    const existingRow = findOrderByRequestId(ordersSheet, requestID);
    if (existingRow) {
      return { existingRow: existingRow, existingId: ordersSheet.getRange(existingRow, O.ORDER_ID).getValue() };
    }
    const id = 'ORD-' + uuid;
    const rowValues = new Array(O.MENTOR_NOTES).fill('');
    rowValues[O.ORDER_ID - 1]             = id;
    rowValues[O.INCLUDED_REQUEST_IDS - 1] = requestID;
    rowValues[O.VENDOR - 1]               = vendor;
    rowValues[O.PART_NAME - 1]            = partName || '';
    rowValues[O.SKU - 1]                  = sku || '';
    rowValues[O.QTY_ORDERED - 1]          = quantity || 1;
    rowValues[O.FINAL_UNIT_PRICE - 1]     = estUnitPrice || '';
    rowValues[O.TOTAL_COST - 1]           = totalEstCost || '';
    rowValues[O.SHIPPING_METHOD - 1]      = expeditedShipping || 'Standard';
    rowValues[O.ORDER_STATUS - 1]         = 'Approved - Not Yet Ordered';
    rowValues[O.MENTOR_NOTES - 1]         = mentorNotes || '';
    const r = ordersSheet.getLastRow() + 1;
    if (r > ordersSheet.getMaxRows()) ordersSheet.insertRowsAfter(ordersSheet.getMaxRows(), 1);
    ordersSheet.getRange(r, 1, 1, rowValues.length).setValues([rowValues]);
    SpreadsheetApp.flush();
    return { orderID: id };
  });

  if (result.existingRow) {
    SpreadsheetApp.getActive().toast(
      `${requestID} already has order ${result.existingId} (Orders row ${result.existingRow}); no new order created`,
      '🎃 Already Approved', 6);
    return;
  }
  const orderID = result.orderID;

  const timestamp    = new Date().toLocaleDateString();
  const updatedNotes = (mentorNotes || '') + '\n[' + timestamp + '] Approved → ' + orderID;
  sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);

  SpreadsheetApp.getActive().toast(`✅ Order ${orderID} created for ${partName || sku}`, '🎃 Request Approved', 5);
}

function handleOrdered(sheet, row) {
  const ss        = SpreadsheetApp.getActive();
  const requestID = sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_ID).getValue();
  const today     = new Date();

  const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (ordersSheet) {
    const orderRow = findOrderByRequestId(ordersSheet, requestID);
    if (orderRow) {
      // Only update existing order — never create new
      const existingDate = ordersSheet.getRange(orderRow, ORDERS_COLS.ORDER_DATE).getValue();
      if (!existingDate) {
        ordersSheet.getRange(orderRow, ORDERS_COLS.ORDER_DATE).setValue(today);
      }
      ordersSheet.getRange(orderRow, ORDERS_COLS.ORDER_STATUS).setValue(STATUS.ORDERED);
      Logger.log(`[handleOrdered] Updated order at row ${orderRow} for ${requestID}`);
    } else {
      Logger.log(`[handleOrdered] No linked order found for ${requestID} — skipping`);
    }
  }

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
      // Keep the first received date if the status is set to Received again
      const receivedCell = ordersSheet.getRange(orderRow, ORDERS_COLS.RECEIVED_DATE);
      if (!receivedCell.getValue()) receivedCell.setValue(new Date());
      ordersSheet.getRange(orderRow, ORDERS_COLS.ORDER_STATUS).setValue('Received');
    }
  }

  // Already counted: re-selecting Received must not add the parts to inventory twice
  if (/added to inventory/.test((mentorNotes || '').toString())) {
    ss.toast(`${requestID} is already in inventory; quantity not changed`, '📦 Already Received', 6);
    return;
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
    logMove_({ who: currentUserLabel_('Mentor (sheet)'), sku: sku, partName: partName,
      qty: quantity, to: cleanLocation_(location), requestId: requestID, how: 'Sheet status' });
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
 *
 * Ground truth is the HMB Robotics budget spreadsheet (finance).
 * syncFinanceBudget_() copies the FRC lines' Budget and Spent into the
 * Budget tab; everything else reads that local copy, because the onEdit
 * simple trigger is not allowed to open another spreadsheet.
 *
 * Remaining (per line) = Budget − Spent (finance) − PartBot pending
 * PartBot pending      = this budget year's requests that are not
 *                        cancelled/denied and not yet reimbursed
 ******************************************************/

const FINANCE_BUDGET = {
  SPREADSHEET_ID: '1JdWqI2GQKF-r4Fto-m7Z0ixFxtD084bQGVMzDKqw8SQ',
  SHEET_PATTERN:  /^Master .*Budget$/,     // e.g. "Master 2027 Budget"
  SECTION:        'FRC Expenses'
};

// Budget lines PartBot requests count against (all must exist in the FRC section).
// Every other FRC line (e.g. Competition Registration) is reported from finance only.
const BUDGET_LINES = [
  'Robot Hardware & Field Pieces',
  'Tools & Supplies',
  'Marketing/Spirit'
];

// Request category (Discord choice) → finance budget line
const BUDGET_CATEGORIES = {
  'Robot Part':       'Robot Hardware & Field Pieces',
  'Field Piece':      'Robot Hardware & Field Pieces',
  'Tool':             'Tools & Supplies',
  'Supply':           'Tools & Supplies',
  'Marketing/Spirit': 'Marketing/Spirit'
};
const DEFAULT_BUDGET_LINE = 'Robot Hardware & Field Pieces';  // older rows with no category

const BUILD_SEASONS = ['In-season', 'Off-season'];

// Budget tab layout (the whole tab is written by PartBot)
const BUDGET_TAB = {
  YEAR_LABEL:  'B1',
  YEAR_START:  'B2',
  YEAR_END:    'B3',
  SOURCE:      'B4',
  LAST_SYNCED: 'B5',
  NOTE:        'A6',
  HEADER_ROW:  7,
  FIRST_LINE_ROW: 8,      // one row per FRC line, then the FRC Total row
  NUM_COLS:    6,         // Line | Budget | Spent | Pending | Remaining | % Used
  TOTAL_LABEL: 'FRC Total'
};

function budgetLineFor_(category) {
  return BUDGET_CATEGORIES[(category || '').toString().trim()] || DEFAULT_BUDGET_LINE;
}

// Reads the finance spreadsheet and writes the FRC lines into the Budget tab
function syncFinanceBudget_() {
  const finance = SpreadsheetApp.openById(FINANCE_BUDGET.SPREADSHEET_ID);
  const master  = finance.getSheets().find(s => FINANCE_BUDGET.SHEET_PATTERN.test(s.getName()));
  if (!master) throw new Error('No "Master ... Budget" tab found in the finance spreadsheet');

  const values = master.getDataRange().getValues();

  // Title, e.g. "HMB Robotics 2027 Budget (9/1/26-8/31/27)"
  const title = (values[0][0] || '').toString();
  const range = title.match(/\((\d{1,2}\/\d{1,2}\/\d{2,4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\)/);
  if (!range) throw new Error(`Could not read the budget year from "${title}"`);
  const yearStart = parseShortDate_(range[1]);
  const yearEnd   = parseShortDate_(range[2]);
  yearEnd.setHours(23, 59, 59);

  // Find the FRC section, then the lines inside it (stop at the next "... Expenses" header)
  const norm  = v => (v || '').toString().trim().toLowerCase();
  const start = values.findIndex(r => norm(r[0]) === norm(FINANCE_BUDGET.SECTION));
  if (start < 0) throw new Error(`"${FINANCE_BUDGET.SECTION}" not found on ${master.getName()}`);

  // Every labeled line in the section, in finance's order
  const found = [];
  for (let i = start + 1; i < values.length; i++) {
    const label = (values[i][0] || '').toString().trim();
    if (!label) continue;
    if (/expenses$/i.test(label)) break;
    found.push({ name: label, budget: parseFloat(values[i][1]) || 0, spent: parseFloat(values[i][2]) || 0 });
  }
  const missing = BUDGET_LINES.filter(l => !found.some(f => norm(f.name) === norm(l)));
  if (missing.length) throw new Error(`Budget line(s) not found in ${FINANCE_BUDGET.SECTION}: ${missing.join(', ')}`);
  // Use PartBot's spelling for the lines requests count against
  found.forEach(f => { f.name = BUDGET_LINES.find(l => norm(l) === norm(f.name)) || f.name; });

  const tab = getOrCreateBudgetTab_();
  tab.getRange('A1:B5').setValues([
    ['Budget Year', title.replace(/^HMB Robotics\s*/i, '')],
    ['Year Start',  yearStart],
    ['Year End',    yearEnd],
    ['Synced From', `${finance.getName()} → ${master.getName()}`],
    ['Last Synced', new Date()]
  ]);
  tab.getRange(BUDGET_TAB.NOTE)
    .setValue('This tab is written by PartBot. Change budget amounts in the HMB Robotics budget spreadsheet, then run 🎃 PartBot → 🔄 Sync Budget.')
    .setFontStyle('italic');
  tab.getRange(BUDGET_TAB.HEADER_ROW, 1, 1, BUDGET_TAB.NUM_COLS).setValues([[
    'Budget Line', 'Budget', 'Spent (Finance)', 'PartBot Pending', 'Remaining', '% Used'
  ]]).setFontWeight('bold');

  // Grow or shrink the table so mentor rows below it (e.g. "Budget Links") are never overwritten
  const oldTotalRow = findBudgetTotalRow_(tab);
  const newTotalRow = BUDGET_TAB.FIRST_LINE_ROW + found.length;
  if (newTotalRow > oldTotalRow) {
    tab.insertRowsAfter(oldTotalRow, newTotalRow - oldTotalRow);
  } else if (newTotalRow < oldTotalRow) {
    tab.getRange(newTotalRow + 1, 1, oldTotalRow - newTotalRow, BUDGET_TAB.NUM_COLS).clear();
  }
  tab.getRange(BUDGET_TAB.FIRST_LINE_ROW, 1, found.length, 3)
    .setValues(found.map(f => [f.name, f.budget, f.spent]));
  tab.getRange(newTotalRow, 1).setValue(BUDGET_TAB.TOTAL_LABEL);

  // The note used to sit two rows below the table; it now lives in A6
  const below = tab.getRange(newTotalRow + 1, 1, 5, 1);
  below.getValues().forEach((r, i) => {
    if (/^This tab is written by PartBot/.test(r[0])) tab.getRange(newTotalRow + 1 + i, 1).clear();
  });

  Logger.log('[syncFinanceBudget_] Synced ' + JSON.stringify(found));
}

// Row of the "FRC Total" label; before the first full-section sync, the 3-line table ended at row 11
function findBudgetTotalRow_(tab) {
  const labels = tab.getRange(BUDGET_TAB.FIRST_LINE_ROW, 1, 40, 1).getValues();
  const i = labels.findIndex(r => r[0] === BUDGET_TAB.TOTAL_LABEL);
  return i >= 0 ? BUDGET_TAB.FIRST_LINE_ROW + i : BUDGET_TAB.FIRST_LINE_ROW + BUDGET_LINES.length;
}

function parseShortDate_(text) {
  const [m, d, y] = text.split('/').map(Number);
  return new Date(y < 100 ? 2000 + y : y, m - 1, d);
}

function getOrCreateBudgetTab_() {
  const ss  = SpreadsheetApp.getActive();
  let tab   = ss.getSheetByName(SHEET_NAMES.BUDGET);
  const fresh = !tab;
  if (!tab) tab = ss.insertSheet(SHEET_NAMES.BUDGET);

  // First sync replaces the old single-season layout (A1:F16 only;
  // rows below, e.g. "Budget Links", belong to mentors and are kept)
  if (fresh || tab.getRange('A1').getValue() !== 'Budget Year') {
    tab.getRange('A1:F16').clear();
    tab.getRange('A1:A5').setFontWeight('bold');
  }
  return tab;
}

// Sync, but fall back to the last copy if finance can't be read (logged, non-fatal)
function trySyncFinanceBudget_() {
  try {
    syncFinanceBudget_();
    return true;
  } catch (err) {
    Logger.log('[trySyncFinanceBudget_] Using last synced budget: ' + err);
    return false;
  }
}

function getBudgetConfig_() {
  const tab = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.BUDGET);
  if (!tab || tab.getRange('A1').getValue() !== 'Budget Year') {
    throw new Error('Budget not synced yet. Run 🎃 PartBot → 🔄 Sync Budget.');
  }

  // All FRC lines down to the "FRC Total" row, in finance's order
  const totalRow  = findBudgetTotalRow_(tab);
  const rows      = tab.getRange(BUDGET_TAB.FIRST_LINE_ROW, 1, totalRow - BUDGET_TAB.FIRST_LINE_ROW, 3).getValues();
  const lineOrder = [];
  const lines     = {};
  rows.forEach(([name, budget, spent]) => {
    if (!name) return;
    lineOrder.push(name);
    lines[name] = { budget: parseFloat(budget) || 0, spent: parseFloat(spent) || 0 };
  });

  return {
    yearLabel:   tab.getRange(BUDGET_TAB.YEAR_LABEL).getValue(),
    seasonStart: new Date(tab.getRange(BUDGET_TAB.YEAR_START).getValue()),   // budget year start
    seasonEnd:   new Date(tab.getRange(BUDGET_TAB.YEAR_END).getValue()),     // budget year end
    lastSynced:  tab.getRange(BUDGET_TAB.LAST_SYNCED).getValue(),
    lineOrder:   lineOrder,
    lines:       lines
  };
}

// getValues() rows stop at the sheet's last used column, so W can be undefined
function isReimbursed_(row) {
  const v = row[PART_REQUESTS_COLS.REIMBURSED - 1];
  return v instanceof Date || (v !== undefined && v !== null && v.toString().trim() !== '');
}

// Returns the budget line a row's cost counts against, or null if it doesn't count
function pendingBudgetLine_(row, config) {
  const id         = (row[PART_REQUESTS_COLS.REQUEST_ID - 1]     || '').toString();
  const status     = (row[PART_REQUESTS_COLS.REQUEST_STATUS - 1] || '').toString();
  const ts         = row[PART_REQUESTS_COLS.TIMESTAMP - 1];

  if (!id) return null;
  if (status === STATUS.CANCELLED || status === STATUS.DENIED) return null;
  if (isReimbursed_(row)) return null;   // now in finance "Spent"
  if (ts) {
    const reqDate = new Date(ts);
    if (reqDate < config.seasonStart || reqDate > config.seasonEnd) return null;
  }
  return budgetLineFor_(row[PART_REQUESTS_COLS.BUDGET_CATEGORY - 1]);
}

function getBudgetStatus_() {
  const config = getBudgetConfig_();
  const ss     = SpreadsheetApp.getActive();
  const sheet  = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);

  const pending = {};
  BUDGET_LINES.forEach(l => pending[l] = 0);

  if (sheet) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const line    = pendingBudgetLine_(data[i], config);
      const estCost = parseFloat(data[i][PART_REQUESTS_COLS.TOTAL_EST_COST - 1]) || 0;
      if (line && estCost > 0) pending[line] += estCost;
    }
  }

  // Older Budget tabs (before the full FRC sync) may lack a purchase line
  const order = config.lineOrder.concat(BUDGET_LINES.filter(l => config.lineOrder.indexOf(l) < 0));
  const lines = order.map(name => {
    const { budget, spent } = config.lines[name] || { budget: 0, spent: 0 };
    const isPartBot   = BUDGET_LINES.indexOf(name) >= 0;
    const linePending = isPartBot ? pending[name] : 0;
    const used        = spent + linePending;
    return {
      name,
      partBot:     isPartBot,   // PartBot requests count against this line
      budget,
      spent,
      pending:     linePending,
      remaining:   budget - used,
      percentUsed: budget > 0 ? used / budget * 100 : 0
    };
  });

  const sum   = key => lines.reduce((t, l) => t + l[key], 0);
  const total = {
    name:      BUDGET_TAB.TOTAL_LABEL,
    budget:    sum('budget'),
    spent:     sum('spent'),
    pending:   sum('pending'),
    remaining: sum('remaining')
  };
  total.percentUsed = total.budget > 0 ? (total.spent + total.pending) / total.budget * 100 : 0;

  try {
    const tab = ss.getSheetByName(SHEET_NAMES.BUDGET);
    const out = lines.concat([total]).map(l => [l.name, l.budget, l.spent, l.pending, l.remaining, l.percentUsed / 100]);
    tab.getRange(BUDGET_TAB.FIRST_LINE_ROW, 1, out.length, BUDGET_TAB.NUM_COLS).setValues(out);
    tab.getRange(BUDGET_TAB.FIRST_LINE_ROW, 2, out.length, 4).setNumberFormat('$#,##0.00');
    tab.getRange(BUDGET_TAB.FIRST_LINE_ROW, 6, out.length, 1).setNumberFormat('0.0%');
    tab.getRange(BUDGET_TAB.FIRST_LINE_ROW + lines.length, 1, 1, BUDGET_TAB.NUM_COLS).setFontWeight('bold');
  } catch (e) {
    Logger.log('[getBudgetStatus_] Budget sheet update failed: ' + e);
  }

  return {
    yearLabel:   config.yearLabel,
    yearStart:   config.seasonStart.toLocaleDateString(),
    yearEnd:     config.seasonEnd.toLocaleDateString(),
    lastSynced:  config.lastSynced ? new Date(config.lastSynced).toISOString() : null,
    lines:       lines,
    total:       total
  };
}

function handleBudgetStatus_(body) {
  try {
    const synced = trySyncFinanceBudget_();
    refreshAllBudgetStatuses_();   // also updates the Budget tab
    const status = getBudgetStatus_();
    return jsonResponse_({ status: 'ok', synced: synced, budget: status });
  } catch (err) {
    Logger.log('[handleBudgetStatus_] Error: ' + err);
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

function budgetBar_(percentUsed, width) {
  const filled = Math.max(0, Math.min(width, Math.round(percentUsed / 100 * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function formatMoney_(v) {
  const s = '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? '-' + s : s;
}

function showBudgetStatus() {
  try {
    const status = getBudgetStatus_();
    const block  = l =>
      `${l.name}\n` +
      `  Budget ${formatMoney_(l.budget)} · Spent ${formatMoney_(l.spent)} · Pending ${formatMoney_(l.pending)}\n` +
      `  Remaining ${formatMoney_(l.remaining)}   [${budgetBar_(l.percentUsed, 20)}] ${l.percentUsed.toFixed(1)}%`;

    SpreadsheetApp.getUi().alert('💰 FRC Budget',
      `${status.yearLabel}\n\n` +
      status.lines.map(block).join('\n\n') + '\n\n' +
      block(status.total) + '\n\n' +
      'Spent = logged by finance. Pending = PartBot requests not yet reimbursed.\n' +
      `Last synced: ${status.lastSynced ? new Date(status.lastSynced).toLocaleString() : 'never'}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (err) {
    SpreadsheetApp.getUi().alert('❌ Error', err.toString(), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

// Menu + hourly trigger: pull latest finance numbers and recompute
function syncBudget(e) {
  syncFinanceBudget_();
  ensureBudgetSyncTrigger_();
  refreshAllBudgetStatuses_();
  if (!e) {   // menu click (the hourly trigger passes an event and has no UI)
    SpreadsheetApp.getUi().alert('🔄 Budget Synced', 'Budget amounts and finance "Spent" updated from the HMB Robotics budget spreadsheet.', SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function ensureBudgetSyncTrigger_() {
  const exists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'syncBudget');
  if (!exists) ScriptApp.newTrigger('syncBudget').timeBased().everyHours(1).create();
}

/******************************************************
 * BUDGET STATUS PER REQUEST (Column P)
 ******************************************************/

// Menu: fill missing prices for this season's active requests
function enrichAllPending() {
  const ss      = SpreadsheetApp.getActive();
  const sheet   = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const config  = getBudgetConfig_();
  const data    = sheet.getDataRange().getValues();
  const started = Date.now();

  let tried = 0, priced = 0, timedOut = false;
  const stillMissing = [];

  for (let i = 1; i < data.length; i++) {
    const id      = (data[i][PART_REQUESTS_COLS.REQUEST_ID - 1]     || '').toString();
    const link    = (data[i][PART_REQUESTS_COLS.PART_LINK - 1]      || '').toString();
    const estCost = parseFloat(data[i][PART_REQUESTS_COLS.TOTAL_EST_COST - 1]) || 0;
    const status  = (data[i][PART_REQUESTS_COLS.REQUEST_STATUS - 1] || '').toString();
    const ts      = data[i][PART_REQUESTS_COLS.TIMESTAMP - 1];

    // Skip if no link, already has price, cancelled/denied, or outside season
    if (!id || !link) continue;
    if (estCost > 0) continue;
    if (status === STATUS.CANCELLED || status === STATUS.DENIED) continue;
    if (ts) {
      const reqDate = new Date(ts);
      if (reqDate < config.seasonStart || reqDate > config.seasonEnd) continue;
    }

    // Stay under the 6-minute Apps Script limit; re-run to continue
    if (Date.now() - started > 4.5 * 60 * 1000) { timedOut = true; break; }

    Logger.log(`Enriching row ${i+1}: ${id}`);
    tried++;
    try {
      enrichPartRequest(id, i + 1);
      const cost = parseFloat(sheet.getRange(i + 1, PART_REQUESTS_COLS.TOTAL_EST_COST).getValue()) || 0;
      if (cost > 0) priced++; else stillMissing.push(id);
      Utilities.sleep(1000); // Avoid rate limiting
    } catch(e) {
      Logger.log(`Error on ${id}: ` + e);
      stillMissing.push(id);
    }
  }

  refreshAllBudgetStatuses_(sheet);

  let message = `Checked ${tried} request(s); found prices for ${priced}.`;
  if (stillMissing.length) {
    message += `\n\nStill no price (enter manually — McMaster-Carr pages hide prices):\n${stillMissing.join(', ')}`;
  }
  if (timedOut) message += '\n\nStopped early to avoid a timeout — run again to continue.';
  SpreadsheetApp.getUi().alert('💲 Fill Missing Prices', message, SpreadsheetApp.getUi().ButtonSet.OK);
}

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

    // Each budget line starts from Budget − finance Spent, then counts down
    // through its pending requests (oldest first = first to reserve budget)
    const config  = getBudgetConfig_();
    const running = {};
    BUDGET_LINES.forEach(l => {
      const { budget, spent } = config.lines[l] || { budget: 0, spent: 0 };
      running[l] = budget - spent;
    });

    const data       = sheet.getDataRange().getValues();
    const activeRows = [];
    const reimbursed = [];

    for (let i = 1; i < data.length; i++) {
      const line = pendingBudgetLine_(data[i], config);
      if (!line) {
        if (data[i][PART_REQUESTS_COLS.REQUEST_ID - 1] && isReimbursed_(data[i])) {
          reimbursed.push(i + 1);
        } else if (/^💵/.test(data[i][PART_REQUESTS_COLS.BUDGET_STATUS - 1] || '')) {
          // Label no longer applies (Reimbursed date removed)
          sheet.getRange(i + 1, PART_REQUESTS_COLS.BUDGET_STATUS).setValue('');
        }
        continue;
      }
      const timestamp = data[i][PART_REQUESTS_COLS.TIMESTAMP - 1];
      activeRows.push({
        rowIndex:  i + 1,    // 1-based sheet row
        id:        data[i][PART_REQUESTS_COLS.REQUEST_ID - 1],
        line:      line,
        timestamp: timestamp ? new Date(timestamp) : new Date(0),
        estCost:   parseFloat(data[i][PART_REQUESTS_COLS.TOTAL_EST_COST - 1]) || 0
      });
    }

    activeRows.sort((a, b) => a.timestamp - b.timestamp);

    for (const req of activeRows) {
      let statusText;
      if (req.estCost <= 0) {
        statusText = '⚪ No price yet';
      } else {
        running[req.line] -= req.estCost;
        const left   = running[req.line];
        const budget = (config.lines[req.line] || {}).budget || 0;
        const pct    = budget > 0 ? left / budget * 100 : 100;

        if (left < 0)        statusText = `🔴 ${formatMoney_(-left)} over · ${req.line}`;
        else if (pct <= 10)  statusText = `🟡 ${formatMoney_(left)} left · ${req.line}`;
        else                 statusText = `🟢 ${formatMoney_(left)} left · ${req.line}`;
      }
      sheet.getRange(req.rowIndex, PART_REQUESTS_COLS.BUDGET_STATUS).setValue(statusText);
    }

    reimbursed.forEach(r =>
      sheet.getRange(r, PART_REQUESTS_COLS.BUDGET_STATUS).setValue('💵 Reimbursed (in finance Spent)'));

    // Keep Budget tab totals in sync with Column P
    getBudgetStatus_();

  } catch (err) {
    Logger.log('[refreshAllBudgetStatuses_] Error: ' + err);
  }
}

// Remaining for one budget line after a given request (used for the Discord reply)
function budgetAfterRequest_(requestRow) {
  const sheet  = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const row    = sheet.getRange(requestRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const status = getBudgetStatus_();
  const line   = budgetLineFor_(row[PART_REQUESTS_COLS.BUDGET_CATEGORY - 1]);
  const info   = status.lines.find(l => l.name === line);

  return {
    line:        line,
    requestCost: parseFloat(row[PART_REQUESTS_COLS.TOTAL_EST_COST - 1]) || 0,
    budget:      info.budget,
    remaining:   info.remaining,
    percentUsed: info.percentUsed
  };
}

/******************************************************
 * ORDER SCHEDULE (Settings tab)
 * Mentors set which days orders are reviewed and placed.
 * Rows are found by the label in column A, so they can be moved.
 ******************************************************/

const SETTINGS_LABELS = {
  MODE:       'Ordering Mode',
  IN_SEASON:  'In-season Order Days',
  OFF_SEASON: 'Off-season Order Days'
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Creates the Settings tab with defaults if it is missing; returns the sheet
function ensureSettingsTab_() {
  const ss  = SpreadsheetApp.getActive();
  let   tab = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (tab) return tab;

  tab = ss.insertSheet(SHEET_NAMES.SETTINGS);
  tab.getRange(1, 1, 4, 2).setValues([
    ['Setting', 'Value'],
    [SETTINGS_LABELS.MODE,       'Off-season'],
    [SETTINGS_LABELS.IN_SEASON,  'Monday, Thursday'],
    [SETTINGS_LABELS.OFF_SEASON, 'Monday']
  ]);
  tab.getRange(1, 1, 1, 2).setFontWeight('bold');
  tab.getRange(2, 2).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(BUILD_SEASONS, true).setAllowInvalid(false)
      .setHelpText('Switch to In-season at kickoff and back to Off-season after the last event.').build());
  tab.getRange(6, 1).setValue(
    'Order days are shown to students after /requestpart. List weekdays separated by commas, e.g. "Monday, Thursday".');
  tab.setColumnWidth(1, 200);
  tab.setColumnWidth(2, 200);
  return tab;
}

// Turns "Tue, friday & Sat" into ['Tuesday', 'Friday', 'Saturday']; unknown words are ignored
function parseWeekdays_(text) {
  return (text || '').toString()
    .split(/,|&|\/|\band\b/i)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .map(s => WEEKDAYS.find(d => d.toLowerCase().startsWith(s.slice(0, 3))))
    .filter((d, i, all) => d && all.indexOf(d) === i);
}

// { mode: 'In-season' | 'Off-season', days: [...] }, or null if no valid days are set
function getOrderSchedule_() {
  const values   = ensureSettingsTab_().getDataRange().getValues();
  const valueFor = label => {
    const row = values.find(r => (r[0] || '').toString().trim() === label);
    return row ? row[1] : '';
  };

  const mode = valueFor(SETTINGS_LABELS.MODE).toString().trim() === 'In-season' ? 'In-season' : 'Off-season';
  const days = parseWeekdays_(valueFor(mode === 'In-season' ? SETTINGS_LABELS.IN_SEASON : SETTINGS_LABELS.OFF_SEASON));
  return days.length ? { mode: mode, days: days } : null;
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
    sheet.getRange(i, PART_REQUESTS_COLS.IN_INVENTORY).setFormula(inInventoryFormula_(i));
  }

  sheet.getRange(2, PART_REQUESTS_COLS.IN_INVENTORY, lastRow - 1, 1).setHorizontalAlignment('center');

  // Budget columns: category and season dropdowns, reimbursed date
  sheet.getRange(1, PART_REQUESTS_COLS.BUDGET_CATEGORY, 1, 3)
    .setValues([['Category', 'Build Season', 'Reimbursed']]);
  sheet.getRange(2, PART_REQUESTS_COLS.BUDGET_CATEGORY, lastRow - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(Object.keys(BUDGET_CATEGORIES), true).setAllowInvalid(false).build());
  sheet.getRange(2, PART_REQUESTS_COLS.BUILD_SEASON, lastRow - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(BUILD_SEASONS, true).setAllowInvalid(false).build());
  sheet.getRange(2, PART_REQUESTS_COLS.REIMBURSED, lastRow - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false)
      .setHelpText('Date finance logged this expense. Leave blank until then.').build())
    .setNumberFormat('m/d/yyyy');

  setupConditionalFormatting_(sheet, lastRow);
  ensureSettingsTab_();
  ensureLocationsTab_();

  SpreadsheetApp.getUi().alert('✅ Setup Complete!', 'Dropdown workflow, inventory indicator, budget columns, row highlighting, the Settings tab (order days), and the Locations tab configured successfully!', SpreadsheetApp.getUi().ButtonSet.OK);
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
    .addItem('💲 Fill Missing Prices',             'enrichAllPending')
    .addItem('📦 Retry Add to Inventory',         'retryAddToInventory')
    .addItem('🔍 Find Missing Inventory Items',   'findMissingInventoryItems')
    .addItem('🧽 Clean Up Locations & Vendors',   'cleanupLocationsAndVendors')
    .addItem('💰 Refresh All Budget Statuses',    'refreshAllBudgetStatuses')
    .addItem('🔄 Sync Budget',                    'syncBudget')
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
 * RECEIVING FROM DISCORD (/receive) & LOCATIONS
 ******************************************************/

const LOCATION_TYPES = ['Subsystem Bin', 'Stock Bin', 'Toolbox', 'Build', 'Other'];
const MOVES_HEADERS  = ['When', 'Who', 'SKU', 'Part Name', 'Qty', 'To', 'Request ID', 'How'];
const STUDENT_LOCATION_PREFIX = 'STUDENT-';

// Requests a box can arrive for
function isReceivable_(status) {
  return status === STATUS.APPROVED || status === STATUS.ORDERED;
}

// Locations tab: the list /receive offers. Seeded once from locations already used in Inventory.
function ensureLocationsTab_() {
  const ss = SpreadsheetApp.getActive();
  let tab = ss.getSheetByName(SHEET_NAMES.LOCATIONS);
  if (tab) return tab;

  tab = ss.insertSheet(SHEET_NAMES.LOCATIONS);
  tab.getRange(1, 1, 1, 3).setValues([['Location', 'Type', 'Description']]).setFontWeight('bold');
  tab.setFrozenRows(1);

  const seen = {};
  const inventory = ss.getSheetByName(SHEET_NAMES.INVENTORY);
  if (inventory && inventory.getLastRow() > 1) {
    inventory.getRange(2, INVENTORY_COLS.LOCATION, inventory.getLastRow() - 1, 1).getValues()
      .forEach(r => cleanLocation_(r[0]).split(',').map(s => s.trim()).filter(Boolean)
        .forEach(loc => { if (loc.indexOf('UNKNOWN') !== 0) seen[loc] = true; }));
  }
  const rows = Object.keys(seen).sort().map(loc => [loc, guessLocationType_(loc), '']);
  if (rows.length) tab.getRange(2, 1, rows.length, 3).setValues(rows);

  tab.getRange(2, 2, Math.max(tab.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(LOCATION_TYPES, true).setAllowInvalid(false).build());
  tab.getRange(1, 5).setValue('Students pick a Location from this list in /receive (or hand the part to a student). ' +
    'Add a row for each new bin or toolbox; delete rows that no longer exist.');
  return tab;
}

function guessLocationType_(loc) {
  const l = loc.toUpperCase();
  if (/TOOLBOX|PACKOUT/.test(l)) return 'Toolbox';
  if (/^BIN-\d+$|^RACK-|SPARE/.test(l)) return 'Stock Bin';
  if (/^BIN-/.test(l)) return 'Subsystem Bin';
  if (/BOT|ASSY|BUILD/.test(l)) return 'Build';
  return 'Other';
}

function getLocations_() {
  const tab = ensureLocationsTab_();
  if (tab.getLastRow() < 2) return [];
  return tab.getRange(2, 1, tab.getLastRow() - 1, 2).getValues()
    .filter(r => (r[0] || '').toString().trim())
    .map(r => ({ name: r[0].toString().trim(), type: (r[1] || 'Other').toString() }));
}

// Inventory Moves tab: one row per receipt, so there's a record of who put what where
// Never throws: a logging problem must not interrupt a receipt that already updated inventory
function logMove_(move) {
  try {
    const ss = SpreadsheetApp.getActive();
    let tab = ss.getSheetByName(SHEET_NAMES.MOVES);
    if (!tab) {
      tab = ss.insertSheet(SHEET_NAMES.MOVES);
      tab.getRange(1, 1, 1, MOVES_HEADERS.length).setValues([MOVES_HEADERS]).setFontWeight('bold');
      tab.setFrozenRows(1);
    }
    tab.getRange(tab.getLastRow() + 1, 1, 1, MOVES_HEADERS.length).setValues([[
      new Date(), move.who || '', move.sku || '', move.partName || '', move.qty,
      move.to || '', move.requestId || '', move.how || ''
    ]]);
  } catch (err) {
    Logger.log('[logMove_] Could not log move (non-fatal): ' + err);
  }
}

// Mentor email when Google provides it (it may not inside onEdit)
function currentUserLabel_(fallback) {
  try {
    return Session.getActiveUser().getEmail() || fallback;
  } catch (err) {
    return fallback;
  }
}

// Action receiveOptions: open requests and locations for /receive autocomplete
function handleReceiveOptions_(body) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const C = PART_REQUESTS_COLS;
  const data = sheet.getDataRange().getValues();
  const requests = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const r = data[i];
    const status = (r[C.REQUEST_STATUS - 1] || '').toString();
    if (!r[C.REQUEST_ID - 1] || !isReceivable_(status)) continue;
    requests.push({
      id: r[C.REQUEST_ID - 1].toString(),
      partName: (r[C.PART_NAME - 1] || '').toString(),
      sku: (r[C.SKU - 1] || '').toString(),
      qty: r[C.QUANTITY - 1] || 1,
      requester: (r[C.REQUESTER - 1] || '').toString(),
      status: status
    });
  }
  return jsonResponse_({ status: 'ok', requests: requests, locations: getLocations_() });
}

// Action receive: a student opened the box and put the parts somewhere
function handleReceive_(body) {
  const requestId = (body.requestId || '').toString().trim().toUpperCase();
  const receiver  = (body.receiver  || 'Discord User').toString().trim();
  const studentTo = (body.student   || '').toString().trim();
  let location    = cleanLocation_(body.location || '');

  if (!requestId) return jsonResponse_({ status: 'error', message: 'Request ID is required' });
  if (!!studentTo === !!location) {
    return jsonResponse_({ status: 'error', message: 'Pick a location **or** a student (one, not both).' });
  }

  if (studentTo) {
    location = STUDENT_LOCATION_PREFIX + studentTo;
  } else {
    // Only listed locations, so typos like "UKNOWN" can't come back
    const match = getLocations_().find(l => l.name.toUpperCase() === location.toUpperCase());
    if (!match) {
      return jsonResponse_({ status: 'error',
        message: `"${location}" isn't on the Locations list. Pick one from the suggestions, or ask a mentor to add it to the Locations tab.` });
    }
    location = match.name;
  }

  try {
    const result = withScriptLock_(() => {
      const ss    = SpreadsheetApp.getActive();
      const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
      const C     = PART_REQUESTS_COLS;
      const ids   = sheet.getRange(2, C.REQUEST_ID, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
      const idx   = ids.findIndex(r => (r[0] || '').toString().trim().toUpperCase() === requestId);
      if (idx < 0) return { error: `Request ${requestId} not found.` };
      const row = idx + 2;
      const r   = sheet.getRange(row, 1, 1, C.BUILD_SEASON).getValues()[0];
      const id  = r[C.REQUEST_ID - 1].toString().trim();   // as stored (lower-case hex); Orders match on it

      const status = (r[C.REQUEST_STATUS - 1] || '').toString();
      if (!isReceivable_(status)) {
        return { error: `${id} is ${status || 'blank'}, so it can't be received. ` +
          (status === STATUS.RECEIVED || status === STATUS.COMPLETE ? 'It was already received.' : 'A mentor needs to approve it first.') };
      }

      const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
      const orderRow = ordersSheet ? findOrderByRequestId(ordersSheet, id) : null;
      let partName = (r[C.PART_NAME - 1] || '').toString().trim();
      let sku      = (r[C.SKU - 1] || '').toString().trim();
      if (orderRow && !partName) partName = (ordersSheet.getRange(orderRow, ORDERS_COLS.PART_NAME).getValue() || '').toString();
      if (orderRow && !sku)      sku      = (ordersSheet.getRange(orderRow, ORDERS_COLS.SKU).getValue() || '').toString();
      if (!partName && !sku) return { error: `${id} has no part name or SKU yet; ask a mentor to fill it in first.` };

      const orderedQty = parseFloat(r[C.QUANTITY - 1]) || 1;
      const qty = parseFloat(body.quantity) > 0 ? parseFloat(body.quantity) : orderedQty;

      addToInventoryUnlocked_(sku, partName, qty, location, detectVendor(r[C.PART_LINK - 1]));

      if (orderRow) {
        const receivedCell = ordersSheet.getRange(orderRow, ORDERS_COLS.RECEIVED_DATE);
        if (!receivedCell.getValue()) receivedCell.setValue(new Date());
        ordersSheet.getRange(orderRow, ORDERS_COLS.ORDER_STATUS).setValue('Received');
      }

      // Setting the status from code doesn't fire onEdit, so nothing prompts or double-adds
      const short = qty < orderedQty ? ` (ordered ${orderedQty})` : '';
      const notes = (r[C.MENTOR_NOTES - 1] || '').toString();
      sheet.getRange(row, C.REQUEST_STATUS).setValue(STATUS.RECEIVED);
      sheet.getRange(row, C.MENTOR_NOTES).setValue(notes +
        `\n[${new Date().toLocaleDateString()}] Received ${qty}x${short}, added to inventory at ${location} by ${receiver} (Discord)`);

      logMove_({ who: receiver, sku: sku, partName: partName, qty: qty, to: location, requestId: id, how: '/receive' });
      SpreadsheetApp.flush();

      return {
        requestId: id, partName: partName, sku: sku, qty: qty, orderedQty: orderedQty,
        location: location, requester: (r[C.REQUESTER - 1] || '').toString(),
        onHand: findInventoryQty_(sku, partName)
      };
    });

    if (result.error) return jsonResponse_({ status: 'error', message: result.error });
    return jsonResponse_(Object.assign({ status: 'ok' }, result));
  } catch (err) {
    Logger.log('[handleReceive_] Error: ' + err);
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

function findInventoryQty_(sku, partName) {
  const inv = SpreadsheetApp.getActive().getSheetByName(SHEET_NAMES.INVENTORY);
  if (!inv || inv.getLastRow() < 2) return null;
  const rows = inv.getRange(2, 1, inv.getLastRow() - 1, INVENTORY_COLS.QTY_ON_HAND).getValues();
  const key = (sku || '').toString().trim().toLowerCase();
  const hit = rows.find(r => key && (r[INVENTORY_COLS.SKU - 1] || '').toString().trim().toLowerCase() === key);
  return hit ? hit[INVENTORY_COLS.QTY_ON_HAND - 1] : null;
}

/******************************************************
 * LOCATION & VENDOR CLEANUP
 ******************************************************/

// Location spellings that mean the same place (keys are upper case, single-spaced)
const LOCATION_ALIASES = {
  'UKNOWN': 'UNKNOWN',
  'UNKOWN': 'UNKNOWN',
  'UNKNOWN': 'UNKNOWN',
  'UNKNOWN 2024 BOT': 'UNKNOWN-2024-BOT',
  'UNKNOWN 2026 BOT': 'UNKNOWN-2026-BOT',
  'PARTS-TOOLBOX': 'TOOLBOX-PARTS'
};

// Vendor spellings to the names detectVendor() uses (keys are lower case)
const VENDOR_ALIASES = {
  'wcp': 'West Coast Products',
  'westcoast products': 'West Coast Products',
  'ctr electronics': 'CTRE',
  'cross the road electronics': 'CTRE',
  'mcmaster-carr': 'McMaster-Carr',
  'mcmaster carr': 'McMaster-Carr',
  'mcmaster': 'McMaster-Carr',
  'powerworx': 'Powerwerx',
  'reduxrobotics': 'Redux Robotics',
  'rev': 'REV Robotics',
  'andy mark': 'AndyMark',
  'thriftybot': 'Thrifty Bot'
};

// "BIN-001, UKNOWN, BIN-001" -> "BIN-001": fix spellings, drop repeats,
// and drop plain UNKNOWN when a real location is also listed
function cleanLocation_(text) {
  const parts = (text || '').toString().split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => LOCATION_ALIASES[p.toUpperCase().replace(/\s+/g, ' ')] || p);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  const known  = unique.filter(p => p !== 'UNKNOWN');
  return (known.length ? known : unique).join(', ');
}

// Fix vendor spellings; fill a blank/Unknown/Other vendor only when the SKU prefix is unambiguous
function canonicalVendor_(vendor, sku) {
  const v = (vendor || '').toString().trim();
  const alias = VENDOR_ALIASES[v.toLowerCase()];
  if (alias) return alias;
  if (!v || v === 'Unknown' || v === 'Other') {
    const s = (sku || '').toString().trim();
    if (/^WCP-\d/i.test(s)) return 'West Coast Products';
    if (/^REV-\d/i.test(s)) return 'REV Robotics';
    if (/^am-\d/i.test(s))  return 'AndyMark';
  }
  return v;
}

// Menu: preview, confirm, apply, and log every change to the Cleanup Log tab
function cleanupLocationsAndVendors() {
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  const inventory = ss.getSheetByName(SHEET_NAMES.INVENTORY);
  const orders    = ss.getSheetByName(SHEET_NAMES.ORDERS);
  const changes   = [];   // [sheet, row, column, old, new]

  const scan = (sheet, col, fn, label) => {
    if (!sheet || sheet.getLastRow() < 2) return;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    data.forEach((r, i) => {
      const before = (r[col - 1] || '').toString();
      const after  = fn(r);
      if (after !== before) changes.push([sheet.getName(), i + 2, label, before, after, col]);
    });
  };

  scan(inventory, INVENTORY_COLS.LOCATION, r => cleanLocation_(r[INVENTORY_COLS.LOCATION - 1]), 'Location');
  scan(inventory, INVENTORY_COLS.VENDOR,
    r => canonicalVendor_(r[INVENTORY_COLS.VENDOR - 1], r[INVENTORY_COLS.SKU - 1]), 'Vendor');
  scan(orders, ORDERS_COLS.VENDOR,
    r => canonicalVendor_(r[ORDERS_COLS.VENDOR - 1], r[ORDERS_COLS.SKU - 1]), 'Vendor');

  if (changes.length === 0) {
    ui.alert('🧽 Clean Up Locations & Vendors', 'Nothing to clean up.', ui.ButtonSet.OK);
    return;
  }

  const count = (sheet, label) => changes.filter(c => c[0] === sheet && c[2] === label).length;
  let preview = `Found ${changes.length} cell(s) to fix:\n` +
    `• Inventory locations: ${count(SHEET_NAMES.INVENTORY, 'Location')}\n` +
    `• Inventory vendors: ${count(SHEET_NAMES.INVENTORY, 'Vendor')}\n` +
    `• Orders vendors: ${count(SHEET_NAMES.ORDERS, 'Vendor')}\n\nExamples:\n`;
  changes.slice(0, 8).forEach(c => { preview += `${c[0]} row ${c[1]}: "${c[3]}" → "${c[4]}"\n`; });
  preview += '\nQuantities are not changed. Every change is logged to the "Cleanup Log" tab. Apply?';

  if (ui.alert('🧽 Clean Up Locations & Vendors', preview, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  withScriptLock_(() => {
    changes.forEach(c => ss.getSheetByName(c[0]).getRange(c[1], c[5]).setValue(c[4]));
    let log = ss.getSheetByName('Cleanup Log');
    if (!log) {
      log = ss.insertSheet('Cleanup Log');
      log.appendRow(['When', 'Sheet', 'Row', 'Column', 'Old Value', 'New Value']);
      log.setFrozenRows(1);
    }
    const now = new Date();
    log.getRange(log.getLastRow() + 1, 1, changes.length, 6)
      .setValues(changes.map(c => [now, c[0], c[1], c[2], c[3], c[4]]));
    SpreadsheetApp.flush();
  });

  ui.alert('✅ Cleanup Complete', `Fixed ${changes.length} cell(s). See the "Cleanup Log" tab for each change.`, ui.ButtonSet.OK);
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

  if (/added to inventory/.test((mentorNotes || '').toString())) {
    const again = ui.alert('Already in Inventory',
      `${requestID} was already added to inventory. Add ${quantity} more anyway?`, ui.ButtonSet.YES_NO);
    if (again !== ui.Button.YES) return;
  }

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
    logMove_({ who: currentUserLabel_('Mentor (sheet)'), sku: sku, partName: partName,
      qty: quantity, to: cleanLocation_(location), requestId: requestID, how: 'Retry Add to Inventory' });
    const timestamp    = new Date().toLocaleDateString();
    sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES)
      .setValue((mentorNotes || '') + `\n[${timestamp}] Received ${quantity}x, manually added to inventory at ${location}`);
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