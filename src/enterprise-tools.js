/**
 * Guesty MCP Server — Enterprise Tier Aggregation Tools
 *
 * Three Enterprise-tier MCP tools that aggregate IoT device signal with
 * Guesty-side data (reservation status, review score, last-clean timestamp)
 * into single-call snapshots for ops dashboards.
 *
 * Tools:
 *   - get_property_health      aggregated single-property snapshot
 *                              (IoT devices + reservation + reviews + clean)
 *   - submit_checkout_photos   post-checkout photo intake (writes through to
 *                              the IoT baseline store via iot-db.js)
 *   - get_maintenance_alerts   active IoT maintenance alerts, filterable
 *                              per listing or portfolio-wide
 *
 * ── MERGE STATUS (2026-04-17, Owner greenlight msg 6406) ────────────────
 * These tools are now the CANONICAL registrations at these names. The
 * same names previously lived in iot-tools.js as IoT-only views — those
 * have been extracted into plain-async internal helpers and are imported
 * here. This is the Owner-approved option-c merge path: one tool name
 * per MCP surface, Enterprise aggregator wraps the IoT getter.
 *
 * Guesty-side layering (reservation status, review score, last-clean)
 * uses guestyGet() from server.js. Each call is wrapped in try/catch so
 * the aggregator degrades gracefully — if Guesty is slow or fails on one
 * sub-query, the tool still returns IoT data with the failing field set
 * to null + a non-fatal error note.
 */

import { z } from "zod";
import { guestyGet } from "./guesty-client.js";
import {
  enterpriseGated,
  getIoTPropertyHealth,
  submitIoTCheckoutPhotos,
  getIoTMaintenanceAlerts,
} from "./iot-tools.js";

// ─────────────────────────────────────────────────────────────────────────
// Graceful Guesty fetchers — each returns { value, error } so the aggregator
// can surface partial data even when one sub-call fails.
// ─────────────────────────────────────────────────────────────────────────

async function safeFetchReservationStatus(listingId) {
  try {
    // Current active / upcoming reservation for this listing
    const data = await guestyGet("/reservations", {
      listingId,
      limit: 1,
      sort: "-checkIn",
      "filters[status]": "confirmed,checked_in",
    });
    const r = (data && data.results && data.results[0]) || null;
    if (!r) return { value: { status: "no_active_reservation" }, error: null };
    return {
      value: {
        reservation_id: r._id,
        status: r.status,
        check_in: r.checkIn,
        check_out: r.checkOut,
        guest: r.guest && r.guest.fullName,
      },
      error: null,
    };
  } catch (e) {
    return { value: null, error: e.message };
  }
}

async function safeFetchReviewScore(listingId) {
  try {
    const data = await guestyGet("/reviews", { listingId, limit: 50 });
    const reviews = (data && data.results) || [];
    if (reviews.length === 0) {
      return { value: { average: null, count: 0 }, error: null };
    }
    const sum = reviews.reduce(
      (acc, rv) => acc + (typeof rv.overallRating === "number" ? rv.overallRating : 0),
      0
    );
    return {
      value: {
        average: Math.round((sum / reviews.length) * 10) / 10,
        count: reviews.length,
      },
      error: null,
    };
  } catch (e) {
    return { value: null, error: e.message };
  }
}

async function safeFetchLastClean(listingId) {
  try {
    // Tasks filtered to cleaning/turnover type, sorted by completion time desc
    const data = await guestyGet("/tasks", {
      "filters[listing]": listingId,
      "filters[type]": "cleaning,turnover",
      "filters[status]": "completed",
      limit: 1,
      sort: "-completedAt",
    });
    const t = (data && data.results && data.results[0]) || null;
    if (!t) return { value: { completed_at: null }, error: null };
    return {
      value: {
        completed_at: t.completedAt || t.updatedAt || null,
        task_id: t._id,
        assignee: t.assignee && t.assignee.fullName,
      },
      error: null,
    };
  } catch (e) {
    return { value: null, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Utility: wrap a raw data object in the MCP text-content envelope.
// ─────────────────────────────────────────────────────────────────────────
function envelope(obj) {
  return {
    content: [
      { type: "text", text: JSON.stringify(obj, null, 2) },
    ],
  };
}

function errorEnvelope(message, details) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: message, details: details || null }, null, 2),
      },
    ],
    isError: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Register the 3 Enterprise-tier aggregation tools on the MCP server.
// ─────────────────────────────────────────────────────────────────────────

export function registerEnterpriseTools(server) {
  // ── Tool 1: get_property_health (aggregated) ────────────────────
  server.tool(
    "get_property_health",
    "Aggregate health signal per property: IoT device status + overall IoT state, current reservation status, 50-review average score, and last-clean timestamp. Single-call snapshot for ops dashboards. Sub-fetches that fail degrade gracefully (null value + error note).",
    {
      listingId: z.string().describe("The Guesty listing ID for the property"),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    enterpriseGated("get_property_health", async (params) => {
      try {
        const [iot, reservation, reviews, lastClean] = await Promise.all([
          getIoTPropertyHealth(params.listingId),
          safeFetchReservationStatus(params.listingId),
          safeFetchReviewScore(params.listingId),
          safeFetchLastClean(params.listingId),
        ]);
        const partialErrors = [];
        if (reservation.error) partialErrors.push({ field: "reservation_status", error: reservation.error });
        if (reviews.error) partialErrors.push({ field: "review_score", error: reviews.error });
        if (lastClean.error) partialErrors.push({ field: "last_clean", error: lastClean.error });

        return envelope({
          property_id: params.listingId,
          iot: {
            devices: iot.devices,
            overall_status: iot.overall_status,
            device_count: iot.devices.length,
          },
          reservation_status: reservation.value,
          review_score: reviews.value,
          last_clean: lastClean.value,
          partial_errors: partialErrors.length ? partialErrors : null,
          fetched_at: new Date().toISOString(),
        });
      } catch (e) {
        return errorEnvelope("Failed to aggregate property health.", e.message);
      }
    })
  );

  // ── Tool 2: submit_checkout_photos ──────────────────────────────
  server.tool(
    "submit_checkout_photos",
    "Accept post-checkout photo uploads and log them to the property's maintenance/cleaning record. Photos are queued for downstream inspection workflows (Phase 2 vision comparison).",
    {
      listingId: z
        .string()
        .describe("The Guesty listing ID for the property"),
      reservationId: z
        .string()
        .describe("The reservation ID this checkout is for"),
      photos: z
        .array(z.string())
        .describe("Array of photo URLs or file paths to submit"),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    enterpriseGated("submit_checkout_photos", async (params) => {
      try {
        const result = await submitIoTCheckoutPhotos({
          listingId: params.listingId,
          reservationId: params.reservationId,
          photos: params.photos,
        });
        return envelope(result);
      } catch (e) {
        return errorEnvelope("Failed to submit checkout photos.", e.message);
      }
    })
  );

  // ── Tool 3: get_maintenance_alerts (portfolio-capable) ──────────
  server.tool(
    "get_maintenance_alerts",
    "List or filter open maintenance alerts for a specific property or across the whole portfolio. Supports severity filtering and active-only (unresolved) filtering. IoT-sourced today; future Phase will merge Guesty-native task alerts.",
    {
      listingId: z
        .string()
        .optional()
        .describe("Filter alerts to a specific listing ID. Omit for portfolio-wide."),
      severity: z
        .enum(["critical", "warning", "info", "all"])
        .optional()
        .default("all")
        .describe("Filter by alert severity level (default: all)"),
      active_only: z
        .boolean()
        .optional()
        .default(true)
        .describe("Only return active (unresolved) alerts (default: true)"),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    enterpriseGated("get_maintenance_alerts", async (params) => {
      try {
        const result = await getIoTMaintenanceAlerts({
          listingId: params.listingId,
          severity: params.severity,
          activeOnly: params.active_only,
        });
        return envelope({
          ...result,
          scope: params.listingId ? "listing" : "portfolio",
          fetched_at: new Date().toISOString(),
        });
      } catch (e) {
        return errorEnvelope("Failed to retrieve maintenance alerts.", e.message);
      }
    })
  );
}

// Exported for direct invocation from smoke tests without constructing
// a full McpServer instance. Each is a real call now, not a stub — tests
// may need to stub the IoT db + guestyGet for isolated execution.
export const __handlers = {
  get_property_health: enterpriseGated("get_property_health", async (params) => {
    const [iot, reservation, reviews, lastClean] = await Promise.all([
      getIoTPropertyHealth(params.listingId),
      safeFetchReservationStatus(params.listingId),
      safeFetchReviewScore(params.listingId),
      safeFetchLastClean(params.listingId),
    ]);
    return envelope({
      property_id: params.listingId,
      iot: {
        devices: iot.devices,
        overall_status: iot.overall_status,
        device_count: iot.devices.length,
      },
      reservation_status: reservation.value,
      review_score: reviews.value,
      last_clean: lastClean.value,
      partial_errors: [
        reservation.error && { field: "reservation_status", error: reservation.error },
        reviews.error && { field: "review_score", error: reviews.error },
        lastClean.error && { field: "last_clean", error: lastClean.error },
      ].filter(Boolean),
      fetched_at: new Date().toISOString(),
    });
  }),
  submit_checkout_photos: enterpriseGated("submit_checkout_photos", async (params) => {
    const result = await submitIoTCheckoutPhotos({
      listingId: params.listingId,
      reservationId: params.reservationId,
      photos: params.photos,
    });
    return envelope(result);
  }),
  get_maintenance_alerts: enterpriseGated("get_maintenance_alerts", async (params) => {
    const result = await getIoTMaintenanceAlerts({
      listingId: params.listingId,
      severity: params.severity,
      activeOnly: params.active_only,
    });
    return envelope({
      ...result,
      scope: params.listingId ? "listing" : "portfolio",
      fetched_at: new Date().toISOString(),
    });
  }),
};
