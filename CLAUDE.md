# 8793PartBot — Project Context

Handoff context for feature development. Treat this as project guidance, but verify behavior against the checked-in source before changing it. The local checkout was clean on `main` at commit `87694fc` when this file was created; re-check git state before working or deploying.

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
Google Sheets — Part Requests / Orders / Inventory / Budget

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

The README and older handoffs may describe `Code.gs`, `SharedConstants.gs`, `.env.example`, or `check-commands.js`; those files were not present in the checked-out tree when this file was written. The tracked Apps Script source is `Code.js`. Verify how that maps to the live Apps Script project before pushing or copying code. `apps-script/.clasp.json` already exists; inspect it and confirm its target rather than cloning over it.

## Environments and Deployment

- **Discord bot VM:** `pumpkinbots@partbot`, working directory `~/8793PartBot/discord-bot/`, PM2 process `discord-bot`.
- **Bot deployment:** commit and push locally, then on the VM pull the intended commit, restart `discord-bot`, and verify command registration in Discord.
- **Apps Script:** project is bound to the spreadsheet. Updates have historically been copied into the browser editor. The repository now contains `.clasp.json`; verify the target and establish a safe `clasp status` / push workflow before changing how deployment is done. If `doPost` changes, deploy a new web-app version and confirm the bot points to the active deployment URL.
- **Spreadsheet:** `8793 FullInventory and PartPurchasing`.

Before pulling on the VM, check both the worktree and local-only commits. A past SKU-field debugging session was caused by a local commit that had not been pushed:

```bash
git status
git log --oneline origin/main..HEAD
```

Do not assume a local feature is deployed merely because it works in the local checkout. After bot changes, verify the registered Discord command schema; `check-commands.js` was not present in the verified checkout, so do not assume that helper exists.

## Secrets

Never commit credentials or paste them into chat.

- `discord-bot/.env` on the VM: Discord token, client ID, guild ID, and Apps Script web-app URL.
- Apps Script Script Properties: `GEMINI_API_KEY` and optional Discord webhook URL / role ID.
- `.env.example` was not present in the verified checkout; update setup docs or add a sanitized example when appropriate.

## Discord Commands and API

The verified `bot.js` registers these guild-scoped commands through `Routes.applicationGuildCommands`:

- `/requestpart`: subsystem, optional product link, SKU, quantity, max budget, priority, and notes
- `/cancelrequest`: request ID and optional reason
- `/inventory`: exact SKU or keyword search
- `/orderstatus`: request ID or order ID
- `/openorders`: pending orders and denied requests

`/budgetstatus` is described in some handoff material but was **not** registered in the verified bot source. Apps Script does include a `budgetStatus` action/handler; keep the distinction clear when changing docs or implementation.

Apps Script `doPost` actions include `health`, `discordRequest`, `inventory`, `orderStatus`, `openOrders`, `cancelRequest`, and `budgetStatus`. `shared-constants.js` contains action/field constants and validation helpers, but no corresponding `SharedConstants.gs` was present in the Apps Script directory at verification. Keep the actual bot and Apps Script contract synchronized when adding or changing actions.

## Data Model

**Part Requests (A–T):** Request ID | Timestamp | Requester | Subsystem | Part Name | SKU | Part Link | Quantity | Priority | Needed By | Inventory On-Hand | Vendor Stock | Est Unit Price | Total Est Cost | Max Budget | Budget Status | Request Status (Q) | Mentor Notes (R) | Expedited Shipping | In Inventory (T)

**Orders (A–O):** Order ID | Included Request IDs | Vendor | Part Name | SKU | Qty Ordered | Final Unit Price | Total Cost | Order Date | Shipping Method | Tracking | ETA | Received Date | Order Status | Mentor Notes

**Inventory (A–I):** SKU | Vendor | Part Name | Location | Qty On-Hand | Reorder Threshold | Usage Rate | Last Count Date | Notes

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

## Local Reimbursement Report

Reimbursement generation is a local Mac CLI in `reimbursement-local/`; do not add it to the PartBot sheet menu or Apps Script web app. It uses only invoice PDFs in a folder: no Sheets, Gmail, or OAuth.

- Run `cd reimbursement-local && npm install` then `npm test`.
- Run `npm run report -- --receipt-dir <folder>`. `src/invoice.js` extracts each PDF's text (pdfjs-dist), suggests a description and amount (grand/order/total-due labels, then largest dollar amount flagged low-confidence), and the user confirms or edits each line. Image-only PDFs need manual entry. Max 6 lines (template limit); skipped PDFs are left out. Existing `FDILL_Receipts_*.pdf` bundles are ignored.
- Output is a new `Submitted_<YYYY-MM-DD>_<original invoice folder name>[_NN]` folder under the expenses root (override with `--output`), containing the filled `.xlsx` (default template from the prior submission, `--template` to override), a same-name-stem printable PDF preview generated directly from the form values, a receipts-only combined PDF, and numbered individual PDFs. The preview does not require Numbers and does not reproduce the spreadsheet's exact styling. Existing folders are never overwritten. Nothing is emailed or submitted.
- After actually submitting, run `npm run mark-submitted -- --report <folder>`; those PDFs (by SHA-256) are skipped on later runs unless `--include-submitted`.
- Form output: clears all six example rows, writes Total Due as a numeric value (not a formula; `=SUM` broke in Google Sheets), and strips Google custom workbook metadata for Numbers compatibility.

See `reimbursement-local/README.md` for command details.

### 1. OnShape BOM integration (designed)

- **Phase 1 — CSV import:** `🎃 PartBot → 📥 Import BOM from CSV`. Columns: `Part Number, Description, Quantity, Vendor, Link, Notes`. Add subsystem and vendor detection, duplicate detection, and batch creation with one timestamp.
- **Phase 2 — Google Sheets bridge:** OnShape exports BOM to a dedicated sheet; script watches for new rows.
- **Phase 3 — OnShape API:** requires Education/Enterprise API access.
- **Phase 4 — CAD-to-inventory installed tracking.**
- Students have been asked to add OnShape custom properties: Part Number, Vendor, Vendor Link, Description, Subsystem.
- Vendor prefixes: WCP, REV, AM, VEX, McMaster, CTRE.
- Target: ready by season kickoff.

## Working Conventions

- Keep Discord bot and Apps Script action names, request fields, response fields, and validation rules in sync.
- Prefer read-only formulas and formatting over editable controls for status shown to students.
- For each new sheet column, update column constants, the README column list, and this file.
- Update `README.md` alongside feature changes; credit students who request features.
- Test end-to-end from Discord after changes touching both the bot and Apps Script.
- Be explicit about what was tested locally versus deployed to the live VM or Apps Script project.
