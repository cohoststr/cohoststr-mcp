# CohostSTR — MCP server for Guesty

[![npm version](https://img.shields.io/npm/v/cohoststr-mcp)](https://www.npmjs.com/package/cohoststr-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An open-source, write-capable MCP (Model Context Protocol) server for [Guesty](https://guesty.com) property management. Connect any MCP-compatible AI client (Claude, ChatGPT, Copilot, Cline) to your Guesty account — manage reservations, communicate with guests, track finances, update pricing.

**Live now:** all 43 Guesty tools, free — reservations, listings, guests, calendars, guest messaging, financial reports, pricing and listing writes, operations, reviews, webhooks, and IoT/property-health. No license key, no paid tier.

**Why MCP:** Guesty is one of the larger PMS platforms in the short-term-rental space and no MCP integration existed. Every major PMS will need one.

**Built and run in production** on our own short-term rental portfolio. Node.js + MCP SDK + Express, MIT licensed. Things we learned: Guesty's `/reservations` endpoint only returns future data (we use the calendar endpoint for historical), and the SSE transport doesn't run on Vercel serverless (expected). **All 43 Guesty tools free.**

Full tool surface: **44 tools registered, all free** — 43 Guesty tools (23 read-only, 16 write/guest-messaging including `get_conversations` and `draft_guest_reply`, and 4 IoT/property-health) plus `get_license_info`, which reports this server's own licensing state and makes no Guesty API call. **There are no paid tiers.** `GUESTY_MCP_LICENSE_KEY` is optional and does not change what you can call.

> **Everything is free.** All 43 Guesty tools work with no license key. Paid-prefix keys are still recognized (they show up in `get_license_info`) but are not required and unlock nothing extra — there is nothing extra to unlock. Set or omit `GUESTY_MCP_LICENSE_KEY`; access is the same either way.

## Quick Start

```bash
npx cohoststr-mcp
```

Or add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "guesty": {
      "command": "npx",
      "args": ["-y", "cohoststr-mcp"],
      "env": {
        "GUESTY_CLIENT_ID": "your-client-id",
        "GUESTY_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

## Get Guesty API Credentials

1. Log into [Guesty Dashboard](https://app.guesty.com)
2. Go to **Settings > API** (or Marketplace > API Credentials)
3. Create an API application with `open-api` scope
4. Copy your **Client ID** and **Client Secret**

## All 43 Guesty Tools

### Reservations & Guests
| Tool | Description |
|------|-------------|
| `get_reservations` | Fetch reservations with filters (dates, listing, status, guest) |
| `create_reservation` | Create direct bookings (website to Guesty) |
| `update_reservation` | Update reservation status, dates, guest info, or add notes |
| `search_reservations` | Search by guest name, email, or confirmation code |
| `get_reservation_financials` | Detailed financial breakdown for a reservation |
| `create_reservation_note` | Add internal notes to a reservation |
| `get_guests` | Search guest database by name or email |
| `get_guest_by_id` | Get detailed guest profile |

### Listings & Calendar
| Tool | Description |
|------|-------------|
| `get_listing` | Get property details or list all properties |
| `update_listing` | Update title, description, amenities, min nights, max guests |
| `get_calendar` | Check availability and pricing by date |
| `update_calendar` | Block/unblock dates, set minimum nights |
| `get_calendar_blocks` | Get blocked dates with reasons |
| `get_listing_occupancy` | Calculate occupancy rate over a date range |
| `get_photos` | Fetch listing photos with captions |
| `update_photos` | Replace or reorder listing photos |

### Messaging
| Tool | Description |
|------|-------------|
| `get_conversations` | Fetch guest message history |
| `send_guest_message` | Send messages to guests in conversations |

### Financials & Pricing
| Tool | Description |
|------|-------------|
| `get_financials` | Revenue, payouts, and commission data |
| `update_pricing` | Update base price or date-specific pricing |
| `get_listing_pricing` | Get base price, discounts, and fee details |
| `update_listing_pricing` | Update base price, cleaning fee, discounts |
| `get_owner_statements` | Owner revenue statements and reports |
| `get_expenses` | Track operational expenses |
| `create_expense` | Create new expense records |
| `get_revenue_summary` | Aggregated revenue across all listings |

### Operations
| Tool | Description |
|------|-------------|
| `get_tasks` | Fetch cleaning and maintenance tasks |
| `create_task` | Create cleaning or maintenance tasks |
| `get_reviews` | Fetch guest reviews from all channels |
| `respond_to_review` | Post responses to guest reviews |
| `get_channels` | List connected booking channels per property |
| `get_supported_languages` | Get supported languages for a listing |

### Automation & Integrations
| Tool | Description |
|------|-------------|
| `get_automation_rules` | List automation and workflow rules |
| `get_webhooks` | List registered webhooks |
| `create_webhook` | Register new webhook for event notifications |
| `delete_webhook` | Remove a registered webhook |
| `get_custom_fields` | Fetch custom fields for listings or reservations |
| `get_account_info` | Get account info and subscription details |

### Server & Licensing
| Tool | Description |
|------|-------------|
| `get_license_info` | Report this MCP server's own licensing state — every tool is currently free; lists the tool ledger and whether a key was detected. Makes no Guesty API call. |

It is counted in the 44 registered tools but **not** in the "43 Guesty tools" figure, because it reports our licensing state rather than doing anything with your Guesty account: 43 Guesty tools + this one = 44.

### IoT & Property Health
| Tool | Description |
|------|-------------|
| `get_readiness_score` | Composite turnover-readiness score for a property from cleaning, maintenance, and IoT signals |
| `get_property_health` | Aggregate health signal per property: reservation status, open maintenance alerts, review-score, last-clean timestamp, IoT hub status |
| `submit_checkout_photos` | Accept post-checkout photo uploads and log them to the property's maintenance/cleaning record |
| `get_maintenance_alerts` | List or filter open maintenance alerts for a property or portfolio |

These four tools are free like everything else. They read the local IoT database (`IOT_DB_PATH`) that the optional webhook receiver (`src/webhook/iot-receiver-server.js`) populates. With no devices reporting they return empty device and alert lists, a low readiness score that names each missing signal, and null IoT fields in the health snapshot — not errors — and the Guesty-side fields still fill in.

## Use Cases

- **Guest Communication**: guest-messaging tools draft and send replies grounded in real reservation data
- **Revenue Management**: Pull financial reports, analyze occupancy, optimize pricing
- **Operations**: Track check-ins/outs, coordinate cleaning schedules, manage availability
- **Marketing**: Identify low-occupancy periods, create targeted promotions
- **Connected Tools**: give every MCP-compatible client in your stack access to the same property data

## Requirements

- Node.js 18+
- Guesty account with API access (Professional plan or higher)
- MCP-compatible AI client (Claude Code, Cursor, Windsurf, etc.)

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `GUESTY_CLIENT_ID` | — | OAuth2 client id (required) |
| `GUESTY_CLIENT_SECRET` | — | OAuth2 client secret (required) |
| `IOT_WEBHOOK_PORT` | `3100` | Port for the IoT webhook receiver stub (`src/webhook/iot-receiver-server.js`). Local/reverse-proxy only — do not expose publicly. Production requires a reverse proxy that terminates TLS and enforces real HMAC against `IOT_WEBHOOK_SECRET`. |

## API Reference

This server wraps the [Guesty Open API](https://open-api.guesty.com/api-docs). Authentication uses OAuth2 client credentials flow with automatic token caching, retry logic, and rate limit handling.

## Built By

Built and run by a short-term rental operator on its own portfolio, shared with the STR community. Not affiliated with Guesty.

## License

MIT
