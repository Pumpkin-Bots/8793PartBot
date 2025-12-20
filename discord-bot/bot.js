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
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const axios = require('axios');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !APPS_SCRIPT_URL) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

function formatDate(value, fallback = 'Unknown') {
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

function formatEta(value) {
  return formatDate(value, 'Not set');
}

const commands = [
  new SlashCommandBuilder()
    .setName('requestpart')
    .setDescription('Submit an FRC part request')
    .addStringOption(option =>
      option.setName('subsystem').setDescription('Subsystem').setRequired(true)
        .addChoices(
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
        )
    )
    .addStringOption(option =>
      option.setName('link').setDescription('Part link (URL)').setRequired(false)
    )
    .addStringOption(option =>
      option.setName('sku').setDescription('Specific SKU/part number (overrides AI detection)').setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('qty').setDescription('Quantity').setRequired(false)
    )
    .addNumberOption(option =>
      option.setName('maxbudget').setDescription('Max budget (USD)').setRequired(false)
    )
    .addStringOption(option =>
      option.setName('priority').setDescription('Priority').setRequired(false)
        .addChoices(
          { name: 'Critical', value: 'Critical' },
          { name: 'High', value: 'High' },
          { name: 'Medium', value: 'Medium' },
          { name: 'Low', value: 'Low' }
        )
    )
    .addStringOption(option =>
      option.setName('notes').setDescription('Additional notes').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('cancelrequest')
    .setDescription('Cancel your own part request')
    .addStringOption(option =>
      option.setName('requestid').setDescription('Request ID (e.g., REQ-12345678)').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason for cancellation').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('openorders')
    .setDescription('Show all orders that have not been received'),

  new SlashCommandBuilder()
    .setName('orderstatus')
    .setDescription('Check order or request status')
    .addStringOption(option =>
      option.setName('requestid').setDescription('Request ID (e.g. REQ-1234)').setRequired(false)
    )
    .addStringOption(option =>
      option.setName('orderid').setDescription('Order ID (e.g. ORD-5678)').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Look up inventory')
    .addStringOption(option =>
      option.setName('sku').setDescription('Exact SKU / part number').setRequired(false)
    )
    .addStringOption(option =>
      option.setName('search').setDescription('Keyword search').setRequired(false)
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  console.log('[Bot] Registering slash commands...');
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log('[Bot] ✅ Slash commands registered');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('ready', () => {
  console.log(`[Bot] ✅ Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'requestpart':
        await handleRequestPart(interaction);
        break;
      case 'cancelrequest':
        await handleCancelRequest(interaction);
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
    }
  } catch (err) {
    console.error(`[Bot] Error handling ${interaction.commandName}:`, err);
    const errorMessage = '❌ An error occurred';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(errorMessage).catch(() => {});
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
    }
  }
});

async function handleRequestPart(interaction) {
  const subsystem = interaction.options.getString('subsystem');
  const link = interaction.options.getString('link') || '';
  const sku = interaction.options.getString('sku') || '';
  const qty = interaction.options.getInteger('qty') || 1;
  const maxBudget = interaction.options.getNumber('maxbudget') || '';
  const priority = interaction.options.getString('priority') || 'Medium';
  const notes = interaction.options.getString('notes') || '';

  await interaction.deferReply({ ephemeral: true });

  try {
    const payload = {
      action: 'discordRequest',
      requester: interaction.user.username,
      subsystem: subsystem,
      partLink: link,
      sku: sku,
      quantity: qty,
      neededBy: '',
      maxBudget: maxBudget,
      priority: priority,
      notes: `[Discord] ${notes}`.trim()
    };

    const response = await axios.post(APPS_SCRIPT_URL, payload);
    const data = response.data;

    if (data.status !== 'ok') {
      return interaction.editReply(`❌ Error: ${data.message || 'Unknown error'}`);
    }

    const responseLines = [
      `✅ Request **${data.requestID}** submitted!`,
      `Subsystem: **${subsystem}**`
    ];

    if (link) responseLines.push(`Link: ${link}`);
    if (sku) responseLines.push(`SKU: **${sku}** (user-specified)`);
    responseLines.push(`Qty: **${qty}**, Priority: **${priority}**`);

    return interaction.editReply(responseLines.join('\n'));

  } catch (err) {
    console.error('[handleRequestPart] Error:', err.message);
    return interaction.editReply('❌ Failed to contact Google Sheets');
  }
}

async function handleCancelRequest(interaction) {
  const requestId = (interaction.options.getString('requestid') || '').trim().toUpperCase();
  const reason = (interaction.options.getString('reason') || '').trim();

  if (!requestId) {
    return interaction.reply({
      content: '⚠️ Please provide a request ID',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const payload = {
      action: 'cancelRequest',
      requestId: requestId,
      canceller: interaction.user.username,
      reason: reason || 'No reason provided'
    };

    const response = await axios.post(APPS_SCRIPT_URL, payload);
    const data = response.data;

    if (data.status !== 'ok') {
      return interaction.editReply(`❌ ${data.message || 'Unknown error'}`);
    }

    const responseLines = [
      `✅ Request **${requestId}** cancelled successfully`,
    ];

    if (reason) {
      responseLines.push(`Reason: ${reason}`);
    }

    return interaction.editReply(responseLines.join('\n'));

  } catch (err) {
    console.error('[handleCancelRequest] Error:', err.message);
    return interaction.editReply('❌ Failed to contact Google Sheets');
  }
}

async function handleOpenOrders(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const payload = { action: 'openOrders' };
    const response = await axios.post(APPS_SCRIPT_URL, payload);
    const data = response.data;

    if (data.status !== 'ok') {
      return interaction.editReply(`❌ Error: ${data.message || 'Unknown error'}`);
    }

    const orders = data.orders || [];
    const denied = data.denied || [];

    if (orders.length === 0 && denied.length === 0) {
      return interaction.editReply('✅ No open orders and no denied requests.');
    }

    const lines = [];
    lines.push('📦 **Open Orders (not yet received)**');

    if (orders.length === 0) {
      lines.push('No open orders.\n');
    } else {
      const shown = orders.slice(0, 15);
      lines.push(`Total: ${orders.length}\n`);

      for (const o of shown) {
        lines.push(
          `• **${o.orderId}** — ${o.vendor || 'Unknown'}`,
          `  Part: ${o.partName || '(no name)'}`,
          `  SKU: ${o.sku || '(none)'} | Qty: ${o.qty || 'N/A'}`,
          `  Status: ${o.status || 'Unknown'}`,
          `  Ordered: ${formatDate(o.orderDate)} | ETA: ${formatEta(o.eta)}`,
          `  Tracking: ${o.tracking || '—'}\n`
        );
      }
    }

    if (denied.length > 0) {
      const shownDenied = denied.slice(0, 15);
      lines.push('⚠️ **Denied Requests**');
      lines.push(`Total: ${denied.length}\n`);

      for (const r of shownDenied) {
        lines.push(
          `• **${r.id}** — ${r.partName || '(no name)'}`,
          `  Requester: ${r.requester || 'Unknown'}`,
          `  Notes: ${r.mentorNotes || '—'}\n`
        );
      }
    }

    return interaction.editReply(lines.join('\n'));

  } catch (err) {
    console.error('[handleOpenOrders] Error:', err.message);
    return interaction.editReply('❌ Failed to contact Google Sheets');
  }
}

async function handleOrderStatus(interaction) {
  const requestId = (interaction.options.getString('requestid') || '').trim();
  const orderId = (interaction.options.getString('orderid') || '').trim();

  if (!requestId && !orderId) {
    return interaction.reply({
      content: '⚠️ Provide either **requestid** or **orderid**',
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
      return interaction.editReply(`❌ Error: ${data.message || 'Unknown error'}`);
    }

    if (requestId) {
      const r = data.request;
      if (!r) return interaction.editReply(`🔍 No request found for \`${requestId}\``);

      const lines = [
        `📄 **Request Status – ${r.id}**\n`,
        `**Status:** ${r.requestStatus || 'Unknown'}`,
        `**Subsystem:** ${r.subsystem || 'N/A'}`,
        `**Part:** ${r.partName || '(no name)'}`,
        `**Qty:** ${r.qty || 'N/A'}`,
        `**Priority:** ${r.priority || 'N/A'}`
      ];

      const orders = data.orders || [];
      if (orders.length > 0) {
        lines.push('\n📦 **Linked Orders:**');
        for (const o of orders) {
          lines.push(
            `• **${o.orderId}** — ${o.status || 'Unknown'}, ` +
            `ETA: ${formatEta(o.eta)}`
          );
        }
      }

      return interaction.editReply(lines.join('\n'));
    }

    if (orderId) {
      const o = data.order;
      if (!o) return interaction.editReply(`🔍 No order found for \`${orderId}\``);

      const lines = [
        `📦 **Order Status – ${o.orderId}**\n`,
        `**Status:** ${o.status || 'Unknown'}`,
        `**Vendor:** ${o.vendor || 'N/A'}`,
        `**Part:** ${o.partName || '(no name)'}`,
        `**Qty:** ${o.qty || 'N/A'}`,
        `**Ordered:** ${formatDate(o.orderDate)}`,
        `**ETA:** ${formatEta(o.eta)}`,
        `**Tracking:** ${o.tracking || '—'}`
      ];

      return interaction.editReply(lines.join('\n'));
    }

  } catch (err) {
    console.error('[handleOrderStatus] Error:', err.message);
    return interaction.editReply('❌ Failed to contact Google Sheets');
  }
}

async function handleInventory(interaction) {
  const sku = (interaction.options.getString('sku') || '').trim();
  const search = (interaction.options.getString('search') || '').trim();

  if (!sku && !search) {
    return interaction.reply({
      content: '⚠️ Provide either **sku** or **search**',
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
      return interaction.editReply(`❌ Error: ${data.message || 'Unknown error'}`);
    }

    const matches = data.matches || [];

    if (matches.length === 0) {
      return interaction.editReply(`🔍 No inventory found for \`${sku || search}\``);
    }

    if (matches.length === 1) {
      const m = matches[0];
      const lines = [
        '📦 **Inventory Match**\n',
        `**SKU:** ${m.sku}`,
        `**Name:** ${m.name}`,
        `**Vendor:** ${m.vendor}`,
        `**Location:** ${m.location}`,
        `**Qty On-Hand:** ${m.quantity}`
      ];
      return interaction.editReply(lines.join('\n'));
    }

    const lines = [`📦 **${matches.length} matches found:**`];
    for (const m of matches.slice(0, 10)) {
      lines.push(`• \`${m.sku}\` — ${m.name} (Qty: ${m.quantity}, Loc: ${m.location})`);
    }

    return interaction.editReply(lines.join('\n'));

  } catch (err) {
    console.error('[handleInventory] Error:', err.message);
    return interaction.editReply('❌ Failed to contact Google Sheets');
  }
}

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(err => {
    console.error('[Bot] ❌ Failed to start:', err);
    process.exit(1);
  });