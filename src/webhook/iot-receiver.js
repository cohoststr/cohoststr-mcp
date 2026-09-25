/**
 * IoT Webhook Receiver — Enterprise Tier (STUB)
 *
 * Endpoints:
 *   POST /webhook/iot/:property_id     — accept inbound IoT events
 *   GET  /webhook/iot/health           — liveness probe
 *
 * Responsibilities (stub scope only):
 *   - Require a non-empty `x-cohoststr-webhook-signature` header
 *     (HMAC verification is stubbed — see TODO below).
 *   - Parse JSON body: { device_id, event_type, severity, timestamp, metadata }
 *   - Append one JSON line per event to ~/.cohoststr/logs/iot-webhook.log
 *   - Return 202 Accepted with { received: true, event_id: <uuid> }
 *
 * NOT IN SCOPE (future phases):
 *   - Real HMAC verification against IOT_WEBHOOK_SECRET
 *   - Rate limiting
 *   - Durable persistence / DB writes
 *   - Fan-out to `get_maintenance_alerts` MCP tool
 *
 * Production deployment note:
 *   This receiver is intended to run behind a reverse proxy (nginx / Caddy /
 *   Cloudflare Tunnel) that terminates TLS and enforces real HMAC checks.
 *   Do NOT expose port IOT_WEBHOOK_PORT (default 3100) on the public internet.
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";

const router = Router();

const LOG_PATH = `${homedir()}/.cohoststr/logs/iot-webhook.log`;

// Best-effort: ensure logs dir exists at import time.
mkdir(dirname(LOG_PATH), { recursive: true }).catch(() => {});

/**
 * Append a single JSON line to the rotating log file.
 * Rotation itself is delegated to logrotate / launchd — this module is
 * append-only.
 */
async function logEvent(entry) {
  try {
    await appendFile(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    // Surface a line to stderr but do not fail the request — observability
    // is best-effort at this tier.
    console.error("[iot-receiver] log write failed:", err.message);
  }
}

// ── Health ────────────────────────────────────────────────────────────────

router.get("/webhook/iot/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    receiver: "iot-webhook-stub",
    log_path: LOG_PATH
  });
});

// ── Inbound event ─────────────────────────────────────────────────────────

router.post("/webhook/iot/:property_id", async (req, res) => {
  const signature = req.get("x-cohoststr-webhook-signature");

  // TODO: verify HMAC against IOT_WEBHOOK_SECRET
  // Expected: HMAC-SHA256(body, IOT_WEBHOOK_SECRET) === signature
  if (!signature || typeof signature !== "string" || signature.length === 0) {
    return res.status(401).json({
      received: false,
      error: "missing x-cohoststr-webhook-signature header"
    });
  }

  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      received: false,
      error: "body must be a JSON object"
    });
  }

  const { device_id, event_type, severity, timestamp, metadata } = body;

  const event_id = randomUUID();
  const entry = {
    event_id,
    property_id: req.params.property_id,
    device_id: device_id ?? null,
    event_type: event_type ?? null,
    severity: severity ?? null,
    timestamp: timestamp ?? new Date().toISOString(),
    metadata: metadata ?? null,
    signature_present: true,
    received_at: new Date().toISOString()
  };

  await logEvent(entry);

  return res.status(202).json({
    received: true,
    event_id
  });
});

export default router;
