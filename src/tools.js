// Tool registrations for cohoststr-mcp, shared by the local stdio entry
// (src/server.js). The hosted service is maintained separately.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { screenGuestMessage, DRAFTING_RULES } from "./guest-policy.js";
import { z } from "zod";
import { getTier, getTierInfo, gatedHandler, FREE_TOOLS } from './license.js';
import { extractReviewRows, mapReviewRow, mapBlockedDay, BLOCK_TYPE_LEGEND } from './shapes.js';
import { registerIoTTools } from './iot-tools.js';
import { registerEnterpriseTools } from './enterprise-tools.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';
import { initDB } from './iot-db.js';
import { guestyGet, guestyPost, guestyPut, guestyDelete } from './guesty-client.js';
import { createRequire } from 'node:module';

// [2026-08-06 CTO] SERVER VERSION IS DERIVED, NEVER TYPED.
// MEASURED, not assumed: this file carried the literal "0.9.1" at L159 while
// package.json said 0.9.9. A live `initialize` handshake against the PUBLISHED
// 0.9.9 tarball AND against the published 0.9.6 tarball BOTH answered
// serverInfo.version = "0.9.1" -- the control FAILED TO DISCRIMINATE, and that
// failure is the only reason the freeze was caught at all. Every MCP client
// that reads serverInfo has been told 0.9.1 across at least eight publishes.
// The literal was a SECOND place the version had to be updated by hand, which
// is the same defect class as server.json's packages[0].version drifting from
// its own root version inside the very commit that fixed a sibling-surface
// miss. A DERIVED VALUE CANNOT DRIFT. package.json ships in the npm tarball
// (verified with `npm pack --dry-run --json`) and is in the repo, so the
// require resolves on both surfaces; the catch means a packaging accident
// degrades the version string instead of killing the server at boot.
const PKG_VERSION = (() => {
  try {
    return createRequire(import.meta.url)('../package.json').version;
  } catch {
    return '0.0.0-unresolved';
  }
})();

export { guestyGet };

// ISSUE_1_FIX (2026-04-22 CTO): shared filter builder for /reservations queries.
// Guesty Open API v1 ignores `checkIn[$gte]`/`checkIn[$lte]` bracket-style
// query params — it requires a JSON `filters=[{field,operator,from,to}]` array.
// When filters are present, `listingId` is ALSO ignored as a top-level param
// and must move *inside* the filter array. No `context:"now"` — that scopes
// results to upcoming-only (the bug abada1987 reported in Issue #1).
export function buildReservationFilters({ listingId, checkInFrom, checkInTo, checkOutFrom, checkOutTo, status } = {}) {
  const filters = [];
  if (listingId) filters.push({ field: "listingId", operator: "$eq", value: listingId });
  if (status) filters.push({ field: "status", operator: "$eq", value: status });
  if (checkInFrom && checkInTo) {
    filters.push({ field: "checkIn", operator: "$between", from: checkInFrom, to: checkInTo });
  } else if (checkInFrom) {
    filters.push({ field: "checkIn", operator: "$gte", value: checkInFrom });
  } else if (checkInTo) {
    filters.push({ field: "checkIn", operator: "$lte", value: checkInTo });
  }
  if (checkOutFrom && checkOutTo) {
    filters.push({ field: "checkOut", operator: "$between", from: checkOutFrom, to: checkOutTo });
  } else if (checkOutFrom) {
    filters.push({ field: "checkOut", operator: "$gte", value: checkOutFrom });
  } else if (checkOutTo) {
    filters.push({ field: "checkOut", operator: "$lte", value: checkOutTo });
  }
  return filters;
}

/**
 * Build a fully registered MCP server.
 * hosted=true leaves out the IoT/Enterprise tools: they read a sensor database on
 * the local machine, which has no meaning for a multi-tenant hosted server.
 */
export function buildServer({ hosted = false } = {}) {
  // Create MCP Server
  const server = new McpServer({
    name: "cohoststr-mcp",
    version: PKG_VERSION,
  });
  // License tier check
  const _tier = getTier();
  console.error();


  // The Guesty communication API wraps payloads as { status, data: {...} }.
  const unwrapComm = (d) => (d && typeof d === "object" && !Array.isArray(d) && d.data && typeof d.data === "object" && "status" in d ? d.data : d);

  // Tool 1: Get Reservations
  server.tool(
    "get_reservations",
    "Fetch reservations from Guesty. Filter by date range, listing, status, or guest name.",
    {
      limit: z.number().optional().default(10).describe("Max results (default 10)"),
      skip: z.number().optional().default(0).describe("Offset for pagination"),
      checkInFrom: z.string().optional().describe("Check-in date from (YYYY-MM-DD)"),
      checkInTo: z.string().optional().describe("Check-in date to (YYYY-MM-DD)"),
      checkOutFrom: z.string().optional().describe("Check-out date from (YYYY-MM-DD)"),
      checkOutTo: z.string().optional().describe("Check-out date to (YYYY-MM-DD)"),
      listingId: z.string().optional().describe("Filter by listing ID"),
      status: z.string().optional().describe("Filter by status: confirmed, canceled, inquiry, etc."),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const queryParams = {
        limit: params.limit,
        skip: params.skip,
        sort: "checkIn",
        order: "desc",
      };
      // ISSUE_1_FIX (2026-04-22): use Open API `filters` JSON array instead of
      // `checkIn[$gte]`/`[$lte]` bracket params (silently ignored → upcoming-only).
      const filters = buildReservationFilters(params);
      if (filters.length > 0) {
        queryParams.filters = JSON.stringify(filters);
      } else if (params.listingId) {
        queryParams.listingId = params.listingId;
      }

      const data = await guestyGet("/reservations", queryParams);

      const results = data.results || [];
      const summary = results.map((r) => ({
        id: r._id,
        guest: r.guest?.fullName || "Unknown",
        guestEmail: r.guest?.email || "",
        guestPhone: r.guest?.phone || "",
        checkIn: r.checkIn?.slice(0, 10),
        checkOut: r.checkOut?.slice(0, 10),
        nights: r.nightsCount,
        status: r.status,
        source: r.source,
        listing: r.listing?.title || "Unknown",
        listingId: r.listingId,
        totalPaid: r.money?.totalPaid,
        currency: r.money?.currency,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify({ total: data.count, results: summary }, null, 2) }],
      };
    }
  );

  // Tool 2: Get Listing
  server.tool(
    "get_listing",
    "Fetch details about a specific property listing or all listings.",
    {
      listingId: z.string().optional().describe("Specific listing ID. Omit to get all listings."),
      limit: z.number().optional().default(25).describe("Max results when fetching all"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      let data;
      if (params.listingId) {
        data = await guestyGet(`/listings/${params.listingId}`);
        const l = data;
        const summary = {
          id: l._id,
          title: l.title,
          nickname: l.nickname,
          address: l.address?.full,
          bedrooms: l.bedrooms,
          bathrooms: l.bathrooms,
          maxGuests: l.accommodates,
          propertyType: l.propertyType,
          prices: l.prices,
          status: l.active ? "active" : "inactive",
        };
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } else {
        data = await guestyGet("/listings", { limit: params.limit });
        const listings = (data.results || []).map((l) => ({
          id: l._id,
          title: l.title,
          nickname: l.nickname,
          address: l.address?.full,
          bedrooms: l.bedrooms,
          bathrooms: l.bathrooms,
          maxGuests: l.accommodates,
          active: l.active,
        }));
        return { content: [{ type: "text", text: JSON.stringify({ total: data.count, listings }, null, 2) }] };
      }
    }
  );

  // Tool 3: Get Conversations
  server.tool(
    "get_conversations",
    "Fetch guest conversations/messages from Guesty. Get message history for a reservation or listing.",
    {
      reservationId: z.string().optional().describe("Filter by reservation ID"),
      limit: z.number().optional().default(10).describe("Max conversations to return"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    gatedHandler("get_conversations", async (params) => {
      const queryParams = { limit: params.limit };
      if (params.reservationId) queryParams["filters[reservationId]"] = params.reservationId;

      // The communication API wraps its payload: { status, data: { conversations, count } }.
      // This tool used to read data.results and so returned ZERO conversations for every
      // account (measured against a live account 2026-09-24). Both shapes are accepted.
      const data = unwrapComm(await guestyGet("/communication/conversations", queryParams));
      const list = data.conversations || data.results || [];
      const convos = list.map((c) => ({
        id: c._id,
        guestName: c.meta?.guest?.fullName || c.guest?.fullName || "Unknown",
        listing: c.meta?.reservations?.[0]?.listing?.title || c.listing?.title || "Unknown",
        lastMessage: c.lastMessage?.body?.slice(0, 200) || "",
        lastMessageAt: c.lastMessage?.sentAt || c.lastMessageFrom?.date,
        unread: c.unreadCount,
        reservationId: c.meta?.reservations?.[0]?._id || c.reservationId,
      }));

      return { content: [{ type: "text", text: JSON.stringify({ total: data.count ?? list.length, conversations: convos }, null, 2) }] };
    })
  );

  // Tool 3b: Draft Guest Reply (read-only; never sends)
  server.tool(
    "draft_guest_reply",
    "Gather everything needed to draft an accurate reply to a guest: their recent messages, the reservation and the listing's real check-in/out times, access notes and house rules, plus drafting rules. Sends nothing.",
    {
      conversationId: z.string().describe("The Guesty conversation ID"),
      messages: z.number().optional().default(6).describe("How many recent messages to include (max 20)"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    gatedHandler("draft_guest_reply", async (params) => {
      const UNKNOWN = "unknown - do not guess";
      const conv = unwrapComm(await guestyGet(`/communication/conversations/${params.conversationId}`));
      const n = Math.min(Math.max(1, params.messages || 6), 20);
      const postsRaw = unwrapComm(await guestyGet(`/communication/conversations/${params.conversationId}/posts`, { limit: n, sort: "-createdAt" }));
      const posts = (Array.isArray(postsRaw) ? postsRaw : postsRaw.posts || postsRaw.results || [])
        .slice(0, n).reverse().map((p) => ({
          from: p.sentBy === "guest" || p.isIncoming === true || p.module?.type === "guest" ? "guest" : (p.sentBy || "host"),
          at: p.createdAt || p.sentAt,
          text: String(p.body || p.text || "").slice(0, 1500),
        }));
      const resId = conv.reservationId || conv.reservation?._id || conv.meta?.reservations?.[0]?._id;
      let reservation = null, listing = null;
      if (resId) {
        try {
          const r = await guestyGet(`/reservations/${resId}`, { fields: "checkIn checkOut checkInDateLocalized checkOutDateLocalized nightsCount guestsCount status source listingId" });
          reservation = {
            id: resId, status: r.status || UNKNOWN, channel: r.source || UNKNOWN,
            checkIn: r.checkInDateLocalized || r.checkIn || UNKNOWN, checkOut: r.checkOutDateLocalized || r.checkOut || UNKNOWN,
            nights: r.nightsCount ?? UNKNOWN, guests: r.guestsCount ?? UNKNOWN, listingId: r.listingId,
          };
        } catch { reservation = { id: resId, note: "reservation could not be read" }; }
      }
      const listingId = reservation?.listingId || conv.listingId || conv.listing?._id;
      if (listingId) {
        try {
          const l = await guestyGet(`/listings/${listingId}`, { fields: "title nickname address defaultCheckInTime defaultCheckOutTime publicDescription accommodates" });
          const pd = l.publicDescription || {};
          listing = {
            title: l.title || l.nickname || UNKNOWN,
            city: l.address?.city || UNKNOWN,
            checkInTime: l.defaultCheckInTime || UNKNOWN,
            checkOutTime: l.defaultCheckOutTime || UNKNOWN,
            maxGuests: l.accommodates ?? UNKNOWN,
            access: pd.access || UNKNOWN,
            houseRules: pd.houseRules || UNKNOWN,
            space: pd.space ? String(pd.space).slice(0, 1200) : UNKNOWN,
            notes: pd.notes ? String(pd.notes).slice(0, 1200) : UNKNOWN,
          };
        } catch { listing = { note: "listing could not be read" }; }
      }
      const out = {
        guest: conv.meta?.guest?.fullName || conv.guest?.fullName || UNKNOWN,
        reservation: reservation || UNKNOWN,
        listing: listing || UNKNOWN,
        recentMessages: posts,
        draftingRules: DRAFTING_RULES,
      };
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    })
  );

  // Tool 4: Send Guest Message
  server.tool(
    "send_guest_message",
    "Send a message to a guest in a Guesty conversation.",
    {
      conversationId: z.string().describe("The conversation ID to reply in"),
      message: z.string().describe("The message text to send to the guest"),
      allowPolicyRisk: z.boolean().optional().describe("Set true ONLY for direct bookings or when the host has explicitly accepted a channel-policy warning for this exact message."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    gatedHandler("send_guest_message", async (params) => {
      const screen = screenGuestMessage(params.message);
      if (!screen.ok && params.allowPolicyRisk !== true) {
        return { isError: true, content: [{ type: "text", text:
          `NOT SENT — channel-policy risk: the message ${screen.hits.map((h) => h.why).join("; ")}. ` +
          `Airbnb, Vrbo and Booking.com can suspend a listing for this. Rewrite it without that content, ` +
          `or, if this is a direct booking or the host explicitly accepts the risk, resend with "allowPolicyRisk": true.` }] };
      }
      const data = await guestyPost(`/communication/conversations/${params.conversationId}/send-message`, {
        body: params.message,
      });
      return { content: [{ type: "text", text: `Message sent successfully. ID: ${data._id || "OK"}` }] };
    })
  );

  // Tool 5: Get Financials
  server.tool(
    "get_financials",
    "Fetch financial data including revenue, payouts, and reservation financials.",
    {
      listingId: z.string().optional().describe("Filter by listing ID"),
      from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      to: z.string().optional().describe("End date (YYYY-MM-DD)"),
      limit: z.number().optional().default(25).describe("Max results"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      // Pull reservations with financial data, sorted by most recent
      const queryParams = {
        limit: params.limit,
        fields: "money guest checkIn checkOut listing status nightsCount",
        sort: "checkIn",
        order: "desc",
      };
      // ISSUE_1_FIX (2026-04-22): filters array for historical windows
      // (bracket-style params were silently ignored → upcoming-only).
      const filters = buildReservationFilters({
        listingId: params.listingId,
        checkInFrom: params.from,
        checkInTo: params.to,
      });
      if (filters.length > 0) {
        queryParams.filters = JSON.stringify(filters);
      } else if (params.listingId) {
        queryParams.listingId = params.listingId;
      }

      const data = await guestyGet("/reservations", queryParams);
      const financials = (data.results || []).map((r) => ({
        guest: r.guest?.fullName || "Unknown",
        listing: r.listing?.title || "Unknown",
        checkIn: r.checkIn?.slice(0, 10),
        checkOut: r.checkOut?.slice(0, 10),
        status: r.status,
        totalPaid: r.money?.totalPaid,
        hostPayout: r.money?.hostPayout,
        commission: r.money?.commission,
        currency: r.money?.currency,
      }));

      const totalRevenue = financials.reduce((sum, r) => sum + (r.totalPaid || 0), 0);
      const totalPayout = financials.reduce((sum, r) => sum + (r.hostPayout || 0), 0);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            summary: { totalRevenue, totalPayout, reservationCount: financials.length },
            reservations: financials,
          }, null, 2),
        }],
      };
    }
  );

  // Tool 6: Update Pricing
  server.tool(
    "update_pricing",
    "Update the base price for a listing on specific dates or the default base price.",
    {
      listingId: z.string().describe("The listing ID to update pricing for"),
      basePrice: z.number().optional().describe("New default base price per night"),
      dateFrom: z.string().optional().describe("Start date for date-specific pricing (YYYY-MM-DD)"),
      dateTo: z.string().optional().describe("End date for date-specific pricing (YYYY-MM-DD)"),
      price: z.number().optional().describe("Price per night for the date range"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    gatedHandler("update_pricing", async (params) => {
      if (params.basePrice) {
        const data = await guestyPut(`/listings/${params.listingId}`, {
          prices: { basePrice: params.basePrice },
        });
        return { content: [{ type: "text", text: `Base price updated to $${params.basePrice} for listing ${params.listingId}` }] };
      }

      if (params.dateFrom && params.dateTo && params.price) {
        const data = await guestyPut(`/listings/${params.listingId}/calendar`, {
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          price: params.price,
        });
        return { content: [{ type: "text", text: `Price set to $${params.price}/night from ${params.dateFrom} to ${params.dateTo}` }] };
      }

      return { content: [{ type: "text", text: "Error: Provide either basePrice or dateFrom+dateTo+price" }] };
    })
  );

  // ============ V2 TOOLS ============

  // Tool 7: Create Reservation (Direct Booking)
  server.tool(
    "create_reservation",
    "Create a new reservation/booking in Guesty. Use for direct bookings from your website.",
    {
      listingId: z.string().describe("The listing ID to book"),
      checkIn: z.string().describe("Check-in date (YYYY-MM-DD)"),
      checkOut: z.string().describe("Check-out date (YYYY-MM-DD)"),
      guestName: z.string().describe("Guest full name"),
      guestEmail: z.string().optional().describe("Guest email address"),
      guestPhone: z.string().optional().describe("Guest phone number"),
      numberOfGuests: z.number().optional().default(1).describe("Number of guests"),
      source: z.string().optional().default("direct").describe("Booking source (direct, website, etc.)"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    gatedHandler("create_reservation", async (params) => {
      const body = {
        listingId: params.listingId,
        checkInDateLocalized: params.checkIn,
        checkOutDateLocalized: params.checkOut,
        status: "confirmed",
        guest: {
          fullName: params.guestName,
          email: params.guestEmail,
          phone: params.guestPhone,
        },
        guestsCount: params.numberOfGuests,
        source: params.source,
      };

      const data = await guestyPost("/reservations", body);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            reservationId: data._id,
            confirmationCode: data.confirmationCode,
            guest: params.guestName,
            listing: params.listingId,
            dates: `${params.checkIn} → ${params.checkOut}`,
          }, null, 2),
        }],
      };
    })
  );

  // Tool 8: Get Reviews
  server.tool(
    "get_reviews",
    "Fetch guest reviews for your properties from all channels.",
    {
      listingId: z.string().optional().describe("Filter by listing ID"),
      limit: z.number().optional().default(10).describe("Max results"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const queryParams = { limit: params.limit };
      if (params.listingId) queryParams.listingId = params.listingId;

      const data = await guestyGet("/reviews", queryParams);
      // 2026-09-02 (issue #2): /v1/reviews returns { data: [...] } with the text
      // and ratings under rawReview. The previous `data.results` read returned []
      // for every caller since launch. Shape mappers live in src/shapes.js and are
      // tested against the live-measured payload in tests/test-shapes.mjs.
      const rows = extractReviewRows(data);
      const reviews = rows.map(mapReviewRow);

      return {
        content: [{ type: "text", text: JSON.stringify({
          returned: reviews.length,
          limit: data?.limit ?? params.limit ?? null,
          skip: data?.skip ?? 0,
          reviews,
        }, null, 2) }],
      };
    }
  );

  // ---------------------------------------------------------------------------
  // [calshape 2026-08-06 CTO] Guesty calendar routes return their day rows in one
  // of four shapes. MEASURED LIVE 2026-08-06 against open-api.guesty.com: BOTH
  // /v1/listings/{id}/calendar (singular) and /v1/listings/calendars (plural)
  // return a BARE TOP-LEVEL ARRAY today.
  //
  // This normalizer ALREADY EXISTED, inline, at the get_calendar_availability site
  // (see ISSUE_1_FIX 2026-04-22 below) and was never propagated to its two
  // siblings, which shipped broken through every release up to and including npm
  // 0.9.5. get_calendar returned days:[] and get_calendar_blocks returned
  // blockedDays:[] for every listing and every date range.
  //
  // IT THROWS ON AN UNRECOGNISED SHAPE ON PURPOSE, AND THAT IS THE LOAD-BEARING
  // PART. Returning [] makes a vendor change indistinguishable from a real empty
  // calendar. For get_calendar_blocks an empty list does not read as "no data" --
  // it reads as "nothing is blocked", i.e. THE UNIT IS FREE. A false "free" is a
  // double-booking on an occupied unit. Fail loudly instead of answering wrongly.
  //
  // strict:false is for the one caller that has a DELIBERATE downstream recovery
  // (deriving occupancy from /reservations when no day rows come back). It still
  // announces the unknown shape on stderr rather than swallowing it -- a silent
  // under-count and a silent over-count are the same disease with opposite signs.
  function normalizeCalendarDays(data, whereFrom, opts) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.days)) return data.days;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.results)) return data.results;
    const shape = (data && typeof data === "object")
      ? `object keys=[${Object.keys(data).join(",")}]`
      : String(typeof data);
    const msg = `${whereFrom}: unrecognised Guesty calendar response shape (${shape}). ` +
      `Refusing to report an empty calendar as an answer.`;
    if (opts && opts.strict === false) { console.error(`[calshape] ${msg}`); return []; }
    throw new Error(msg);
  }

  // Tool 9: Get Calendar
  server.tool(
    "get_calendar",
    "Fetch calendar availability and pricing for a listing over a date range.",
    {
      listingId: z.string().describe("The listing ID"),
      from: z.string().describe("Start date (YYYY-MM-DD)"),
      to: z.string().describe("End date (YYYY-MM-DD)"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const data = await guestyGet(`/listings/${params.listingId}/calendar`, {
        from: params.from,
        to: params.to,
      });

      const days = normalizeCalendarDays(data, "get_calendar").map((d) => ({
        date: d.date,
        available: d.status === "available",
        price: d.price,
        minNights: d.minNights,
        blockReason: d.blockReason,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify({ listing: params.listingId, days }, null, 2) }],
      };
    }
  );

  // Tool 10: Update Calendar
  server.tool(
    "update_calendar",
    "Block or unblock dates, set minimum nights, or update availability for a listing.",
    {
      listingId: z.string().describe("The listing ID"),
      dateFrom: z.string().describe("Start date (YYYY-MM-DD)"),
      dateTo: z.string().describe("End date (YYYY-MM-DD)"),
      status: z.string().optional().describe("Set to 'available' or 'unavailable'"),
      minNights: z.number().optional().describe("Minimum night stay"),
      blockReason: z.string().optional().describe("Reason for blocking: owner, maintenance, other"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    gatedHandler("update_calendar", async (params) => {
      const body = {};
      if (params.status) body.status = params.status;
      if (params.minNights) body.minNights = params.minNights;
      if (params.blockReason) body.note = params.blockReason;

      const data = await guestyPut(`/listings/${params.listingId}/calendar`, {
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        ...body,
      });

      return {
        content: [{ type: "text", text: `Calendar updated for ${params.listingId}: ${params.dateFrom} to ${params.dateTo}` }],
      };
    })
  );

  // Tool 11: Respond to Review
  server.tool(
    "respond_to_review",
    "Post a response to a guest review.",
    {
      reviewId: z.string().describe("The review ID to respond to"),
      response: z.string().describe("Your response text"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    gatedHandler("respond_to_review", async (params) => {
      const data = await guestyPut(`/reviews/${params.reviewId}`, {
        response: params.response,
      });
      return { content: [{ type: "text", text: `Review response posted successfully for review ${params.reviewId}` }] };
    })
  );

  // Tool 12: Get Owner Statements
  server.tool(
    "get_owner_statements",
    "Fetch owner revenue statements/reports for properties.",
    {
      listingId: z.string().optional().describe("Filter by listing ID"),
      from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      to: z.string().optional().describe("End date (YYYY-MM-DD)"),
      limit: z.number().optional().default(10).describe("Max results"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const queryParams = { limit: params.limit };
      if (params.listingId) queryParams.listingId = params.listingId;
      if (params.from) queryParams["from"] = params.from;
      if (params.to) queryParams["to"] = params.to;

      // Owner statements not available via Open API v1 — fall back to financial data from reservations
      // ISSUE_1_FIX (2026-04-22): same bracket→filters rewrite as Issue #1 sibling tools.
      const ownerFilters = buildReservationFilters({
        listingId: params.listingId,
        checkInFrom: params.from,
        checkInTo: params.to,
      });
      const resData = await guestyGet("/reservations", {
        limit: params.limit,
        fields: "money guest checkIn checkOut listing status nightsCount",
        ...(ownerFilters.length > 0
          ? { filters: JSON.stringify(ownerFilters) }
          : (params.listingId ? { listingId: params.listingId } : {})),
      });
      const results = (resData.results || []).map((r) => ({
        guest: r.guest?.fullName || "Unknown",
        listing: r.listing?.title || "Unknown",
        checkIn: r.checkIn?.slice(0, 10),
        checkOut: r.checkOut?.slice(0, 10),
        status: r.status,
        totalPaid: r.money?.totalPaid,
        hostPayout: r.money?.hostPayout,
        commission: r.money?.commission,
        currency: r.money?.currency,
      }));
      const totalRevenue = results.reduce((sum, r) => sum + (r.totalPaid || 0), 0);
      const totalPayout = results.reduce((sum, r) => sum + (r.hostPayout || 0), 0);
      return {
        content: [{ type: "text", text: JSON.stringify({ summary: { totalRevenue, totalPayout, count: results.length }, results }, null, 2) }],
      };
    }
  );

  // Tool 13: Get Expenses
  server.tool(
    "get_expenses",
    "Fetch operational expenses tracked in Guesty.",
    {
      listingId: z.string().optional().describe("Filter by listing ID"),
      from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      to: z.string().optional().describe("End date (YYYY-MM-DD)"),
      limit: z.number().optional().default(25).describe("Max results"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const queryParams = { limit: params.limit };
      if (params.listingId) queryParams.listingId = params.listingId;
      if (params.from) queryParams["from"] = params.from;
      if (params.to) queryParams["to"] = params.to;

      // Expenses endpoint may not be available on all Guesty plans
      let data;
      try {
        data = await guestyGet("/expenses", queryParams);
      } catch (e) {
        // Fall back to listing expenses if main endpoint not available
        return { content: [{ type: "text", text: JSON.stringify({ note: "Expenses endpoint not available on your Guesty plan. Use get_financials for reservation-based financial data." }, null, 2) }] };
      }
      const expenses = (data.results || []).map((e) => ({
        id: e._id,
        title: e.title,
        amount: e.amount,
        currency: e.currency,
        category: e.category,
        listing: e.listing?.title || "Unknown",
        date: e.date?.slice(0, 10),
        vendor: e.vendor,
      }));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ total: data.count, expenses }, null, 2),
        }],
      };
    }
  );

  // Tool 14: Get Channels (Connected OTAs)
  server.tool(
    "get_channels",
    "List connected booking channels (Airbnb, VRBO, Booking.com, etc.) and their status.",
    {
      listingId: z.string().optional().describe("Filter by listing ID to see which channels a property is on"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      if (params.listingId) {
        const listing = await guestyGet(`/listings/${params.listingId}`);
        const channels = (listing.integrations || []).map((i) => ({
          channel: i.platform,
          externalId: i.externalId,
          externalUrl: i.externalUrl,
          status: i.status,
        }));
        return {
          content: [{ type: "text", text: JSON.stringify({ listing: listing.title, channels }, null, 2) }],
        };
      }
      // Get all listings with their channel info
      const data = await guestyGet("/listings", { limit: 50 });
      const listings = (data.results || []).map((l) => ({
        id: l._id,
        title: l.title,
        nickname: l.nickname,
        channels: (l.integrations || []).map((i) => i.platform).join(", ") || "none",
        active: l.active,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ total: data.count, listings }, null, 2) }],
      };
    }
  );

  // Tool 15: Get Tasks (Cleaning/Maintenance)
  server.tool(
    "get_tasks",
    "Fetch cleaning and maintenance tasks from Guesty.",
    {
      listingId: z.string().optional().describe("Filter by listing ID"),
      status: z.string().optional().describe("Filter by status: pending, confirmed, completed, canceled"),
      limit: z.number().optional().default(25).describe("Max results (minimum 25 per Guesty API)"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const queryParams = {
        limit: Math.max(params.limit, 25),
        columns: "id,status,type,listingId,scheduledFor,assignee,description",
      };
      if (params.listingId) queryParams.listingId = params.listingId;
      if (params.status) queryParams.status = params.status;

      const data = await guestyGet("/tasks-open-api/tasks", queryParams);
      const tasks = (data.data || data.results || []).map((t) => ({
        id: t._id || t.id,
        type: t.type,
        status: t.status,
        listingId: t.listingId,
        assignee: t.assignee?.fullName || t.assignee || "Unassigned",
        scheduledFor: t.scheduledFor?.slice?.(0, 10) || t.scheduledFor,
        description: t.description?.slice?.(0, 200) || t.description,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify({ total: data.count || tasks.length, tasks }, null, 2) }],
      };
    }
  );

  // ============ V3 TOOLS ============

  // Tool 16: Get Photos
  server.tool(
    "get_photos",
    "Fetch photos for a specific listing including URLs, captions, and sort order.",
    {
      listingId: z.string().describe("The listing ID to get photos for"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const data = await guestyGet(`/listings/${params.listingId}`);
      const photos = (data.pictures || []).map((p) => ({
        url: p.original || p.thumbnail,
        caption: p.caption || "",
        sortOrder: p.sortOrder,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify({ listing: params.listingId, photoCount: photos.length, photos }, null, 2) }],
      };
    }
  );

  // Tool 17: Update Photos
  server.tool(
    "update_photos",
    "Replace or reorder photos for a listing. Provide the full array of photos in desired order.",
    {
      listingId: z.string().describe("The listing ID to update photos for"),
      photos: z.array(z.object({
        url: z.string().describe("Photo URL"),
        caption: z.string().optional().describe("Photo caption"),
      })).describe("Array of photo objects with url and optional caption"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    gatedHandler("update_photos", async (params) => {
      const data = await guestyPut(`/listings/${params.listingId}`, {
        pictures: params.photos,
      });
      return { content: [{ type: "text", text: `Photos updated for listing ${params.listingId}. ${params.photos.length} photos set.` }] };
    })
  );

  // Tool 18: Get Calendar Blocks
  server.tool(
    "get_calendar_blocks",
    "Get blocked dates and their reasons for a listing over a date range.",
    {
      listingId: z.string().describe("The listing ID"),
      from: z.string().describe("Start date (YYYY-MM-DD)"),
      to: z.string().describe("End date (YYYY-MM-DD)"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const data = await guestyGet(`/listings/${params.listingId}/calendar`, {
        from: params.from,
        to: params.to,
      });

      // 2026-09-02 (issue #4): surface Guesty's per-day `blocks` flags (m/o/b/r
      // and the rest, passed through) and `blockRefs` instead of a bare status.
      const blockedDays = normalizeCalendarDays(data, "get_calendar_blocks")
        .filter((d) => d.status !== "available")
        .map(mapBlockedDay);

      return {
        content: [{ type: "text", text: JSON.stringify({
          listing: params.listingId,
          blockedCount: blockedDays.length,
          blockTypeLegend: BLOCK_TYPE_LEGEND,
          blockedDays,
        }, null, 2) }],
      };
    }
  );

  // Tool 19: Create Expense
  server.tool(
    "create_expense",
    "Create a new expense record for a listing in Guesty.",
    {
      listingId: z.string().describe("The listing ID the expense is for"),
      title: z.string().describe("Expense title/description"),
      amount: z.number().describe("Expense amount"),
      currency: z.string().optional().default("USD").describe("Currency code (default USD)"),
      category: z.string().optional().describe("Expense category (e.g., cleaning, maintenance, supplies)"),
      vendor: z.string().optional().describe("Vendor/supplier name"),
      date: z.string().optional().describe("Expense date (YYYY-MM-DD)"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    gatedHandler("create_expense", async (params) => {
      const body = {
        listingId: params.listingId,
        title: params.title,
        amount: params.amount,
        currency: params.currency,
      };
      if (params.category) body.category = params.category;
      if (params.vendor) body.vendor = params.vendor;
      if (params.date) body.date = params.date;

      try {
        const data = await guestyPost("/expenses", body);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              expenseId: data._id,
              title: params.title,
              amount: `${params.currency} ${params.amount}`,
              listing: params.listingId,
            }, null, 2),
          }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Expenses endpoint not available on your Guesty plan.", details: e.message }, null, 2) }] };
      }
    })
  );

  // Tool 20: Get Guests
  server.tool(
    "get_guests",
    "Fetch guest database/profiles. Search by name or email.",
    {
      limit: z.number().optional().default(10).describe("Max results (default 10)"),
      skip: z.number().optional().describe("Offset for pagination"),
      query: z.string().optional().describe("Search by guest name or email"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const queryParams = { limit: params.limit };
      if (params.skip) queryParams.skip = params.skip;
      if (params.query) queryParams.q = params.query;

      const data = await guestyGet("/guests", queryParams);
      const guests = (data.results || []).map((g) => ({
        id: g._id,
        fullName: g.fullName,
        email: g.email,
        phone: g.phone,
        reservationCount: g.reservationsCount,
        createdAt: g.createdAt?.slice(0, 10),
      }));

      return {
        content: [{ type: "text", text: JSON.stringify({ total: data.count, guests }, null, 2) }],
      };
    }
  );

  // Tool 21: Get Guest by ID
  server.tool(
    "get_guest_by_id",
    "Get detailed guest profile by guest ID.",
    {
      guestId: z.string().describe("The guest ID"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const data = await guestyGet(`/guests/${params.guestId}`);
      const guest = {
        id: data._id,
        fullName: data.fullName,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        address: data.address,
        reservationsCount: data.reservationsCount,
        notes: data.notes,
        tags: data.tags,
        createdAt: data.createdAt?.slice(0, 10),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(guest, null, 2) }],
      };
    }
  );

  // Tool 22: Update Listing
  server.tool(
    "update_listing",
    "Update listing details such as title, description, amenities, min nights, and max guests.",
    {
      listingId: z.string().describe("The listing ID to update"),
      title: z.string().optional().describe("New listing title"),
      publicDescription: z.string().optional().describe("Public-facing description"),
      privateDescription: z.string().optional().describe("Private/internal description"),
      amenities: z.array(z.string()).optional().describe("Array of amenity strings"),
      minNights: z.number().optional().describe("Minimum night stay"),
      maxGuests: z.number().optional().describe("Maximum number of guests"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    gatedHandler("update_listing", async (params) => {
      const body = {};
      if (params.title) body.title = params.title;
      if (params.publicDescription) body.publicDescription = { summary: params.publicDescription };
      if (params.privateDescription) body.privateDescription = params.privateDescription;
      if (params.amenities) body.amenities = params.amenities;
      if (params.minNights) body.minNights = params.minNights;
      if (params.maxGuests) body.accommodates = params.maxGuests;

      const data = await guestyPut(`/listings/${params.listingId}`, body);
      const updated = Object.keys(body).join(", ");
      return { content: [{ type: "text", text: `Listing ${params.listingId} updated. Fields changed: ${updated}` }] };
    })
  );

  // Tool 23: Get Automation Rules
  server.tool(
    "get_automation_rules",
    "List automation and workflow rules configured in Guesty.",
    {
      limit: z.number().optional().default(25).describe("Max results (default 25)"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      // Automations endpoint may not be available on Open API v1
      try {
        const data = await guestyGet("/automations", { limit: params.limit });
        const automations = (data.results || []).map((a) => ({
          id: a._id,
          title: a.title,
          active: a.active,
          trigger: a.trigger,
          createdAt: a.createdAt?.slice(0, 10),
        }));
        return { content: [{ type: "text", text: JSON.stringify({ total: data.count, automations }, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: JSON.stringify({ note: "Automations endpoint not available on your Guesty plan or API version. Check Guesty dashboard for automation rules." }, null, 2) }] };
      }
    }
  );

  // Tool 24: Create Task
  server.tool(
    "create_task",
    "Create a cleaning or maintenance task for a listing.",
    {
      listingId: z.string().describe("The listing ID the task is for"),
      type: z.string().describe("Task type: cleaning or maintenance"),
      scheduledFor: z.string().describe("Scheduled date (YYYY-MM-DD)"),
      assigneeId: z.string().optional().describe("Assignee user ID"),
      description: z.string().optional().describe("Task description/notes"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    gatedHandler("create_task", async (params) => {
      const body = {
        listingId: params.listingId,
        type: params.type,
        scheduledFor: params.scheduledFor,
      };
      if (params.assigneeId) body.assigneeId = params.assigneeId;
      if (params.description) body.description = params.description;

      const data = await guestyPost("/tasks-open-api/tasks", body);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            taskId: data._id,
            type: params.type,
            listing: params.listingId,
            scheduledFor: params.scheduledFor,
          }, null, 2),
        }],
      };
    })
  );

  // Tool 25: Update Reservation
  server.tool(
    "update_reservation",
    "Update reservation details such as status, dates, guest info, or add notes.",
    {
      reservationId: z.string().describe("The reservation ID to update"),
      status: z.string().optional().describe("New status: confirmed, canceled, inquiry, etc."),
      checkIn: z.string().optional().describe("New check-in date (YYYY-MM-DD)"),
      checkOut: z.string().optional().describe("New check-out date (YYYY-MM-DD)"),
      guestName: z.string().optional().describe("Updated guest full name"),
      guestEmail: z.string().optional().describe("Updated guest email"),
      note: z.string().optional().describe("Add a note to the reservation"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    gatedHandler("update_reservation", async (params) => {
      const body = {};
      if (params.status) body.status = params.status;
      if (params.checkIn) body.checkInDateLocalized = params.checkIn;
      if (params.checkOut) body.checkOutDateLocalized = params.checkOut;
      if (params.guestName || params.guestEmail) {
        body.guest = {};
        if (params.guestName) body.guest.fullName = params.guestName;
        if (params.guestEmail) body.guest.email = params.guestEmail;
      }
      if (params.note) body.note = params.note;

      const data = await guestyPut(`/reservations/${params.reservationId}`, body);
      const updated = Object.keys(body).join(", ");
      return { content: [{ type: "text", text: `Reservation ${params.reservationId} updated. Fields changed: ${updated}` }] };
    })
  );

  // Tool 26: Get Supported Languages
  server.tool(
    "get_supported_languages",
    "Get supported languages configured for a listing.",
    {
      listingId: z.string().describe("The listing ID"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      // Try supported-languages endpoint, fall back to listing data
      let data;
      try {
        data = await guestyGet(`/listings/${params.listingId}/supported-languages`);
      } catch (e) {
        // Fall back to extracting language info from listing
        const listing = await guestyGet(`/listings/${params.listingId}`);
        data = { languages: listing.languages || listing.supportedLanguages || [], note: "Extracted from listing data" };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ listing: params.listingId, languages: data }, null, 2) }],
      };
    }
  );

  // Tool 27: Search Reservations
  server.tool(
    "search_reservations",
    "Search reservations by guest name, email, or confirmation code.",
    {
      query: z.string().describe("Search query — guest name, email, or confirmation code"),
      limit: z.number().optional().default(10).describe("Max results (default 10)"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const data = await guestyGet("/reservations", {
        limit: params.limit,
        q: params.query,
        sort: "checkIn",
        order: "desc",
      });

      const results = (data.results || []).map((r) => ({
        id: r._id,
        confirmationCode: r.confirmationCode,
        guest: r.guest?.fullName || "Unknown",
        guestEmail: r.guest?.email || "",
        checkIn: r.checkIn?.slice(0, 10),
        checkOut: r.checkOut?.slice(0, 10),
        status: r.status,
        listing: r.listing?.title || "Unknown",
        listingId: r.listingId,
        totalPaid: r.money?.totalPaid,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify({ total: data.count, results }, null, 2) }],
      };
    }
  );

  // Tool 28: Get Listing Occupancy
  server.tool(
    "get_listing_occupancy",
    "Calculate occupancy rate for a listing over a date range.",
    {
      listingId: z.string().describe("The listing ID"),
      from: z.string().describe("Start date (YYYY-MM-DD)"),
      to: z.string().describe("End date (YYYY-MM-DD)"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      // ISSUE_1_FIX (2026-04-22): Open API calendar returns the day array under
      // `data.days`, `data.data`, `data.results`, or as a bare top-level array
      // depending on endpoint variant. Previous code only looked at `data.days`
      // → totalDays:0 when response came back in any other shape (the bug
      // abada1987 flagged as "all-zero totals" in Issue #1).
      // Also: pass both `from`/`to` and `startDate`/`endDate` to be forgiving
      // across Open API v1 calendar route versions.
      const data = await guestyGet(`/listings/${params.listingId}/calendar`, {
        from: params.from,
        to: params.to,
        startDate: params.from,
        endDate: params.to,
      });

      // Normalize response shape across known Guesty calendar variants.
      // strict:false preserves this site's deliberate reservations fallback below.
      let days = normalizeCalendarDays(data, "get_calendar_availability", { strict: false });

      // If the calendar endpoint didn't give us per-day rows, derive occupancy
      // from reservations over the window so we never silently return 0.
      if (days.length === 0 && params.from && params.to) {
        const occupFilters = buildReservationFilters({
          listingId: params.listingId,
          checkInFrom: params.from,
          checkInTo: params.to,
        });
        try {
          const resData = await guestyGet("/reservations", {
            limit: 100,
            fields: "checkIn checkOut nightsCount status",
            filters: JSON.stringify(occupFilters),
          });
          const totalDaysSpan = Math.max(1, Math.round((new Date(params.to) - new Date(params.from)) / 86400000) + 1);
          const bookedDays = (resData.results || [])
            .filter((r) => r.status === "confirmed" || r.status === "reserved")
            .reduce((s, r) => s + (r.nightsCount || 0), 0);
          const rate = Math.round((bookedDays / totalDaysSpan) * 10000) / 100;
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                listing: params.listingId,
                from: params.from,
                to: params.to,
                totalDays: totalDaysSpan,
                bookedDays,
                blockedDays: 0,
                availableDays: Math.max(0, totalDaysSpan - bookedDays),
                occupancyRate: `${rate}%`,
                source: "reservations-derived",
              }, null, 2),
            }],
          };
        } catch (e) {
          // fall through to zero-day response
        }
      }

      const totalDays = days.length;
      let bookedDays = 0;
      let blockedDays = 0;
      let availableDays = 0;

      days.forEach((d) => {
        const s = d.status || d.state;
        if (s === "booked" || s === "reserved") bookedDays++;
        else if (s === "unavailable" || s === "blocked") blockedDays++;
        else availableDays++;
      });

      const occupancyRate = totalDays > 0 ? Math.round((bookedDays / totalDays) * 10000) / 100 : 0;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            listing: params.listingId,
            from: params.from,
            to: params.to,
            totalDays,
            bookedDays,
            blockedDays,
            availableDays,
            occupancyRate: `${occupancyRate}%`,
          }, null, 2),
        }],
      };
    }
  );

  // Tool 29: Get Revenue Summary
  server.tool(
    "get_revenue_summary",
    "Get aggregated revenue summary across all or specific listings for a date range.",
    {
      from: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      to: z.string().optional().describe("End date (YYYY-MM-DD)"),
      listingId: z.string().optional().describe("Filter by listing ID"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const queryParams = {
        limit: 100,
        fields: "money nightsCount listing checkIn checkOut status",
        sort: "checkIn",
        order: "desc",
      };
      // ISSUE_1_FIX (2026-04-22): filters array for historical windows.
      // `status: "confirmed"` moved into filters so it survives alongside
      // listingId + date window (top-level status was silently dropped when
      // filters were later set on other paths).
      const filters = buildReservationFilters({
        listingId: params.listingId,
        checkInFrom: params.from,
        checkInTo: params.to,
        status: "confirmed",
      });
      if (filters.length > 0) {
        queryParams.filters = JSON.stringify(filters);
      } else {
        queryParams.status = "confirmed";
        if (params.listingId) queryParams.listingId = params.listingId;
      }

      const data = await guestyGet("/reservations", queryParams);
      const reservations = data.results || [];

      let totalRevenue = 0;
      let totalPayout = 0;
      let totalNights = 0;

      reservations.forEach((r) => {
        totalRevenue += r.money?.totalPaid || 0;
        totalPayout += r.money?.hostPayout || 0;
        totalNights += r.nightsCount || 0;
      });

      const reservationCount = reservations.length;
      const averageNightlyRate = totalNights > 0 ? Math.round((totalRevenue / totalNights) * 100) / 100 : 0;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            totalRevenue,
            totalPayout,
            averageNightlyRate,
            totalNights,
            reservationCount,
            period: {
              from: params.from || "all-time",
              to: params.to || "present",
            },
            listingId: params.listingId || "all",
          }, null, 2),
        }],
      };
    }
  );

  // Tool 30: Get Webhooks
  server.tool(
    "get_webhooks",
    "List all registered webhooks for your Guesty account.",
    {
      limit: z.number().optional().default(25).describe("Max results"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        const data = await guestyGet("/webhooks", { limit: params.limit });
        const webhooks = (data.results || data || []).map((w) => ({
          id: w._id,
          url: w.url,
          events: w.events,
          active: w.active,
          createdAt: w.createdAt?.slice(0, 10),
        }));
        return { content: [{ type: "text", text: JSON.stringify({ total: webhooks.length, webhooks }, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Webhooks endpoint not available.", details: e.message }, null, 2) }] };
      }
    }
  );

  // Tool 31: Create Webhook
  server.tool(
    "create_webhook",
    "Register a new webhook to receive event notifications from Guesty.",
    {
      url: z.string().describe("The URL to receive webhook events"),
      events: z.array(z.string()).describe("Events to subscribe to (e.g., 'reservation.created', 'reservation.updated', 'guest.checked_in')"),
      secret: z.string().optional().describe("Webhook signing secret for verification"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    gatedHandler("create_webhook", async (params) => {
      try {
        const body = { url: params.url, events: params.events };
        if (params.secret) body.secret = params.secret;
        const data = await guestyPost("/webhooks", body);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, webhookId: data._id, url: params.url, events: params.events }, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Failed to create webhook.", details: e.message }, null, 2) }] };
      }
    })
  );

  // Tool 32: Delete Webhook
  server.tool(
    "delete_webhook",
    "Delete a registered webhook by ID.",
    {
      webhookId: z.string().describe("The webhook ID to delete"),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    gatedHandler("delete_webhook", async (params) => {
      try {
        await guestyDelete(`/webhooks/${params.webhookId}`);
        return { content: [{ type: "text", text: `Webhook ${params.webhookId} deleted successfully.` }] };
      } catch (e) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Failed to delete webhook.", details: e.message }, null, 2) }] };
      }
    })
  );

  // Tool 33: Get Custom Fields
  server.tool(
    "get_custom_fields",
    "Fetch custom fields configured for listings or reservations.",
    {
      entity: z.string().optional().default("listing").describe("Entity type: listing or reservation"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        const data = await guestyGet("/custom-fields", { entity: params.entity });
        const fields = (data.results || data || []).map((f) => ({
          id: f._id,
          key: f.key || f.fieldId,
          label: f.label || f.name,
          type: f.type,
          entity: f.entity,
        }));
        return { content: [{ type: "text", text: JSON.stringify({ total: fields.length, fields }, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Custom fields endpoint not available.", details: e.message }, null, 2) }] };
      }
    }
  );

  // Tool 36: Get Account Info
  server.tool(
    "get_account_info",
    "Get current Guesty account information and subscription details.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => {
      try {
        const data = await guestyGet("/accounts/me");
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: data._id,
              name: data.name,
              email: data.email,
              company: data.companyName,
              timezone: data.timezone,
              currency: data.currency,
              plan: data.plan || data.subscription?.plan,
            }, null, 2),
          }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Account info not available.", details: e.message }, null, 2) }] };
      }
    }
  );

  // Tool 37: Get Reservation Financials
  server.tool(
    "get_reservation_financials",
    "Get detailed financial breakdown for a specific reservation including payments, charges, and adjustments.",
    {
      reservationId: z.string().describe("The reservation ID"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const data = await guestyGet(`/reservations/${params.reservationId}`, {
        fields: "money guest listing checkIn checkOut status confirmationCode",
      });
      const money = data.money || {};
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            confirmationCode: data.confirmationCode,
            guest: data.guest?.fullName,
            listing: data.listing?.title,
            checkIn: data.checkIn?.slice(0, 10),
            checkOut: data.checkOut?.slice(0, 10),
            status: data.status,
            financials: {
              totalPrice: money.totalPrice,
              totalPaid: money.totalPaid,
              balanceDue: money.balanceDue,
              hostPayout: money.hostPayout,
              commission: money.commission,
              cleaningFee: money.cleaningFee,
              channelCommission: money.channelCommission,
              currency: money.currency,
              payments: money.payments || [],
            },
          }, null, 2),
        }],
      };
    }
  );

  // Tool 38: Create Reservation Note
  server.tool(
    "create_reservation_note",
    "Add an internal note to a reservation visible only to the property management team.",
    {
      reservationId: z.string().describe("The reservation ID"),
      note: z.string().describe("Note text to add"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    gatedHandler("create_reservation_note", async (params) => {
      try {
        const data = await guestyPost(`/reservations/${params.reservationId}/notes`, {
          body: params.note,
        });
        return { content: [{ type: "text", text: JSON.stringify({ success: true, noteId: data._id, reservation: params.reservationId }, null, 2) }] };
      } catch (e) {
        // Fallback: try updating reservation with note field
        try {
          await guestyPut(`/reservations/${params.reservationId}`, { note: params.note });
          return { content: [{ type: "text", text: `Note added to reservation ${params.reservationId} via update.` }] };
        } catch (e2) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Failed to add note.", details: e2.message }, null, 2) }] };
        }
      }
    })
  );

  // Tool 39: Get Listing Pricing
  server.tool(
    "get_listing_pricing",
    "Get pricing details for a listing including base price, weekly/monthly discounts, and extra fees.",
    {
      listingId: z.string().describe("The listing ID"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      const data = await guestyGet(`/listings/${params.listingId}`, {
        fields: "prices terms financials title nickname",
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            listing: data.title || data.nickname,
            pricing: {
              basePrice: data.prices?.basePrice,
              weeklyDiscount: data.prices?.weeklyPriceFactor,
              monthlyDiscount: data.prices?.monthlyPriceFactor,
              cleaningFee: data.prices?.cleaningFee,
              extraPersonFee: data.prices?.extraPersonFee,
              currency: data.prices?.currency,
            },
            terms: {
              minNights: data.terms?.minNights,
              maxNights: data.terms?.maxNights,
              cancellationPolicy: data.terms?.cancellationPolicy,
            },
          }, null, 2),
        }],
      };
    }
  );

  // Tool 40: Update Listing Pricing
  server.tool(
    "update_listing_pricing",
    "Update pricing for a listing — base price, cleaning fee, extra person fee, and discounts.",
    {
      listingId: z.string().describe("The listing ID"),
      basePrice: z.number().optional().describe("Nightly base price"),
      cleaningFee: z.number().optional().describe("Cleaning fee"),
      extraPersonFee: z.number().optional().describe("Fee per extra person"),
      weeklyPriceFactor: z.number().optional().describe("Weekly discount factor (e.g., 0.9 for 10% off)"),
      monthlyPriceFactor: z.number().optional().describe("Monthly discount factor (e.g., 0.8 for 20% off)"),
      currency: z.string().optional().describe("Currency code (e.g., USD)"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    gatedHandler("update_listing_pricing", async (params) => {
      const prices = {};
      if (params.basePrice !== undefined) prices.basePrice = params.basePrice;
      if (params.cleaningFee !== undefined) prices.cleaningFee = params.cleaningFee;
      if (params.extraPersonFee !== undefined) prices.extraPersonFee = params.extraPersonFee;
      if (params.weeklyPriceFactor !== undefined) prices.weeklyPriceFactor = params.weeklyPriceFactor;
      if (params.monthlyPriceFactor !== undefined) prices.monthlyPriceFactor = params.monthlyPriceFactor;
      if (params.currency) prices.currency = params.currency;

      const data = await guestyPut(`/listings/${params.listingId}`, { prices });
      const updated = Object.keys(prices).join(", ");
      return { content: [{ type: "text", text: `Pricing updated for ${params.listingId}. Fields changed: ${updated}` }] };
    })
  );


  // License Info Tool
  //
  // 2026-08-06 (CTO): wrapped in gatedHandler. It had a PLAIN handler, which meant
  // isToolAllowed() was never consulted for this tool and it was reachable at every
  // tier by bypassing the gate rather than by passing it. THIS WRAP IS A NO-OP FOR
  // ACCESS, NOT A RESTRICTION: "get_license_info" is now listed in FREE_TOOLS, so
  // the gate returns true for it at free, paid_not_yet_wired and every paid tier.
  // Verified by exercise before shipping — the handler still runs and isError stays
  // undefined. What changes is that the tool is now INSIDE the accounting: it is
  // counted by freeToolCount/accessibleToolCount instead of being an off-ledger
  // 24th tool that made every published count wrong by one.
  //
  // Do not "simplify" this back to a plain handler. A tool outside the gate is a
  // tool outside the census, and the census is what we publish.
  server.tool(
    "get_license_info",
    "Report this server's licensing state. Every registered tool is currently free; lists the tool ledger and whether a key was detected. Makes no Guesty API call.",
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    gatedHandler("get_license_info", async () => {
      const info = getTierInfo();
      info.freeTools = FREE_TOOLS;
      info.website = "https://cohoststr.com";
      return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
    })
  );


  // Initialize IoT database and register Enterprise-tier tools.
  // After the 2026-04-17 MERGE:
  //   - iot-tools.js registers `get_readiness_score` only (1 tool).
  //   - enterprise-tools.js registers the 3 aggregator tools
  //     (get_property_health, submit_checkout_photos, get_maintenance_alerts)
  //     which wrap the extracted IoT helpers + Guesty-layer data.
  if (!hosted) {
    initDB();
    registerIoTTools(server);
    registerEnterpriseTools(server);
  }
  registerResources(server, { guestyGet });
  registerPrompts(server);
  return server;
}

