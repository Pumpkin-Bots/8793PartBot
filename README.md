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
├── LICENSE
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

## Cloud Hosted Deployment Options
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
- Web dashboard for mentors  
- Predictive part ordering modeling

---

## Maintainers
**FRC Team 8793 – Pumpkin Bots**  
Engineering Lead: Franz Dill  
Student Lead: TBD
AI Assistant: ChatGPT

---

## 📜 License

**8793PartBot – Automated Parts Management System**  
Copyright (c) 2024  
**FRC Team 8793 – Pumpkin Bots**

This project is licensed under the **MIT License with a Use Notification Requirement**.

You are free to:
- Use the software
- Copy it
- Modify it
- Merge it into your own projects
- Distribute it
- Use it privately or publicly
- Use it in competitions, including FIRST Robotics Competition (FRC)

…as long as you follow the MIT terms **and** include the required license notice in any redistributed code.

### 🔔 Use Notification Requirement
If you use, copy, modify, or distribute this software, you must make a reasonable effort to **notify FRC Team 8793 – Pumpkin Bots**.  
This helps build community knowledge and allows the team to track adoption and collaborate with other FRC programs.

Notification can be done in any of the following ways:
- Opening an Issue in this GitHub repository  
- Sending an email to the team (pumpkinbots@hmbrobotics.org)
- Sharing usage publicly in your own README or documentation  

This requirement does **not** restrict your rights granted under the MIT License; it is intended solely to encourage collaboration and transparency among teams.

### 📄 Full License Text
See the [`LICENSE`](./LICENSE) file in this repository for the complete legal terms.
