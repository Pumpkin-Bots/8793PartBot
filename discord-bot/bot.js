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
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const axios = require('axios');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
// Shared secret checked by Apps Script doPost; must match the PARTBOT_SECRET Script Property
const PARTBOT_SECRET = process.env.PARTBOT_SECRET || '';
// Optional: only members with this Discord role (or server managers) can use /receive
const RECEIVING_ROLE_ID = process.env.RECEIVING_ROLE_ID || '';
// Optional: only members with this Discord role (or server managers) can use /delivered
const MENTOR_ROLE_ID = process.env.MENTOR_ROLE_ID || '';

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !APPS_SCRIPT_URL) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}
if (!PARTBOT_SECRET) {
  console.warn('⚠️ PARTBOT_SECRET is not set; Apps Script will reject requests once its secret is configured');
}

// Every call to the Apps Script web app goes through here so the secret is always attached
function postToAppsScript(payload) {
  return axios.post(APPS_SCRIPT_URL, { ...payload, secret: PARTBOT_SECRET });
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

function formatMoney(value) {
  const n = Number(value) || 0;
  const s = '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? '-' + s : s;
}

// "🗓️ Mentors review and place orders twice a week during build season: Monday and Thursday."
// schedule = { mode: 'In-season' | 'Off-season', days: ['Tuesday', ...] } from the Settings tab
function formatOrderSchedule(schedule) {
  if (!schedule || !Array.isArray(schedule.days) || schedule.days.length === 0) return '';
  const days  = schedule.days;
  const count = ['once', 'twice'][days.length - 1] || `${days.length} times`;
  const when  = schedule.mode === 'In-season' ? 'during build season' : 'in the off-season';
  const list  = days.length === 1 ? days[0] : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;
  return `🗓️ Mentors review and place orders ${count} a week ${when}: **${list}**.`;
}

function budgetBar(percentUsed, width = 16) {
  const filled = Math.max(0, Math.min(width, Math.round(percentUsed / 100 * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
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
      option.setName('category').setDescription('What is this purchase for? (sets which budget it counts against)').setRequired(true)
        .addChoices(
          { name: 'Robot Part', value: 'Robot Part' },
          { name: 'Field Piece', value: 'Field Piece' },
          { name: 'Tool', value: 'Tool' },
          { name: 'Supply', value: 'Supply' },
          { name: 'Marketing/Spirit', value: 'Marketing/Spirit' }
        )
    )
    .addStringOption(option =>
      option.setName('season').setDescription('In-season or off-season build').setRequired(true)
        .addChoices(
          { name: 'In-season', value: 'In-season' },
          { name: 'Off-season', value: 'Off-season' }
        )
    )
    .addStringOption(option =>
      option.setName('link').setDescription('Part link (URL)').setRequired(false)
    )
    .addStringOption(option =>
      option.setName('sku').setDescription('Specific SKU/part number (overrides AI detection)').setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('qty').setDescription('Quantity').setRequired(false).setMinValue(1)
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
    .setName('budgetstatus')
    .setDescription('FRC budget: total spent and remaining, plus every FRC Expenses line'),

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
    .setDescription('Search what we have and where it is (check before requesting a part!)')
    .addStringOption(option =>
      option.setName('search').setDescription('Words to look for, e.g. "hex bearing" or "BIN-002"').setRequired(false)
    )
    .addStringOption(option =>
      option.setName('sku').setDescription('Exact SKU / part number').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('receive')
    .setDescription('A part arrived: record it and where you put it')
    .addStringOption(option =>
      option.setName('request').setDescription('Which request arrived (type a part name or REQ ID)')
        .setRequired(true).setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName('location').setDescription('Bin or toolbox you put it in').setRequired(false).setAutocomplete(true)
    )
    .addUserOption(option =>
      option.setName('student').setDescription('Or: the student you handed it to').setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('qty').setDescription('How many arrived (default: the quantity requested)').setRequired(false).setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('delivered')
    .setDescription('Mentors: an order arrived at your home, not in the shop yet')
    .addStringOption(option =>
      option.setName('request').setDescription('Which request arrived (type a part name or REQ ID)')
        .setRequired(true).setAutocomplete(true)
    )
    .addUserOption(option =>
      option.setName('mentor').setDescription('Who has it (default: you)').setRequired(false)
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
  refreshReceiveOptions();
  setInterval(refreshReceiveOptions, RECEIVE_OPTIONS_TTL_MS);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'receive' || interaction.commandName === 'delivered') await handleReceiveAutocomplete(interaction).catch(err =>
      console.error('[Bot] Autocomplete error:', err.message));
    return;
  }
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'requestpart':
        await handleRequestPart(interaction);
        break;
      case 'budgetstatus':
        await handleBudgetStatus(interaction);
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
      case 'receive':
        await handleReceive(interaction);
        break;
      case 'delivered':
        await handleDelivered(interaction);
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
  const category = interaction.options.getString('category');
  const season = interaction.options.getString('season');
  const link = interaction.options.getString('link') || '';
  const sku = interaction.options.getString('sku') || '';
  const qty = interaction.options.getInteger('qty') || 1;
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
      priority: priority,
      notes: `[Discord] ${notes}`.trim(),
      budgetCategory: category,
      buildSeason: season
    };

    const response = await postToAppsScript(payload);
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
    responseLines.push(`Category: **${category}** (${season})`);

    const b = data.budget;
    if (b) {
      if (b.requestCost > 0) {
        responseLines.push(b.remaining < 0
          ? `🔴 **${b.line}**: ${formatMoney(-b.remaining)} **over budget** after this request (${formatMoney(b.requestCost)})`
          : `💰 **${b.line}**: ${formatMoney(b.remaining)} left of ${formatMoney(b.budget)} after this request (${formatMoney(b.requestCost)})`);
      } else {
        responseLines.push(`💰 **${b.line}**: ${formatMoney(b.remaining)} left of ${formatMoney(b.budget)}. No price found yet, so this request isn't counted until a mentor adds one.`);
      }
    }

    const scheduleLine = formatOrderSchedule(data.orderSchedule);
    if (scheduleLine) responseLines.push(scheduleLine);

    return interaction.editReply(responseLines.join('\n'));

  } catch (err) {
    console.error('[handleRequestPart] Error:', err.message);
    return interaction.editReply('❌ Failed to contact Google Sheets');
  }
}

async function handleBudgetStatus(interaction) {
  await interaction.deferReply({ ephemeral: true });   // only the person who ran it sees it

  try {
    const response = await postToAppsScript({ action: 'budgetStatus' });
    const data = response.data;

    if (data.status !== 'ok') {
      return interaction.editReply(`❌ Error: ${data.message || 'Unknown error'}`);
    }

    const budget = data.budget;
    const t = budget.total;
    const totalSpent = t.spent + t.pending;
    const pctRemaining = t.budget > 0 ? t.remaining / t.budget * 100 : 0;

    let health = '🟢 Within budget';
    if (t.remaining < 0) health = '🔴 Over budget';
    else if (pctRemaining <= 10) health = '🟡 Under 10% left';

    // FRC total first, then every FRC Expenses line
    const lines = [
      `💰 **FRC Budget Status: ${budget.yearLabel}**`,
      '',
      `Total Budget:  **${formatMoney(t.budget)}**`,
      `Total Spent:   **${formatMoney(totalSpent)}** (${formatMoney(t.spent)} logged by finance + ${formatMoney(t.pending)} pending in PartBot)`,
      `Remaining:     **${formatMoney(t.remaining)}** (${pctRemaining.toFixed(1)}%)`,
      `\`${budgetBar(t.percentUsed, 20)}\` ${health}`,
      ''
    ];

    for (const l of budget.lines) {
      const left = l.remaining < 0
        ? `🔴 **${formatMoney(-l.remaining)} over**`
        : `**${formatMoney(l.remaining)} left** of ${formatMoney(l.budget)}`;
      lines.push(`**${l.name}**`);
      lines.push(`\`${budgetBar(l.percentUsed)}\` ${l.percentUsed.toFixed(0)}% · ${left}`);
      // Pending only applies to lines PartBot purchases count against
      lines.push(l.partBot
        ? `Spent ${formatMoney(l.spent)} · Pending ${formatMoney(l.pending)}`
        : `Spent ${formatMoney(l.spent)}`);
      lines.push('');
    }

    lines.push('_Spent = logged by finance. Pending = PartBot requests not yet reimbursed._');
    if (!data.synced) {
      lines.push(`⚠️ _Couldn't reach the finance sheet; showing numbers from ${formatDate(budget.lastSynced, 'the last sync')}._`);
    }

    // Discord rejects messages over 2000 characters
    let message = lines.join('\n');
    if (message.length > 1900) {
      message = message.substring(0, 1900) + '\n\n... (truncated)';
    }
    return interaction.editReply(message);

  } catch (err) {
    console.error('[handleBudgetStatus] Error:', err.message);
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

    const response = await postToAppsScript(payload);
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
    const response = await postToAppsScript(payload);
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
    const offsite = orders.filter(o => o.holder);
    if (offsite.length) {
      lines.push(`🏠 **Arrived at a mentor's home, not in the shop yet** (${offsite.length})`);
      for (const o of offsite) {
        lines.push(`• **${o.orderId}** — ${o.partName || '(no name)'} ×${o.qty || '?'} · at ${o.holder}'s`);
      }
      lines.push('');
    }
    lines.push('📦 **Open Orders (not yet received)**');
    const inTransit = orders.filter(o => !o.holder);

    if (inTransit.length === 0) {
      lines.push('No open orders.\n');
    } else {
      const shown = inTransit.slice(0, 15);
      lines.push(`Total: ${inTransit.length}\n`);

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

    // Discord rejects messages over 2000 characters
    let message = lines.join('\n');
    if (message.length > 1900) {
      message = message.substring(0, 1900) + '\n\n... (truncated)';
    }
    return interaction.editReply(message);

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

    const response = await postToAppsScript(payload);
    const data = response.data;

    if (data.status !== 'ok') {
      return interaction.editReply(`❌ Error: ${data.message || 'Unknown error'}`);
    }

    if (requestId) {
      const r = data.request;
      if (!r) return interaction.editReply(`🔍 No request found for \`${requestId}\``);

      const lines = [
        `📄 **Request Status – ${r.id}**\n`,
        `**Status:** ${r.requestStatus || 'Unknown'}` +
          (r.holder ? `\n🏠 Delivered to **${r.holder}**; it'll be in the shop once it's brought in and \`/receive\`d.` : ''),
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
      content: '⚠️ Type some words in **search** (e.g. `hex bearing`, `BIN-002`) or an exact **sku**',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const response = await postToAppsScript({ action: 'inventory', sku: sku, search: search });
    const data = response.data;

    if (data.status !== 'ok') {
      return interaction.editReply(`❌ Error: ${data.message || 'Unknown error'}`);
    }

    const matches = data.matches || [];
    const onOrder = data.onOrder || [];
    const total = data.total || matches.length;
    const lines = [];

    if (matches.length === 0) {
      lines.push(`🔍 Nothing in inventory matches \`${sku || search}\`.`);
    } else {
      lines.push(`📦 **${total} in inventory** matching \`${sku || search}\`${total > matches.length ? ` (showing ${matches.length})` : ''}:`);
      for (const m of matches) {
        const qty = m.quantity === '' || m.quantity === null ? '?' : m.quantity;
        const name = truncate(m.name || '(no name)', 60);
        lines.push(`• **${qty}** × ${name} — ${m.location || 'no location'}${m.sku ? ` · \`${m.sku}\`` : ''}`);
      }
      if (total > matches.length) lines.push('_Add more words to narrow the search._');
    }

    if (onOrder.length) {
      lines.push('', '🛒 **Already on order:**');
      for (const o of onOrder) {
        const state = o.holder ? `🏠 at ${o.holder}'s, not in shop yet` : o.status;
        lines.push(`• ${o.qty} × ${truncate(o.partName, 60)} — ${o.requestId} (${state}, ${o.requester})`);
      }
    }

    return interaction.editReply(truncate(lines.join('\n'), 1950));

  } catch (err) {
    console.error('[handleInventory] Error:', err.message);
    return interaction.editReply('❌ Failed to contact Google Sheets');
  }
}

function truncate(text, max) {
  const s = (text || '').toString();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/* ---------- /receive ---------- */

// Autocomplete must answer within 3 seconds, faster than Apps Script, so suggestions come from a cache
const RECEIVE_OPTIONS_TTL_MS = 2 * 60 * 1000;
let receiveOptions = { requests: [], locations: [], loadedAt: 0 };
let receiveOptionsLoading = null;

function refreshReceiveOptions() {
  if (receiveOptionsLoading) return receiveOptionsLoading;
  receiveOptionsLoading = postToAppsScript({ action: 'receiveOptions' })
    .then(res => {
      if (res.data && res.data.status === 'ok') {
        receiveOptions = { requests: res.data.requests || [], locations: res.data.locations || [], loadedAt: Date.now() };
      } else {
        console.error('[receiveOptions] Error:', res.data && res.data.message);
      }
    })
    .catch(err => console.error('[receiveOptions] Failed:', err.message))
    .finally(() => { receiveOptionsLoading = null; });
  return receiveOptionsLoading;
}

async function handleReceiveAutocomplete(interaction) {
  if (Date.now() - receiveOptions.loadedAt > RECEIVE_OPTIONS_TTL_MS) refreshReceiveOptions();

  const focused = interaction.options.getFocused(true);
  const words = (focused.value || '').toLowerCase().split(/\s+/).filter(Boolean);
  const matchesAll = text => words.every(w => text.toLowerCase().includes(w));
  let choices = [];

  if (focused.name === 'request') {
    choices = receiveOptions.requests
      .filter(r => matchesAll(`${r.id} ${r.partName} ${r.sku} ${r.requester} ${r.holder || ''}`))
      .map(r => ({
        name: truncate(`${r.holder ? `🏠 ${r.holder} · ` : ''}${r.partName || r.sku || '(no name yet)'} ×${r.qty} · ${r.requester} · ${r.id}`, 100),
        value: r.id
      }));
  } else if (focused.name === 'location') {
    choices = receiveOptions.locations
      .filter(l => matchesAll(`${l.name} ${l.type}`))
      .map(l => ({ name: truncate(`${l.name} (${l.type})`, 100), value: truncate(l.name, 100) }));
  }

  await interaction.respond(choices.slice(0, 25));
}

function canReceive(interaction, roleId = RECEIVING_ROLE_ID) {
  if (!roleId) return true;
  const member = interaction.member;
  if (!member) return false;
  if (member.permissions && member.permissions.has && member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = member.roles;
  if (roles && roles.cache) return roles.cache.has(roleId);
  return Array.isArray(roles) && roles.includes(roleId);
}

// Requests store the Discord username; look the member up so the requester gets pinged
async function mentionFor(guild, username) {
  if (!guild || !username) return username ? `**${username}**` : 'the requester';
  try {
    const found = await guild.members.search({ query: username, limit: 5 });
    const member = found.find(m => m.user.username === username);
    if (member) return `<@${member.id}>`;
  } catch (err) {
    console.error('[mentionFor] Member search failed:', err.message);
  }
  return `**${username}**`;
}

async function handleReceive(interaction) {
  if (!canReceive(interaction)) {
    return interaction.reply({ content: '🔒 Only the receiving team can use /receive. Ask a mentor if you should have the role.', ephemeral: true });
  }

  const requestId = interaction.options.getString('request');
  const location = (interaction.options.getString('location') || '').trim();
  const student = interaction.options.getUser('student');
  const qty = interaction.options.getInteger('qty');

  if (!location === !student) {
    return interaction.reply({
      content: '⚠️ Say where it went: pick a **location** (bin or toolbox) **or** a **student**, not both.',
      ephemeral: true
    });
  }

  // Public reply: this is the "It's here!" announcement
  await interaction.deferReply();

  try {
    const response = await postToAppsScript({
      action: 'receive',
      requestId: requestId,
      location: location,
      student: student ? student.username : '',
      quantity: qty || '',
      receiver: interaction.user.username
    });
    const data = response.data;

    if (data.status !== 'ok') {
      await interaction.deleteReply().catch(() => {});
      return interaction.followUp({ content: `❌ ${data.message || 'Could not record that.'}`, ephemeral: true });
    }

    refreshReceiveOptions();

    const who = await mentionFor(interaction.guild, data.requester);
    const where = student ? `with <@${student.id}>` : `in **${data.location}**`;
    const short = data.qty < data.orderedQty ? ` (ordered ${data.orderedQty}; mentors will follow up on the rest)` : '';
    const lines = [
      `📦 **It's here!** ${who}, your **${truncate(data.partName || data.sku, 80)}** arrived.`,
      `${data.qty} received by <@${interaction.user.id}>, now ${where}${short}.`
    ];
    if (data.onHand !== null && data.onHand !== undefined && data.onHand !== '') {
      lines.push(`Inventory total for \`${data.sku}\`: **${data.onHand}** · ${data.requestId}`);
    } else {
      lines.push(data.requestId);
    }
    return interaction.editReply(lines.join('\n'));

  } catch (err) {
    console.error('[handleReceive] Error:', err.message);
    await interaction.deleteReply().catch(() => {});
    return interaction.followUp({ content: "⚠️ Couldn't confirm with Google Sheets. Check `/orderstatus` for that request before trying again, so it isn't counted twice.", ephemeral: true });
  }
}

/* ---------- /delivered ---------- */

// Orders often ship to a mentor's home; tell the requester it arrived but isn't in the shop yet
async function handleDelivered(interaction) {
  if (!canReceive(interaction, MENTOR_ROLE_ID)) {
    return interaction.reply({ content: '🔒 Only mentors can use /delivered.', ephemeral: true });
  }

  const requestId = interaction.options.getString('request');
  const mentor = interaction.options.getUser('mentor') || interaction.user;

  await interaction.deferReply();

  try {
    const response = await postToAppsScript({
      action: 'delivered',
      requestId: requestId,
      holder: mentor.username,
      by: interaction.user.username
    });
    const data = response.data;

    if (data.status !== 'ok') {
      await interaction.deleteReply().catch(() => {});
      return interaction.followUp({ content: `❌ ${data.message || 'Could not record that.'}`, ephemeral: true });
    }

    refreshReceiveOptions();

    const who = await mentionFor(interaction.guild, data.requester);
    return interaction.editReply([
      `🏠 **Arrived at a mentor's home!** ${who}, your **${truncate(data.partName || data.sku, 80)}** ×${data.qty} was delivered to <@${mentor.id}>.`,
      `It's **not in the shop yet**. It'll go into inventory when it's brought in and \`/receive\`d. · ${data.requestId}`
    ].join('\n'));

  } catch (err) {
    console.error('[handleDelivered] Error:', err.message);
    await interaction.deleteReply().catch(() => {});
    return interaction.followUp({ content: "⚠️ Couldn't confirm with Google Sheets. Check `/orderstatus` before trying again.", ephemeral: true });
  }
}

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(err => {
    console.error('[Bot] ❌ Failed to start:', err);
    process.exit(1);
  });
