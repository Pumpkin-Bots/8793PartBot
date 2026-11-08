# 8793PartBot — Project Context

Handoff context for feature development. Treat this as project guidance, but verify behavior against the checked-in source before changing it. Re-check git state (and the live Apps Script, see below) before working or deploying.

## What This Is

PartBot is the parts-procurement system for **FRC Team 8793 (Pumpkin Bots)** in Half Moon Bay, California. Students request parts in Discord, mentors approve requests in Google Sheets, and the system tracks each part from request through order, receipt, and inventory.

- **Owner / lead mentor:** Franz Dill (Discord: `franz_ee`)
- **Users:** high-school students (requesters) and mentors (approvers)
- **Design principle:** design for students first. Student-facing UI should not make a control look like an action students are expected to take unless it is one.

## Architecture

```text
Discord slash commands
        |
        v
Node.js Discord bot (discord-bot/bot.js) — GCP VM, managed by PM2
  - Registers guild-scoped commands
  - Handles interactions and POSTs to Apps Script
        |
        v
Google Apps Script web app (tracked locally as apps-script/Code.js)
  - doPost() routes on body.action
  - Reads and writes Google Sheets
  - Enriches product details with Gemini
  - Handles onEdit status workflow, menus, and formatting
        |
        v
Google Sheets — Part Requests / Orders / Inventory / Budget / Settings

Google Gemini API (gemini-2.5-flash)
  - Extracts part name, SKU, and price from product pages
  - Includes fallbacks for Amazon and McMaster-Carr
```

## Repository Layout

Verified in the local checkout:

```text
8793PartBot/
├── discord-bot/
│   ├── bot.js
│   ├── shared-constants.js
│   ├── package.json
│   └── package-lock.json
├── apps-script/
│   ├── .clasp.json
│   ├── Code.js
│   └── appsscript.json
├── LICENSE
├── README.md
└── CLAUDE.md
```

Older handoffs may describe `Code.gs`, `SharedConstants.gs`, `.env.example`, or `check-commands.js`; none are in this repo (`check-commands.js` exists only on the VM, untracked). The tracked Apps Script source is `Code.js`, mapped to the live project by `apps-script/.clasp.json`. The bot's `.env` needs `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `APPS_SCRIPT_URL`, `PARTBOT_SECRET`.

## Environments and Deployment

- **Discord bot VM:** `pumpkinbots_hmbrobotics_org@discord-bot-vm`, working directory `~/8793PartBot/discord-bot/`, PM2 process `discord-bot`.
  Until 2026-11-07 the VM ran a clone of the personal repo `pureh2oo/8793PartBot` (bot.js at the repo root, with uncommitted edits), not this repo. It was moved to a clone of `Pumpkin-Bots/8793PartBot`; the old folder is kept as `~/8793PartBot-personal` for rollback. Never embed tokens in the VM's git remote URL; this repo is public and pulls need none.
- **Bot deployment:** commit and push locally, then on the VM pull the intended commit, restart `discord-bot`, and verify command registration in Discord.
- **Apps Script:** bound to the spreadsheet and deployed with clasp (logged in as the pumpkinbots account). Before every `clasp push`, `clasp pull` into a scratch folder and diff against the committed `Code.js`; the live project was once ~180 lines ahead of git from browser-editor edits. After pushing, update the existing web-app deployment in place (`clasp deployments`, then `clasp deploy -i <id>`) so the bot's URL doesn't change. The web app runs as the deploying user with anonymous access, so don't publish the deployment ID or URL in this public repo.
- **Budget access:** the deploying account must be able to read the HMB Robotics budget spreadsheet; run `syncBudget` once from the editor as that account to approve access and create the hourly trigger.
- **Spreadsheet:** `8793 FullInventory and PartPurchasing`.

Before pulling on the VM, check both the worktree and local-only commits. A past SKU-field debugging session was caused by a local commit that had not been pushed:

```bash
git status
git log --oneline origin/main..HEAD
```

Do not assume a local feature is deployed merely because it works in the local checkout. After bot changes, verify the registered Discord command schema (commands re-register on startup). The bot's dependencies must all be in `discord-bot/package.json`: the VM installs with `npm ci`, and `dotenv` was once missing because it had been installed by hand.

## Secrets

Never commit credentials or paste them into chat.

- `discord-bot/.env` on the VM: Discord token, client ID, guild ID, Apps Script web-app URL, and `PARTBOT_SECRET`.
- Apps Script Script Properties: `GEMINI_API_KEY`, `PARTBOT_SECRET`, and optional Discord webhook URL / role ID.
- `doPost` rejects every action except `health` unless `body.secret` equals the `PARTBOT_SECRET` property (not enforced while the property is unset). All bot calls go through `postToAppsScript()`, which attaches it.
- `.env.example` was not present in the verified checkout; update setup docs or add a sanitized example when appropriate.

## Discord Commands and API

The verified `bot.js` registers these guild-scoped commands through `Routes.applicationGuildCommands`:

- `/requestpart`: subsystem, category, season (required), optional product link, SKU, quantity, priority, and notes (the max budget option was removed 2026-11-08; column O is no longer filled)
- `/budgetstatus`: FRC total (budget, spent, remaining $ and %) followed by every FRC Expenses line, posted to the channel, via the `budgetStatus` action. It replaced a separate `/requestbudget` command.
- `/cancelrequest`: request ID and optional reason
- `/inventory`: exact SKU or keyword search
- `/orderstatus`: request ID or order ID
- `/openorders`: pending orders and denied requests

Apps Script `doPost` actions include `health`, `discordRequest`, `inventory`, `orderStatus`, `openOrders`, `cancelRequest`, and `budgetStatus`. `shared-constants.js` contains action/field constants and validation helpers, but no corresponding `SharedConstants.gs` was present in the Apps Script directory at verification. Keep the actual bot and Apps Script contract synchronized when adding or changing actions.

## Data Model

**Part Requests (A–W):** Request ID | Timestamp | Requester | Subsystem | Part Name | SKU | Part Link | Quantity | Priority | Needed By | Inventory On-Hand | Vendor Stock | Est Unit Price | Total Est Cost | Max Budget | Budget Status (P) | Request Status (Q) | Mentor Notes (R) | Expedited Shipping | In Inventory (T) | Category (U) | Build Season (V) | Reimbursed (W)

**Orders (A–O):** Order ID | Included Request IDs | Vendor | Part Name | SKU | Qty Ordered | Final Unit Price | Total Cost | Order Date | Shipping Method | Tracking | ETA | Received Date | Order Status | Mentor Notes

**Inventory (A–I):** SKU | Vendor | Part Name | Location | Qty On-Hand | Reorder Threshold | Usage Rate | Last Count Date | Notes

**Settings (label in A, value in B):** `Ordering Mode` (In-season / Off-season dropdown), `In-season Order Days`, `Off-season Order Days` (comma-separated weekdays). Read by `getOrderSchedule_()`, which finds rows by label and creates the tab with defaults via `ensureSettingsTab_()` if missing. The `/requestpart` reply shows the current mode's days (`orderSchedule` in the `discordRequest` response, formatted by `formatOrderSchedule` in `bot.js`); the student's season option does not affect it.

IDs use `REQ-xxxxxxxx` and `ORD-xxxxxxxx` formats. Verify column constants against the live sheet before adding or moving columns.

## Request Status Workflow

Driven by `onEdit` in the Part Requests status column:

```text
Submitted -> Under Review -> Approved (creates Orders row)
          -> Ordered -> Received (adds to Inventory; prompts for location)
                     -> Complete
          -> Denied (prompts for reason)
          -> Cancelled (student-initiated)
```

Denied rows are highlighted red; cancelled rows gray. Received rows are green when added to inventory and yellow when missing from inventory.

## Budget

Ground truth is the finance spreadsheet **HMB Robotics 2027 Budget** (ID in `FINANCE_BUDGET` in `Code.js`), tab matching `Master ... Budget`. It holds donor names and other private data; only the FRC Expenses lines are read, and nothing from it belongs in the repo.

- PartBot reads every labeled line in the `FRC Expenses` section (Budget = column B, Spent = column C), stopping at the next `... Expenses` header. Requests count only against `BUDGET_LINES` (Robot Hardware & Field Pieces, Tools & Supplies, Marketing/Spirit), which must exist; other lines (Competition Registration, Travel & Food) are reported from finance only. The budget year comes from the title, e.g. `(9/1/26-8/31/27)`.
- Budget tab: note in A6, header row 7, one row per FRC line from row 8, then `FRC Total`. Sync inserts or clears rows as the line count changes, so mentor rows below ("Budget Links") are never overwritten.
- `syncFinanceBudget_()` copies those into the PartBot **Budget** tab (script-owned layout). It runs on Discord `discordRequest`/`budgetStatus`, hourly (`syncBudget` trigger), and from the menu. Everything else reads the Budget tab, because the `onEdit` simple trigger cannot open another spreadsheet.
- Remaining per line = Budget − finance Spent − PartBot pending. Pending = budget-year requests not Cancelled/Denied and with **Reimbursed (W)** blank. Mentors fill W when finance logs the expense, to avoid double counting.
- Category (U) maps to a line via `BUDGET_CATEGORIES`; blank (older rows) counts as Robot Hardware. Build Season (V) is recorded for reporting only.
- The web app runs as the deploying user, so that account needs Viewer access to the finance spreadsheet.
- `getValues()` rows stop at the sheet's last used column, so a new trailing column (like W) can read as `undefined`, not `''`. Use `isReimbursed_()`-style checks; this once marked every request as reimbursed.
- Purchasing and reimbursement workflow (keeps the numbers accurate) is documented in the README; the key mentor duty is entering the Reimbursed date (W) once finance logs an expense.

## Implemented Behavior to Preserve

### SKU handling

A user-supplied SKU is written to the sheet immediately and takes priority over AI extraction. Gemini should fill only Part Name and Price when a SKU was supplied; without one, it may fill Part Name, SKU, and Price. The SKU override was requested by student Tyler H.

### In Inventory indicator (column T)

This is a read-only formula, not a checkbox. Checkboxes looked like a workflow step students should perform and were easy to toggle accidentally. The formula depends on the Mentor Notes text `added to inventory`; keep that phrase stable or update the formula and related workflow together.

```text
=IF(OR(Q2="📦 Received", Q2="✔️ Complete"), IF(REGEXMATCH(R2, "added to inventory"), "✅", "⚠️"), "")
```

`fixInventoryColumnValidation()` was identified as the repair helper after the checkbox-to-formula change: it clears validation on column T, resets it to plain text, and reapplies formulas. Confirm it exists in the current Apps Script source before relying on it; function presence can vary across local and live versions.

The `🎃 PartBot` sheet menu includes `📦 Retry Add to Inventory` and `🔍 Find Missing Inventory Items`.

### 1. OnShape BOM integration (designed)

- **Phase 1 — CSV import:** `🎃 PartBot → 📥 Import BOM from CSV`. Columns: `Part Number, Description, Quantity, Vendor, Link, Notes`. Add subsystem and vendor detection, duplicate detection, and batch creation with one timestamp.
- **Phase 2 — Google Sheets bridge:** OnShape exports BOM to a dedicated sheet; script watches for new rows.
- **Phase 3 — OnShape API:** requires Education/Enterprise API access.
- **Phase 4 — CAD-to-inventory installed tracking.**
- Students have been asked to add OnShape custom properties: Part Number, Vendor, Vendor Link, Description, Subsystem.
- Vendor prefixes: WCP, REV, AM, VEX, McMaster, CTRE.
- Target: ready by season kickoff.

### Concurrency and idempotency

- Row-appending writes (`createPartRequest_`, `handleApproved`, `addToInventory`) run under `withScriptLock_()` and write the row with one `setValues`, so simultaneous requests can't share a row.
- Setting Approved again doesn't create a second order if one already lists the request ID. Setting Received again keeps the first received date and doesn't re-add inventory when Mentor Notes already say `added to inventory`. These guards were added after duplicate orders appeared in 2026.
- New request rows copy row 2's data validation and get the In Inventory formula (`applyRequestRowDefaults_`).
- Enrichment never overwrites an existing Est Unit Price, and the vendor page's price metadata takes precedence over Gemini's reading.
- `/cancelrequest` is refused once a request is Approved, because an order row already exists.

## Working Conventions

- Keep Discord bot and Apps Script action names, request fields, response fields, and validation rules in sync.
- Prefer read-only formulas and formatting over editable controls for status shown to students.
- For each new sheet column, update column constants, the README column list, and this file.
- Update `README.md` alongside feature changes; credit students who request features.
- Test end-to-end from Discord after changes touching both the bot and Apps Script.
- Be explicit about what was tested locally versus deployed to the live VM or Apps Script project.
