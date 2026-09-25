// draft_guest_reply grounds on real listing facts and sends nothing; send_guest_message screens channel-policy risk.
process.env.GUESTY_TOKEN_CACHE_FILE = "off";
process.env.GUESTY_CLIENT_ID = "cid"; process.env.GUESTY_CLIENT_SECRET = "sec";
let posts = 0; const seen = [];
globalThis.fetch = async (u, init = {}) => {
  u = String(u); const m = init.method || "GET"; seen.push(m + " " + u.split("?")[0].replace("https://open-api.guesty.com/v1", ""));
  const J = (o) => new Response(JSON.stringify(o), { status: 200 });
  if (u.includes("/oauth2/token")) return J({ access_token: "t", expires_in: 86400 });
  if (m === "POST") { posts++; return J({ _id: "m1" }); }
  if (u.endsWith("/communication/conversations") || u.includes("/communication/conversations?")) return J({ status: 200, data: { count: 1, conversations: [{ _id: "C1", meta: { guest: { fullName: "Billy Test" }, reservations: [{ _id: "R1", listing: { title: "Deluxe Cabin" } }] } }] } });
  if (u.includes("/posts")) return J({ results: [{ sentBy: "guest", createdAt: "2026-09-24T19:04:00Z", body: "How do we get our keys?" }, { sentBy: "host", createdAt: "2026-09-20T10:00:00Z", body: "Welcome!" }] });
  if (u.includes("/communication/conversations/C1")) return J({ _id: "C1", guest: { fullName: "Billy Test" }, reservationId: "R1" });
  if (u.includes("/reservations/R1")) return J({ status: "confirmed", source: "Booking.com", checkInDateLocalized: "2026-09-24", checkOutDateLocalized: "2026-09-27", nightsCount: 3, guestsCount: 2, listingId: "L1" });
  if (u.includes("/listings/L1")) return J({ title: "Deluxe Cabin", address: { city: "Buena Vista" }, defaultCheckInTime: "16:00", defaultCheckOutTime: "10:00", accommodates: 4, publicDescription: { access: "Keys are in the drop box by the front door.", houseRules: "No smoking." } });
  return J({});
};
const { buildServer } = await import("../src/tools.js");
const server = buildServer({ hosted: false });
const call = async (n, a) => { const r = await server._registeredTools[n].handler(a, {}); return { err: !!r.isError, text: (r.content || []).map((c) => c.text).join("\n") }; };
let fails = 0; const check = (n, c) => { console.log((c ? "PASS " : "FAIL ") + n); if (!c) fails++; };

const d = await call("draft_guest_reply", { conversationId: "C1" });
const j = JSON.parse(d.text);
check("draft carries the listing's real access note", j.listing.access === "Keys are in the drop box by the front door.");
check("draft carries check-in time and dates", j.listing.checkInTime === "16:00" && j.reservation.checkIn === "2026-09-24" && j.reservation.channel === "Booking.com");
check("guest's question is the last message", j.recentMessages.at(-1).from === "guest" && /keys/.test(j.recentMessages.at(-1).text));
check("missing facts are marked do-not-guess", j.listing.notes === "unknown - do not guess");
check("draft sent nothing", posts === 0 && !seen.some((s) => s.startsWith("POST") && !s.includes("oauth2")));

const bad = [["email", "Email me at host@example.com"], ["phone", "Call 719-555-0123 when you arrive"], ["zelle", "You can pay the fee by Zelle"], ["direct", "Next time book direct and save"]];
for (const [k, msg] of bad) {
  const r = await call("send_guest_message", { conversationId: "C1", message: msg });
  check(`policy screen holds ${k}`, r.err && /NOT SENT/.test(r.text) && posts === 0);
}
const code = await call("send_guest_message", { conversationId: "C1", message: "Your door code is 4821. Check-in is 4 PM." });
check("NEGCTRL ordinary message with a door code is sent", !code.err && posts === 1);
const over = await call("send_guest_message", { conversationId: "C1", message: "Email me at host@example.com", allowPolicyRisk: true });
check("allowPolicyRisk sends a held message (direct booking)", !over.err && posts === 2);
// Regression: the live API wraps conversations as { status, data: { conversations } }; the tool used to read .results and return 0.
const gcv = JSON.parse((await call("get_conversations", {})).text);
check("get_conversations reads the wrapped live shape", gcv.conversations.length === 1 && gcv.conversations[0].guestName === "Billy Test" && gcv.conversations[0].reservationId === "R1");
console.log(fails ? `FAILED ${fails}` : "ALL PASS"); process.exit(fails ? 1 : 0);
