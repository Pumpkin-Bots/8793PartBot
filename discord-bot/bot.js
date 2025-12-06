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
          { name: 'Other', value: 'Other' }
        )
    )
    .addIntegerOption(option =>
      option.setName('qty').setDescription('Quantity').setRequired(false)
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

  if (interaction.commandName === 'requestpart') {
    await handleRequestPart(interaction);
  }
});

async function handleRequestPart(interaction) {
  const subsystem = interaction.options.getString('subsystem');
  const qty = interaction.options.getInteger('qty') || 1;
  const priority = interaction.options.getString('priority') || 'Medium';

  await interaction.deferReply({ ephemeral: true });

  try {
    const payload = {
      action: 'discordRequest',
      requester: interaction.user.username,
      subsystem: subsystem,
      quantity: qty,
      priority: priority
    };

    console.log('[handleRequestPart] Sending:', JSON.stringify(payload));

    const response = await axios.post(APPS_SCRIPT_URL, payload);
    const data = response.data;

    console.log('[handleRequestPart] Response:', JSON.stringify(data));

    if (data.status !== 'ok') {
      return interaction.editReply(`❌ Error: ${data.message || 'Unknown error'}`);
    }

    return interaction.editReply(
      `✅ Request **${data.requestID}** submitted!\n` +
      `Subsystem: **${subsystem}**, Qty: **${qty}**, Priority: **${priority}**`
    );

  } catch (err) {
    console.error('[handleRequestPart] Error:', err.message);
    return interaction.editReply('❌ Failed to contact Google Sheets');
  }
}

registerCommands()
  .then(() => client.login(TOKEN))
  .catch(err => {
    console.error('[Bot] ❌ Failed to start:', err);
    process.exit(1);
  });