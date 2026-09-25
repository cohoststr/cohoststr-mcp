// Shape tests for src/shapes.js against payloads MEASURED live on 2026-09-02
// (10-listing account). No network. Run: node tests/test-shapes.mjs
import { extractReviewRows, mapReviewRow, mapBlockedDay, BLOCK_TYPE_LEGEND } from "../src/shapes.js";
let failures = 0;
const ok = (m) => console.log("ok   " + m);
const fail = (m) => { failures++; console.error("FAIL: " + m); };
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : fail(m + ` -- got ${JSON.stringify(a)}`));

// 1. reviews: the real shape is { data, limit, skip }
const live = { data: [{ _id: "rv1", channelId: "airbnb2", listingId: "L1", guestId: "G1", reservationId: "R1",
  createdAt: "2026-08-30T12:00:00.000Z", rawReview: { reviewer_role: "guest", overall_rating: 5,
  public_review: "Great place! A tiny home that feels really spacious", private_feedback: "", hidden: false,
  submitted_at: "2026-08-30T11:59:00Z", category_ratings_cleanliness: 5 } }], limit: 100, skip: 0 };
eq(extractReviewRows(live).length, 1, "live { data: [...] } shape yields the row");
eq(extractReviewRows({ results: [{}, {}] }).length, 2, "legacy { results } shape still yields rows");
eq(extractReviewRows([{}]).length, 1, "bare array yields rows");
eq(extractReviewRows({ count: 3 }).length, 0, "control: a payload with neither key yields 0 rows");
const m = mapReviewRow(live.data[0]);
eq([m.rating, m.channel, m.listingId, m.reviewerRole, m.date], [5, "airbnb2", "L1", "guest", "2026-08-30"], "review row maps rating/channel/listing/role/date from rawReview + row");
eq(m.comment.startsWith("Great place!"), true, "review text comes from rawReview.public_review");
// The OLD mapper read r.rating / r.comment — on the live row those are undefined. Control: prove the old read fails.
eq([live.data[0].rating, live.data[0].comment], [undefined, undefined], "control: the pre-fix fields do not exist on a live row (why every caller saw [])");

// 1b. Booking.com review shape (measured live): scoring.review_score 1-10, content.{headline,positive,negative}
const bk = mapReviewRow({ _id: "rv2", channelId: "bookingCom", listingId: "L2", createdAt: "2026-08-01T00:00:00.000Z",
  rawReview: { review_id: 1, scoring: { clean: null, review_score: 8 }, content: { headline: "Nice", positive: "Quiet spot", negative: "Cold shower", language_code: "en" },
  reviewer: { name: "Sam", country_code: "us" }, reply: null } });
eq([bk.rating, bk.ratingScale, bk.reviewerName, bk.comment], [8, 10, "Sam", "Nice | Quiet spot | Cold shower"], "Booking.com row maps review_score/10, reviewer name, and joined content");
eq([m.ratingScale], [5], "Airbnb row reports a 5-point scale");
eq(mapReviewRow({ _id: "x", rawReview: {} }).rating, null, "control: a row with no rating anywhere yields null, not a crash");

// 2. calendar blocks: live day shape
const day = { date: "2026-09-02", status: "booked", reservationId: "RES1",
  blocks: { m: false, r: false, b: true, bd: false, sr: false, abl: false, a: false, bw: false, o: false, pt: false, an: true },
  blockRefs: [{ type: "b", startDate: "2026-09-02T00:00:00.000Z", endDate: "2026-09-05T00:00:00.000Z", reservationId: "RES1",
    reservation: { confirmationCode: "ABC123", source: "airbnb2" } }, { type: "an", startDate: "2026-09-02T00:00:00.000Z", endDate: "2026-09-02T00:00:00.000Z" }] };
const b = mapBlockedDay(day);
eq(b.blockTypes, ["b", "an"], "only TRUE flags are listed as block types");
eq(b.blockReason, "booking, an (Guesty flag, passed through)", "reason names the four known types and passes unknown keys through");
eq(b.blockRefs[0], { type: "b", startDate: "2026-09-02", endDate: "2026-09-05", reservationId: "RES1", confirmationCode: "ABC123", source: "airbnb2", note: null }, "blockRef summarised with reservation code + source");
const manual = mapBlockedDay({ date: "2026-09-10", status: "unavailable", blocks: { m: true, o: false, b: false, r: false }, blockRefs: [] });
eq([manual.blockTypes, manual.blockReason], [["m"], "manual block"], "manual block (#4's case) is named");
const owner = mapBlockedDay({ date: "2026-09-11", status: "unavailable", blocks: { o: true }, blockRefs: [] });
eq(owner.blockReason, "owner block", "owner block is named");
const reserved = mapBlockedDay({ date: "2026-09-12", status: "reserved", blocks: { r: true }, blockRefs: [] });
eq(reserved.blockReason, BLOCK_TYPE_LEGEND.r, "reserved is named");
eq(mapBlockedDay({ date: "x", status: "unavailable" }).blockReason, "unknown", "control: a day with no blocks object falls back to unknown, not a crash");
for (const k of ["m", "o", "b", "r"]) if (!(k in BLOCK_TYPE_LEGEND)) fail(`legend missing ${k}`);
ok("legend carries m/o/b/r");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nPASS shapes");
process.exit(failures ? 1 : 0);
