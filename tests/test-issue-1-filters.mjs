// Offline smoke test for Issue #1 fix — verifies filter builder emits correct
// Guesty Open API shape for all four bug reproductions.
import { buildReservationFilters } from "../src/tools.js";

function eq(label, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const ok = g === w;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) { console.log("  got: ", g); console.log("  want:", w); process.exitCode = 1; }
  return ok;
}

// T1: 2024 historical window (user's repro) — NO context:"now"
eq("T1 2024 window via between",
  buildReservationFilters({ checkInFrom: "2024-01-01", checkInTo: "2024-12-31" }),
  [{ field: "checkIn", operator: "$between", from: "2024-01-01", to: "2024-12-31" }]);

// T2: listingId + date window — listingId MUST move inside filters
eq("T2 listingId + window both in filters",
  buildReservationFilters({ listingId: "abc123", checkInFrom: "2025-06-01", checkInTo: "2025-08-31" }),
  [
    { field: "listingId", operator: "$eq", value: "abc123" },
    { field: "checkIn", operator: "$between", from: "2025-06-01", to: "2025-08-31" },
  ]);

// T3: revenue summary — listingId + confirmed status + window
eq("T3 revenue summary full filter",
  buildReservationFilters({ listingId: "abc123", checkInFrom: "2026-01-01", checkInTo: "2026-04-30", status: "confirmed" }),
  [
    { field: "listingId", operator: "$eq", value: "abc123" },
    { field: "status", operator: "$eq", value: "confirmed" },
    { field: "checkIn", operator: "$between", from: "2026-01-01", to: "2026-04-30" },
  ]);

// T4: one-sided bound
eq("T4 checkInFrom only uses $gte",
  buildReservationFilters({ checkInFrom: "2024-06-01" }),
  [{ field: "checkIn", operator: "$gte", value: "2024-06-01" }]);

// T5: no params — empty filters (fall through to plain listingId path)
eq("T5 empty input yields empty filters",
  buildReservationFilters({}),
  []);

// T6: NO context:"now" anywhere in output — critical regression check
const dumps = JSON.stringify(buildReservationFilters({
  listingId: "x", checkInFrom: "2024-01-01", checkInTo: "2024-12-31",
  checkOutFrom: "2024-01-05", checkOutTo: "2024-12-31",
  status: "confirmed",
}));
eq("T6 no context:\"now\" leakage", /context/.test(dumps), false);

// T7: checkOut window works too
eq("T7 checkOut window",
  buildReservationFilters({ checkOutFrom: "2024-01-05", checkOutTo: "2024-12-31" }),
  [{ field: "checkOut", operator: "$between", from: "2024-01-05", to: "2024-12-31" }]);

// T8: both check-in and check-out bounds
eq("T8 both checkIn + checkOut windows",
  buildReservationFilters({ checkInFrom: "2024-01-01", checkInTo: "2024-06-30", checkOutFrom: "2024-01-05", checkOutTo: "2024-07-05" }),
  [
    { field: "checkIn",  operator: "$between", from: "2024-01-01", to: "2024-06-30" },
    { field: "checkOut", operator: "$between", from: "2024-01-05", to: "2024-07-05" },
  ]);

if (!process.exitCode) console.log("\n✅ 8/8 offline filter-builder regression passed");
