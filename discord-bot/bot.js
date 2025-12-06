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

// bot.js - 8793PartBot Discord Bot
// Requires: discord.js v14, axios
// npm install discord.js axios

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const axios = require('axios');

/******************************************************
 * CONFIGURATION
 ******************************************************/

const CONFIG = {
  DISCORD: {
    TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID
  },
  APPS_SCRIPT_URL: process.env.APPS_SCRIPT_URL,
  LIMITS: {
    MAX_ORDERS_DISPLAY: 15,
    MAX_DENIED_DISPLAY: 15,
    MAX_INVENTORY_DISPLAY: 10,
    MAX_QUANTITY: 1000,
    MAX_BUDGET: 10000,
    MAX_NOTE_LENGTH: 500
  },
  HTTP: {
    TIMEOUT: 10000, // 10 seconds
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000 // 1 second
  }
};

const FALLBACKS = {
  UNKNOWN: 'Unknown',
  NOT_AVAILABLE: 'N/A',
  NOT_SET: '—',
  NO_NAME: '(no name)',
  NONE: '(none)'
};

const SUBSYSTEMS = [
  { name: 'Drive', value: 'Drive' },
  { name: 'Intake', value: 'Intake' },
  { name: 'Shooter', value: 'Shooter' },
  { name: 'Climber', value: 'Climber' },
  { name: 'Mechanical', value: 'Mechanical' },
  { name: 'Electrical', value: 'Electrical' },
  { name: 'Vision', value: 'Vision' },
  { name: 'Pneumatics', value: 'Pneumatics' },
  { name: 'Software', value: 'Software' },
  { name: 'Safety', value: 'Safety' },
  { name: 'Spares', value: 'Spares' },
  { name: 'Other', value: 'Other' }
];

const PRIORITIES = [
  { name: 'Critical', value: 'Critical' },
  { name: 'High', value: 'High' },
  { name: 'Medium', value: 'Medium' },
  { name: 'Low', value: 'Low' }
];

/******************************************************
 * CONFIGURATION VALIDATION
 ******************************************************/

function validateConfig() {
  const required = [
    'DISCORD_TOKEN',
    'CLIENT_ID',
    'GUILD_ID',
    'APPS_SCRIPT_URL'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  // Validate Apps Script URL format
  try {
    new URL(CONFIG.APPS_SCRIPT_URL);
  } catch (err) {
    console.error('❌ Invalid APPS_SCRIPT_URL format');
    process.exit(1);
  }

  console.log('✅ Configuration validated');
}

/******************************************************
 * UTILITY FUNCTIONS
 ******************************************************/

/**
 * Formats a date value to a readable string
 * @param {Date|string|null} value - Date to format
 * @param {string} fallback - Fallback string if date is invalid
 * @returns {string} Formatted date string
 */
function formatDate(value, fallback = FALLBACKS.UNKNOWN) {
  if (!value) return fallback;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return typeof value === 'string' ? value : fallback;
  }

  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Formats an ETA date
 * @param {Date|string|null} value - ETA date
 * @returns {string} Formatted ETA string
 */
function formatEta(value) {
  return formatDate(value, 'Not set');
}

/**
 * Validates a URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
function isValidUrl(url) {
  if (!url) return true; // Empty is acceptable
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Truncates text to a maximum length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/******************************************************
 * HTTP REQUEST UTILITIES
 ******************************************************/

/**
 * Makes an HTTP POST request with retry logic
 * @param {string} url - URL to request
 * @param {object} payload - Request payload
 * @param {number} retries - Number of retries remaining
 * @returns {Promise<object>} Response data
 */
async function postWithRetry(url, payload, retries = CONFIG.HTTP.MAX_RETRIES) {
  try {
    const response = await axios.post(url, payload, {
      timeout: CONFIG.HTTP.TIMEOUT,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (err) {
    if (retries > 0 && isRetryableError(err)) {
      console.warn(`[HTTP] Request failed, retrying... (${retries} attempts left)`);
      await sleep(CONFIG.HTTP.RETRY_DELAY);
      return postWithRetry(url, payload, retries - 1);
    }
    throw err;
  }
}

/**
 * Determines if an error is retryable
 * @param {Error} error - Error to check
 * @returns {boolean} True if error is retryable
 */
function isRetryableError(error) {
  if (!error.response) return true; // Network errors are retryable
  const status = error.response.status;
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Sleep utility for retry delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/******************************************************
 * MESSAGE FORMATTING UTILITIES
 ******************************************************/

/**
 * Formats an order for display
 * @param {object} order - Order object
 * @returns {string} Formatted order string
 */
function formatOrder(order) {
  return [
    `• **${order.orderId}** — ${order.vendor || FALLBACKS.UNKNOWN}`,
    `  Part: ${order.partName || FALLBACKS.NO_NAME}`,
    `  SKU: ${order.sku || FALLBACKS.NONE} | Qty: ${order.qty || FALLBACKS.NOT_AVAILABLE}`,
    `  Status: ${order.status || FALLBACKS.UNKNOWN}`,
    `  Ordered: ${formatDate(order.orderDate)} | ETA: ${formatEta(order.eta)}`,
    `  Tracking: ${order.tracking || FALLBACKS.NOT_SET}`,
    `  Requests: ${order.includedRequests || FALLBACKS.NOT_SET}`
  ].join('\n');
}

/**
 * Formats a denied request for display
 * @param {object} request - Request object
 * @returns {string} Formatted request string
 */
function formatDeniedRequest(request) {
  return [
    `• **${request.id}** — ${request.partName || FALLBACKS.NO_NAME}`,
    `  Requester: ${request.requester || FALLBACKS.UNKNOWN} | Subsystem: ${request.subsystem || FALLBACKS.NOT_AVAILABLE}`,
    `  Qty: ${request.qty || FALLBACKS.NOT_AVAILABLE} | Priority: ${request.priority || FALLBACKS.NOT_AVAILABLE}`,
    `  Notes: ${request.mentorNotes || FALLBACKS.NOT_SET}`,
    `  Link: ${request.link || FALLBACKS.NOT_SET}`
  ].join('\n');
}

/**
 * Formats a single inventory item for display
 * @param {object} item - Inventory item
 * @returns {string} Formatted item string
 */
function formatInventoryItem(item) {
  return `• \`${item.sku}\` — ${item.name} (Qty: ${item.quantity}, Loc: ${item.location})`;
}

/**
 * Formats a detailed inventory match
 * @param {object} item - Inventory item
 * @returns {string} Formatted detailed item string
 */
function formatInventoryDetail(item) {
  return [
    `📦 **Inventory Match**`,
    ``,
    `**SKU:** ${item.sku}`,
    `**Name:** ${item.name}`,
    `**Vendor:** ${item.vendor}`,
    `**Location:** ${item.location}`,
    `**Qty On-Hand:** ${item.quantity}`
  ].join('\n');
}

/**
 * Formats a request status response
 * @param {object} request - Request object
 * @param {Array} orders - Associated orders
 * @returns {string} Formatted status message
 */
function formatRequestStatus(request, orders = []) {
  const lines = [
    `📄 **Request Status – ${request.id}**`,
    ``,
    `**Status:** ${request.requestStatus || FALLBACKS.UNKNOWN}`,
    `**Subsystem:** ${request.subsystem || FALLBACKS.NOT_AVAILABLE}`,
    `**Part:** ${request.partName || FALLBACKS.NO_NAME}`,
    `**SKU:** ${request.sku || FALLBACKS.NONE}`,
    `**Qty:** ${request.qty || FALLBACKS.NOT_AVAILABLE}`,
    `**Priority:** ${request.priority || FALLBACKS.NOT_AVAILABLE}`
  ];

  if (orders.length === 0) {
    lines.push('', 'No orders have been created for this request yet.');
  } else {
    lines.push('', '📦 **Linked Orders:**');
    for (const order of orders) {
      lines.push(
        `• **${order.orderId}** — Status: ${order.status || FALLBACKS.UNKNOWN}, ` +
        `Vendor: ${order.vendor || FALLBACKS.NOT_AVAILABLE}, ` +
        `Ordered: ${formatDate(order.orderDate)}, ` +
        `ETA: ${formatEta(order.eta)}`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Formats an order detail response
 * @param {object} order - Order object
 * @returns {string} Formatted order detail
 */
function formatOrderDetail(order) {
  return [
    `📦 **Order Status – ${order.orderId}**`,
    ``,
    `**Status:** ${order.status || FALLBACKS.UNKNOWN}`,
    `**Vendor:** ${order.vendor || FALLBACKS.NOT_AVAILABLE}`,
    `**Part:** ${order.partName || FALLBACKS.NO_NAME}`,
    `**SKU:** ${order.sku || FALLBACKS.NONE}`,
    `**Qty:** ${order.qty || FALLBACKS.NOT_AVAILABLE}`,
    `**Order Date:** ${formatDate(order.orderDate)}`,
    `**Shipping:** ${order.shipping || FALLBACKS.NOT_AVAILABLE}`,
    `**Tracking:** ${order.tracking || FALLBACKS.NOT_SET}`,
    `**ETA (Delivery):** ${formatEta(order.eta)}`,
    `**Received:** ${order.receivedDate || FALLBACKS.NOT_SET}`,
    `**Requests:** ${order.includedRequests || FALLBACKS.NOT_SET}`
  ].join('\n');
}

/******************************************************
 * INPUT VALIDATION
 ******************************************************/

/**
 * Validates request part input
 * @param {object} input - Input data to validate
 * @returns {object} Validation result {valid: boolean, error: string}
 */
function validateRequestPartInput(input) {
  // Validate URL if provided
  if (input.link && !isValidUrl(input.link)) {
    return { valid: false, error: 'Invalid URL format for part link' };
  }

  // Validate quantity
  if (input.qty < 1) {
    return { valid: false, error: 'Quantity must be at least 1' };
  }

  if (input.qty > CONFIG.LIMITS.MAX_QUANTITY) {
    return { valid: false, error: `Quantity cannot exceed ${CONFIG.LIMITS.MAX_QUANTITY}` };
  }

  // Validate budget if provided
  if (input.maxBudget && input.maxBudget > CONFIG.LIMITS.MAX_BUDGET) {
    return { valid: false, error: `Budget cannot exceed $${CONFIG.LIMITS.MAX_BUDGET}` };
  }

  if (input.maxBudget && input.maxBudget < 0) {
    return { valid: false, error: 'Budget cannot be negative' };
  }

  // Validate notes length
  if (input.notes && input.notes.length > CONFIG.LIMITS.MAX_NOTE_LENGTH) {
    return { 
      valid: false, 
      error: `Notes cannot exceed ${CONFIG.LIMITS.MAX_NOTE_LENGTH} characters` 
    };
  }

  return { valid: true };
}

/******************************************************
 * SLASH COMMAND DEFINITIONS
 ******************************************************/

const commands = [
  // /requestpart
  new SlashCommandBuilder()
    .setName('requestpart')
    .setDescription('Submit an FRC part request to Google Sheets')
    .addStringOption(option =>
      option
        .setName('subsystem')
        .setDescription('Subsystem (Drive, Intake, Shooter, etc.)')
        .setRequired(true)
        .addChoices(...SUBSYSTEMS)
    )
    .addStringOption(option =>
      option
        .setName('link')
        .setDescription('Part link (URL)')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName('qty')
        .setDescription('Quantity')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(CONFIG.LIMITS.MAX_QUANTITY)
    )
    .addNumberOption(option =>
      option
        .setName('maxbudget')
        .setDescription('Max budget (USD)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(CONFIG.LIMITS.MAX_BUDGET)
    )
    .addStringOption(option =>
      option
        .setName('priority')
        .setDescription('Priority level')
        .setRequired(false)
        .addChoices(...PRIORITIES)
    )
    .addStringOption(option =>
      option
        .setName('notes')
        .setDescription('Additional notes (size, length, etc.)')
        .setRequired(false)
        .setMaxLength(CONFIG.LIMITS.MAX_NOTE_LENGTH)
    ),

  // /openorders
  new SlashCommandBuilder()
    .setName('openorders')
    .setDescription('Show all orders that have not been received'),

  // /orderstatus
  new SlashCommandBuilder()
    .setName('orderstatus')
    .setDescription('Check order or request status from Google Sheets')
    .addStringOption(option =>
      option
        .setName('requestid')
        .setDescription('Request ID (e.g. REQ-1234)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('orderid')
        .setDescription('Order ID (e.g. ORD-5678)')
        .setRequired(false)
    ),

  // /inventory
  new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Look up inventory from Google Sheets')
    .addStringOption(option =>
      option
        .setName('sku')
        .setDescription('Exact SKU / part number')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('search')
        .setDescription('Keyword search in name/SKU')
        .setRequired(false)
    )
].map(cmd => cmd.toJSON());

/******************************************************
 * COMMAND REGISTRATION
 ******************************************************/

const rest = new REST({ version: '10' }).setToken(CONFIG.DISCORD.TOKEN);

/**
 * Registers slash commands with Discord
 */
async function registerCommands() {
  try {
    console.log('[Bot] Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(CONFIG.DISCORD.CLIENT_ID, CONFIG.DISCORD.GUILD_ID),
      { body: commands }
    );
    console.log('[Bot] ✅ Slash commands registered successfully');
  } catch (err) {
    console.error('[Bot] ❌ Failed to register slash commands:', err);
    throw err;
  }
}

/******************************************************
 * DISCORD CLIENT
 ******************************************************/

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('ready', () => {
  console.log(`[Bot] ✅ Logged in as ${client.user.tag}`);
});

/******************************************************
 * COMMAND HANDLERS
 ******************************************************/

/**
 * Handles /requestpart command
 * @param {Interaction} interaction - Discord interaction
 */
async function handleRequestPart(interaction) {
  const input = {
    subsystem: interaction.options.getString('subsystem'),
    link: interaction.options.getString('link') || '',
    qty: interaction.options.getInteger('qty') || 1,
    maxBudget: interaction.options.getNumber('maxbudget') || '',
    priority: interaction.options.getString('priority') || 'Medium',
    notes: interaction.options.getString('notes') || ''
  };

  // Validate input
  const validation = validateRequestPartInput(input);
  if (!validation.valid) {
    return interaction.reply({
      content: `⚠️ ${validation.error}`,
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const payload = {
      action: 'discordRequest',
      requester: interaction.user.username,
      subsystem: input.subsystem,
      partLink: input.link,
      quantity: input.qty,
      neededBy: '',
      maxBudget: input.maxBudget,
      priority: input.priority,
      notes: `[Discord] ${input.notes}`.trim()
    };

    const data = await postWithRetry(CONFIG.APPS_SCRIPT_URL, payload);

    if (data.status !== 'ok') {
      console.error('[handleRequestPart] Error from Apps Script:', data);
      return interaction.editReply(
        `❌ Error from Sheets: ${data.message || 'Unknown error'}`
      );
    }

    const responseLines = [
      `✅ Request **${data.requestID}** submitted.`,
      `Subsystem: **${input.subsystem}**`
    ];

    if (input.link) {
      responseLines.push(`Link: ${input.link}`);
    }

    responseLines.push(`Qty: **${input.qty}**, Priority: **${input.priority}**`);

    return interaction.editReply(responseLines.join('\n'));

  } catch (err) {
    console.error('[handleRequestPart] Error:', err.message);
    return interaction.editReply(
      '❌ Failed to send request to Google Sheets. Please try again later.'
    );
  }
}

/**
 * Handles /openorders command
 * @param {Interaction} interaction - Discord interaction
 */
async function handleOpenOrders(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const payload = { action: 'openOrders' };
    const data = await postWithRetry(CONFIG.APPS_SCRIPT_URL, payload);

    if (data.status !== 'ok') {
      console.error('[handleOpenOrders] Error from Apps Script:', data);
      return interaction.editReply(
        `❌ Error from Sheets: ${data.message || 'Unknown error'}`
      );
    }

    const orders = data.orders || [];
    const denied = data.denied || [];

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

/**
 * Builds the message for open orders display
 * @param {Array} orders - Array of order objects
 * @param {Array} denied - Array of denied request objects
 * @returns {string} Formatted message
 */
function buildOpenOrdersMessage(orders, denied) {
  const lines = [];

  // Open Orders Section
  lines.push('📦 **Open Orders (not yet received)**');

  if (orders.length === 0) {
    lines.push('No open orders.', '');
  } else {
    const shownOrders = orders.slice(0, CONFIG.LIMITS.MAX_ORDERS_DISPLAY);

    if (orders.length > CONFIG.LIMITS.MAX_ORDERS_DISPLAY) {
      lines.push(
        `Showing first ${CONFIG.LIMITS.MAX_ORDERS_DISPLAY} of ${orders.length} open orders.`,
        ''
      );
    } else {
      lines.push(`Total open orders: ${orders.length}`, '');
    }

    for (const order of shownOrders) {
      lines.push(formatOrder(order), '');
    }
  }

  // Denied Requests Section
  if (denied.length > 0) {
    const shownDenied = denied.slice(0, CONFIG.LIMITS.MAX_DENIED_DISPLAY);

    lines.push('⚠️ **Requests Needing Attention (Denied)**');

    if (denied.length > CONFIG.LIMITS.MAX_DENIED_DISPLAY) {
      lines.push(
        `Showing first ${CONFIG.LIMITS.MAX_DENIED_DISPLAY} of ${denied.length} denied requests.`,
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

/**
 * Handles /orderstatus command
 * @param {Interaction} interaction - Discord interaction
 */
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
      action: 'orderStatus',
      requestId,
      orderId
    };

    const data = await postWithRetry(CONFIG.APPS_SCRIPT_URL, payload);

    if (data.status !== 'ok') {
      console.error('[handleOrderStatus] Error from Apps Script:', data);
      return interaction.editReply(
        `❌ Error from Sheets: ${data.message || 'Unknown error'}`
      );
    }

    // Lookup by Request ID
    if (requestId) {
      const request = data.request || null;
      const orders = data.orders || [];

      if (!request) {
        return interaction.editReply(`🔍 No request found for \`${requestId}\`.`);
      }

      const message = formatRequestStatus(request, orders);
      return interaction.editReply({ content: message });
    }

    // Lookup by Order ID
    if (orderId) {
      const order = data.order || null;

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

/**
 * Handles /inventory command
 * @param {Interaction} interaction - Discord interaction
 */
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
      action: 'inventory',
      sku: sku,
      search: search
    };

    const data = await postWithRetry(CONFIG.APPS_SCRIPT_URL, payload);

    if (data.status !== 'ok') {
      console.error('[handleInventory] Error from Apps Script:', data);
      return interaction.editReply(
        `❌ Error from Sheets: ${data.message || 'Unknown error'}`
      );
    }

    const matches = data.matches || [];

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
    const displayMatches = matches.slice(0, CONFIG.LIMITS.MAX_INVENTORY_DISPLAY);
    const lines = [`📦 **${matches.length} matches found:**`];

    for (const match of displayMatches) {
      lines.push(formatInventoryItem(match));
    }

    if (matches.length > CONFIG.LIMITS.MAX_INVENTORY_DISPLAY) {
      lines.push('', `...and ${matches.length - CONFIG.LIMITS.MAX_INVENTORY_DISPLAY} more`);
    }

    return interaction.editReply({ content: lines.join('\n') });

  } catch (err) {
    console.error('[handleInventory] Error:', err.message);
    return interaction.editReply(
      '❌ Failed to contact Google Sheets. Please try again later.'
    );
  }
}

/******************************************************
 * INTERACTION ROUTING
 ******************************************************/

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'requestpart':
        await handleRequestPart(interaction);
        break;
      case 'inventory':
        await handleInventory(interaction);
        break;
      case 'orderstatus':
        await handleOrderStatus(interaction);
        break;
      case 'openorders':
        await handleOpenOrders(interaction);
        break;
      default:
        console.warn(`[Bot] Unknown command: ${interaction.commandName}`);
    }
  } catch (err) {
    console.error(`[Bot] Error handling command ${interaction.commandName}:`, err);
    
    const errorMessage = '❌ An unexpected error occurred. Please try again later.';
    
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(errorMessage).catch(() => {});
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
    }
  }
});

/******************************************************
 * GRACEFUL SHUTDOWN
 ******************************************************/

async function gracefulShutdown(signal) {
  console.log(`\n[Bot] Received ${signal}, shutting down gracefully...`);
  
  try {
    client.destroy();
    console.log('[Bot] ✅ Discord client destroyed');
  } catch (err) {
    console.error('[Bot] Error during shutdown:', err);
  }
  
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Bot] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Bot] Uncaught Exception:', err);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

/******************************************************
 * BOT STARTUP
 ******************************************************/

async function startBot() {
  try {
    validateConfig();
    await registerCommands();
    await client.login(CONFIG.DISCORD.TOKEN);
  } catch (err) {
    console.error('[Bot] ❌ Failed to start bot:', err);
    process.exit(1);
  }
}

// Start the bot
startBot();