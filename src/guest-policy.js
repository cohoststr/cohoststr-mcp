// Channel-policy screen for outgoing guest messages.
//
// Airbnb, Vrbo and Booking.com all penalise hosts for taking guests off-platform:
// sharing an email or phone number before booking, asking for payment outside the
// channel, or steering the guest to "book direct". One flagged message can get a
// listing suspended, which costs far more than a slow reply. So a message that
// looks like any of these is held unless the caller explicitly accepts the risk
// (e.g. the conversation is a direct booking, where these rules do not apply).
const RULES = [
  { id: "email-address", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, why: "contains an email address" },
  { id: "phone-number", re: /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, why: "contains a phone number" },
  { id: "off-platform-payment", re: /\b(zelle|venmo|paypal|cash ?app|wire transfer|western union|bitcoin|crypto)\b/i, why: "asks for or mentions payment outside the booking channel" },
  { id: "book-direct", re: /\b(book(ing)? direct(ly)?|outside (of )?(airbnb|vrbo|booking\.com)|off (the )?platform)\b/i, why: "steers the guest to book or talk off the platform" },
];

export function screenGuestMessage(text) {
  const hits = RULES.filter((r) => r.re.test(String(text || ""))).map((r) => ({ rule: r.id, why: r.why }));
  return { ok: hits.length === 0, hits };
}

export const DRAFTING_RULES = [
  "Use ONLY the facts below. If the guest asks something the facts do not answer, say you will check and get back to them. Never invent a door code, Wi-Fi password, address detail, time or fee.",
  "Answer the guest's actual question first, in one or two short sentences.",
  "On Airbnb, Vrbo and Booking.com threads, do not include email addresses, phone numbers, payment outside the platform, or invitations to book direct.",
  "Do not promise refunds, discounts, early check-in or late check-out unless the host has approved it.",
  "The draft is NOT sent. Show it to the host; send it with send_guest_message only after they approve.",
];
