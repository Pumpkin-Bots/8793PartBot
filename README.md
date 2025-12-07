# 8793PartBot — Automated Parts Purchasing System for FRC Robotics

## Overview
8793PartBot is an automation system built for **FRC Team 8793 – Pumpkin Bots** to streamline:
- Part requests from students via Discord slash commands
- Automatic SKU/name extraction via AI (OpenAI GPT-4o-mini)
- Real-time inventory lookup
- Purchasing approvals and workflow management
- Order tracking with ETA notifications
- Discord ↔ Google Sheets integration

It replaces DM chaos, ad‑hoc spreadsheets, and manual vendor lookups with a structured, automated workflow.

---

## Features

### 🔧 AI-Powered Part Enrichment
Automatically extracts from a vendor URL:
- Part name
- SKU / product code
- Estimated price
- Stock availability
- Variant selection (AI uses student-provided hint text)

Supports major FRC vendors:
- REV Robotics
- AndyMark
- West Coast Products (WCP)
- VEX Robotics
- McMaster-Carr
- DigiKey
- Amazon

### 💬 Discord Slash Commands
Students request parts using intuitive slash commands:
```
/requestpart subsystem:Drive link:<URL> qty:2 priority:High notes:"0.5 inch bore"
```

All commands:
- `/requestpart` - Submit a new part request
- `/inventory` - Search inventory by SKU or keyword
- `/openorders` - View all pending orders and denied requests
- `/orderstatus` - Check status of a specific request or order

### 📦 Order Tracking
- `/openorders` – displays all non-received orders
- `/orderstatus requestid:REQ-xxxx` – detailed status for a request
- `/orderstatus orderid:ORD-xxxx` – detailed status for an order
- ETAs shown in human-readable format (e.g., "Dec 15, 2024")
- Tracking numbers displayed when available

### 📚 Inventory Lookup
```
/inventory sku:WCP-0783
/inventory search:bearing
/inventory search:BIN-001
```
Returns:
- Stock on hand (aggregated across multiple locations)
- Location(s)
- Vendor
- Part name

Supports:
- Exact SKU matching
- Fuzzy keyword search
- Location-based lookup (BIN-xxx, RACK-xxx)

### 🛠 Automated Workflow
1. Student submits `/requestpart` in Discord
2. Apps Script creates request in Google Sheets
3. AI enrichment extracts part details from URL
4. System checks inventory for existing stock
5. Mentor reviews and approves in Google Sheets
6. Approved requests automatically moved to Orders sheet
7. Order status tracked until received
8. Denied requests flagged in `/openorders` for visibility

---

## Architecture
```
Discord Slash Commands
        ↓
Node.js Discord Bot (bot.js)
  - Command handling
  - User interaction
  - HTTP requests to Apps Script
        ↓
Google Apps Script Web App (Code.gs)
  - Request routing (doPost)
  - Database operations
  - OpenAI API integration
        ↓
Google Sheets (Database)
  - Part Requests (pending items)
  - Orders (approved/ordered items)
  - Inventory (on-hand stock)
        ↓
OpenAI API (gpt-4o-mini)
  - SKU/price parsing from HTML
  - Variant selection
```

---

## Repository Structure
```
8793PartBot/
│
├── discord-bot/
│   ├── bot.js                    # Main Discord bot (refactored)
│   ├── shared-constants.js       # Shared API constants
│   ├── package.json
│   ├── package-lock.json
│   ├── .env                      # Environment variables (not in git)
│   └── .env.example              # Template for .env
│
├── apps-script/
│   ├── Code.gs                   # Main Apps Script (complete implementation)
│   ├── SharedConstants.gs        # Shared constants (optional)
│   └── appsscript.json           # Apps Script manifest
│
├── LICENSE
└── README.md                     # This file
```

---

## Setup Instructions

### Prerequisites
- Google Account (for Google Sheets and Apps Script)
- Discord Developer Account
- OpenAI API Key (for AI enrichment)
- Google Cloud VM or server (for hosting the bot)

---

### 1. Google Sheets Setup

#### Create Spreadsheet
1. Create a new Google Sheet named "8793 FullInventory and PartPurchasing"
2. Create three tabs with exact names:
   - `Part Requests`
   - `Orders`
   - `Inventory`

#### Part Requests Sheet (Columns A-S)
```
ID | Timestamp | Requester | Subsystem | Part Name | SKU | Part Link | Quantity | 
Priority | Needed By | Inventory On-Hand | Vendor Stock | Est Unit Price | 
Total Est Cost | Max Budget | Budget Status | Request Status | Mentor Notes | 
Expedited Shipping
```

#### Orders Sheet (Columns A-O)
```
Order ID | Included Request IDs | Vendor | Part Name | SKU | Qty Ordered | 
Final Unit Price | Total Cost | Order Date | Shipping Method | Tracking | 
ETA | Received Date | Order Status | Mentor Notes
```

#### Inventory Sheet (Columns A-E)
```
Part Number / SKU | Vendor | Part Name | Location | Qty On-Hand
```

---

### 2. Apps Script Setup

#### Create Apps Script Project
1. Open your Google Sheet
2. Go to **Extensions → Apps Script**
3. Delete any default code
4. Copy the complete `Code.gs` from this repository
5. Paste into the Apps Script editor
6. **Save** (Ctrl+S or ⌘+S)

#### Configure OpenAI API Key
1. In Apps Script, go to **Project Settings** (⚙️ on left)
2. Scroll to **Script Properties**
3. Click **Add script property**
   - Property: `OPENAI_API_KEY`
   - Value: `your-openai-api-key-here`
4. Click **Save script properties**

#### Deploy as Web App
1. Click **Deploy → New deployment**
2. Click gear icon ⚙️ next to "Select type"
3. Choose **Web app**
4. Configure:
```
   Description: FRC Parts Bot API
   Execute as: Me (your-email@example.com)
   Who has access: Anyone
```
5. Click **Deploy**
6. Click **Authorize access**
   - Choose your Google account
   - Click "Advanced" → "Go to [Your Project]"
   - Click "Allow"
7. **Copy the Web app URL** (ends with `/exec`)
   - Example: `https://script.google.com/macros/s/AKfycby.../exec`

#### Test the Deployment
Open the Web app URL in your browser. You should see:
```
OK FROM FRC PURCHASING WEB APP
```

---

### 3. Discord Bot Setup

#### Create Discord Application
1. Go to https://discord.com/developers/applications
2. Click **New Application**
3. Name it (e.g., "8793PartBot")
4. Click **Create**

#### Create Bot User
1. Click **Bot** in left sidebar
2. Click **Add Bot** → **Yes, do it!**
3. Click **Reset Token** → **Yes, do it!**
4. **Copy the token** (you'll only see it once!)
5. Save it securely

#### Get Application ID
1. Click **General Information** in left sidebar
2. Copy the **Application ID**

#### Invite Bot to Server
1. Click **OAuth2 → URL Generator**
2. Select scopes:
   - ✓ `bot`
   - ✓ `applications.commands`
3. Select bot permissions:
   - ✓ Send Messages
   - ✓ Use Slash Commands
   - ✓ Embed Links
4. Copy the generated URL
5. Open URL in browser and invite bot to your server

#### Get Guild ID
1. Open Discord
2. Go to **User Settings** (⚙️) → **Advanced**
3. Enable **Developer Mode**
4. Right-click your server icon
5. Click **Copy Server ID**

---

### 4. Server Setup (Google Cloud VM)

#### Create VM Instance
1. Go to https://console.cloud.google.com
2. Navigate to **Compute Engine → VM instances**
3. Click **Create Instance**
4. Configure:
```
   Name: discord-bot-vm
   Region: us-central1 (or closest)
   Machine type: e2-micro (free tier)
   Boot disk: Ubuntu 22.04 LTS, 10GB
   Firewall: Allow HTTP and HTTPS traffic
```
5. Click **Create**

#### Connect via SSH
Click **SSH** button next to your VM instance in the console.

#### Install Node.js and Git
```bash
# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Verify installation
node --version  # Should show v18.x.x
npm --version   # Should show 9.x.x or higher
```

#### Clone Repository
```bash
cd ~
git clone https://github.com/YOUR_USERNAME/8793PartBot.git
cd 8793PartBot/discord-bot
```

#### Install Dependencies
```bash
npm install discord.js axios dotenv
```

#### Configure Environment Variables

**Option A: Using .env file (Recommended)**
```bash
nano .env
```

Add:
```env
DISCORD_TOKEN=your-discord-bot-token-here
CLIENT_ID=your-application-id-here
GUILD_ID=your-guild-id-here
APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

Save with `Ctrl+X`, `Y`, `Enter`

**Option B: Using ~/.bashrc (Persistent)**
```bash
nano ~/.bashrc
```

Add at the end:
```bash
export DISCORD_TOKEN="your-discord-bot-token-here"
export CLIENT_ID="your-application-id-here"
export GUILD_ID="your-guild-id-here"
export APPS_SCRIPT_URL="https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
```

Save and reload:
```bash
source ~/.bashrc
```

#### Test the Bot
```bash
node bot.js
```

You should see:
```
[Bot] Registering slash commands...
[Bot] ✅ Slash commands registered
[Bot] ✅ Logged in as 8793PartBot#1234
```

Press `Ctrl+C` to stop.

#### Install PM2 for 24/7 Operation
```bash
# Install PM2 globally
sudo npm install -g pm2

# Start bot with PM2
pm2 start bot.js --name discord-bot

# Configure auto-start on reboot
pm2 startup
# Copy and run the command it outputs

# Save PM2 configuration
pm2 save
```

#### Verify Bot is Running
```bash
pm2 status
pm2 logs discord-bot
```

---

### 5. Test in Discord

In your Discord server, type `/` and you should see:
- `/requestpart`
- `/inventory`
- `/openorders`
- `/orderstatus`

#### Test Commands
```
/requestpart subsystem:Drive qty:1 priority:Medium

/inventory search:wheel

/openorders

/orderstatus requestid:REQ-xxxxx
```

---

## Useful Commands

### Managing the Bot (PM2)
```bash
# View status
pm2 status

# View real-time logs
pm2 logs discord-bot

# Restart bot
pm2 restart discord-bot

# Stop bot
pm2 stop discord-bot

# View detailed info
pm2 show discord-bot

# Monitor (dashboard view)
pm2 monit
```

### Updating from GitHub
```bash
cd ~/8793PartBot/discord-bot
pm2 stop discord-bot
git pull origin main
npm install  # If dependencies changed
pm2 restart discord-bot
pm2 logs discord-bot
```

### Updating Apps Script
1. Edit Code.gs in Apps Script editor
2. Click Save (💾)
3. **Deploy → Manage deployments**
4. Click pencil icon (✏️) to edit
5. Under "Version", select **"New version"**
6. Click **Deploy**
7. URL stays the same - no bot restart needed

---

## Command Reference

### `/requestpart` - Submit New Request
```
/requestpart 
  subsystem:Drive           # Required: Drive, Intake, Shooter, etc.
  link:https://...          # Optional: Vendor URL
  qty:2                     # Optional: Quantity (default: 1)
  maxbudget:50              # Optional: Maximum budget in USD
  priority:High             # Optional: Critical, High, Medium, Low
  notes:"0.5in bore"        # Optional: Hints for AI variant selection
```

### `/inventory` - Search Inventory
```
/inventory sku:WCP-0783              # Exact SKU lookup
/inventory search:bearing            # Keyword search
/inventory search:BIN-001            # Location lookup
```

### `/openorders` - View Pending Orders
```
/openorders                          # Shows all non-received orders
```

### `/orderstatus` - Check Status
```
/orderstatus requestid:REQ-1fd8b811  # Request details
/orderstatus orderid:ORD-a2b3c4d5    # Order details
```

---

## Troubleshooting

### Bot Shows Offline in Discord
```bash
# Check if bot is running
pm2 status

# Check logs for errors
pm2 logs discord-bot --lines 50

# Verify environment variables
echo $DISCORD_TOKEN
echo $APPS_SCRIPT_URL

# Restart bot
pm2 restart discord-bot
```

### Commands Not Appearing in Discord
```bash
# Re-register commands
pm2 stop discord-bot
node bot.js  # Watch for registration messages
# Press Ctrl+C after seeing "✅ Slash commands registered"
pm2 start discord-bot
```

### "Error from Sheets" Message
1. Check Apps Script **Executions** log (clock icon in Apps Script editor)
2. Look for errors in the execution details
3. Verify deployment is set to "Anyone" can access
4. Test Apps Script URL in browser (should show "OK FROM FRC PURCHASING WEB APP")

### Inventory Search Returns No Results
1. Verify Inventory sheet has data
2. Check column headers match exactly:
   - `Part Number / SKU`
   - `Part Name`
   - `Qty On-Hand` (or similar)
3. Try exact SKU: `/inventory sku:WCP-0783`

---

## Configuration

### Shared Constants
The `shared-constants.js` file defines the API contract between bot.js and Code.gs:
- Action names (`discordRequest`, `inventory`, etc.)
- Field names for requests and responses
- Validation limits
- Display limits
- Error codes

**Important:** If you modify shared-constants.js, update BOTH bot.js and Code.gs.

### Column Indices
Column positions are defined in constants at the top of Code.gs:
```javascript
const PART_REQUESTS_COLS = {
  ID: 1,
  TIMESTAMP: 2,
  REQUESTER: 3,
  // ... etc
};
```

If you change column order in Google Sheets, update these constants.

---

## Security Best Practices

### Never Commit Secrets
Add to `.gitignore`:
```
.env
node_modules/
*.log
.DS_Store
```

### Rotate Tokens Regularly
- Discord bot token
- OpenAI API key
- Apps Script deployment

### Restrict Apps Script Access
- Execute as: **Me** (not "User accessing the web app")
- Who has access: **Anyone** (required for Discord integration)

### Monitor Logs
```bash
# Check for suspicious activity
pm2 logs discord-bot | grep ERROR
```

### Use Environment Variables
Never hardcode credentials in code.

---

## Roadmap

### Planned Features
- [ ] Vendor API integrations (REV, AndyMark direct ordering)
- [ ] Automatic cart building
- [ ] SKU disambiguation improvements
- [ ] Inventory QR code scanning (mobile app)
- [ ] Budget dashboards and spending analytics
- [ ] Web dashboard for mentors
- [ ] Predictive part ordering based on historical data
- [ ] Multi-team support
- [ ] Automated reorder points for consumables

### Known Issues
- AI occasionally misidentifies SKU on multi-variant pages
- Date formatting varies by locale
- Rate limiting on OpenAI API (15+ concurrent requests)

---

## Contributing

We welcome contributions from other FRC teams! To contribute:

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup
```bash
git clone https://github.com/YOUR_USERNAME/8793PartBot.git
cd 8793PartBot/discord-bot
npm install
cp .env.example .env
# Edit .env with your credentials
node bot.js
```

---

## Maintainers

**FRC Team 8793 – Pumpkin Bots**  
Half Moon Bay High School

- Engineering Lead: Franz Dill
- Student Lead: TBD
- AI Assistant: Claude (Anthropic)

Contact: pumpkinbots@hmbrobotics.org

---

## 📜 License

**8793PartBot – Automated Parts Management System**  
Copyright (c) 2025  
**FRC Team 8793 – Pumpkin Bots**

This project is licensed under the **MIT License with a Use Notification Requirement**.

### You are free to:
- ✅ Use the software
- ✅ Copy it
- ✅ Modify it
- ✅ Merge it into your own projects
- ✅ Distribute it
- ✅ Use it privately or publicly
- ✅ Use it in competitions, including FIRST Robotics Competition (FRC)

…as long as you follow the MIT terms **and** include the required license notice in any redistributed code.

### 🔔 Use Notification Requirement

If you use, copy, modify, or distribute this software, you must make a reasonable effort to **notify FRC Team 8793 – Pumpkin Bots**.

This helps build community knowledge and allows the team to track adoption and collaborate with other FRC programs.

**Notification can be done by:**
- Opening an Issue in this GitHub repository
- Sending an email to pumpkinbots@hmbrobotics.org
- Mentioning usage in your own README or documentation

This requirement does **not** restrict your rights granted under the MIT License; it is intended solely to encourage collaboration and knowledge sharing within the FRC community.

---

## Acknowledgments

- **FIRST Robotics Competition** for inspiring innovative solutions
- **Anthropic** for Claude AI assistance in development
- **OpenAI** for GPT-4o-mini powering part enrichment
- **Discord** for the platform and excellent API
- **Google** for Apps Script and Sheets infrastructure
- **FRC vendor community** (REV, AndyMark, WCP, VEX) for supporting robotics education

---

## Support

Having issues? Try these resources:

1. **Check the Troubleshooting section** above
2. **Review Apps Script Executions** (clock icon in editor)
3. **Check PM2 logs**: `pm2 logs discord-bot`
4. **Open an Issue** on GitHub with:
   - Error messages
   - Steps to reproduce
   - Screenshots if applicable
5. **Email us**: pumpkinbots@hmbrobotics.org

---

**Built with ❤️ by FRC Team 8793 – Pumpkin Bots**  
*Automating the boring parts so we can focus on building robots!* 🤖🎃
