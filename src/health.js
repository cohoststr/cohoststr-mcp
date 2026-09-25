import { createServer } from "http";
import { createRequire } from "node:module";

// [2026-08-06 CTO] THIRD FROZEN-LITERAL SITE FOUND IN ONE SWEEP, AND THE ONLY
// REASON IT WAS FOUND IS THAT I GREPPED FOR THE *CLASS* AFTER FIXING THE
// INSTANCE. This file reported version "0.2.0" and toolCount 15 -- the version
// frozen ~40 releases back, the count wrong under every reading of the current
// surface (43 registered, 23-24 free). src/http-server.js already derived its
// version from package.json and said so in a pin-comment; server.js and this
// file did not, so the codebase held BOTH the fix and the defect side by side.
// A hand-typed number is a promise to update it by hand forever. Version is now
// derived; toolCount is DELETED rather than corrected -- a health endpoint has
// no business restating a figure that is authoritative elsewhere, and a number
// with no owner is the thing that goes stale.
// NOTE: this module currently has ZERO importers (grep for `startHealthCheck`
// returns only its own definition, with a positive control on license.js
// returning four real consumers). It is dead code that still SHIPS, so its
// claims are readable by anyone who opens the tarball even though nothing
// executes them. Dead code is not exempt from being true.
const PKG_VERSION = (() => {
  try {
    return createRequire(import.meta.url)("../package.json").version;
  } catch {
    return "0.0.0-unresolved";
  }
})();

const startTime = Date.now();
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || "3003", 10);

export function startHealthCheck(guestyAuthFn) {
  const server = createServer(async (req, res) => {
    if (req.url !== "/health" && req.url !== "/") {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const uptime = Math.floor((Date.now() - startTime) / 1000);
    let guestyStatus = "unknown";

    try {
      await guestyAuthFn();
      guestyStatus = "connected";
    } catch (e) {
      guestyStatus = `error: ${e.message}`;
    }

    const health = {
      status: guestyStatus === "connected" ? "healthy" : "degraded",
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`,
      guestyApi: guestyStatus,
      version: PKG_VERSION,
      transport: "stdio",
      timestamp: new Date().toISOString(),
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(health, null, 2));
  });

  server.listen(HEALTH_PORT, () => {
    console.log(`[health] Health check endpoint at http://localhost:${HEALTH_PORT}/health`);
  });

  return server;
}
