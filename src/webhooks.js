import { createServer } from "http";

/**
 * Guesty Webhook Handler
 * Receives real-time events from Guesty:
 * - New reservation created
 * - Guest message received
 * - Review posted
 * - Reservation updated/canceled
 * - Check-in/check-out events
 */

const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || "3001", 10);

const eventHandlers = new Map();

export function onEvent(eventType, handler) {
  if (!eventHandlers.has(eventType)) {
    eventHandlers.set(eventType, []);
  }
  eventHandlers.get(eventType).push(handler);
}

function emit(eventType, data) {
  const handlers = eventHandlers.get(eventType) || [];
  const allHandlers = eventHandlers.get("*") || [];
  for (const h of [...handlers, ...allHandlers]) {
    try {
      h(data);
    } catch (e) {
      console.error(`Webhook handler error for ${eventType}:`, e.message);
    }
  }
}

export function startWebhookServer() {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const event = JSON.parse(body);
      const eventType = event.event || event.type || "unknown";

      console.log(`[webhook] Received: ${eventType}`);

      emit(eventType, event);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ received: true }));
    } catch (e) {
      console.error("[webhook] Parse error:", e.message);
      res.writeHead(400);
      res.end("Bad Request");
    }
  });

  server.listen(WEBHOOK_PORT, () => {
    console.log(`[webhook] Guesty webhook server listening on port ${WEBHOOK_PORT}`);
  });

  return server;
}

/**
 * Supported Guesty webhook events:
 * - reservation.created
 * - reservation.updated
 * - reservation.canceled
 * - reservation.checkin
 * - reservation.checkout
 * - conversation.new_message
 * - review.created
 * - listing.updated
 * - task.created
 * - task.completed
 */
