#!/usr/bin/env node
/**
 * Standalone boot for the IoT webhook receiver (Enterprise Tier stub).
 *
 * Runs the iot-receiver router on its own Express app, listening on
 * IOT_WEBHOOK_PORT (default 3100). Use this for local dev / smoke tests
 * when you do not want to start the full MCP HTTP server.
 *
 *   node src/webhook/iot-receiver-server.js
 *   IOT_WEBHOOK_PORT=4100 node src/webhook/iot-receiver-server.js
 *
 * Production: run behind a reverse proxy that terminates TLS and enforces
 * a real HMAC check against IOT_WEBHOOK_SECRET. Do NOT expose this port
 * directly on the public internet.
 */

import express from "express";
import iotReceiverRouter from "./iot-receiver.js";

const PORT = parseInt(process.env.IOT_WEBHOOK_PORT || "3100", 10);

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(iotReceiverRouter);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[iot-receiver] stub listening on http://127.0.0.1:${PORT}`);
  console.log(`[iot-receiver] POST /webhook/iot/:property_id`);
  console.log(`[iot-receiver] GET  /webhook/iot/health`);
});
