# 8793PartBot — Automated Parts Purchasing System for FRC Robotics

## Overview
8793PartBot is an automation system built for **FRC Team 8793 – Pumpkin Bots** to streamline:
- Part requests from students via Discord slash commands
- **User-specified SKU override** for multi-variant product pages (NEW!)
- Automatic SKU/name extraction via AI (Google Gemini 2.5 Flash)
- Real-time inventory lookup
- Student self-service request cancellation
- Purchasing approvals and workflow management
- Order tracking with ETA notifications
- Discord ↔ Google Sheets integration

It replaces DM chaos, ad‑hoc spreadsheets, and manual vendor lookups with a structured, automated workflow.

---

## Features

### 🎯 User SKU Override (NEW!)
Students can now specify exact SKUs when requesting parts from multi-variant product pages:
```
/requestpart subsystem:Drive category:Robot Part season:In-season link:https://wcproducts.com/products/ball-bearings sku:WCP-0785 qty:4
```

**Why this matters:**
- Product pages like WCP ball bearings have multiple SKUs (WCP-0783, WCP-0784, WCP-0785, etc.)
- AI might guess the wrong variant based on notes alone
- User-specified SKU **overrides AI detection** and guarantees the correct part
- Still optional - AI enrichment works normally if SKU not provided

**Example use case:**
```
Without SKU field:
/requestpart subsystem:Drive category:Robot Part season:In-season link:https://wcproducts.com/products/ball-bearings qty:4 notes:"1/2 inch flanged"
→ AI might extract WCP-0783 (wrong variant) ❌

With SKU field:
/requestpart subsystem:Drive category:Robot Part season:In-season link:https://wcproducts.com/products/ball-bearings sku:WCP-0785 qty:4
→ Guaranteed WCP-0785 (correct variant) ✅
```

### 🔧 AI-Powered Part Enrichment (Gemini 2.5 Flash)
Automatically extracts from a vendor URL:
- Part name
- SKU / product code (unless user-specified)
- Estimated price

**Supported vendors:**
- ✅ West Coast Products (WCP)
- ✅ REV Robotics
- ✅ VexPro
- ✅ AndyMark
- ✅ Amazon (URL-based extraction)
- ✅ McMaster-Carr (SKU-based extraction)
- ✅ CTRE
- ✅ Studica
- ✅ Redux Robotics
- ✅ Thrifty Bot

**Fallback strategies:**
- **Amazon:** Extracts product name from URL slug + ASIN
- **McMaster-Carr:** Extracts SKU from URL pattern
- **Other vendors:** Intelligent pattern matching

**Smart SKU handling:**
- If user provides SKU → AI only enriches Part Name and Price
- If user omits SKU → AI enriches Part Name, SKU, and Price
- User SKU always takes precedence over AI detection

### 💬 Discord Slash Commands
Students request parts using intuitive slash commands:
```
/requestpart subsystem:Drive category:Robot Part season:In-season link:<URL> sku:WCP-0785 qty:2 priority:High notes:"For shooter prototype"
```

**All commands:**
- `/requestpart` - Submit a new part request (now with optional `sku` field!)
- `/budgetstatus` - FRC budget: total spent and remaining ($ and %), plus every FRC Expenses line
- `/cancelrequest` - Cancel your own request
- `/inventory` - Search what we have and where it is (check before requesting!)
- `/receive` - A part arrived: record it and where you put it (receiving team)
- `/delivered` - Mentors: an order arrived at your home, not in the shop yet
- `/openorders` - View all pending orders and denied requests
- `/orderstatus` - Check status of a specific request or order

### 💰 Live FRC Budget
Every request counts against a line of the **HMB Robotics budget spreadsheet** (finance's ground truth):

| Request category | Budget line |
|---|---|
| Robot Part, Field Piece | Robot Hardware & Field Pieces |
| Tool, Supply | Tools & Supplies |
| Marketing/Spirit | Marketing/Spirit |

**Remaining = Budget − Spent (logged by finance) − PartBot pending.** Pending is this budget year's requests that aren't cancelled, denied, or reimbursed. When finance logs an expense, a mentor enters the date in the request's **Reimbursed** column so it isn't counted twice.

- `/requestpart` replies with what's left in that budget line after your request
- `/budgetstatus` shows the FRC total and every line under FRC Expenses in the budget sheet (Competition Registration, Travel & Food, Robot Hardware & Field Pieces, Marketing/Spirit, Tools & Supplies) with spent, pending, and remaining. Lines PartBot purchases don't use show finance's numbers only.
- PartBot copies the budget amounts into its **Budget** tab hourly, on each Discord command, and from **🎃 PartBot → 🔄 Sync Budget**

### 🗓️ Order Days
`/requestpart` also tells students when mentors review and place orders, for example: *"Mentors review and place orders twice a week during build season: **Monday and Thursday**."*

The days come from the **Settings** tab, which PartBot creates with defaults the first time it's needed (or from **⚙️ Setup Dropdown Workflow**):

| Setting | Default | Notes |
|---|---|---|
| Ordering Mode | Off-season | Dropdown. Switch to **In-season** at kickoff and back after the last event. |
| In-season Order Days | Monday, Thursday | Weekdays separated by commas |
| Off-season Order Days | Monday | |

The message follows **Ordering Mode**, not the season a student picks on the request, because ordering happens on the team's current schedule. Rows are found by their label in column A, so they can be moved. If the day list is blank or unreadable, the line is simply left out of the reply.

### 🚫 Request Cancellation
Students can cancel their own requests:
```
/cancelrequest requestid:REQ-12345678 reason:No longer needed
```

**Security features:**
- ✅ Can only cancel your own requests
- ✅ Cannot cancel if already ordered/received/complete
- ✅ Timestamps and audit trail in mentor notes
- ✅ Row turns gray when cancelled
- ✅ Status set to "🚫 Cancelled"

### 📦 Order Tracking
- `/openorders` – displays all non-received orders
- `/orderstatus requestid:REQ-xxxx` – detailed status for a request
- `/orderstatus orderid:ORD-xxxx` – detailed status for an order
- ETAs shown in human-readable format (e.g., "Dec 15, 2024")
- Tracking numbers displayed when available

### 📬 Receiving Parts (`/receive`)
*User story: "I'm a student on the receiving team. I open a box, get excited, and tell the person who ordered it: It's here! I need a quick way in Discord to record that it arrived and where I put it."*

```
/receive request:<start typing the part name or REQ ID> location:<bin or toolbox>
/receive request:REQ-a35de4bb student:@maya          # handed straight to a student
/receive request:REQ-a35de4bb location:BIN-001 qty:1  # fewer arrived than ordered
```
- **request** suggests approved/ordered requests as you type (part name, requester, or ID).
- **location** suggests entries from the **Locations** tab: subsystem bins, stock bins, toolboxes. Only listed locations are accepted, so typos like "UKNOWN" can't creep in. Pick **student** instead to record that a student has it (`STUDENT-<username>`).
- The bot posts a public **📦 It's here!** message that pings the requester.
- Behind the scenes: the request becomes 📦 Received (✅ In Inventory), the order gets its received date, the part is added to Inventory at that location, and the receipt is logged to the **Inventory Moves** tab.
- Optional: set `RECEIVING_ROLE_ID` in the bot's `.env` to limit `/receive` to a Discord role (server managers can always use it).
- If fewer arrived than ordered, the request is still marked Received and the reply says so; a mentor follows up on the rest.

### 🏠 Delivered to a Mentor's Home (`/delivered`)

> *"I am a student and would like to know when an order is received by a mentor (ships to home address) but has not been brought into the PumpkinBots shop to be moved into inventory."*

Many orders ship to a mentor's house. When the box arrives there, the mentor runs:

```
/delivered request:<start typing the part name or REQ ID>             # you have it
/delivered request:REQ-a35de4bb mentor:@other_mentor                  # someone else has it
```

- PartBot posts **🏠 Arrived at a mentor's home!** and pings the student who requested it.
- The request becomes **🏠 At Mentor (not in shop)** (blue row). Students see who has it in `/openorders` (listed first), `/orderstatus`, and the "Already on order" part of `/inventory`.
- It is **not** in inventory yet. When it's brought to the shop, a student uses `/receive` as usual, which adds it to inventory and records the shop location. In `/receive` suggestions it shows as `🏠 <mentor> · <part>`.
- Mentors can also pick 🏠 At Mentor in the sheet's status dropdown; it asks who has the package.
- Optional: set `MENTOR_ROLE_ID` in the bot's `.env` to limit `/delivered` to a Discord role (server managers can always use it).

### 📚 Inventory Lookup
```
/inventory search:hex bearing
/inventory search:BIN-002
/inventory sku:WCP-0783
```
Anyone can search. Every word must match somewhere in the SKU, part name, vendor, or location, so `hex bearing` finds "Flanged Bearing 1/2 Hex". In-stock items are listed first with quantity and location, and matching requests that are **already on order** are shown too. **Search before you request a part.**

### 🛠 Automated Workflow
1. Student submits `/requestpart` in Discord (optionally with specific SKU)
2. Apps Script creates request in Google Sheets
3. **User-provided SKU written immediately** (if specified)
4. **AI enrichment (Gemini)** extracts part details from URL
   - If user provided SKU → AI only fills Part Name and Price
   - If no user SKU → AI fills Part Name, SKU, and Price
5. System checks inventory for existing stock
6. Mentor reviews and approves in Google Sheets
7. **Student can cancel** using `/cancelrequest` (if not yet ordered)
8. Approved requests automatically moved to Orders sheet
9. Order status tracked until received
10. Denied requests flagged in `/openorders` for visibility

**Status workflow:**
- **📥 Submitted** → Initial request state
- **👀 Under Review** → Pending mentor review
- **✅ Approved** → Auto-creates order in Orders sheet
- **🛒 Ordered** → Tracking and ETA management
- **🏠 At Mentor (not in shop)** → Delivered to a mentor's home; `/receive` when it reaches the shop
- **📦 Received** → Auto-adds to inventory with location prompt
- **✔️ Complete** → Marks request as done, grays out row
- **❌ Denied** → Prompts for reason, highlights row red
- **🚫 Cancelled** → Student-initiated cancellation, grays out row

### 💵 Purchasing & Reimbursement Workflow (keeps the budget accurate)
A request counts as **PartBot pending** from the moment it's requested until it's marked reimbursed; after that it's in finance's **Spent**.

| # | Step | Who | Where | Budget effect |
|---|---|---|---|---|
| 1 | Request the part with `/requestpart`, picking **category** and **season** and linking the exact product page | Student | Discord | Counts as pending (if a price was found) |
| 2 | Make sure it has a price; type it in **Est Unit Price (M)** if blank (always for McMaster) | Mentor | Part Requests | No price = counts as $0. Typing M updates Total Est Cost (N) and the budget |
| 3 | Review: ✅ Approved or ❌ Denied | Mentor | Part Requests | Denied drops out of pending |
| 4 | Order it, set 🛒 Ordered | Mentor | Vendor, Part Requests | Still pending |
| 5 | Receive it, set 📦 Received → ✔️ Complete | Mentor | Part Requests | Still pending |
| 6 | Submit for reimbursement (receipts + BGCC check request form, emailed to finance and BGCC; see the budget sheet's "Expense Process" tab). **List the request IDs in the email.** | Purchaser | Email | No change |
| 7 | Log the expense in "2027 Detailed Expenses" (ideally with the request IDs in **Details**) | Finance | HMB Robotics budget sheet | Moves into **Spent**; counts twice until step 8 |
| 8 | Enter the date finance logged it in **Reimbursed (W)** for each request in that reimbursement | Mentor | Part Requests | Leaves pending; accurate again |

**Tips:** do step 8 soon after step 7 (the only time the budget is off, and it's always too high). Pending uses the estimated cost; finance records the actual amount with tax and shipping, so update Column M at order time if the real price differs a lot. Purchases made outside PartBot only appear once finance logs them. Category (U) decides which budget line a request counts against and can be corrected anytime. `/cancelrequest` removes a request from pending automatically.

---

## Architecture
```
Discord Slash Commands
        ↓
Node.js Discord Bot (bot.js)
  - Command handling (/requestpart with SKU, category, season; /budgetstatus; /cancelrequest, etc.)
  - User interaction
  - HTTP requests to Apps Script
  - SKU parameter extraction and validation
        ↓
Google Apps Script (apps-script/Code.js)
  - Request routing (doPost)
  - Database operations
  - User SKU handling (priority over AI)
  - Gemini API integration
  - Security checks (cancellation permissions)
        ↓
Google Sheets (Database)
  - Part Requests (pending items with user/AI SKUs, budget category, reimbursed date)
  - Orders (approved/ordered items)
  - Inventory (on-hand stock)
  - Budget (synced copy of the FRC Expenses lines + PartBot pending)
        ↑ hourly / on each Discord command
HMB Robotics budget spreadsheet (finance's ground truth, read-only)
  - Master ... Budget → FRC Expenses: Budget and Spent per line
        ↓
Google Gemini API (gemini-2.5-flash)
  - Part name extraction from URLs
  - SKU extraction (only if user didn't specify)
  - Price extraction
  - Intelligent fallbacks for Amazon/McMaster
```

---

## Repository Structure
```
8793PartBot/
│
├── discord-bot/
│   ├── bot.js                    # Main Discord bot (with SKU field support)
│   ├── shared-constants.js       # Shared API constants
│   ├── package.json
│   ├── package-lock.json
│   └── .env                      # Local/VM secrets; not committed
│
├── apps-script/
│   ├── Code.js                   # Main bound Apps Script
│   ├── .clasp.json               # Apps Script project mapping
│   └── appsscript.json           # Apps Script manifest
│
├── CLAUDE.md
├── LICENSE
└── README.md                     # This file
```

The repository does not currently include `.env.example` or `SharedConstants.gs`; update this tree when those files are added.

---

## Command Reference

### `/requestpart` - Submit New Request
```
/requestpart 
  subsystem:Drive           # Required: Drive, Intake, Shooter, etc.
  category:Robot Part       # Required: Robot Part, Field Piece, Tool, Supply, Marketing/Spirit
  season:In-season          # Required: In-season or Off-season
  link:https://...          # Optional: Vendor URL (triggers AI enrichment)
  sku:WCP-0785              # Optional: Exact SKU (overrides AI detection) ⭐ NEW!
  qty:2                     # Optional: Quantity (default: 1)
  priority:High             # Optional: Critical, High, Medium, Low
  notes:"For prototype"     # Optional: Additional context
```

**What happens:**
1. Request created in Google Sheets
2. **User SKU written immediately** (if provided)
3. AI enrichment extracts part name, SKU (if not user-specified), price from URL
4. Notification sent to Discord procurement channel
5. Discord shows: `SKU: **WCP-0785** (user-specified)` if you provided it
6. Request ID returned (e.g., REQ-12345678)
7. Discord shows what's left in the request's budget line after this purchase
8. Discord shows which days mentors review and place orders (from the **Settings** tab)

### `/budgetstatus` - FRC Budget
```
/budgetstatus
```
Only you see the reply (it isn't posted to the channel). Starts with the FRC total (budget, total spent = logged by finance + pending in PartBot, remaining in dollars and percent), then every line under **FRC Expenses** in the HMB Robotics budget sheet (Competition Registration, Travel & Food, Robot Hardware & Field Pieces, Marketing/Spirit, Tools & Supplies, plus any line finance adds) with budget, spent, pending, and remaining.

**SKU field behavior:**
- **With SKU:** `sku:WCP-0785` → Guaranteed correct, AI skips SKU extraction
- **Without SKU:** AI attempts to extract SKU from product page
- **Multi-variant pages:** Always specify SKU to avoid wrong variants

**Examples:**
```bash
# Exact SKU for multi-variant page (recommended for WCP, McMaster)
/requestpart subsystem:Drive category:Robot Part season:In-season link:https://wcproducts.com/products/ball-bearings sku:WCP-0785 qty:4

# Let AI detect SKU (works well for single-product pages)
/requestpart subsystem:Intake category:Robot Part season:In-season link:https://www.revrobotics.com/rev-21-1650/ qty:2

# No link, no SKU (manual entry by mentor)
/requestpart subsystem:Electrical category:Supply season:In-season notes:"5mm LED, red" qty:10
```

### `/cancelrequest` - Cancel Your Request
```
/cancelrequest 
  requestid:REQ-12345678    # Required: Your request ID
  reason:No longer needed   # Optional: Reason for cancellation
```

**Security:**
- Can only cancel your own requests
- Cannot cancel if status is Ordered, Received, or Complete
- Audit trail preserved in mentor notes
- Row turns gray, status becomes "🚫 Cancelled"

**Example:**
```
/cancelrequest requestid:REQ-a1b2c3d4 reason:Found alternative part
```

### `/inventory` - Search Inventory
```
/inventory search:hex bearing        # All words must match (name, SKU, vendor, location)
/inventory search:BIN-001            # Everything in a location
/inventory sku:WCP-0783              # Exact SKU lookup
```

**Returns:** quantity on hand, part name, location(s), SKU (up to 15, in stock first), plus matching requests already on order.

### `/receive` - Record a Delivery
```
/receive request:REQ-xxxx location:BIN-001 [qty:N]
/receive request:REQ-xxxx student:@name [qty:N]
```
See [Receiving Parts](#-receiving-parts-receive).

### `/delivered` - Arrived at a Mentor's Home
```
/delivered request:REQ-xxxx [mentor:@name]
```
See [Delivered to a Mentor's Home](#-delivered-to-a-mentors-home-delivered).

### `/openorders` - View Pending Orders
```
/openorders                          # Shows all non-received orders
```

**Displays:**
- Up to 15 open orders (not yet received)
- Up to 15 denied requests
- Order IDs, vendors, SKUs, status, ETAs

### `/orderstatus` - Check Status
```
/orderstatus requestid:REQ-1fd8b811  # Request details
/orderstatus orderid:ORD-a2b3c4d5    # Order details
```

**Request status shows:**
- Current status (Submitted, Approved, Ordered, etc.)
- Part details including user-specified or AI-detected SKU
- Linked orders (if any)

**Order status shows:**
- Order date
- ETA
- Tracking number
- Current status

---

## Troubleshooting

### SKU Field Not Appearing in Discord

**Problem:** `/requestpart` command doesn't show `sku` option

**Solution:**
```bash
# On your VM:
cd ~/8793PartBot/discord-bot

# Verify SKU field is in bot.js code
grep -n "setName('sku')" bot.js
# Should show 2 lines: one in /requestpart, one in /inventory

# Delete and re-register commands
pm2 delete discord-bot
pm2 start bot.js --name discord-bot
pm2 save

# Completely quit and reopen Discord
# (or use Discord in incognito browser)
```

### User SKU Not Being Saved

**Problem:** User specifies SKU but it doesn't appear in Google Sheets

**Check Apps Script Code.gs:**
1. Line ~191 in `handleDiscordRequest_` should have:
   ```javascript
   sku: body.sku || '',
   ```

2. Line ~243 in `createPartRequest_` should have:
   ```javascript
   if (data.sku) {
     sheet.getRange(nextRow, PART_REQUESTS_COLS.SKU).setValue(data.sku);
   }
   ```

3. Verify `PART_REQUESTS_COLS.SKU` points to correct column (usually column 6 = F)

4. Check Execution logs: Extensions → Apps Script → Executions
   - Look for: `[createPartRequest_] User provided SKU: WCP-0785`

### AI Not Extracting SKU (When User Doesn't Provide One)

**Problem:** AI enrichment fills Part Name but not SKU

**Common causes:**
1. **Multi-variant pages:** Use user SKU field instead
2. **Page fetch failed:** Check Execution logs for HTTP errors
3. **Gemini rate limit:** Free tier = 15 requests/minute
4. **Complex page structure:** Some vendor pages are hard to parse

**Solutions:**
- For multi-variant pages: Always use `sku:WCP-XXXX` parameter
- For single-product pages: Check Execution logs for specific errors
- Manual enrichment: Select row → **🎃 PartBot → ✨ Enrich Part Request**

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

### "Error from Sheets" Message
1. Check Apps Script **Executions** log (clock icon in Apps Script editor)
2. Look for errors in the execution details
3. Verify deployment is set to "Anyone" can access
4. Test Apps Script URL in browser (should show "OK FROM FRC PURCHASING WEB APP")

### "Request not found" Error (when canceling)
1. Verify request ID is correct (case-insensitive)
2. Check that request exists in Part Requests sheet
3. Run **🎃 PartBot → ⚙️ Setup Dropdown Workflow** to ensure validation includes Cancelled status

### Dropdown Validation Error
**Error:** "The data you entered in cell Q18 violates the data validation rules..."

**Fix:**
1. Run **🎃 PartBot → ⚙️ Setup Dropdown Workflow** in Google Sheets
2. This adds "🚫 Cancelled" to the allowed status values

---

## Best Practices

### When to Use the SKU Field

**✅ Always use SKU for:**
- Multi-variant product pages (WCP ball bearings, McMaster hardware)
- Parts with multiple size/color/type options on one page
- When you know the exact part number
- Critical parts where wrong variant = project failure

**⚠️ Optional for:**
- Single-product vendor pages (most REV/AndyMark products)
- Parts where AI can easily determine the SKU
- Prototyping parts where exact variant doesn't matter

**❌ Don't use SKU for:**
- Requests without a vendor link
- Generic part descriptions ("need M5 bolts")

**Examples:**

```bash
# GOOD: Multi-variant page with specific SKU
/requestpart subsystem:Drive category:Robot Part season:In-season link:https://wcproducts.com/products/ball-bearings sku:WCP-0785 qty:4

# GOOD: Single-product page, let AI detect
/requestpart subsystem:Intake category:Robot Part season:In-season link:https://www.revrobotics.com/rev-21-1650/ qty:2

# GOOD: McMaster with known part number
/requestpart subsystem:Mechanical category:Robot Part season:In-season link:https://mcmaster.com/93475A230/ sku:93475A230 qty:20

# BAD: Generic request (use notes instead)
/requestpart subsystem:Electrical category:Supply season:In-season notes:"Red 5mm LEDs" qty:10
```

---

## Roadmap

### Recently Added Features ✅
- [x] User SKU override field (December 2024) ✅
- [x] Student self-service cancellation ✅
- [x] AI enrichment with Gemini API ✅
- [x] Location-based inventory search ✅
- [x] Live FRC budget from the HMB Robotics budget sheet: `/budgetstatus`, per-line remaining on `/requestpart`, Reimbursed tracking (November 2026) ✅
- [x] Reliable WCP/Shopify price extraction and 💲 Fill Missing Prices (November 2026) ✅

### Planned Features
- [ ] Vendor API integrations (REV, AndyMark direct ordering)
- [ ] Automatic cart building
- [ ] Inventory QR code scanning (mobile app)
- [ ] Spending analytics (by subsystem, season, vendor)
- [ ] Web dashboard for mentors
- [ ] Predictive part ordering based on historical data
- [ ] Multi-team support
- [ ] Automated reorder points for consumables
- [ ] SKU validation against vendor databases

### Known Issues
- Gemini occasionally returns incomplete data for complex product pages
  - **Workaround:** Use `sku` parameter for multi-variant pages
- Date formatting varies by locale
- Rate limiting on Gemini API (15 requests/minute on free tier)
- McMaster-Carr pages load prices with JavaScript, so PartBot can't read them
  - **Workaround:** a mentor types the price in Est Unit Price (Column M)
- Prices for `?variant=` links use the product's default price, so treat them as estimates

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
npm ci
# Create .env with: DISCORD_TOKEN, CLIENT_ID, GUILD_ID, APPS_SCRIPT_URL, PARTBOT_SECRET (optional: RECEIVING_ROLE_ID, MENTOR_ROLE_ID)
node bot.js
```

### Deploying
**Discord bot (VM):** the VM runs a clone of this repo at `~/8793PartBot/discord-bot` under PM2. No token is needed to pull (the repo is public; never put a token in the remote URL).
```bash
cd ~/8793PartBot && git pull
cd discord-bot && npm ci
pm2 restart discord-bot
pm2 logs discord-bot --lines 15 --nostream   # expect "Slash commands registered" and "Logged in"
```
Slash commands re-register on startup.

**Shared secret:** the bot sends `PARTBOT_SECRET` from its `.env` with every call, and the web app rejects calls without it once the Apps Script Script Property `PARTBOT_SECRET` holds the same value. Set it in both places (Project Settings → Script Properties in the Apps Script editor); never commit it. If Discord commands start replying "Unauthorized", the two values don't match.

**Apps Script:** deployed with [clasp](https://github.com/google/clasp) from `apps-script/`.
1. Check the live project hasn't been edited in the browser since the last push: `clasp pull` into a scratch folder (copy `.clasp.json` there) and diff against `Code.js`. Bring any browser edits into git first.
2. `clasp push` updates the code the spreadsheet runs (menus, onEdit, triggers).
3. Discord calls a versioned **web-app deployment**, so also update it in place: `clasp deployments` to find the active one, then `clasp deploy -i <deploymentId> -d "<description>"`. The URL stays the same.

**First-time budget setup:** run `syncBudget` once from the Apps Script editor as the account that owns the web-app deployment (approves access to the budget sheet and creates the hourly sync trigger), then **🎃 PartBot → ⚙️ Setup Dropdown Workflow** for the Category / Build Season / Reimbursed columns.

---

## Maintainers

**FRC Team 8793 – Pumpkin Bots**  
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
- **Google** for Gemini 2.5 Flash API powering part enrichment
- **Google** for Apps Script and Sheets infrastructure
- **Discord** for the platform and excellent API
- **FRC vendor community** (REV, AndyMark, WCP, VEX) for supporting robotics education
- **FRC Team 8793 students** (especially Tyler H. for the SKU field feature request!) for testing and feedback

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
