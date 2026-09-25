// src/resources.js
//
// MCP Resources primitive for CohostSTR MCP server — v0.9.0 (2026-04-20).
//
// Exposes read-only addressable resources via guesty:// URI scheme so clients
// can surface Guesty entities as @-mentionable context rather than forcing a
// tool call for every read. Reuses the existing `guestyGet` helper from server.js.
//
// URI templates registered:
//   guesty://listing/{id}               — listing detail
//   guesty://reservation/{id}           — reservation detail
//   guesty://review/{id}                — review detail
//   guesty://guest/{id}                 — guest profile
//   guesty://thread/{conversation_id}   — message thread
//   guesty://report/revenue/{month}     — monthly revenue snapshot (YYYY-MM)
//   guesty://listing/{listing_id}/tasks — open tasks for a listing
//
// Capabilities declared by McpServer when at least one resource is registered:
//   resources: { listChanged: false, subscribe: false }
//
// Subscribe + listChanged are intentionally OFF for v0.9.0 — keeps scope tight.
// Enable in v0.10.0 after per-resource caching strategy lands.

import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * @param {object} server  - McpServer instance
 * @param {object} deps    - { guestyGet }  dependency injection to avoid circular imports
 */
export function registerResources(server, { guestyGet }) {
  // --- Helper: shape a ReadResourceResult ---
  const asJsonResource = (uri, data, mimeType = "application/json") => ({
    contents: [
      {
        uri: uri.toString(),
        mimeType,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  });

  const asErrorResource = (uri, err) => ({
    contents: [
      {
        uri: uri.toString(),
        mimeType: "text/plain",
        text: `Error reading ${uri}: ${err.message || String(err)}`,
      },
    ],
  });

  // --- Helper: list callback factory ---
  // For each template we provide a list callback that returns the top N of that
  // entity so clients can enumerate them for @-mention pickers. Required per SDK.
  const listTopN = async (path, buildUri, limit = 25) => {
    try {
      const data = await guestyGet(path, { limit });
      const items = data.results || [];
      return {
        resources: items.map((item) => ({
          uri: buildUri(item),
          name: item.title || item.guest?.fullName || item.name || item._id,
          description: item.nickname || item.publicReview || undefined,
          mimeType: "application/json",
        })),
      };
    } catch (e) {
      return { resources: [] };
    }
  };

  // --- 1. Listing detail ---
  server.registerResource(
    "listing",
    new ResourceTemplate("guesty://listing/{id}", {
      list: async () =>
        listTopN("/listings", (l) => `guesty://listing/${l._id}`),
    }),
    {
      title: "Guesty Listing",
      description: "Full detail for a single Guesty listing (property).",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      try {
        const data = await guestyGet(`/listings/${id}`);
        return asJsonResource(uri, data);
      } catch (e) {
        return asErrorResource(uri, e);
      }
    }
  );

  // --- 2. Reservation detail ---
  server.registerResource(
    "reservation",
    new ResourceTemplate("guesty://reservation/{id}", {
      list: async () =>
        listTopN("/reservations", (r) => `guesty://reservation/${r._id}`),
    }),
    {
      title: "Guesty Reservation",
      description: "Full detail for a single reservation incl. guest, dates, money.",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      try {
        const data = await guestyGet(`/reservations/${id}`);
        return asJsonResource(uri, data);
      } catch (e) {
        return asErrorResource(uri, e);
      }
    }
  );

  // --- 3. Review detail ---
  server.registerResource(
    "review",
    new ResourceTemplate("guesty://review/{id}", {
      list: async () =>
        listTopN("/reviews", (r) => `guesty://review/${r._id}`),
    }),
    {
      title: "Guesty Review",
      description: "Full detail for a single review (Airbnb, Booking.com, etc.).",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      try {
        const data = await guestyGet(`/reviews/${id}`);
        return asJsonResource(uri, data);
      } catch (e) {
        return asErrorResource(uri, e);
      }
    }
  );

  // --- 4. Guest profile ---
  server.registerResource(
    "guest",
    new ResourceTemplate("guesty://guest/{id}", {
      list: async () =>
        listTopN("/guests", (g) => `guesty://guest/${g._id}`),
    }),
    {
      title: "Guesty Guest",
      description: "Guest profile: contact, tags, prior-stay history.",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      try {
        const data = await guestyGet(`/guests/${id}`);
        return asJsonResource(uri, data);
      } catch (e) {
        return asErrorResource(uri, e);
      }
    }
  );

  // --- 5. Message thread ---
  server.registerResource(
    "thread",
    new ResourceTemplate("guesty://thread/{conversation_id}", {
      // No bulk-list for threads (usually fetched per-reservation).
      list: undefined,
    }),
    {
      title: "Guesty Message Thread",
      description: "All messages on a single conversation thread.",
      mimeType: "application/json",
    },
    async (uri, { conversation_id }) => {
      try {
        // /messages is not a Guesty route (404 against a live account, 2026-09-24);
        // the thread lives at /posts, wrapped as { status, data: { posts } }.
        const raw = await guestyGet(
          `/communication/conversations/${conversation_id}/posts`,
          { limit: 100, sort: "-createdAt" }
        );
        const data = raw && raw.data && typeof raw.data === "object" && "status" in raw ? raw.data : raw;
        return asJsonResource(uri, data);
      } catch (e) {
        return asErrorResource(uri, e);
      }
    }
  );

  // --- 6. Monthly revenue snapshot ---
  // Uses the existing /reservations endpoint filtered by checkInFrom/checkInTo.
  // Month format: YYYY-MM. Returns aggregate money fields.
  server.registerResource(
    "revenue-month",
    new ResourceTemplate("guesty://report/revenue/{month}", {
      list: undefined,
    }),
    {
      title: "Monthly Revenue",
      description:
        "Aggregate revenue snapshot for a given month (YYYY-MM). Sums nightly rate, cleaning, extras, discounts.",
      mimeType: "application/json",
    },
    async (uri, { month }) => {
      try {
        // Validate YYYY-MM
        if (!/^\d{4}-\d{2}$/.test(month)) {
          return asErrorResource(uri, new Error(`Invalid month '${month}' — expected YYYY-MM`));
        }
        const [year, mo] = month.split("-").map(Number);
        const from = `${month}-01`;
        const lastDay = new Date(year, mo, 0).getDate();
        const to = `${month}-${String(lastDay).padStart(2, "0")}`;

        const data = await guestyGet("/reservations", {
          limit: 100,
          "checkIn[$gte]": from,
          "checkIn[$lte]": to,
          status: "confirmed",
        });
        const results = data.results || [];

        const agg = results.reduce(
          (acc, r) => {
            const m = r.money || {};
            acc.count += 1;
            acc.nights += r.nightsCount || 0;
            acc.fareAccommodation += m.fareAccommodation || 0;
            acc.fareCleaning += m.fareCleaning || 0;
            acc.hostPayout += m.hostPayout || 0;
            acc.totalPaid += m.totalPaid || 0;
            return acc;
          },
          {
            month,
            count: 0,
            nights: 0,
            fareAccommodation: 0,
            fareCleaning: 0,
            hostPayout: 0,
            totalPaid: 0,
          }
        );

        return asJsonResource(uri, agg);
      } catch (e) {
        return asErrorResource(uri, e);
      }
    }
  );

  // --- 7. Open tasks for a listing ---
  server.registerResource(
    "listing-tasks",
    new ResourceTemplate("guesty://listing/{listing_id}/tasks", {
      list: undefined,
    }),
    {
      title: "Open Tasks for Listing",
      description: "All open/pending tasks for a given listing.",
      mimeType: "application/json",
    },
    async (uri, { listing_id }) => {
      try {
        const data = await guestyGet("/tasks", {
          listingId: listing_id,
          status: "pending",
          limit: 50,
        });
        return asJsonResource(uri, data);
      } catch (e) {
        return asErrorResource(uri, e);
      }
    }
  );

  console.error("[resources] Registered 7 Guesty resource templates (guesty://)");
}
