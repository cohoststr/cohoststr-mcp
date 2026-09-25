#!/usr/bin/env node
// Local stdio entry point: `npx -y cohoststr-mcp`.
// Credentials come from GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./tools.js";

// Kept for anything that imported these from the old single-file server.
export { buildReservationFilters, guestyGet } from "./tools.js";

// `npx cohoststr-mcp setup`: hidden-prompt setup that writes Claude Desktop's config (src/setup.js).
if (process.argv[2] === "setup") {
  const { runSetup } = await import("./setup.js");
  await runSetup();
  process.exit(0);
}

if (!process.env.GUESTY_CLIENT_ID || !process.env.GUESTY_CLIENT_SECRET) {
  console.error("Error: GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET environment variables are required.");
  process.exit(1);
}

const server = buildServer();
await server.connect(new StdioServerTransport());
