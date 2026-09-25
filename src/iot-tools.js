/**
 * Guesty MCP Server — IoT / Property Health (Internal Helpers + 1 MCP Tool)
 *
 * Phase 1: Core data collection + readiness scoring.
 * Phase 2: Vision-based photo comparison (planned).
 *
 * ── MERGE NOTE (2026-04-17, per Owner greenlight msg 6406) ─────────────
 * The three tools `get_property_health`, `submit_checkout_photos`,
 * `get_maintenance_alerts` that previously lived HERE as IoT-only MCP tools
 * have been EXTRACTED into plain-async internal helpers. Their canonical
 * MCP-tool registration has MOVED to `enterprise-tools.js`, where each one
 * becomes an Enterprise aggregator that calls these helpers AND layers in
 * Guesty-side data (reservation status, review score, last-clean timestamp).
 *
 * Only one tool — `get_readiness_score` — is registered directly from here.
 * It is Physical-Readiness only (sensor + photo signal) and has no Guesty
 * aggregation need.
 *
 * All three helpers RETURN raw data objects (not MCP content envelopes) and
 * THROW on error. Enterprise aggregators handle envelope + error shaping.
 */

import { z } from "zod";
import { getTier, isToolAllowed, refusalMessage } from "./license.js";
import {
  getLatestReadings,
  getAlerts,
  getBaseline,
  savePhotos,
} from "./iot-db.js";

/**
 * IoT/property-health gate. Defers ENTIRELY to license.js — it used to carry
 * its own copy of the tier check, which is how it shipped for months telling
 * callers to set a key the kill-switch would refuse (see 0.9.7 changelog).
 * While ALL_TOOLS_FREE is true in license.js this passes every call through.
 *
 * Exported so enterprise-tools.js can reuse the same gate.
 */
export function enterpriseGated(toolName, handler) {
  return async (params) => {
    if (!isToolAllowed(toolName)) {
      return {
        content: [{ type: "text", text: refusalMessage(toolName, getTier()) }],
        isError: true,
      };
    }
    return handler(params);
  };
}

/**
 * Derive an overall status from a set of device readings.
 *   - "critical" if ANY device has a critical alert
 *   - "warning"  if ANY device has a warning alert
 *   - "healthy"  otherwise
 */
export function deriveOverallStatus(devices) {
  let status = "healthy";
  for (const d of devices) {
    if (d.alert_level === "critical") return "critical";
    if (d.alert_level === "warning") status = "warning";
  }
  return status;
}

// ─────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS (exported for enterprise-tools.js aggregators)
// Return raw data objects. Throw on error. No MCP envelope wrapping.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Fetch IoT device health snapshot for a single property.
 * @param {string} listingId Guesty listing ID
 * @returns {Promise<{property_id: string, devices: Array, overall_status: string}>}
 */
export async function getIoTPropertyHealth(listingId) {
  const readings = await getLatestReadings(listingId);
  const devices = (readings || []).map((r) => ({
    device_id: r.device_id,
    type: r.type,
    location: r.location,
    last_reading: r.last_reading,
    last_seen: r.last_seen,
    alert_level: r.alert_level || null,
  }));
  return {
    property_id: listingId,
    devices,
    overall_status: deriveOverallStatus(devices),
  };
}

/**
 * Save submitted post-checkout photos for a property+reservation.
 * @param {{listingId: string, reservationId: string, photos: string[]}} args
 * @returns {Promise<{submission_id: string, photo_count: number, status: string, message: string}>}
 */
export async function submitIoTCheckoutPhotos({ listingId, reservationId, photos }) {
  if (!photos || photos.length === 0) {
    throw new Error("No photos provided. Include at least one photo URL or path.");
  }
  const result = await savePhotos({
    listingId,
    reservationId,
    photos,
    timestamp: new Date().toISOString(),
  });
  return {
    submission_id: result.submission_id,
    photo_count: photos.length,
    status: "received",
    message: "Photos queued for analysis",
  };
}

/**
 * Fetch IoT maintenance alerts, optionally filtered by listing / severity / active-only.
 * @param {{listingId?: string, severity?: string, activeOnly?: boolean}} [filters]
 * @returns {Promise<{alerts: Array, total_count: number}>}
 */
export async function getIoTMaintenanceAlerts(filters = {}) {
  const dbFilters = {
    listingId: filters.listingId || null,
    severity:
      !filters.severity || filters.severity === "all"
        ? null
        : filters.severity,
    activeOnly: filters.activeOnly !== false, // default true
  };
  const alertData = await getAlerts(dbFilters);
  const alerts = (alertData || []).map((a) => ({
    id: a.id,
    device_id: a.device_id,
    property_id: a.property_id,
    alert_type: a.alert_type,
    severity: a.severity,
    message: a.message,
    created_at: a.created_at,
  }));
  return { alerts, total_count: alerts.length };
}

// ─────────────────────────────────────────────────────────────────────────
// MCP TOOL REGISTRATION (only 1 tool — get_readiness_score)
// The other 3 tools live in enterprise-tools.js post-merge.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Register the Physical Readiness Score tool on the given MCP server.
 * Enterprise-gated — requires Enterprise license key.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 */
export function registerIoTTools(server) {
  // ── Tool: get_readiness_score ───────────────────────────────────
  server.tool(
    "get_readiness_score",
    "Calculate a 0-100 Physical Readiness Score for a property before guest check-in. Evaluates temperature, leak detection, door lock, humidity, critical alerts, and baseline photos.",
    {
      listingId: z.string().describe("The Guesty listing ID for the property"),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    enterpriseGated("get_readiness_score", async (params) => {
      try {
        const [readings, alerts, baseline] = await Promise.all([
          getLatestReadings(params.listingId),
          getAlerts({
            listingId: params.listingId,
            severity: null,
            activeOnly: true,
          }),
          getBaseline(params.listingId),
        ]);

        const checks = [];
        let score = 0;
        const MAX_SCORE = 100;

        // ── Check 1: Temperature in range (10 pts) ──
        const tempDevice = (readings || []).find(
          (r) => r.type === "temperature"
        );
        const tempOk =
          tempDevice &&
          tempDevice.last_reading !== null &&
          tempDevice.last_reading >= 60 &&
          tempDevice.last_reading <= 80;
        checks.push({
          name: "temperature_in_range",
          passed: !!tempOk,
          points: tempOk ? 10 : 0,
          detail: tempDevice
            ? `Temperature: ${tempDevice.last_reading}F (range: 60-80F)`
            : "No temperature sensor found",
        });
        if (tempOk) score += 10;

        // ── Check 2: No leak alerts (25 pts) ──
        const leakAlerts = (alerts || []).filter(
          (a) => a.alert_type === "leak" || a.alert_type === "water_leak"
        );
        const noLeaks = leakAlerts.length === 0;
        checks.push({
          name: "no_leak_alerts",
          passed: noLeaks,
          points: noLeaks ? 25 : 0,
          detail: noLeaks
            ? "No active leak alerts"
            : `${leakAlerts.length} active leak alert(s)`,
        });
        if (noLeaks) score += 25;

        // ── Check 3: Door lock responsive (25 pts) ──
        const lockDevice = (readings || []).find(
          (r) => r.type === "lock" || r.type === "door_lock"
        );
        const lockOk =
          lockDevice &&
          lockDevice.last_seen &&
          Date.now() - new Date(lockDevice.last_seen).getTime() <
            30 * 60 * 1000; // seen within 30 min
        checks.push({
          name: "door_lock_responsive",
          passed: !!lockOk,
          points: lockOk ? 25 : 0,
          detail: lockDevice
            ? `Lock last seen: ${lockDevice.last_seen}`
            : "No door lock device found",
        });
        if (lockOk) score += 25;

        // ── Check 4: Humidity OK (10 pts) ──
        const humidDevice = (readings || []).find(
          (r) => r.type === "humidity"
        );
        const humidOk =
          humidDevice &&
          humidDevice.last_reading !== null &&
          humidDevice.last_reading >= 30 &&
          humidDevice.last_reading <= 60;
        checks.push({
          name: "humidity_ok",
          passed: !!humidOk,
          points: humidOk ? 10 : 0,
          detail: humidDevice
            ? `Humidity: ${humidDevice.last_reading}% (range: 30-60%)`
            : "No humidity sensor found",
        });
        if (humidOk) score += 10;

        // ── Check 5: No critical alerts (20 pts) ──
        const criticals = (alerts || []).filter(
          (a) => a.severity === "critical"
        );
        const noCritical = criticals.length === 0;
        checks.push({
          name: "no_critical_alerts",
          passed: noCritical,
          points: noCritical ? 20 : 0,
          detail: noCritical
            ? "No critical alerts"
            : `${criticals.length} critical alert(s) active`,
        });
        if (noCritical) score += 20;

        // ── Check 6: Baseline photos exist (10 pts) ──
        const hasBaseline =
          baseline && baseline.photos && baseline.photos.length > 0;
        checks.push({
          name: "baseline_photos_exist",
          passed: !!hasBaseline,
          points: hasBaseline ? 10 : 0,
          detail: hasBaseline
            ? `${baseline.photos.length} baseline photo(s) on file`
            : "No baseline photos uploaded",
        });
        if (hasBaseline) score += 10;

        // ── Derive status ──
        let status;
        if (score >= 80) status = "ready";
        else if (score >= 50) status = "warning";
        else status = "not_ready";

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  score,
                  max_score: MAX_SCORE,
                  status,
                  checks,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "Failed to calculate readiness score.",
                  details: e.message,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    })
  );
}
