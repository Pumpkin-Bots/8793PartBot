# 8793PartBot — Automated Parts Purchasing System for FRC Robotics

## Overview
8793PartBot is an automation system built for **FRC Team 8793 – Pumpkin Bots** to streamline:
- Part requests from students  
- Automatic SKU/name extraction via AI  
- Inventory lookup  
- Purchasing approvals  
- Order tracking  
- Discord ↔ Google Sheets integration  

It replaces DM chaos, ad‑hoc spreadsheets, and manual vendor lookups with a structured workflow.

---

## Features

### 🔧 AI-Powered Part Enrichment
Automatically extracts from a vendor URL:
- Part name  
- SKU / product code  
- Estimated price  
- Stock availability  
- Variant selection (AI uses student-provided hint text)

### 💬 Discord → Google Sheets Pipeline
Students request parts using:
```
/requestpart subsystem:Drive link:<URL> qty:2 priority:High
```
Mentors approve within Google Sheets or via Discord.

### 📦 Order Tracking
Commands:
- `/openorders` – all non‑received orders  
- `/orderstatus order:ORD-xxxx` – details for a single order  
- ETAs shown in human-readable format  

### 📚 Inventory Lookup
```
/inventory sku:WCP-0783
```
Returns:
- Stock on hand  
- Location  
- Vendor  
- Part name  

### 🛠 Automated Workflow
- New request → AI enrichment → Inventory check  
- Mentor approval moves item to **Orders** sheet automatically  
- Denied items flagged for attention in `/openorders`  
- Discord link previews suppressed for denied items  

---

## Architecture

```
Discord Slash Commands  
        ↓  
Node.js Discord Bot (bot.js)  
        ↓  
Google Apps Script Web App (doPost)  
        ↓  
Google Sheets  
        ↓  
OpenAI API (SKU/price parsing)
```

---

## Repository Structure

```
8793PartBot/
│
├── discord-bot/
│   ├── bot.js
│   ├── package.json
│   ├── package-lock.json
│   ├── .env.example
│
├── apps-script/
│   ├── main.gs
│   ├── enrichment.gs
│   ├── inventory.gs
│   ├── workflow.gs
│   ├── appsscript.json
│   ├── clasp.json
│
└── README.md   ← this file
```

---

## Setup Instructions

### 1. Clone the repository
```
git clone https://github.com/<yourname>/8793PartBot.git
cd 8793PartBot
```

---

## Discord Bot Setup

### Install dependencies
```
cd discord-bot
npm install
```

### Create `.env`
```
DISCORD_TOKEN=xxxxx
CLIENT_ID=xxxxx
GUILD_ID=xxxxx
APPS_SCRIPT_URL=https://script.google.com/.../exec
```

### Start the bot
```
node bot.js
```

---

## Google Apps Script Setup

### Install Clasp
```
npm install -g @google/clasp --unsafe-perm=true
```

### Login
```
clasp login
```

### Link local folder
```
cd apps-script
clasp pull
```

### Push updates
```
clasp push
```

### Deploy Web App
Apps Script → **Deploy → New Deployment → Web App**  
- Execute as: **Me**  
- Access: **Anyone**  
Copy the URL into `.env` as `APPS_SCRIPT_URL`.

---

## Google Sheets Setup

### Required Tabs
- **Part Requests**
- **Orders**
- **Inventory**

### Inventory Sheet Columns
```
SKU | Vendor | Part Name | Location | Qty
```

---

## Command Reference

### Request part
```
/requestpart subsystem:Drive link:<URL> qty:2 priority:High
```

### Inventory lookup
```
/inventory sku:WCP-0783
```

### View all active orders
```
/openorders
```

### View one order
```
/orderstatus order:ORD-xxxx
```

---

## Deployment Options
Recommended:
- **Railway**
- **Render**
- **Google Cloud Run**

Others:
- AWS Lightsail  
- Custom VPS (Docker)

---

## Roadmap
- Vendor API integrations  
- Automatic cart building  
- SKU disambiguation improvements  
- Inventory QR scanning  
- Budget dashboards  
- Multi-team federation system  
- Web dashboard for mentors  

---

## Maintainers
**FRC Team 8793 – Pumpkin Bots**  
Engineering Lead: Franz Dill  
AI Assistant: ChatGPT

---

## License
Pending team choice (MIT, Apache 2.0, etc.)
