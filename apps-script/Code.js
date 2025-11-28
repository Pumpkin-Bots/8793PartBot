/******************************************************
 * CONFIG
 ******************************************************/

// Sheet (tab) names
const PART_REQUESTS_SHEET_NAME = 'Part Requests';
const ORDERS_SHEET_NAME        = 'Orders';
const INVENTORY_SHEET_NAME     = 'Inventory';

// Script property holding your OpenAI API key
const OPENAI_KEY_PROPERTY_NAME = 'OPENAI_API_KEY';

// OpenAI model to use
const OPENAI_MODEL = 'gpt-4.1-mini';

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
  const partRequestsSheet  = ss.getSheetByName(PART_REQUESTS_SHEET_NAME);

  const formRow = e.range.getRow();
  const formData = formResponsesSheet
    .getRange(formRow, 1, 1, formResponsesSheet.getLastColumn())
    .getValues()[0];

  // Form columns (assumed):
  // 0 Timestamp
  // 1 Requester
  // 2 Subsystem
  // 3 Part Link
  // 4 Needed By
  // 5 Quantity
  // 6 Max Budget
  // 7 Priority
  // 8 Notes (optional)

  const timestamp  = formData[0];
  const requester  = formData[1];
  const subsystem  = formData[2];
  const partLink   = formData[3];
  const neededBy   = formData[4];
  const quantity   = formData[5];
  const maxBudget  = formData[6];
  const priority   = formData[7];
  const notes      = formData[8] || '';

  const uuid = Utilities.getUuid().split('-')[0];
  const requestID = 'REQ-' + uuid;
  const expeditedShipping = (priority === 'Critical') ? 'Expedited' : 'Standard';

  const nextRow = partRequestsSheet.getLastRow() + 1;

  // Part Requests columns:
  // 1 ID, 2 Timestamp, 3 Requester, 4 Subsystem, 5 Part Name,
  // 6 SKU, 7 Part Link, 8 Qty, 9 Priority, 10 Needed By,
  // 11 Inventory On-Hand, 12 Vendor Stock, 13 Est Unit Price,
  // 14 Total Est Cost, 15 Max Budget, 16 Budget Status,
  // 17 Request Status, 18 Mentor Notes, 19 Expedited Shipping

  partRequestsSheet.getRange(nextRow, 1).setValue(requestID);
  partRequestsSheet.getRange(nextRow, 2).setValue(timestamp);
  partRequestsSheet.getRange(nextRow, 3).setValue(requester);
  partRequestsSheet.getRange(nextRow, 4).setValue(subsystem);
  partRequestsSheet.getRange(nextRow, 7).setValue(partLink);
  partRequestsSheet.getRange(nextRow, 8).setValue(quantity);
  partRequestsSheet.getRange(nextRow, 9).setValue(priority);
  partRequestsSheet.getRange(nextRow, 10).setValue(neededBy);
  partRequestsSheet.getRange(nextRow, 15).setValue(maxBudget);
  partRequestsSheet.getRange(nextRow, 17).setValue('Requested');
  partRequestsSheet.getRange(nextRow, 18).setValue(notes);
  partRequestsSheet.getRange(nextRow, 19).setValue(expeditedShipping);

  enrichPartRequest(nextRow, notes);
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
    Logger.log('doPost raw body: ' + raw);

    const body = JSON.parse(raw);

    // Inventory lookup
    if (body.action === 'inventory') {
      Logger.log('doPost: inventory action, sku="%s" search="%s"', body.sku || '', body.search || '');
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
    Logger.log('doPost error: ' + err);
    return jsonResponse_({ status: 'error', message: err.toString() });
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/******************************************************
 * DISCORD → PART REQUESTS
 ******************************************************/

function handleDiscordRequest_(body) {
  const ss = SpreadsheetApp.getActive();
  const partRequestsSheet = ss.getSheetByName(PART_REQUESTS_SHEET_NAME);
  if (!partRequestsSheet) {
    throw new Error('Sheet not found: ' + PART_REQUESTS_SHEET_NAME);
  }

  const timestamp     = new Date();
  const requester     = body.requester || 'Discord User';
  const subsystem     = body.subsystem || '';
  const partLink      = body.partLink || '';
  const quantity      = body.quantity || 1;
  const neededBy      = body.neededBy || '';
  const maxBudget     = body.maxBudget || '';
  const priority      = body.priority || 'Medium';
  const notes         = body.notes || '';
  const expeditedShip = (priority === 'Critical') ? 'Expedited' : 'Standard';

  const uuid = Utilities.getUuid().split('-')[0];
  const requestID = 'REQ-' + uuid;
  const nextRow = partRequestsSheet.getLastRow() + 1;

  partRequestsSheet.getRange(nextRow, 1).setValue(requestID);
  partRequestsSheet.getRange(nextRow, 2).setValue(timestamp);
  partRequestsSheet.getRange(nextRow, 3).setValue(requester);
  partRequestsSheet.getRange(nextRow, 4).setValue(subsystem);
  partRequestsSheet.getRange(nextRow, 7).setValue(partLink);
  partRequestsSheet.getRange(nextRow, 8).setValue(quantity);
  partRequestsSheet.getRange(nextRow, 9).setValue(priority);
  partRequestsSheet.getRange(nextRow, 10).setValue(neededBy);
  partRequestsSheet.getRange(nextRow, 15).setValue(maxBudget);
  partRequestsSheet.getRange(nextRow, 17).setValue('Requested');
  partRequestsSheet.getRange(nextRow, 18).setValue(notes);
  partRequestsSheet.getRange(nextRow, 19).setValue(expeditedShip);

  try {
    Logger.log('handleDiscordRequest_: calling enrichPartRequest for row ' + nextRow);
    enrichPartRequest(nextRow, notes);
  } catch (err) {
    Logger.log('enrichPartRequest error for row ' + nextRow + ': ' + err);
  }

  return jsonResponse_({ status: 'ok', requestID: requestID });
}

/******************************************************
 * FUNCTION TO MOVE PURCHASE SHEET 
 ******************************************************/
function onEdit(e) {
  // Safety: make sure we have event data
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  // Only watch the Part Requests sheet
  if (sheet.getName() !== PART_REQUESTS_SHEET_NAME) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();

  // Ignore header row
  if (row === 1) return;

  // Column 17 = Request Status
  const STATUS_COL = 17;
  if (col !== STATUS_COL) return;

  const newValue = (e.value || '').toString().trim();

  // Only react when the user changes the cell to "Approved"
  if (newValue.toLowerCase() !== 'approved') return;

  try {
    // Create the order and update status to "Ordered"
    approveRequest(row);
  } catch (err) {
    Logger.log('onEdit approveRequest error for row ' + row + ': ' + err);
  }
}

/******************************************************
 * AI ENRICHMENT (Part Name, SKU, Price, Vendor Stock)
 ******************************************************/

function enrichPartRequest(row, hintText) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(PART_REQUESTS_SHEET_NAME);
  const inventorySheet = ss.getSheetByName(INVENTORY_SHEET_NAME);

  const url = sheet.getRange(row, 7).getValue();
  if (!url) {
    Logger.log('No URL in row ' + row);
    return;
  }

  let htmlSnippet = '';
  try {
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    htmlSnippet = resp.getContentText().substring(0, 15000);
  } catch (err) {
    Logger.log('Error fetching URL for row ' + row + ': ' + err);
  }

  const notes = sheet.getRange(row, 18).getValue() || hintText || '';

  const aiData = getPartInfoFromAI(url, htmlSnippet, notes);
  if (!aiData) {
    Logger.log('AI enrichment failed for row ' + row);
    return;
  }

  let partName   = aiData.partName || '';
  let sku        = aiData.sku || '';
  const price      = aiData.estimatedPrice || '';
  const stockState = aiData.stockStatus || '';

  // Special handling: WCP ball bearings multi-variant page
  const urlLower = url.toLowerCase();
  if (urlLower.includes('wcproducts.com/collections/cnc-hardware/products/ball-bearings')) {
    // Use AI name, but do not trust SKU unless it appears in HTML
    if (sku) {
      const normalizedHtml = htmlSnippet.toLowerCase();
      const normalizedSku  = sku.toString().toLowerCase();
      if (!normalizedHtml.includes(normalizedSku)) {
        Logger.log('Discarding AI SKU for WCP bearings page row ' + row);
        sku = '';
      }
    }
  }

  // Final safety: if SKU not found in HTML at all, drop it
  if (sku) {
    const normalizedHtml = htmlSnippet.toLowerCase();
    const normalizedSku  = sku.toString().toLowerCase();
    if (!normalizedHtml.includes(normalizedSku)) {
      Logger.log('Discarding AI SKU "' + sku + '" for row ' + row + ' – not found in HTML.');
      sku = '';
    }
  }

  if (partName)   sheet.getRange(row, 5).setValue(partName);
  if (sku)        sheet.getRange(row, 6).setValue(sku);
  if (price)      sheet.getRange(row, 13).setValue(price);
  if (stockState) sheet.getRange(row, 12).setValue(stockState);

  if (sku && inventorySheet) {
    const invOnHand = lookupInventoryBySKU(inventorySheet, sku);
    sheet.getRange(row, 11).setValue(invOnHand);
  }
}

function enrichSelectedFromMenu() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(PART_REQUESTS_SHEET_NAME);
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
  const notes = sheet.getRange(row, 18).getValue() || '';
  enrichPartRequest(row, notes);
  SpreadsheetApp.getUi().alert('AI enrichment attempted for row ' + row + '.');
}

function getPartInfoFromAI(url, htmlSnippet, hintText) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(OPENAI_KEY_PROPERTY_NAME);
  if (!apiKey) {
    throw new Error(OPENAI_KEY_PROPERTY_NAME + ' is not set in Script properties.');
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
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent }
    ],
    response_format: { type: 'json_object' }
  };

  const response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code !== 200) {
    Logger.log('OpenAI error: ' + code + ' ' + response.getContentText());
    return null;
  }

  const data = JSON.parse(response.getContentText());
  const content = data.choices[0].message.content;

  let ai;
  try {
    ai = JSON.parse(content);
  } catch (err) {
    Logger.log('Failed to parse AI JSON: ' + err + ' content=' + content);
    return null;
  }

  Logger.log('AI part info for URL ' + url + ': ' + JSON.stringify(ai));
  return ai;
}

/******************************************************
 * ORDER STATUS LOOKUP
 ******************************************************/
function handleOrderStatus_(body) {
  const ss = SpreadsheetApp.getActive();
  const reqSheet = ss.getSheetByName(PART_REQUESTS_SHEET_NAME);
  const ordSheet = ss.getSheetByName(ORDERS_SHEET_NAME);

  const requestId = (body.requestId || '').toString().trim();
  const orderId   = (body.orderId   || '').toString().trim();

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

    // Part Requests columns (0-based):
    // 0 ID, 1 Timestamp, 2 Requester, 3 Subsystem, 4 Part Name,
    // 5 SKU, 6 Link, 7 Qty, 8 Priority, 9 Needed By,
    // 10 Inventory, 11 Vendor Stock, 12 Est Unit Price,
    // 13 Total Est Cost, 14 Max Budget, 15 Budget Status,
    // 16 Request Status, 17 Mentor Notes, 18 Expedited Shipping

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const id  = (row[0] || '').toString().trim();
      if (id === requestId) {
        reqInfo = {
          id: row[0],
          timestamp: row[1],
          requester: row[2],
          subsystem: row[3],
          partName: row[4],
          sku: row[5],
          link: row[6],
          qty: row[7],
          priority: row[8],
          neededBy: row[9],
          inventoryOnHand: row[10],
          vendorStock: row[11],
          estUnitPrice: row[12],
          totalEstCost: row[13],
          maxBudget: row[14],
          budgetStatus: row[15],
          requestStatus: row[16],
          mentorNotes: row[17],
          shipping: row[18]
        };
        break;
      }
    }

    result.request = reqInfo;

    // Also find any orders linked to this request ID
    if (ordSheet && reqInfo) {
      const ovals = ordSheet.getDataRange().getValues();
      const linkedOrders = [];

      // Orders columns (0-based):
      // 0 Order ID, 1 Included Request IDs, 2 Vendor, 3 Part Name, 4 SKU,
      // 5 Qty Ordered, 6 Final Unit Price, 7 Total Cost, 8 Order Date,
      // 9 Shipping, 10 Tracking, 11 ETA, 12 Received Date,
      // 13 Order Status, 14 Mentor Notes

      for (let i = 1; i < ovals.length; i++) {
        const row = ovals[i];
        const includedRaw = (row[1] || '').toString();
        const ids = includedRaw
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        if (ids.includes(requestId)) {
          linkedOrders.push({
            orderId: row[0],
            includedRequests: includedRaw,
            vendor: row[2],
            partName: row[3],
            sku: row[4],
            qty: row[5],
            unitPrice: row[6],
            totalCost: row[7],
            orderDate: row[8],
            shipping: row[9],
            tracking: row[10],
            eta: row[11],
            receivedDate: row[12],
            status: row[13],
            mentorNotes: row[14]
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
      const id  = (row[0] || '').toString().trim();
      if (id === orderId) {
        orderInfo = {
          orderId: row[0],
          includedRequests: row[1],
          vendor: row[2],
          partName: row[3],
          sku: row[4],
          qty: row[5],
          unitPrice: row[6],
          totalCost: row[7],
          orderDate: row[8],
          shipping: row[9],
          tracking: row[10],
          eta: row[11],
          receivedDate: row[12],
          status: row[13],
          mentorNotes: row[14]
        };
        break;
      }
    }

    result.order = orderInfo;
  }

  return jsonResponse_(result);
}

/******************************************************
 * INVENTORY LOOKUP
 ******************************************************/
function lookupInventoryBySKU(inventorySheet, sku) {
  const values = inventorySheet.getDataRange().getValues();
  const SKU_COL = 0; // A
  const QTY_COL = 4; // E

  const target = sku.toString().trim().toLowerCase();

  for (let i = 1; i < values.length; i++) {
    const rowSku = (values[i][SKU_COL] || '').toString().trim().toLowerCase();
    if (rowSku && rowSku === target) {
      const qty = values[i][QTY_COL];
      return qty || 0;
    }
  }
  return 0;
}

/******************************************************
 * INVENTORY LOOKUP
 ******************************************************/
function handleInventoryLookup_(body) {
  const ss = SpreadsheetApp.getActive();
  const inventorySheet = ss.getSheetByName(INVENTORY_SHEET_NAME);
  if (!inventorySheet) {
    return jsonResponse_({ status: 'error', message: 'Inventory sheet not found' });
  }

  const skuQuery   = (body.sku || '').toString().trim();
  const searchText = (body.search || '').toString().trim();

  Logger.log('handleInventoryLookup_: sku="%s" search="%s"', skuQuery, searchText);

  const values = inventorySheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    return jsonResponse_({ status: 'ok', matches: [] });
  }

  const SKU_COL    = 0;
  const VENDOR_COL = 1;
  const NAME_COL   = 2;
  const LOC_COL    = 3;
  const QTY_COL    = 4;

  const rows = values.slice(1);
  const matches = [];

  // Exact SKU match
  if (skuQuery) {
    const target = skuQuery.toLowerCase();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowSkuRaw = row[SKU_COL];
      const rowSku = (rowSkuRaw || '').toString().trim().toLowerCase();

      Logger.log('Row %s SKU raw="%s" normalized="%s"', i + 2, rowSkuRaw, rowSku);

      if (rowSku && rowSku === target) {
        matches.push({
          sku: row[SKU_COL],
          vendor: row[VENDOR_COL],
          name: row[NAME_COL],
          location: row[LOC_COL],
          quantity: row[QTY_COL]
        });
        break;
      }
    }
  }

  // Fallback fuzzy search
  const fallbackQuery = (searchText || skuQuery).toLowerCase();
  if (matches.length === 0 && fallbackQuery) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowSku  = (row[SKU_COL]  || '').toString().toLowerCase();
      const rowName = (row[NAME_COL] || '').toString().toLowerCase();

      if (rowSku.indexOf(fallbackQuery) !== -1 || rowName.indexOf(fallbackQuery) !== -1) {
        matches.push({
          sku: row[SKU_COL],
          vendor: row[VENDOR_COL],
          name: row[NAME_COL],
          location: row[LOC_COL],
          quantity: row[QTY_COL]
        });
      }

      if (matches.length >= 10) break;
    }
  }

  Logger.log('handleInventoryLookup_ result: ' + JSON.stringify(matches));

  return jsonResponse_({ status: 'ok', matches: matches });
}

/******************************************************
 * OPEN ORDERS
 ******************************************************/
function handleOpenOrders_(body) {
  const ss = SpreadsheetApp.getActive();
  const ordSheet = ss.getSheetByName(ORDERS_SHEET_NAME);
  const reqSheet = ss.getSheetByName(PART_REQUESTS_SHEET_NAME);

  if (!ordSheet) {
    return jsonResponse_({
      status: 'error',
      message: 'Orders sheet not found'
    });
  }

  const ordValues = ordSheet.getDataRange().getValues();
  const orders = [];

  if (ordValues && ordValues.length > 1) {
    // Orders columns (0-based index):
    // 0 Order ID, 1 Included Request IDs, 2 Vendor, 3 Part Name, 4 SKU,
    // 5 Qty Ordered, 6 Final Unit Price, 7 Total Cost, 8 Order Date,
    // 9 Shipping Method, 10 Tracking, 11 ETA, 12 Received Date,
    // 13 Order Status, 14 Mentor Notes

    const rows = ordValues.slice(1);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      const orderId   = (row[0] || '').toString().trim();
      const vendor    = row[2] || '';
      const partName  = row[3] || '';
      const sku       = row[4] || '';
      const qty       = row[5] || '';
      const orderDate = row[8] || '';
      const shipping  = row[9] || '';
      const tracking  = row[10] || '';
      const eta       = row[11] || '';
      const received  = row[12];  // may be blank
      const status    = (row[13] || '').toString().trim();
      const reqIds    = row[1] || '';

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

  // ---- Also collect "Denied" requests from Part Requests sheet ----
  const denied = [];
  if (reqSheet) {
    const reqValues = reqSheet.getDataRange().getValues();
    if (reqValues && reqValues.length > 1) {
      // Part Requests columns (0-based):
      // 0 ID, 1 Timestamp, 2 Requester, 3 Subsystem, 4 Part Name,
      // 5 SKU, 6 Link, 7 Qty, 8 Priority, 9 Needed By,
      // 10 Inventory, 11 Vendor Stock, 12 Est Unit Price,
      // 13 Total Est Cost, 14 Max Budget, 15 Budget Status,
      // 16 Request Status, 17 Mentor Notes, 18 Expedited Shipping

      const rRows = reqValues.slice(1);
      for (let i = 0; i < rRows.length; i++) {
        const row = rRows[i];
        const id      = (row[0] || '').toString().trim();
        const status  = (row[16] || '').toString().trim().toLowerCase();

        if (!id) continue;
        if (status === 'denied') {
          denied.push({
            id: row[0],
            timestamp: row[1],
            requester: row[2],
            subsystem: row[3],
            partName: row[4],
            sku: row[5],
            link: row[6],
            qty: row[7],
            priority: row[8],
            neededBy: row[9],
            mentorNotes: row[17] || ''
          });
        }
      }
    }
  }

  Logger.log('handleOpenOrders_ found ' + orders.length + ' open orders and ' + denied.length + ' denied requests');

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
  const sheet = ss.getSheetByName(PART_REQUESTS_SHEET_NAME);
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

/******************************************************
 * APPROVE REQUEST
 ******************************************************/
function approveRequest(requestRow) {
  const ss = SpreadsheetApp.getActive();
  const requestSheet = ss.getSheetByName(PART_REQUESTS_SHEET_NAME);
  const orderSheet   = ss.getSheetByName(ORDERS_SHEET_NAME);

  const requestID    = requestSheet.getRange(requestRow, 1).getValue();
  const partName     = requestSheet.getRange(requestRow, 5).getValue();
  const sku          = requestSheet.getRange(requestRow, 6).getValue();
  const link         = requestSheet.getRange(requestRow, 7).getValue();
  const qty          = requestSheet.getRange(requestRow, 8).getValue();
  const estUnit      = requestSheet.getRange(requestRow, 13).getValue();
  const totalEst     = requestSheet.getRange(requestRow, 14).getValue();
  const maxBudget    = requestSheet.getRange(requestRow, 15).getValue();
  const budgetStatus = requestSheet.getRange(requestRow, 16).getValue();
  const shipping     = requestSheet.getRange(requestRow, 19).getValue() || 'Standard';

  if (!requestID) {
    throw new Error('No Request ID found in row ' + requestRow);
  }

  if (budgetStatus && budgetStatus.toString().startsWith('Over Budget')) {
    throw new Error('Request ' + requestID + ' exceeds budget. Fix or override before approving.');
  }

  const orderID = 'ORD-' + Utilities.getUuid().split('-')[0];
  const vendor  = extractVendorFromURL(link);

  orderSheet.appendRow([
    orderID,
    requestID,
    vendor,
    partName,
    sku,
    qty,
    estUnit,
    totalEst,
    new Date(),
    shipping,
    '',
    '',
    '',
    'Ordered',
    ''
  ]);

  requestSheet.getRange(requestRow, 17).setValue('Ordered');
}

// Vendor extraction helper
function extractVendorFromURL(url) {
  if (!url) return 'Other Vendor';
  const lower = url.toLowerCase();
  if (lower.includes('revrobotics'))      return 'REV Robotics';
  if (lower.includes('andymark'))         return 'AndyMark';
  if (lower.includes('mcmaster'))         return 'McMaster-Carr';
  if (lower.includes('vexrobotics'))      return 'VEX Robotics';
  if (lower.includes('digikey'))          return 'DigiKey';
  if (lower.includes('amazon'))           return 'Amazon';
  if (lower.includes('wcproducts'))       return 'West Coast Products';
  if (lower.includes('ctr-electronics'))  return 'CTR Electronics';
  if (lower.includes('homedepot'))        return 'Home Depot';
  if (lower.includes('powerwerx'))        return 'PowerWorx';
  if (lower.includes('sendcutsend'))      return 'SendCutSend';
  if (lower.includes('foamorder'))        return 'Foam Order';
  return 'Other Vendor';
}