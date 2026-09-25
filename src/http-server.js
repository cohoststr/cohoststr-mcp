#!/usr/bin/env node
/**
 * HTTP/SSE transport for Guesty MCP Server
 * Hosted version for Smithery/MCPMarket marketplace submission
 */
import express from "express";
import { randomUUID } from "crypto";
import { createRequire } from "module";

// Version is READ from package.json, never re-typed here. The literal "0.8.2"
// sat in this file through four releases and was served to every client that
// called initialize.
const PKG_VERSION = createRequire(import.meta.url)("../package.json").version;

const app = express();
app.use(express.json());

// IoT routes require filesystem for JSON DB — skip on Vercel serverless
// (Vercel has read-only /tmp only; initDB() writes to ~/.cohoststr/)
if (!process.env.VERCEL) {
  try {
    const { default: iotRouter } = await import("./iot-webhook.js");
    const { default: iotReceiverRouter } = await import("./webhook/iot-receiver.js");
    const { initDB } = await import("./iot-db.js");
    initDB();
    app.use(iotRouter);
    app.use(iotReceiverRouter);
  } catch (e) {
    console.warn("[http-server] IoT routes skipped:", e.message);
  }
}

const PORT = process.env.PORT || 3001;

// Request counter
const stats = { total: 0, endpoints: {}, startedAt: new Date().toISOString() };
app.use((req, res, next) => {
  stats.total++;
  const key = `${req.method} ${req.path}`;
  stats.endpoints[key] = (stats.endpoints[key] || 0) + 1;
  next();
});

// Server info
const SERVER_INFO = {
  name: "cohoststr-mcp",
  version: PKG_VERSION,
  // 2026-09-02 (CTO): all tools free (Owner TG 8336). Both figures here are
  // asserted by tests/test-remote-toolsync.mjs against the live registration
  // census and license.js's derived counts — do not retype them by hand.
  description: "MCP server for Guesty property management — 44 registered tools, all free (43 Guesty tools + get_license_info), covering reservations, guests, messaging, pricing, revenue, tasks, webhooks, and IoT/property-health.",
  capabilities: {
    tools: { listChanged: false },
    resources: { listChanged: false }
  }
};

// Tool definitions (metadata only — execution requires Guesty credentials)
// Tool names, GENERATED from the real registrations in src/server.js,
// src/iot-tools.js and src/enterprise-tools.js. DO NOT HAND-EDIT.
// This list was hand-maintained until 2026-08-06 and had drifted to a 12-of-43
// overlap with the product -- 31 advertised names did not exist, and the two
// calendar tools the 0.9.6 release fixed were not advertised at all.
// tests/test-remote-toolsync.mjs FAILS THE BUILD if this diverges again.
// NOTE: this endpoint advertises the surface; it does NOT execute it (see /mcp
// tools/call below). Deriving this at runtime is not possible here: importing
// server.js calls initDB() and connects a stdio transport at module load.
const TOOLS = [
  "create_expense",
  "create_reservation",
  "create_reservation_note",
  "create_task",
  "create_webhook",
  "delete_webhook",
  "draft_guest_reply",
  "get_account_info",
  "get_automation_rules",
  "get_calendar",
  "get_calendar_blocks",
  "get_channels",
  "get_conversations",
  "get_custom_fields",
  "get_expenses",
  "get_financials",
  "get_guest_by_id",
  "get_guests",
  "get_license_info",
  "get_listing",
  "get_listing_occupancy",
  "get_listing_pricing",
  "get_maintenance_alerts",
  "get_owner_statements",
  "get_photos",
  "get_property_health",
  "get_readiness_score",
  "get_reservation_financials",
  "get_reservations",
  "get_revenue_summary",
  "get_reviews",
  "get_supported_languages",
  "get_tasks",
  "get_webhooks",
  "respond_to_review",
  "search_reservations",
  "send_guest_message",
  "submit_checkout_photos",
  "update_calendar",
  "update_listing",
  "update_listing_pricing",
  "update_photos",
  "update_pricing",
  "update_reservation"
];

// Health
app.get("/health", (req, res) => {
  res.json({ status: "ok", ...SERVER_INFO, tools: TOOLS.length });
});

// Root — server info
app.get("/", (req, res) => {
  res.json({
    ...SERVER_INFO,
    tools: TOOLS.length,
    docs: "https://cohoststr.com",
    npm: "https://www.npmjs.com/package/cohoststr-mcp",
    github: "https://github.com/cohoststr/cohoststr-mcp",
    quickstart: "npx cohoststr-mcp"
  });
});

// SSE endpoint for MCP transport
app.get("/sse", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*"
  });

  const sessionId = randomUUID();
  res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: { sessionId, ...SERVER_INFO } })}\n\n`);

  // Keep alive
  const interval = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 30000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

// MCP JSON-RPC endpoint
app.post("/mcp", (req, res) => {
  const { method, id, params } = req.body;

  switch (method) {
    case "initialize":
      res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: SERVER_INFO, capabilities: SERVER_INFO.capabilities } });
      break;

    case "tools/list":
      res.json({
        jsonrpc: "2.0", id,
        result: {
          tools: TOOLS.map(name => ({
            name,
            description: `Guesty ${name.replace(/_/g, " ")} operation`,
            inputSchema: { type: "object", properties: {} }
          }))
        }
      });
      break;

    case "tools/call": {
      // MEASURED 2026-08-06: before this branch existed, ZZ_NO_SUCH_TOOL returned
      // BYTE-IDENTICAL output to get_listing. A caller could not distinguish "this
      // tool does not exist" from "this tool exists but I will not run it", so the
      // 31 phantom names above were indistinguishable from real ones by probing.
      const wanted = params && params.name;
      if (!TOOLS.includes(wanted)) {
        res.json({
          jsonrpc: "2.0", id,
          error: { code: -32601, message: `Unknown tool: ${wanted}. Call tools/list for the ${TOOLS.length} tools this server advertises.` }
        });
        break;
      }
      res.json({
        jsonrpc: "2.0", id,
        error: { code: -32001, message: "Tool execution requires Guesty API credentials. Install locally: npx cohoststr-mcp" }
      });
      break;
    }

    default:
      res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});

// List tools as REST
app.get("/tools", (req, res) => {
  res.json({ tools: TOOLS, count: TOOLS.length });
});

// Request stats
app.get("/stats", (req, res) => {
  res.json({ ...stats, uptime: `${((Date.now() - new Date(stats.startedAt).getTime()) / 3600000).toFixed(1)}h` });
});

// Export for Vercel serverless, listen for standalone
if (process.env.VERCEL) {
  // Vercel handles the HTTP layer
} else {
  app.listen(PORT, () => {
    console.log(`Guesty MCP HTTP Server on port ${PORT}`);
  });
}

export default app;
// Named exports exist ONLY so tests/test-remote-toolsync.mjs can assert against the
// REAL runtime values rather than a text-scrape of this file. Vercel uses the
// default export and is unaffected. Import this module with VERCEL=1 set, or
// app.listen() below will bind a port in your test process.
export { TOOLS, SERVER_INFO };
