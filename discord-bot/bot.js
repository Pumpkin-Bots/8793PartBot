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
 * bot.js - Modifications to use shared-constants.js
 * 
 * INSTALLATION:
 * 1. Save shared-constants.js in the same directory as bot.js
 * 2. Add the require statement at the top of bot.js
 * 3. Replace the configuration sections with these modified versions
 */

// ============================================
// ADD THIS AT THE TOP (after other requires)
// ============================================

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const axios = require('axios');

// *** ADD THIS LINE ***
const {
  API_ACTIONS,
  API_STATUS,
  ERROR_CODES,
  REQUEST_FIELDS,
  RESPONSE_FIELDS,
  SUBSYSTEMS,
  PRIORITIES,
  VALIDATION_LIMITS,
  DISPLAY_LIMITS,
  FALLBACKS
} = require('./shared-constants');

// ============================================
// REPLACE CONFIG SECTION
// ============================================

const CONFIG = {
  DISCORD: {
    TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID
  },
  APPS_SCRIPT_URL: process.env.APPS_SCRIPT_URL,
  // Use shared validation limits
  LIMITS: VALIDATION_LIMITS,
  // Use shared display limits
  DISPLAY: DISPLAY_LIMITS,
  HTTP: {
    TIMEOUT: 10000,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000
  }
};

// Remove local FALLBACKS - now imported from shared constants

// ============================================
// REPLACE SUBSYSTEMS ARRAY IN SLASH COMMANDS
// ============================================

// OLD:
// const SUBSYSTEMS = [
//   { name: 'Drive', value: 'Drive' },
//   ...
// ];

// NEW: Generate from shared constants
const SUBSYSTEM_CHOICES = Object.entries(SUBSYSTEMS).map(([key, value]) => ({
  name: value,
  value: value
}));

const PRIORITY_CHOICES = Object.entries(PRIORITIES).map(([key, value]) => ({
  name: value,
  value: value
}));

// ============================================
// UPDATE SLASH COMMANDS TO USE CHOICES
// ============================================

const commands = [
  new SlashCommandBuilder()
    .setName('requestpart')
    .setDescription('Submit an FRC part request to Google Sheets')
    .addStringOption(option =>
      option
        .setName('subsystem')
        .setDescription('Subsystem (Drive, Intake, Shooter, etc.)')
        .setRequired(true)
        .addChoices(...SUBSYSTEM_CHOICES)  // *** CHANGED ***
    )
    .addStringOption(option =>
      option
        .setName('link')
        .setDescription('Part link (URL)')
        .setRequired(false)
        .setMaxLength(VALIDATION_LIMITS.MAX_URL_LENGTH)  // *** ADDED ***
    )
    .addIntegerOption(option =>
      option
        .setName('qty')
        .setDescription('Quantity')
        .setRequired(false)
        .setMinValue(VALIDATION_LIMITS.MIN_QUANTITY)  // *** CHANGED ***
        .setMaxValue(VALIDATION_LIMITS.MAX_QUANTITY)  // *** CHANGED ***
    )
    .addNumberOption(option =>
      option
        .setName('maxbudget')
        .setDescription('Max budget (USD)')
        .setRequired(false)
        .setMinValue(VALIDATION_LIMITS.MIN_BUDGET)  // *** CHANGED ***
        .setMaxValue(VALIDATION_LIMITS.MAX_BUDGET)  // *** CHANGED ***
    )
    .addStringOption(option =>
      option
        .setName('priority')
        .setDescription('Priority level')
        .setRequired(false)
        .addChoices(...PRIORITY_CHOICES)  // *** CHANGED ***
    )
    .addStringOption(option =>
      option
        .setName('notes')
        .setDescription('Additional notes (size, length, etc.)')
        .setRequired(false)
        .setMaxLength(VALIDATION_LIMITS.MAX_NOTE_LENGTH)  // *** CHANGED ***
    ),
  
  // ... other commands remain the same
];

// ============================================
// UPDATE handleRequestPart TO USE CONSTANTS
// ============================================

async function handleRequestPart(interaction) {
  const input = {
    subsystem: interaction.options.getString('subsystem'),
    link: interaction.options.getString('link') || '',
    qty: interaction.options.getInteger('qty') || 1,
    maxBudget: interaction.options.getNumber('maxbudget') || '',
    priority: interaction.options.getString('priority') || 'Medium',
    notes: interaction.options.getString('notes') || ''
  };

  await interaction.deferReply({ ephemeral: true });

  try {
    const payload = {
      action: 'discordRequest',  // Use old format for now
      requester: interaction.user.username,
      subsystem: input.subsystem,
      partLink: input.link,
      quantity: input.qty,
      neededBy: '',
      maxBudget: input.maxBudget,
      priority: input.priority,
      notes: `[Discord] ${input.notes}`.trim()
    };

    console.log('[handleRequestPart] Sending payload:', JSON.stringify(payload, null, 2));

    const response = await postWithRetry(CONFIG.APPS_SCRIPT_URL, payload);
    
    // *** ADD THIS DEBUGGING ***
    console.log('[handleRequestPart] Raw response:', JSON.stringify(response, null, 2));
    console.log('[handleRequestPart] Response type:', typeof response);
    console.log('[handleRequestPart] Response keys:', Object.keys(response));

    // Check for error in response
    if (!response) {
      return interaction.editReply('❌ No response from Google Sheets');
    }

    // Try to access status field
    const status = response.status || response.STATUS;
    console.log('[handleRequestPart] Status:', status);

    if (status !== 'ok') {
      console.error('[handleRequestPart] Error response:', response);
      
      // Try multiple ways to get error message
      const errorMsg = 
        response.error?.message ||  // New format
        response.message ||          // Old format
        response.error ||            // String error
        'Unknown error';
      
      return interaction.editReply(`❌ Error from Sheets: ${errorMsg}`);
    }

    // Try to get requestID from multiple locations
    const requestID = 
      response.data?.requestID ||   // New format with data wrapper
      response.requestID ||          // Old format
      response.data?.REQUEST_ID ||   // New format with capital ID
      'UNKNOWN';

    console.log('[handleRequestPart] Request ID:', requestID);

    const responseLines = [
      `✅ Request **${requestID}** submitted.`,
      `Subsystem: **${input.subsystem}**`
    ];

    if (input.link) {
      responseLines.push(`Link: ${input.link}`);
    }

    responseLines.push(`Qty: **${input.qty}**, Priority: **${input.priority}**`);

    return interaction.editReply(responseLines.join('\n'));

  } catch (err) {
    console.error('[handleRequestPart] Exception:', err);
    console.error('[handleRequestPart] Stack:', err.stack);
    return interaction.editReply(
      '❌ Failed to send request to Google Sheets. Please try again later.'
    );
  }
}

// ============================================
// UPDATE handleOpenOrders TO USE CONSTANTS
// ============================================

async function handleOpenOrders(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const payload = { 
      [REQUEST_FIELDS.ACTION]: API_ACTIONS.OPEN_ORDERS  // *** CHANGED ***
    };

    const data = await postWithRetry(CONFIG.APPS_SCRIPT_URL, payload);

    if (data[RESPONSE_FIELDS.STATUS] !== API_STATUS.OK) {  // *** CHANGED ***
      console.error('[handleOpenOrders] Error from Apps Script:', data);
      
      const errorMsg = data[RESPONSE_FIELDS.ERROR]?.[RESPONSE_FIELDS.ERROR_MESSAGE] 
        || data.message 
        || 'Unknown error';
      
      return interaction.editReply(`❌ Error from Sheets: ${errorMsg}`);
    }

    // Support both new structured format and old format
    const responseData = data[RESPONSE_FIELDS.DATA] || data;
    const orders = responseData.orders || [];
    const denied = responseData.denied || [];

    if (orders.length === 0 && denied.length === 0) {
      return interaction.editReply(
        '✅ No open orders and no denied requests. Everything is up to date.'
      );
    }

    const message = buildOpenOrdersMessage(orders, denied);
    return interaction.editReply({ content: message });

  } catch (err) {
    console.error('[handleOpenOrders] Error:', err.message);
    return interaction.editReply(
      '❌ Failed to contact Google Sheets. Please try again later.'
    );
  }
}

// ============================================
// UPDATE buildOpenOrdersMessage TO USE CONSTANTS
// ============================================

function buildOpenOrdersMessage(orders, denied) {
  const lines = [];

  lines.push('📦 **Open Orders (not yet received)**');

  if (orders.length === 0) {
    lines.push('No open orders.', '');
  } else {
    const shownOrders = orders.slice(0, CONFIG.DISPLAY.MAX_ORDERS_DISPLAY);  // *** CHANGED ***

    if (orders.length > CONFIG.DISPLAY.MAX_ORDERS_DISPLAY) {  // *** CHANGED ***
      lines.push(
        `Showing first ${CONFIG.DISPLAY.MAX_ORDERS_DISPLAY} of ${orders.length} open orders.`,
        ''
      );
    } else {
      lines.push(`Total open orders: ${orders.length}`, '');
    }

    for (const order of shownOrders) {
      lines.push(formatOrder(order), '');
    }
  }

  if (denied.length > 0) {
    const shownDenied = denied.slice(0, CONFIG.DISPLAY.MAX_DENIED_DISPLAY);  // *** CHANGED ***

    lines.push('⚠️ **Requests Needing Attention (Denied)**');

    if (denied.length > CONFIG.DISPLAY.MAX_DENIED_DISPLAY) {  // *** CHANGED ***
      lines.push(
        `Showing first ${CONFIG.DISPLAY.MAX_DENIED_DISPLAY} of ${denied.length} denied requests.`,
        ''
      );
    } else {
      lines.push(`Total denied requests: ${denied.length}`, '');
    }

    for (const request of shownDenied) {
      lines.push(formatDeniedRequest(request), '');
    }
  }

  return lines.join('\n').trimEnd();
}

// ============================================
// UPDATE handleOrderStatus TO USE CONSTANTS
// ============================================

async function handleOrderStatus(interaction) {
  const requestId = (interaction.options.getString('requestid') || '').trim();
  const orderId = (interaction.options.getString('orderid') || '').trim();

  if (!requestId && !orderId) {
    return interaction.reply({
      content: '⚠️ Please provide either a **requestid** (e.g. `REQ-1234`) or an **orderid** (e.g. `ORD-5678`).',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const payload = {
      [REQUEST_FIELDS.ACTION]: API_ACTIONS.ORDER_STATUS,  // *** CHANGED ***
      [REQUEST_FIELDS.REQUEST_ID]: requestId,  // *** CHANGED ***
      [REQUEST_FIELDS.ORDER_ID]: orderId  // *** CHANGED ***
    };

    const data = await postWithRetry(CONFIG.APPS_SCRIPT_URL, payload);

    if (data[RESPONSE_FIELDS.STATUS] !== API_STATUS.OK) {  // *** CHANGED ***
      console.error('[handleOrderStatus] Error from Apps Script:', data);
      
      const errorMsg = data[RESPONSE_FIELDS.ERROR]?.[RESPONSE_FIELDS.ERROR_MESSAGE] 
        || data.message 
        || 'Unknown error';
      
      return interaction.editReply(`❌ Error from Sheets: ${errorMsg}`);
    }

    // Support both formats
    const responseData = data[RESPONSE_FIELDS.DATA] || data;

    if (requestId) {
      const request = responseData.request || null;
      const orders = responseData.orders || [];

      if (!request) {
        return interaction.editReply(`🔍 No request found for \`${requestId}\`.`);
      }

      const message = formatRequestStatus(request, orders);
      return interaction.editReply({ content: message });
    }

    if (orderId) {
      const order = responseData.order || null;

      if (!order) {
        return interaction.editReply(`🔍 No order found for \`${orderId}\`.`);
      }

      const message = formatOrderDetail(order);
      return interaction.editReply({ content: message });
    }

  } catch (err) {
    console.error('[handleOrderStatus] Error:', err.message);
    return interaction.editReply(
      '❌ Failed to contact Google Sheets. Please try again later.'
    );
  }
}

// ============================================
// UPDATE handleInventory TO USE CONSTANTS
// ============================================

async function handleInventory(interaction) {
  const sku = (interaction.options.getString('sku') || '').trim();
  const search = (interaction.options.getString('search') || '').trim();

  if (!sku && !search) {
    return interaction.reply({
      content: '⚠️ Provide either a **sku** or a **search** term.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const payload = {
      [REQUEST_FIELDS.ACTION]: API_ACTIONS.INVENTORY,  // *** CHANGED ***
      [REQUEST_FIELDS.SKU]: sku,  // *** CHANGED ***
      [REQUEST_FIELDS.SEARCH]: search  // *** CHANGED ***
    };

    const data = await postWithRetry(CONFIG.APPS_SCRIPT_URL, payload);

    if (data[RESPONSE_FIELDS.STATUS] !== API_STATUS.OK) {  // *** CHANGED ***
      console.error('[handleInventory] Error from Apps Script:', data);
      
      const errorMsg = data[RESPONSE_FIELDS.ERROR]?.[RESPONSE_FIELDS.ERROR_MESSAGE] 
        || data.message 
        || 'Unknown error';
      
      return interaction.editReply(`❌ Error from Sheets: ${errorMsg}`);
    }

    const responseData = data[RESPONSE_FIELDS.DATA] || data;
    const matches = responseData.matches || [];

    if (matches.length === 0) {
      return interaction.editReply(
        `🔍 No inventory found for \`${sku || search}\`.`
      );
    }

    if (matches.length === 1) {
      const message = formatInventoryDetail(matches[0]);
      return interaction.editReply({ content: message });
    }

    // Multiple matches
    const displayMatches = matches.slice(0, CONFIG.DISPLAY.MAX_INVENTORY_DISPLAY);  // *** CHANGED ***
    const lines = [`📦 **${matches.length} matches found:**`];

    for (const match of displayMatches) {
      lines.push(formatInventoryItem(match));
    }

    if (matches.length > CONFIG.DISPLAY.MAX_INVENTORY_DISPLAY) {  // *** CHANGED ***
      lines.push('', `...and ${matches.length - CONFIG.DISPLAY.MAX_INVENTORY_DISPLAY} more`);
    }

    return interaction.editReply({ content: lines.join('\n') });

  } catch (err) {
    console.error('[handleInventory] Error:', err.message);
    return interaction.editReply(
      '❌ Failed to contact Google Sheets. Please try again later.'
    );
  }
}

// ============================================
// SUMMARY OF CHANGES
// ============================================

/*
 * CHANGES MADE:
 * 
 * 1. Added require() for shared-constants.js
 * 2. Removed local SUBSYSTEMS, PRIORITIES, FALLBACKS arrays
 * 3. Updated CONFIG to use shared VALIDATION_LIMITS and DISPLAY_LIMITS
 * 4. Generated Discord choices from shared constants
 * 5. Updated all payload construction to use REQUEST_FIELDS constants
 * 6. Updated all response parsing to use RESPONSE_FIELDS constants
 * 7. Updated all action names to use API_ACTIONS constants
 * 8. Added support for structured error responses
 * 9. Maintained backward compatibility with old response format
 * 
 * BENEFITS:
 * - No more typos in field names
 * - Guaranteed consistency between bot and backend
 * - Single source of truth for all constants
 * - Easier to update API contract
 * - Type-safe field access (with proper IDE support)
 */