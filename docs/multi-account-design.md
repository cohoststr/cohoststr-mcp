# Multi-Account Support Design (v3)

## Overview
Support managing multiple Guesty accounts from a single MCP server instance.

## Configuration
```json
{
  "accounts": {
    "default": { "clientId": "xxx", "clientSecret": "xxx", "label": "Main account" },
    "client-abc": { "clientId": "yyy", "clientSecret": "yyy", "label": "ABC Vacation Rentals" }
  }
}
```

## Usage
Every tool accepts optional `accountId`:
```
get_reservations({ accountId: "client-abc", limit: 10 })
```

## Key Features
- Separate token cache per account
- Independent rate limit tracking
- Per-account health checks
- No cross-account data leakage
- Audit log per account

## Enterprise Use Cases
- Property management companies with regional accounts
- White-label SaaS serving multiple clients
- Multi-brand hospitality groups
