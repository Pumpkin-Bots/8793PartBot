// bot.js - 8793PartBot
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

// ---- ENVIRONMENT VARIABLES ----
// export DISCORD_TOKEN="..."
// export CLIENT_ID="..."
// export GUILD_ID="..."
// export APPS_SCRIPT_URL="https://script.google.com/macros/s/XXX/exec"

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !APPS_SCRIPT_URL) {
  console.error('❌ Missing one or more environment variables: DISCORD_TOKEN, CLIENT_ID, GUILD_ID, APPS_SCRIPT_URL');
  process.exit(1);
}

function formatDate(value, fallback = 'Unknown') {
  if (!value) return fallback;

  // If Apps Script sends a Date, or an ISO string, just let JS parse it
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    // If parsing fails, just return the original string
    return typeof value === 'string' ? value : fallback;
  }

  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short', // "Nov"
    day: 'numeric'  // "27"
  });
}

function formatEta(value) {
  return formatDate(value, 'Not set');
}

// --------------------------------------------------
// Slash command definitions
// --------------------------------------------------
const commands = [
  // /requestpart
  new SlashCommandBuilder()
    .setName('requestpart')
    .setDescription('Submit an FRC part request to Google Sheets')
    .addStringOption(option =>
      option
        .setName('subsystem')
        .setDescription('Subsystem (Drive, Intake, Shooter, Climber, Electrical, etc.)')
        .setRequired(true)
        .addChoices(
          { name: 'Drive',       value: 'Drive' },
          { name: 'Intake',      value: 'Intake' },
          { name: 'Shooter',     value: 'Shooter' },
          { name: 'Climber',     value: 'Climber' },
          { name: 'Mechanical',  value: 'Mechanical' },
          { name: 'Electrical',  value: 'Electrical' },
          { name: 'Vision',      value: 'Vision' },
		  { name: 'Pneumatics',  value: 'Pneumatics' },
          { name: 'Software',    value: 'Software' },
		  { name: 'Safety',      value: 'Safety' },
          { name: 'Spares',      value: 'Spares' },
          { name: 'Other',       value: 'Other' }
        )
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
    )
    .addNumberOption(option =>
      option
        .setName('maxbudget')
        .setDescription('Max budget (USD)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('priority')
        .setDescription('Priority')
        .setRequired(false)
        .addChoices(
          { name: 'Critical', value: 'Critical' },
          { name: 'High',     value: 'High' },
          { name: 'Medium',   value: 'Medium' },
          { name: 'Low',      value: 'Low' }
        )
    )
    .addStringOption(option =>
      option
        .setName('notes')
        .setDescription('Additional notes (size, length, etc.)')
        .setRequired(false)
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

// --------------------------------------------------
// Register commands
// --------------------------------------------------
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  console.log('Registering slash commands...');
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log('Slash commands registered.');
}

// --------------------------------------------------
// Discord client
// --------------------------------------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

// --------------------------------------------------
// Interaction handling
// --------------------------------------------------
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'requestpart') {
    await handleRequestPart(interaction);
  } else if (interaction.commandName === 'inventory') {
    await handleInventory(interaction);
  } else if (interaction.commandName === 'orderstatus') {
    await handleOrderStatus(interaction);
  } else if (interaction.commandName === 'openorders') {
    await handleOpenOrders(interaction);
  }
});

// ---- /requestpart handler ----
async function handleRequestPart(interaction) {
  const subsystem = interaction.options.getString('subsystem');
  const link      = interaction.options.getString('link') || '';
  const qty       = interaction.options.getInteger('qty') || 1;
  const maxBudget = interaction.options.getNumber('maxbudget') || '';
  const priority  = interaction.options.getString('priority') || 'Medium';
  const notesRaw  = interaction.options.getString('notes') || '';

  const requester = interaction.user.username;   // or interaction.user.tag
  const notes = `[Discord] ${notesRaw}`.trim();

  await interaction.deferReply({ ephemeral: true });

  try {
    const payload = {
      action:    'discordRequest',
      requester: requester,
      subsystem: subsystem,
      partLink:  link,
      quantity:  qty,
      neededBy:  '',
      maxBudget: maxBudget,
      priority:  priority,
      notes:     notes
    };

    const response = await axios.post(APPS_SCRIPT_URL, payload);
    const data = response.data;

    if (data.status !== 'ok') {
      console.error('Error from Apps Script:', data);
      return interaction.editReply(`❌ Error from Sheets: ${data.message || 'Unknown error'}`);
    }

    return interaction.editReply(
      `✅ Request **${data.requestID}** submitted.\n` +
      `Subsystem: **${subsystem}**\n` +
      (link ? `Link: ${link}\n` : '') +
      `Qty: **${qty}**, Priority: **${priority}**`
    );
  } catch (err) {
    console.error('Discord /requestpart error:', err);
    return interaction.editReply('❌ Failed to send request to Google Sheets.');
  }
}

async function handleOpenOrders(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const payload = {
      action: 'openOrders'
    };

    const response = await axios.post(APPS_SCRIPT_URL, payload);
    const data = response.data;

    if (data.status !== 'ok') {
      console.error('Error from Apps Script (openOrders):', data);
      return interaction.editReply(`❌ Error from Sheets: ${data.message || 'Unknown error'}`);
    }

    const orders = data.orders || [];
    const denied = data.denied || [];

    if (orders.length === 0 && denied.length === 0) {
      return interaction.editReply('✅ No open orders and no denied requests. Everything is up to date.');
    }

    const MAX_ORDERS = 15;
    const shownOrders = orders.slice(0, MAX_ORDERS);

    let msg = '';

    // ----- Open Orders -----
    msg += `📦 **Open Orders (not yet received)**\n`;
    if (orders.length === 0) {
      msg += `No open orders.\n\n`;
    } else {
      if (orders.length > MAX_ORDERS) {
        msg += `Showing first ${MAX_ORDERS} of ${orders.length} open orders.\n\n`;
      } else {
        msg += `Total open orders: ${orders.length}\n\n`;
      }

      for (const o of shownOrders) {
        msg +=
          `• **${o.orderId}** — ${o.vendor || 'Unknown vendor'}\n` +
          `  Part: ${o.partName || '(no name)'}\n` +
          `  SKU: ${o.sku || '(none)'} | Qty: ${o.qty || 'N/A'}\n` +
          `  Status: ${o.status || 'Unknown'}\n` +
          `  Ordered: ${formatDate(o.orderDate)} | ETA: ${formatEta(o.eta)}\n` +
          `  Tracking: ${o.tracking || '—'}\n` +
          `  Requests: ${o.includedRequests || '—'}\n\n`;
      }
    }

    // ----- Denied Requests (Needs Attention) -----
    if (denied.length > 0) {
      const MAX_DENIED = 15;
      const shownDenied = denied.slice(0, MAX_DENIED);

      msg += `⚠️ **Requests Needing Attention (Denied)**\n`;
      if (denied.length > MAX_DENIED) {
        msg += `Showing first ${MAX_DENIED} of ${denied.length} denied requests.\n\n`;
      } else {
        msg += `Total denied requests: ${denied.length}\n\n`;
      }

      for (const r of shownDenied) {
        msg +=
          `• **${r.id}** — ${r.partName || '(no name)'}\n` +
          `  Requester: ${r.requester || 'Unknown'} | Subsystem: ${r.subsystem || 'N/A'}\n` +
          `  Qty: ${r.qty || 'N/A'} | Priority: ${r.priority || 'N/A'}\n` +
          `  Notes: ${r.mentorNotes || '—'}\n` +
          `  Link: ${r.link || '—'}\n\n`;
      }
    }

    return interaction.editReply({ content: msg.trimEnd() });

  } catch (err) {
    console.error('Discord /openorders error:', err);
    return interaction.editReply('❌ Failed to contact Google Sheets.');
  }
}

async function handleOrderStatus(interaction) {
  const requestId = (interaction.options.getString('requestid') || '').trim();
  const orderId   = (interaction.options.getString('orderid') || '').trim();

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

    const response = await axios.post(APPS_SCRIPT_URL, payload);
    const data = response.data;

    if (data.status !== 'ok') {
      console.error('Error from Apps Script (orderStatus):', data);
      return interaction.editReply(`❌ Error from Sheets: ${data.message || 'Unknown error'}`);
    }

    // ----- Case: lookup by Request ID -----
    if (requestId) {
      const r = data.request || null;
      const orders = data.orders || [];

      if (!r) {
        return interaction.editReply(`🔍 No request found for \`${requestId}\`.`);
      }

      let msg =
        `📄 **Request Status – ${r.id}**\n\n` +
        `**Status:** ${r.requestStatus || 'Unknown'}\n` +
        `**Subsystem:** ${r.subsystem || 'N/A'}\n` +
        `**Part:** ${r.partName || '(no name)'}\n` +
        `**SKU:** ${r.sku || '(none)'}\n` +
        `**Qty:** ${r.qty || 'N/A'}\n` +
        `**Priority:** ${r.priority || 'N/A'}\n`;
      if (orders.length === 0) {
        msg += `\nNo orders have been created for this request yet.`;
      } else {
        msg += `\n📦 **Linked Orders:**\n`;
        for (const o of orders) {
   	  msg +=
            `• **${o.orderId}** — Status: ${o.status || 'Unknown'}, ` +
            `Vendor: ${o.vendor || 'N/A'}, ` +
            `Ordered: ${formatDate(o.orderDate)}, ` +
            `ETA (Delivery): ${formatEta(o.eta)}\n`;
          }
       }

      return interaction.editReply({ content: msg });
    }

    // ----- Case: lookup by Order ID -----
    if (orderId) {
      const o = data.order || null;

      if (!o) {
        return interaction.editReply(`🔍 No order found for \`${orderId}\`.`);
      }

      const msg =
        `📦 **Order Status – ${o.orderId}**\n\n` +
        `**Status:** ${o.status || 'Unknown'}\n` +
        `**Vendor:** ${o.vendor || 'N/A'}\n` +
        `**Part:** ${o.partName || '(no name)'}\n` +
        `**SKU:** ${o.sku || '(none)'}\n` +
        `**Qty:** ${o.qty || 'N/A'}\n` +
        `**Order Date:** ${formatDate(o.orderDate)}\n` +
        `**Shipping:** ${o.shipping || 'N/A'}\n` +
        `**Tracking:** ${o.tracking || '—'}\n` +
        `**ETA (Delivery) :** ${formatEta(o.eta)}\n` +
        `**Received:** ${o.receivedDate || '—'}\n` +
        `**Requests:** ${o.includedRequests || '—'}`;

      return interaction.editReply({ content: msg });
    }

  } catch (err) {
    console.error('Discord /orderstatus error:', err);
    return interaction.editReply('❌ Failed to contact Google Sheets.');
  }
}

// ---- /inventory handler ----
async function handleInventory(interaction) {
  const sku    = (interaction.options.getString('sku') || '').trim();
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

    const response = await axios.post(APPS_SCRIPT_URL, payload);
    const data = response.data;

    if (data.status !== 'ok') {
      console.error('Error from Apps Script (inventory):', data);
      return interaction.editReply(`❌ Error from Sheets: ${data.message || 'Unknown error'}`);
    }

    const matches = data.matches || [];

    if (matches.length === 0) {
      return interaction.editReply(`🔍 No inventory found for \`${sku || search}\`.`);
    }

    if (matches.length === 1) {
      const m = matches[0];
      const msg =
        `📦 **Inventory Match**\n\n` +
        `**SKU:** ${m.sku}\n` +
        `**Name:** ${m.name}\n` +
        `**Vendor:** ${m.vendor}\n` +
        `**Location:** ${m.location}\n` +
        `**Qty On-Hand:** ${m.quantity}`;
      return interaction.editReply({ content: msg });
    }

    // multiple matches
    let reply = `📦 **${matches.length} matches found:**\n`;
    for (const m of matches.slice(0, 10)) {
      reply += `• \`${m.sku}\` — ${m.name} (Qty: ${m.quantity}, Loc: ${m.location})\n`;
    }
    return interaction.editReply({ content: reply });

  } catch (err) {
    console.error('Discord /inventory error:', err);
    return interaction.editReply('❌ Failed to contact Google Sheets.');
  }
}

// --------------------------------------------------
// Start bot
// --------------------------------------------------
registerCommands()
  .then(() => client.login(TOKEN))
  .catch(err => {
    console.error('Failed to register commands or login:', err);
  });
