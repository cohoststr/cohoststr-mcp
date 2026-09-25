/**
 * CohostSTR MCP server — License Key System (v3)
 *
 * ALL_TOOLS_FREE=true — Owner ruling 2026-09-02 (TG 8336, "Make them free for
 *   now"). EVERY REGISTERED TOOL IS PERMITTED AT EVERY TIER, with or without a
 *   key. The tier ledgers below (READ_ONLY_TOOLS / PRO_TOOLS / ENT_TOOLS /
 *   LOCAL_TOOLS) are kept as NAMED LISTS so that the gate can be re-armed later
 *   by flipping one constant — not because anything is withheld today. Nothing
 *   in this module refuses a call while ALL_TOOLS_FREE is true; the refusal
 *   copy further down is dormant and is exercised only through the pure
 *   isToolAllowedAt() function in the test suite.
 *
 *   WHY A SWITCH AND NOT A DELETION: paid tiers were gated for ~4 months while
 *   no billing existed, so 19 of 43 advertised tools returned isError to every
 *   caller. That was worse than free. Opening them is a policy change, and a
 *   policy should live in exactly one line that a test can flip both ways.
 *
 * PAID_TIERS_LIVE=false remains as the paid-key kill-switch: a paid-prefix key
 *   (gmcp_pro_* / gmcp_biz_* / gmcp_ent_*, test_pro/biz/ent) is recognized and
 *   reported as "paid_not_yet_wired" — FOR REPORTING ONLY. It does not change
 *   access, because access is already total.
 *
 * 3-Layer Monetization Model:
 * - Layer 1: MCP Server = operations/data tool (FREE, lead gen)  <-- this file
 * - Layer 2: CohostSTR = SaaS platform (PAID — not yet available)
 *
 * Reads GUESTY_MCP_LICENSE_KEY from env. Optional. Absent, invalid, free or
 * paid-prefix — every key resolves to the same, complete tool surface today.
 */

// THE POLICY. One line. Flip to false to re-arm tier gating (and re-run the
// test suite: tests/test-enterprise.js asserts both arms of this switch).
const ALL_TOOLS_FREE = true;

// Paid-tier kill-switch. Flip to true ONLY when the payment webhook + signed-key
// validation ship. While false: paid-prefix keys resolve to "paid_not_yet_wired".
// With ALL_TOOLS_FREE=true this affects the tier LABEL only, never access.
const PAID_TIERS_LIVE = false;

// ---------------------------------------------------------------------------
// THE LEDGERS. Four named lists whose union is the registered tool surface.
// tests/test-remote-toolsync.mjs asserts that union against the real
// server.tool() registrations in both directions, so a tool added to server.js
// without being placed in a ledger fails the build instead of going off-census
// (which is exactly how get_license_info became an uncounted 24th tool in 2026-08).
// ---------------------------------------------------------------------------

// Read-only Guesty operations and data tools.
const READ_ONLY_TOOLS = [
  // Reservations (read-only)
  "get_reservations",
  "search_reservations",
  "get_reservation_financials",
  // Listings (read-only)
  "get_listing",
  "get_listing_occupancy",
  "get_listing_pricing",
  "get_photos",
  // Guests (read-only)
  "get_guests",
  "get_guest_by_id",
  // Calendar (read-only)
  "get_calendar",
  "get_calendar_blocks",
  // Financials (read-only)
  "get_financials",
  "get_owner_statements",
  "get_expenses",
  "get_revenue_summary",
  // Operations (read-only)
  "get_tasks",
  "get_channels",
  "get_automation_rules",
  "get_custom_fields",
  "get_account_info",
  "get_supported_languages",
  // Reviews (read-only)
  "get_reviews",
  // Webhooks (read-only)
  "get_webhooks",
];

// Guest communication, writes and real-time events. Formerly the Pro tier.
// get_conversations is read-only but sits here because it returns message content.
const PRO_TOOLS = [
  "get_conversations",
  "draft_guest_reply",
  "send_guest_message",
  "respond_to_review",
  "create_webhook",
  "delete_webhook",
  "create_reservation",
  "update_reservation",
  "create_reservation_note",
  "update_pricing",
  "update_calendar",
  "update_listing",
  "update_photos",
  "update_listing_pricing",
  "create_expense",
  "create_task",
];

// IoT + property aggregator tools. Formerly the Enterprise tier. They read the
// local IoT database fed by the optional webhook receiver; with no devices
// reporting they return empty device lists / null signals, not errors.
const ENT_TOOLS = [
  "get_readiness_score",
  "get_property_health",
  "submit_checkout_photos",
  "get_maintenance_alerts",
];

// Server-local: makes no Guesty API call, reports this module's own state.
// Counted in the registered surface, NOT in the Guesty-capability figure — a
// customer asking "how many tools do I get" is asking what we do with THEIR
// account, and inflating that by one with a meta-tool is the honesty defect we
// removed on 2026-08-06. Do not collapse the two figures.
const LOCAL_TOOLS = ["get_license_info"];

// What isToolAllowed() permits at the free tier. DERIVED from the policy.
const FREE_TOOLS = ALL_TOOLS_FREE
  ? [...READ_ONLY_TOOLS, ...PRO_TOOLS, ...ENT_TOOLS, ...LOCAL_TOOLS]
  : [...READ_ONLY_TOOLS, ...LOCAL_TOOLS];

// Published capability figure: free tools that touch the customer's Guesty account.
const GUESTY_FREE_TOOL_COUNT = FREE_TOOLS.filter(
  (t) => !LOCAL_TOOLS.includes(t)
).length;

// Registered surface. DERIVED from the ledgers (was a hand-typed 43 until
// 2026-09-02); the toolsync test checks it against a live registration census.
const TOTAL_TOOLS =
  READ_ONLY_TOOLS.length + PRO_TOOLS.length + ENT_TOOLS.length + LOCAL_TOOLS.length;

// Shown to a caller who supplied a paid-prefix key and hit a refused tool.
// UNREACHABLE while ALL_TOOLS_FREE is true (nothing is refused). Names no
// version, no date, no vendor and no key format, so it cannot go stale on its
// own — keep that property if you edit it. The count is interpolated, not typed.
const PAID_TIERS_NOT_WIRED_MSG =
  "Free tier is live and fully functional — " + GUESTY_FREE_TOOL_COUNT +
  " Guesty tools, no license key required and nothing to configure.\n\n" +
  "Paid tiers (Pro, Business, Enterprise) are not available, so there is " +
  "no key to enter.\n\n" +
  "Any change will be announced in the release notes.";

// Business tier: operational/SLA features the binary advertises (consumed by getTierInfo).
const BIZ_FEATURES = {
  multiAccountLicense: true,
  prioritySupport: true,
};

// Key-to-tier mapping. Label only while ALL_TOOLS_FREE is true.
function resolveTier(licenseKey) {
  if (!licenseKey) return "free";
  const key = licenseKey.trim();
  const isPaidPrefix =
    key.startsWith("gmcp_ent_") ||
    key.startsWith("gmcp_biz_") ||
    key.startsWith("gmcp_pro_") ||
    key === "test_pro" ||
    key === "test_biz" ||
    key === "test_ent";
  if (isPaidPrefix && !PAID_TIERS_LIVE) return "paid_not_yet_wired";
  if (key.startsWith("gmcp_ent_")) return "enterprise";
  if (key.startsWith("gmcp_biz_")) return "business";
  if (key.startsWith("gmcp_pro_")) return "pro";
  if (key === "test_pro") return "pro";
  if (key === "test_biz") return "business";
  if (key === "test_ent") return "enterprise";
  return "free";
}

function getTier() {
  return resolveTier(process.env.GUESTY_MCP_LICENSE_KEY);
}

// PURE access decision. Exported so the test suite can exercise BOTH arms of
// the policy switch without editing this file — a gate whose closed arm has
// never been shown to refuse is decoration, not a gate.
function isToolAllowedAt(tier, toolName, allToolsFree = ALL_TOOLS_FREE) {
  if (allToolsFree) return true;
  if (tier === "free" || tier === "paid_not_yet_wired") {
    return READ_ONLY_TOOLS.includes(toolName) || LOCAL_TOOLS.includes(toolName);
  }
  if (ENT_TOOLS.includes(toolName)) return tier === "enterprise";
  return true;
}

function isToolAllowed(toolName) {
  return isToolAllowedAt(getTier(), toolName);
}

function getTierInfo() {
  const tier = getTier();
  const totalTools = TOTAL_TOOLS;
  const entToolCount = ENT_TOOLS.length;
  const baseToolCount = totalTools - entToolCount;
  const accessibleCount = ALL_TOOLS_FREE
    ? totalTools
    : tier === "free" || tier === "paid_not_yet_wired" ? FREE_TOOLS.length
    : tier === "enterprise" ? totalTools
    : baseToolCount;
  return {
    tier,
    hasKey: !!process.env.GUESTY_MCP_LICENSE_KEY,
    allToolsFree: ALL_TOOLS_FREE,
    licenseRequired: !ALL_TOOLS_FREE,
    // freeToolCount = PUBLISHED capability figure (Guesty tools callable free).
    // accessibleToolCount = GATE figure (what isToolAllowed permits). They
    // reconcile as freeToolCount + localToolCount === accessibleToolCount.
    freeToolCount: GUESTY_FREE_TOOL_COUNT,
    localToolCount: LOCAL_TOOLS.length,
    baseToolCount,
    entToolCount,
    accessibleToolCount: accessibleCount,
    gatedToolCount: totalTools - accessibleCount,
    unlocked: ALL_TOOLS_FREE || (tier !== "free" && tier !== "paid_not_yet_wired"),
    paidTiersLive: PAID_TIERS_LIVE,
    paidKeyDetected: tier === "paid_not_yet_wired",
    bizFeatures: tier === "business" || tier === "enterprise" ? BIZ_FEATURES : null,
  };
}

// Refusal copy for a tool the current tier may not call. DORMANT while
// ALL_TOOLS_FREE is true; exercised via the pure function in tests.
function refusalMessage(toolName, tier) {
  if (tier === "paid_not_yet_wired") return PAID_TIERS_NOT_WIRED_MSG;
  // ENT tools first: at ANY non-enterprise tier the remedy is Enterprise, so the
  // Pro copy below would name the wrong tier for them (caught by the flip
  // control in tests/test-enterprise.js on 2026-09-02 before it shipped).
  if (ENT_TOOLS.includes(toolName)) {
    const included = tier === "free"
      ? READ_ONLY_TOOLS.length
      : TOTAL_TOOLS - ENT_TOOLS.length - LOCAL_TOOLS.length;
    return "This tool (" + toolName + ") requires an Enterprise license. " +
      "Your current tier (" + tier + ") includes " + included + " Guesty tools. " +
      "Enterprise adds IoT readiness, property health, checkout photo intake, " +
      "and maintenance alerts (" + ENT_TOOLS.length + " additional tools). " +
      "Talk to us at https://cohoststr.com/pricing";
  }
  if (tier === "free") {
    // The upgrade instruction is CONDITIONAL ON THE SWITCH, not on copy
    // discipline: telling a caller to set a key the kill-switch will refuse is
    // the defect this branch shipped with for months (see 0.9.8 changelog).
    return "This tool (" + toolName + ") requires a Pro or higher license. " +
      "Free tier includes " + GUESTY_FREE_TOOL_COUNT + " operations and data tools. " +
      "Guest messaging, review responses, and write operations require Pro+. " +
      (PAID_TIERS_LIVE
        ? "Set GUESTY_MCP_LICENSE_KEY env var to unlock all " + TOTAL_TOOLS + " tools. " +
          "Upgrade at https://cohoststr.com/pricing"
        : "Paid tiers are not available, so there is no key to enter. " +
          "Any change will be announced in the release notes.");
  }
  return "This tool (" + toolName + ") is not available in your current tier (" + tier + ").";
}

function gatedHandler(toolName, handler) {
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

export {
  getTier,
  isToolAllowed,
  isToolAllowedAt,
  getTierInfo,
  gatedHandler,
  refusalMessage,
  ALL_TOOLS_FREE,
  READ_ONLY_TOOLS,
  PRO_TOOLS,
  FREE_TOOLS,
  GUESTY_FREE_TOOL_COUNT,
  LOCAL_TOOLS,
  ENT_TOOLS,
  TOTAL_TOOLS,
  BIZ_FEATURES,
  PAID_TIERS_LIVE,
  PAID_TIERS_NOT_WIRED_MSG,
};
