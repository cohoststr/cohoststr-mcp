#!/usr/bin/env node
/**
 * Gate tests for the license policy + the IoT/property-health aggregators.
 *
 * enterprise-tools.js transitively imports server.js which validates
 * GUESTY_CLIENT_ID + GUESTY_CLIENT_SECRET at module load (throws without
 * them) and calls initDB(). Dummy creds + a temp IoT DB are set BEFORE the
 * dynamic import so the test is self-contained.
 *
 * Real aggregator behaviour against live Guesty is integration-only. This file
 * validates: exports present; BOTH arms of ALL_TOOLS_FREE via the pure
 * isToolAllowedAt(); and that at the live policy the free tier reaches the
 * handlers (no isError from the gate).
 */
import os from "os";
import path from "path";
if (!process.env.GUESTY_CLIENT_ID) process.env.GUESTY_CLIENT_ID = "dummy-test-id";
if (!process.env.GUESTY_CLIENT_SECRET) process.env.GUESTY_CLIENT_SECRET = "dummy-test-secret";
process.env.IOT_DB_PATH = path.join(os.tmpdir(), "ent-test-" + Date.now() + ".json");

let passed = 0;
let failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ FAIL: ${msg}`); }
}

async function run() {
  console.log("=== License policy + aggregator gate tests ===\n");

  const lic = await import("../src/license.js");
  const { isToolAllowedAt, isToolAllowed, getTier, getTierInfo, gatedHandler, refusalMessage,
          ALL_TOOLS_FREE, FREE_TOOLS, GUESTY_FREE_TOOL_COUNT, LOCAL_TOOLS, TOTAL_TOOLS,
          PRO_TOOLS, ENT_TOOLS, PAID_TIERS_NOT_WIRED_MSG } = lic;
  const { __handlers } = await import("../src/enterprise-tools.js");

  // 1. exports
  console.log("1. __handlers export contract");
  assert(typeof __handlers === "object" && __handlers !== null, "__handlers is an object");
  for (const n of ["get_property_health", "submit_checkout_photos", "get_maintenance_alerts"])
    assert(typeof __handlers[n] === "function", `${n} is a function`);

  // 2. THE CLOSED ARM (allToolsFree=false) MUST REFUSE. A gate that has never
  //    returned false is decoration; this is the control for section 3.
  console.log("\n2. Closed arm (allToolsFree=false) — the gate can refuse");
  assert(isToolAllowedAt("free", "send_guest_message", false) === false, "free tier refuses a write tool");
  assert(isToolAllowedAt("free", "get_readiness_score", false) === false, "free tier refuses an IoT tool");
  assert(isToolAllowedAt("paid_not_yet_wired", "send_guest_message", false) === false, "paid_not_yet_wired refuses a write tool");
  assert(isToolAllowedAt("pro", "get_readiness_score", false) === false, "pro refuses an IoT tool");
  assert(isToolAllowedAt("free", "get_reservations", false) === true, "free tier permits a read-only tool");
  assert(isToolAllowedAt("free", "get_license_info", false) === true, "free tier permits the local meta-tool");
  assert(isToolAllowedAt("pro", "send_guest_message", false) === true, "pro permits a write tool");
  assert(isToolAllowedAt("enterprise", "get_readiness_score", false) === true, "enterprise permits an IoT tool");
  // Refusal copy on the closed arm must not prescribe a remedy the kill-switch disables.
  const rf = refusalMessage("send_guest_message", "free");
  assert(!/GUESTY_MCP_LICENSE_KEY/.test(rf) || lic.PAID_TIERS_LIVE, "free refusal does not tell the customer to set a key it would then refuse");
  assert(!rf.includes("paid_not_yet_wired") && !PAID_TIERS_NOT_WIRED_MSG.includes("paid_not_yet_wired"), "internal tier token is not leaked to the customer");
  assert(refusalMessage("send_guest_message", "paid_not_yet_wired") === PAID_TIERS_NOT_WIRED_MSG, "paid-prefix key gets the not-wired message verbatim");
  assert(!/gmcp_ent_\*/.test(refusalMessage("get_readiness_score", "pro")), "enterprise refusal names no key prefix");
  assert(/requires an Enterprise license/.test(refusalMessage("get_readiness_score", "free")), "IoT tool at free tier is refused with the ENTERPRISE copy, not the Pro copy");
  assert(/requires a Pro or higher/.test(refusalMessage("send_guest_message", "free")), "write tool at free tier is refused with the Pro copy");

  // 3. THE OPEN ARM (allToolsFree=true) permits everything, every tier.
  console.log("\n3. Open arm (allToolsFree=true) — every tool, every tier");
  for (const tier of ["free", "paid_not_yet_wired", "pro", "business", "enterprise"])
    for (const t of ["send_guest_message", "get_readiness_score", "get_reservations", "get_license_info"])
      assert(isToolAllowedAt(tier, t, true) === true, `${tier} permits ${t}`);

  // 4. THE LIVE POLICY as shipped. Free tier (no key) through the real gate.
  console.log(`\n4. Live policy (ALL_TOOLS_FREE=${ALL_TOOLS_FREE}) — free tier through the real gate`);
  delete process.env.GUESTY_MCP_LICENSE_KEY;
  assert(getTier() === "free", "no key resolves to free");
  const r4 = await gatedHandler("send_guest_message", async () => ({ content: [{ type: "text", text: "HANDLER RAN" }] }))({});
  const t4 = r4?.content?.[0]?.text || "";
  if (ALL_TOOLS_FREE) {
    assert(r4.isError !== true && t4 === "HANDLER RAN", "free tier: write tool handler RAN (not refused)");
    assert(isToolAllowed("get_readiness_score") === true, "free tier: IoT tool permitted");
    assert(FREE_TOOLS.length === TOTAL_TOOLS, `FREE_TOOLS covers the whole registered surface (${FREE_TOOLS.length})`);
    assert(PRO_TOOLS.every((t) => FREE_TOOLS.includes(t)) && ENT_TOOLS.every((t) => FREE_TOOLS.includes(t)), "every former Pro/Enterprise tool is in FREE_TOOLS");
  } else {
    assert(r4.isError === true && !t4.includes("HANDLER RAN"), "free tier: gated tool refused, handler never ran");
  }
  const i4 = getTierInfo();
  assert(i4.allToolsFree === ALL_TOOLS_FREE, "getTierInfo().allToolsFree reports the policy");
  assert(i4.licenseRequired === !ALL_TOOLS_FREE, "getTierInfo().licenseRequired is the policy's inverse");
  assert(i4.freeToolCount === GUESTY_FREE_TOOL_COUNT, "getTierInfo().freeToolCount reports the PUBLISHED figure");
  assert(i4.accessibleToolCount === (ALL_TOOLS_FREE ? TOTAL_TOOLS : FREE_TOOLS.length), "getTierInfo().accessibleToolCount reports the ACCESS figure");
  assert(i4.gatedToolCount === (ALL_TOOLS_FREE ? 0 : TOTAL_TOOLS - FREE_TOOLS.length), "getTierInfo().gatedToolCount reconciles");
  assert(GUESTY_FREE_TOOL_COUNT + LOCAL_TOOLS.length === FREE_TOOLS.length, `ledgers reconcile: ${GUESTY_FREE_TOOL_COUNT} guesty + ${LOCAL_TOOLS.length} local = ${FREE_TOOLS.length} access`);
  assert(GUESTY_FREE_TOOL_COUNT < FREE_TOOLS.length, "published capability figure is strictly below the access figure");

  // 5. The aggregators at the free tier, live policy. With an empty IoT DB and
  //    dummy Guesty creds they must degrade (empty lists / partial errors), not
  //    be refused by the gate and not throw.
  console.log("\n5. Aggregators at free tier — reach the handler, degrade gracefully");
  const call = async (name, params) => {
    try { return await __handlers[name](params); }
    catch (e) { return { content: [{ type: "text", text: `UNCAUGHT: ${e.message}` }], isError: true, uncaught: true }; }
  };
  const r5a = await call("get_maintenance_alerts", { severity: "all", active_only: true });
  const t5a = r5a?.content?.[0]?.text || "";
  assert(!r5a.uncaught, "get_maintenance_alerts did not throw");
  if (ALL_TOOLS_FREE) {
    assert(!/requires an Enterprise license|not yet available|not available/.test(t5a), "get_maintenance_alerts not refused by the gate");
    assert(r5a.isError !== true, "get_maintenance_alerts returns a non-error envelope on an empty DB");
  } else {
    assert(r5a.isError === true && /Enterprise license/.test(t5a), "closed policy: gate refuses with the Enterprise message");
  }
  const r5b = await call("submit_checkout_photos", { listingId: "listing-abc", reservationId: "res-123", photos: ["https://example.com/a.jpg"] });
  assert(!r5b.uncaught, "submit_checkout_photos did not throw");
  if (ALL_TOOLS_FREE) assert(!/requires an Enterprise license/.test(r5b?.content?.[0]?.text || ""), "submit_checkout_photos not refused by the gate");
  // Paid-prefix key: label changes, access does not.
  process.env.GUESTY_MCP_LICENSE_KEY = "test_ent";
  assert(getTier() === (lic.PAID_TIERS_LIVE ? "enterprise" : "paid_not_yet_wired"), "paid-prefix key resolves per PAID_TIERS_LIVE");
  const r5c = await call("get_maintenance_alerts", { severity: "all", active_only: true });
  assert(!r5c.uncaught, "paid-prefix key: aggregator did not throw");
  if (ALL_TOOLS_FREE) assert(r5c.isError !== true, "paid-prefix key: same access as free (not refused)");
  delete process.env.GUESTY_MCP_LICENSE_KEY;

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}
run().catch((e) => { console.error("Test error:", e); process.exit(1); });
