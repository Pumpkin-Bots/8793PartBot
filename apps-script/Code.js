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
  
  // ✨ TRIGGER AI ENRICHMENT
  if (data.partLink) {
    try {
      enrichPartRequest(requestID, nextRow);
    } catch (err) {
      Logger.log('[createPartRequest_] Enrichment failed: ' + err);
      // Don't throw - enrichment failure shouldn't break request creation
    }
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
    
    Logger.log(`[enrichPartRequest] Part Link: ${partLink}`);
    Logger.log(`[enrichPartRequest] Existing Part Name: ${existingPartName}`);
    Logger.log(`[enrichPartRequest] Existing SKU: ${existingSku}`);
    
    // Only enrich if we have a link and missing name/SKU
    if (!partLink || (existingPartName && existingSku)) {
      Logger.log('[enrichPartRequest] No link or already has name/SKU, skipping');
      return;
    }
    
    Logger.log(`[enrichPartRequest] Enriching ${requestID} with link: ${partLink}`);
    
    // Fetch the webpage content
    Logger.log('[enrichPartRequest] Fetching page content...');
    const pageContent = fetchPageContent_(partLink);
    if (!pageContent) {
      Logger.log('[enrichPartRequest] ERROR: Could not fetch page content');
      return;
    }
    
    Logger.log(`[enrichPartRequest] Got page content, length: ${pageContent.length}`);
    Logger.log(`[enrichPartRequest] First 500 chars: ${pageContent.substring(0, 500)}`);
    Logger.log(`[enrichPartRequest] Last 500 chars: ${pageContent.substring(Math.max(0, pageContent.length - 500))}`);
    
    // Extract info using Gemini
    Logger.log('[enrichPartRequest] Calling Gemini API...');
    let extracted = extractWithGemini_(pageContent, partLink);
    
    // If Gemini failed completely (returned null), create empty object
    if (!extracted) {
      Logger.log('[enrichPartRequest] ERROR: Gemini extraction failed');
      extracted = { partName: null, sku: null, price: null };
    } else {
      Logger.log(`[enrichPartRequest] Extraction successful: ${JSON.stringify(extracted)}`);
    }
    
    // FALLBACK: If extraction failed and it's McMaster-Carr, use SKU fallback
    if ((!extracted.partName || !extracted.sku) && partLink.toLowerCase().includes('mcmaster.com')) {
      Logger.log('[enrichPartRequest] McMaster detected - using SKU fallback');
      
      // Extract SKU from McMaster URL (format: mcmaster.com/XXXXYYYY or mcmaster.com/XXXX-YYYY)
      const urlMatch = partLink.match(/mcmaster\.com\/([0-9A-Z\-]+)/i);
      if (urlMatch && urlMatch[1]) {
        const mcmasterSku = urlMatch[1].toUpperCase();
        Logger.log(`[enrichPartRequest] Extracted McMaster SKU from URL: ${mcmasterSku}`);
        
        // Simple fallback - just use SKU in a clean format
        if (!extracted.partName) {
          extracted.partName = `McMaster ${mcmasterSku}`;
        }
        if (!extracted.sku) {
          extracted.sku = mcmasterSku;
        }
        
        Logger.log(`[enrichPartRequest] Using McMaster fallback: ${extracted.partName}`);
      }
    }
    
    Logger.log(`[enrichPartRequest] Final extraction (after fallbacks): ${JSON.stringify(extracted)}`);
    
    // FALLBACK: Amazon - extract from URL if page fetch failed
    if ((!extracted.partName || !extracted.sku) && partLink.toLowerCase().includes('amazon.com')) {
      Logger.log('[enrichPartRequest] Amazon detected - checking for URL-based extraction');
      
      // Extract product name from URL slug (between product title and /dp/)
      const nameMatch = partLink.match(/amazon\.com\/([^\/]+)\/dp\//i);
      if (nameMatch && nameMatch[1]) {
        const urlSlug = decodeURIComponent(nameMatch[1].replace(/-/g, ' '));
        Logger.log(`[enrichPartRequest] Extracted Amazon name from URL: ${urlSlug}`);
        
        if (!extracted.partName && urlSlug.length > 3 && urlSlug.length < 150) {
          extracted.partName = urlSlug;
        }
      }
      
      // Extract ASIN (Amazon product ID)
      const asinMatch = partLink.match(/\/dp\/([A-Z0-9]{10})/i);
      if (asinMatch && asinMatch[1]) {
        const asin = asinMatch[1].toUpperCase();
        Logger.log(`[enrichPartRequest] Extracted Amazon ASIN: ${asin}`);
        
        if (!extracted.sku) {
          extracted.sku = asin;
        }
      }
      
      Logger.log(`[enrichPartRequest] Amazon fallback result: ${JSON.stringify(extracted)}`);
    }
    
    // Update the spreadsheet
    let updated = false;
    
    if (extracted.partName && !existingPartName) {
      Logger.log(`[enrichPartRequest] Writing Part Name: ${extracted.partName}`);
      sheet.getRange(row, PART_REQUESTS_COLS.PART_NAME).setValue(extracted.partName);
      updated = true;
      Logger.log(`[enrichPartRequest] ✓ Set part name`);
    }
    
    if (extracted.sku && !existingSku) {
      Logger.log(`[enrichPartRequest] Writing SKU: ${extracted.sku}`);
      sheet.getRange(row, PART_REQUESTS_COLS.SKU).setValue(extracted.sku);
      updated = true;
      Logger.log(`[enrichPartRequest] ✓ Set SKU`);
    }
    
    if (extracted.price) {
      Logger.log(`[enrichPartRequest] Writing Price: ${extracted.price}`);
      sheet.getRange(row, PART_REQUESTS_COLS.EST_UNIT_PRICE).setValue(extracted.price);
      updated = true;
      Logger.log(`[enrichPartRequest] ✓ Set price`);
    }
    
    if (updated) {
      // Update mentor notes with AI enrichment timestamp
      const timestamp = new Date().toLocaleString();
      const currentNotes = sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).getValue() || '';
      const updatedNotes = currentNotes + `\n[${timestamp}] ✨ AI enriched`;
      Logger.log(`[enrichPartRequest] Writing mentor notes: ${updatedNotes}`);
      sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);
      Logger.log(`[enrichPartRequest] ✓ Updated mentor notes`);
    }
    
    Logger.log(`[enrichPartRequest] ✅ Successfully enriched ${requestID}`);
    
  } catch (err) {
    Logger.log(`[enrichPartRequest] ERROR: ${err}`);
    Logger.log(`[enrichPartRequest] Stack: ${err.stack}`);
  }
}

function fetchPageContent_(url) {
  try {
    // Special handling for McMaster
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
    
    // For McMaster, try to extract from meta tags or title before stripping HTML
    if (url.toLowerCase().includes('mcmaster.com')) {
      Logger.log(`[fetchPageContent_] Attempting McMaster meta extraction...`);
      
      // Try to find product title in meta tags
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        const title = titleMatch[1].trim();
        Logger.log(`[fetchPageContent_] Found title: ${title}`);
        if (title !== 'McMaster-Carr' && !title.includes('JavaScript')) {
          return `Product Title: ${title}\n\n${html}`;
        }
      }
      
      // Try meta description
      const metaMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
      if (metaMatch && metaMatch[1]) {
        Logger.log(`[fetchPageContent_] Found meta description: ${metaMatch[1]}`);
        return `Product: ${metaMatch[1]}\n\n${html}`;
      }
    }
    
    // Extract text from HTML (simple version)
    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove scripts
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // Remove styles
      .replace(/<[^>]+>/g, ' ') // Remove HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    // Limit to first 8000 chars to stay within token limits
    if (text.length > 8000) {
      text = text.substring(0, 8000);
    }
    
    return text;
    
  } catch (err) {
    Logger.log(`[fetchPageContent_] Error: ${err}`);
    return null;
  }
}

function extractWithGemini_(pageContent, url) {
  try {
    const props = PropertiesService.getScriptProperties();
    const apiKey = props.getProperty('GEMINI_API_KEY');
    
    if (!apiKey) {
      Logger.log('[extractWithGemini_] No GEMINI_API_KEY found in script properties');
      return null;
    }
    
    // Detect vendor for better prompting
    const vendor = detectVendor(url);
    
    const prompt = `You are analyzing a product page for an FRC robotics parts ordering system.

URL: ${url}
Vendor: ${vendor}

Page content:
${pageContent}

Extract the following information in JSON format:
{
  "partName": "the full product name/title",
  "sku": "the product SKU/part number/model number",
  "price": "the unit price as a number (no currency symbol)"
}

Rules:
- Part name should be descriptive but concise (under 100 chars)
- SKU should be the vendor's part number (like "217-4583" for McMaster, "WCP-0350" for WCP)
- Price should be numeric only (e.g., 12.99 not "$12.99")
- If you can't find something, use null
- Return ONLY valid JSON, no other text

JSON:`;
    
    const apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
    
    const payload = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500
      }
    };
    
    const response = UrlFetchApp.fetch(`${apiUrl}?key=${apiKey}`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    const responseCode = response.getResponseCode();
    if (responseCode !== 200) {
      Logger.log(`[extractWithGemini_] API returned ${responseCode}: ${response.getContentText()}`);
      return null;
    }
    
    const data = JSON.parse(response.getContentText());
    
    if (!data.candidates || data.candidates.length === 0) {
      Logger.log('[extractWithGemini_] No candidates in response');
      return null;
    }
    
    const text = data.candidates[0].content.parts[0].text;
    Logger.log(`[extractWithGemini_] Raw response: ${text}`);
    
    // Extract JSON from response (might have markdown backticks)
    let jsonText = text.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }
    
    const extracted = JSON.parse(jsonText);
    
    Logger.log(`[extractWithGemini_] Extracted: ${JSON.stringify(extracted)}`);
    
    return {
      partName: extracted.partName || null,
      sku: extracted.sku || null,
      price: extracted.price ? parseFloat(extracted.price) : null
    };
    
  } catch (err) {
    Logger.log(`[extractWithGemini_] Error: ${err}`);
    Logger.log(`[extractWithGemini_] Stack: ${err.stack}`);
    return null;
  }
}

/**
 * Manual test function for AI enrichment
 */
function testEnrichment() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  const ui = SpreadsheetApp.getUi();
  
  // Get the currently selected row
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
  
  ui.alert('Testing AI Enrichment', `Enriching ${requestID}...\n\nCheck the Execution log for results.`, ui.ButtonSet.OK);
  
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
 * OPEN ORDERS HANDLER
 ******************************************************/

function handleOpenOrders_(body) {
  const ss = SpreadsheetApp.getActive();
  
  let debugSheet = ss.getSheetByName('Debug Log');
  if (!debugSheet) {
    debugSheet = ss.insertSheet('Debug Log');
  }
  
  function logToSheet(message) {
    const timestamp = new Date().toLocaleTimeString();
    const nextRow = debugSheet.getLastRow() + 1;
    debugSheet.getRange(nextRow, 1).setValue(timestamp);
    debugSheet.getRange(nextRow, 2).setValue(message);
    Logger.log(message);
  }
  
  try {
    logToSheet('[START] handleOpenOrders_ called');
    
    const ordSheet = ss.getSheetByName('Orders');
    logToSheet('Orders sheet: ' + (ordSheet ? 'FOUND' : 'NOT FOUND'));
    
    if (!ordSheet) {
      logToSheet('[ERROR] Orders sheet not found');
      return jsonResponse_({ 
        status: 'error', 
        message: 'Orders sheet not found' 
      });
    }
    
    const ordValues = ordSheet.getDataRange().getValues();
    logToSheet('Got ' + ordValues.length + ' rows from Orders');
    
    const orders = [];
    
    if (ordValues && ordValues.length > 1) {
      const rows = ordValues.slice(1);
      
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const orderId = row[0];
        
        if (!orderId || orderId.toString().trim() === '') {
          continue;
        }
        
        const received = row[12];
        const status = row[13] ? row[13].toString().trim() : '';
        
        const hasReceivedDate = (received !== null && received !== undefined && received !== '');
        const isCancelled = status.toLowerCase().includes('cancel');
        
        if (!hasReceivedDate && !isCancelled) {
          orders.push({
            orderId: orderId.toString().trim(),
            includedRequests: row[1] ? row[1].toString() : '',
            vendor: row[2] ? row[2].toString() : '',
            partName: row[3] ? row[3].toString() : '',
            sku: row[4] ? row[4].toString() : '',
            qty: row[5] || '',
            orderDate: row[8] || null,
            shipping: row[9] ? row[9].toString() : '',
            tracking: row[10] ? row[10].toString() : '',
            eta: row[11] || null,
            status: status || 'Unknown'
          });
        }
      }
    }
    
    logToSheet('Found ' + orders.length + ' open orders');
    
    const reqSheet = ss.getSheetByName('Part Requests');
    logToSheet('Part Requests sheet: ' + (reqSheet ? 'FOUND' : 'NOT FOUND'));
    
    const denied = [];
    
    if (reqSheet) {
      const reqValues = reqSheet.getDataRange().getValues();
      logToSheet('Got ' + reqValues.length + ' rows from Part Requests');
      
      if (reqValues && reqValues.length > 1) {
        const rRows = reqValues.slice(1);
        
        for (let i = 0; i < rRows.length; i++) {
          const row = rRows[i];
          const id = row[0];
          
          if (!id || id.toString().trim() === '') {
            continue;
          }
          
          const status = row[16] ? row[16].toString().trim().toLowerCase() : '';
          
          if (status === 'denied' || status.includes('❌')) {
            denied.push({
              id: id.toString(),
              timestamp: row[1] || null,
              requester: row[2] ? row[2].toString() : '',
              subsystem: row[3] ? row[3].toString() : '',
              partName: row[4] ? row[4].toString() : '',
              sku: row[5] ? row[5].toString() : '',
              link: row[6] ? row[6].toString() : '',
              qty: row[7] || '',
              priority: row[8] ? row[8].toString() : '',
              mentorNotes: row[17] ? row[17].toString() : ''
            });
          }
        }
      }
    }
    
    logToSheet('Found ' + denied.length + ' denied requests');
    
    const response = {
      status: 'ok',
      orders: orders,
      denied: denied
    };
    
    logToSheet('[SUCCESS] Returning response with ' + orders.length + ' orders');
    
    return jsonResponse_(response);
    
  } catch (err) {
    logToSheet('[ERROR] Exception: ' + err.toString());
    
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

function extractPartNameFromUrl(url) {
  if (!url) return 'Unknown Part';
  
  try {
    const urlStr = url.toString();
    
    if (urlStr.includes('amazon.com')) {
      const match = urlStr.match(/\/([^\/]+)\/dp\//);
      if (match && match[1]) {
        return decodeURIComponent(match[1].replace(/-/g, ' '));
      }
    }
    
    if (urlStr.includes('mcmaster.com')) {
      const match = urlStr.match(/\/(\d+[A-Z]\d+)/);
      if (match && match[1]) {
        return 'McMaster ' + match[1];
      }
    }
    
    if (urlStr.includes('wcproducts.com') || urlStr.includes('westcoastproducts')) {
      const match = urlStr.match(/\/products\/([^\/\?]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1].replace(/-/g, ' '));
      }
    }
    
    if (urlStr.includes('vexrobotics.com') || urlStr.includes('vexpro.com')) {
      const match = urlStr.match(/\/products\/([^\/\?]+)/);
      if (match && match[1]) {
        return 'VEX ' + decodeURIComponent(match[1].replace(/-/g, ' '));
      }
    }
    
    if (urlStr.includes('andymark.com')) {
      const match = urlStr.match(/\/products\/([^\/\?]+)/);
      if (match && match[1]) {
        return 'AndyMark ' + decodeURIComponent(match[1].replace(/-/g, ' '));
      }
    }
    
    if (urlStr.includes('revrobotics.com')) {
      const match = urlStr.match(/\/products\/([^\/\?]+)/);
      if (match && match[1]) {
        return 'REV ' + decodeURIComponent(match[1].replace(/-/g, ' '));
      }
    }
    
    const parts = urlStr.split('/').filter(p => p.length > 0);
    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1].split('?')[0];
      return decodeURIComponent(lastPart.replace(/[-_]/g, ' '));
    }
    
  } catch (e) {
    Logger.log('[extractPartNameFromUrl] Error: ' + e);
  }
  
  return 'Part from ' + url.toString().substring(0, 50);
}

function addToInventory(sku, partName, quantity, location, vendor) {
  Logger.log(`[addToInventory] Starting: SKU=${sku}, Part=${partName}, Qty=${quantity}, Location=${location}`);
  
  const ss = SpreadsheetApp.getActive();
  const inventorySheet = ss.getSheetByName(SHEET_NAMES.INVENTORY);
  
  if (!inventorySheet) {
    Logger.log('[addToInventory] ERROR: Inventory sheet not found');
    throw new Error('Inventory sheet not found');
  }
  
  try {
    const data = inventorySheet.getDataRange().getValues();
    Logger.log(`[addToInventory] Inventory sheet has ${data.length} rows`);
    
    if (data.length < 1) {
      Logger.log('[addToInventory] ERROR: Inventory sheet is empty');
      throw new Error('Inventory sheet is empty');
    }
    
    let existingRow = null;
    
    if (sku) {
      const skuToMatch = sku.toString().toLowerCase().trim();
      Logger.log(`[addToInventory] Searching for existing SKU: ${skuToMatch}`);
      
      for (let i = 1; i < data.length; i++) {
        const rowSku = (data[i][INVENTORY_COLS.SKU - 1] || '').toString().toLowerCase().trim();
        
        if (rowSku && rowSku === skuToMatch) {
          existingRow = i + 1;
          Logger.log(`[addToInventory] Found existing item at row ${existingRow}`);
          break;
        }
      }
    }
    
    if (existingRow) {
      const currentQtyCell = inventorySheet.getRange(existingRow, INVENTORY_COLS.QTY_ON_HAND);
      const currentQty = parseFloat(currentQtyCell.getValue()) || 0;
      const newQty = currentQty + parseFloat(quantity);
      
      Logger.log(`[addToInventory] Updating quantity: ${currentQty} + ${quantity} = ${newQty}`);
      
      currentQtyCell.setValue(newQty);
      inventorySheet.getRange(existingRow, INVENTORY_COLS.LAST_COUNT_DATE).setValue(new Date());
      
      if (location) {
        const currentLocation = inventorySheet.getRange(existingRow, INVENTORY_COLS.LOCATION).getValue();
        if (!currentLocation) {
          inventorySheet.getRange(existingRow, INVENTORY_COLS.LOCATION).setValue(location);
        } else if (currentLocation !== location && !currentLocation.includes(location)) {
          inventorySheet.getRange(existingRow, INVENTORY_COLS.LOCATION).setValue(currentLocation + ', ' + location);
        }
      }
      
      Logger.log(`[addToInventory] SUCCESS: Updated existing item`);
      return true;
      
    } else {
      const nextRow = inventorySheet.getLastRow() + 1;
      Logger.log(`[addToInventory] Adding new item at row ${nextRow}`);
      
      inventorySheet.getRange(nextRow, INVENTORY_COLS.SKU).setValue(sku || '');
      inventorySheet.getRange(nextRow, INVENTORY_COLS.VENDOR).setValue(vendor || '');
      inventorySheet.getRange(nextRow, INVENTORY_COLS.PART_NAME).setValue(partName || '');
      inventorySheet.getRange(nextRow, INVENTORY_COLS.LOCATION).setValue(location);
      inventorySheet.getRange(nextRow, INVENTORY_COLS.QTY_ON_HAND).setValue(parseFloat(quantity));
      inventorySheet.getRange(nextRow, INVENTORY_COLS.LAST_COUNT_DATE).setValue(new Date());
      
      Logger.log(`[addToInventory] SUCCESS: Added new item`);
      return true;
    }
    
  } catch (err) {
    Logger.log(`[addToInventory] ERROR: ${err}`);
    throw err;
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
  SpreadsheetApp.getActive().toast('🛒 Order status updated', 'Success', 3);
}

function handleReceived(sheet, row) {
  Logger.log(`[handleReceived] ===== STARTING ROW ${row} =====`);
  
  const ss = SpreadsheetApp.getActive();
  const ui = SpreadsheetApp.getUi();
  
  const requestID = sheet.getRange(row, PART_REQUESTS_COLS.REQUEST_ID).getValue();
  let partName = sheet.getRange(row, PART_REQUESTS_COLS.PART_NAME).getValue();
  let sku = sheet.getRange(row, PART_REQUESTS_COLS.SKU).getValue();
  const partLink = sheet.getRange(row, PART_REQUESTS_COLS.PART_LINK).getValue();
  let quantity = sheet.getRange(row, PART_REQUESTS_COLS.QUANTITY).getValue();
  const mentorNotes = sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).getValue();
  
  Logger.log(`[handleReceived] Initial data:`);
  Logger.log(`  Request ID: ${requestID}`);
  Logger.log(`  Part Name: ${partName}`);
  Logger.log(`  SKU: ${sku}`);
  Logger.log(`  Part Link: ${partLink}`);
  Logger.log(`  Quantity: ${quantity} (type: ${typeof quantity})`);
  
  partName = partName ? partName.toString().trim() : '';
  sku = sku ? sku.toString().trim() : '';
  
  if (!partName && !sku) {
    Logger.log(`[handleReceived] Part Name/SKU missing, checking Orders sheet...`);
    
    const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
    if (ordersSheet) {
      const orderRow = findOrderByRequestId(ordersSheet, requestID);
      if (orderRow) {
        partName = ordersSheet.getRange(orderRow, ORDERS_COLS.PART_NAME).getValue() || '';
        sku = ordersSheet.getRange(orderRow, ORDERS_COLS.SKU).getValue() || '';
        
        if (!quantity || quantity === '' || isNaN(parseFloat(quantity))) {
          quantity = ordersSheet.getRange(orderRow, ORDERS_COLS.QTY_ORDERED).getValue();
          Logger.log(`[handleReceived] Got quantity from order: ${quantity}`);
        }
        
        Logger.log(`[handleReceived] Found in Orders: Part=${partName}, SKU=${sku}, Qty=${quantity}`);
      }
    }
  }
  
  if (!partName && !sku) {
    if (partLink && partLink !== '') {
      Logger.log(`[handleReceived] Extracting from URL...`);
      partName = extractPartNameFromUrl(partLink);
      sku = partLink;
      Logger.log(`[handleReceived] Extracted: Part=${partName}, SKU=${sku}`);
    } else {
      ui.alert(
        'Error',
        `Request ${requestID} has no identifiable information.\n\n` +
        'Missing: Part Name, SKU, and Part Link\n\n' +
        'Please fill in at least one and try again.',
        ui.ButtonSet.OK
      );
      Logger.log(`[handleReceived] ERROR: No identifiable information`);
      return;
    }
  }
  
  Logger.log(`[handleReceived] Validating quantity: value="${quantity}", type=${typeof quantity}`);
  
  let validQuantity = null;
  
  if (quantity !== null && quantity !== undefined && quantity !== '') {
    const parsed = parseFloat(quantity);
    Logger.log(`[handleReceived] parseFloat result: ${parsed}, isNaN: ${isNaN(parsed)}`);
    
    if (!isNaN(parsed) && parsed > 0) {
      validQuantity = parsed;
      Logger.log(`[handleReceived] Valid quantity: ${validQuantity}`);
    }
  }
  
  if (validQuantity === null) {
    Logger.log(`[handleReceived] Invalid quantity, prompting user...`);
    
    const qtyResponse = ui.prompt(
      '⚠️ Quantity Issue',
      `Request ${requestID}\n` +
      `Part: ${partName || sku}\n\n` +
      `The quantity field appears to be invalid or empty.\n` +
      `Current value: "${quantity}"\n\n` +
      `Please enter the quantity received:`,
      ui.ButtonSet.OK_CANCEL
    );
    
    if (qtyResponse.getSelectedButton() !== ui.Button.OK) {
      Logger.log(`[handleReceived] User cancelled quantity prompt`);
      return;
    }
    
    const userQty = qtyResponse.getResponseText().trim();
    const parsedUserQty = parseFloat(userQty);
    
    if (!userQty || isNaN(parsedUserQty) || parsedUserQty <= 0) {
      ui.alert(
        'Error',
        'Invalid quantity entered. Must be a positive number.',
        ui.ButtonSet.OK
      );
      Logger.log(`[handleReceived] ERROR: User entered invalid quantity: ${userQty}`);
      return;
    }
    
    validQuantity = parsedUserQty;
    Logger.log(`[handleReceived] User entered valid quantity: ${validQuantity}`);
    
    sheet.getRange(row, PART_REQUESTS_COLS.QUANTITY).setValue(validQuantity);
  }
  
  quantity = validQuantity;
  Logger.log(`[handleReceived] Proceeding with quantity: ${quantity}`);
  
  const ordersSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (ordersSheet) {
    const orderRow = findOrderByRequestId(ordersSheet, requestID);
    
    if (orderRow) {
      Logger.log(`[handleReceived] Found order at row ${orderRow}`);
      
      const today = new Date();
      ordersSheet.getRange(orderRow, ORDERS_COLS.RECEIVED_DATE).setValue(today);
      ordersSheet.getRange(orderRow, ORDERS_COLS.ORDER_STATUS).setValue('Received');
      
      Logger.log(`[handleReceived] Updated order received date and status`);
      
      ss.toast(
        `📦 Order marked as received on ${today.toLocaleDateString()}`,
        'Order Updated',
        3
      );
    } else {
      Logger.log(`[handleReceived] WARNING: No order found for ${requestID}`);
    }
  }
  
  const locationResponse = ui.prompt(
    '📦 Add to Inventory',
    `Request: ${requestID}\n` +
    `Part: ${partName || '(from link)'}\n` +
    `SKU: ${sku || '(from link)'}\n` +
    `Quantity: ${quantity}\n\n` +
    `Enter storage location (e.g., BIN-001):`,
    ui.ButtonSet.OK_CANCEL
  );
  
  if (locationResponse.getSelectedButton() !== ui.Button.OK) {
    Logger.log(`[handleReceived] User cancelled location prompt`);
    ss.toast('Cancelled - Order marked received but NOT added to inventory', '⚠️ Warning', 4);
    return;
  }
  
  const location = locationResponse.getResponseText().trim();
  
  if (!location) {
    ui.alert('Error', 'Location required. Order marked received, but not added to inventory.', ui.ButtonSet.OK);
    Logger.log(`[handleReceived] No location provided`);
    return;
  }
  
  const vendor = detectVendor(partLink);
  
  try {
    const added = addToInventory(sku, partName, quantity, location, vendor);
    
    if (added) {
      const timestamp = new Date().toLocaleDateString();
      const updatedNotes = (mentorNotes || '') + 
        `\n[${timestamp}] Received ${quantity}x, added to inventory at ${location}`;
      sheet.getRange(row, PART_REQUESTS_COLS.MENTOR_NOTES).setValue(updatedNotes);
      
      ss.toast(`✅ Added ${quantity}x ${partName || sku} to ${location}`, 'Inventory Updated', 5);
      Logger.log(`[handleReceived] ===== SUCCESS =====`);
    }
  } catch (err) {
    Logger.log(`[handleReceived] ERROR: ${err}`);
    ui.alert('Error', 'Order marked received, but failed to add to inventory:\n\n' + err.toString(), ui.ButtonSet.OK);
  }
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
 * UTILITY FUNCTIONS
 ******************************************************/

function cleanupEmptyRows() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.alert(
    '🧹 Clean Up Empty Rows',
    'This will delete all empty rows from Orders and Part Requests sheets.\n\nThis may take a minute. Continue?',
    ui.ButtonSet.YES_NO
  );
  
  if (result !== ui.Button.YES) {
    return;
  }
  
  const ss = SpreadsheetApp.getActive();
  
  const ordSheet = ss.getSheetByName(SHEET_NAMES.ORDERS);
  if (ordSheet) {
    Logger.log('[cleanupEmptyRows] Cleaning Orders sheet...');
    const lastRow = ordSheet.getMaxRows();
    let deletedCount = 0;
    
    for (let row = lastRow; row >= 2; row--) {
      const orderId = ordSheet.getRange(row, ORDERS_COLS.ORDER_ID).getValue();
      
      if (!orderId || orderId.toString().trim() === '') {
        ordSheet.deleteRow(row);
        deletedCount++;
        
        if (deletedCount % 50 === 0) {
          SpreadsheetApp.flush();
          Logger.log(`[cleanupEmptyRows] Deleted ${deletedCount} rows so far...`);
        }
      }
    }
    
    Logger.log(`[cleanupEmptyRows] Deleted ${deletedCount} empty rows from Orders`);
  }
  
  const reqSheet = ss.getSheetByName(SHEET_NAMES.PART_REQUESTS);
  if (reqSheet) {
    Logger.log('[cleanupEmptyRows] Cleaning Part Requests sheet...');
    const lastRow = reqSheet.getMaxRows();
    let deletedCount = 0;
    
    for (let row = lastRow; row >= 2; row--) {
      const reqId = reqSheet.getRange(row, PART_REQUESTS_COLS.REQUEST_ID).getValue();
      
      if (!reqId || reqId.toString().trim() === '') {
        reqSheet.deleteRow(row);
        deletedCount++;
        
        if (deletedCount % 50 === 0) {
          SpreadsheetApp.flush();
          Logger.log(`[cleanupEmptyRows] Deleted ${deletedCount} rows so far...`);
        }
      }
    }
    
    Logger.log(`[cleanupEmptyRows] Deleted ${deletedCount} empty rows from Part Requests`);
  }
  
  ui.alert(
    '✅ Cleanup Complete!',
    'Empty rows have been removed.',
    ui.ButtonSet.OK
  );
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
    .addItem('🧹 Clean Up Empty Rows', 'cleanupEmptyRows')
    .addItem('✨ Test AI Enrichment', 'testEnrichment')
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