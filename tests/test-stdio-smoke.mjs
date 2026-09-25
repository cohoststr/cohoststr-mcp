// Spawns the real stdio entry (src/server.js) with dummy credentials and checks the
// handshake and tool census through the official MCP client. No Guesty call is made.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";

const PKG = createRequire(import.meta.url)("../package.json");
let failed = 0;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) failed++; };

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/server.js"],
  env: { ...process.env, GUESTY_CLIENT_ID: "dummy", GUESTY_CLIENT_SECRET: "dummy" },
  stderr: "ignore",
});
const client = new Client({ name: "stdio-smoke", version: "1" });
await client.connect(transport);

const info = client.getServerVersion();
ok(info?.name === "cohoststr-mcp", `serverInfo.name = ${info?.name}`);
ok(info?.version === PKG.version, `serverInfo.version ${info?.version} matches package.json ${PKG.version}`);

const { tools } = await client.listTools();
ok(tools.length === 44, `stdio registers 44 tools (got ${tools.length})`);
for (const name of ["send_guest_message", "update_listing_pricing", "get_reservations"]) {
  ok(tools.some((t) => t.name === name), `tool present: ${name}`);
}
// Negative control: a name that has never existed must not be found.
ok(!tools.some((t) => t.name === "list_reservations"), "phantom name list_reservations is absent");

const { prompts } = await client.listPrompts();
ok(prompts.length === 6, `6 workflow prompts listed (got ${prompts.length})`);
const got = await client.getPrompt({ name: "guest_reply", arguments: { guest: "Jane Doe" } });
ok(/Jane Doe/.test(got.messages[0].content.text) && /approve/.test(got.messages[0].content.text), "guest_reply prompt renders with the guest and the approval rule");
await client.close();
console.log(failed ? `FAIL stdio smoke (${failed})` : "PASS stdio smoke");
process.exit(failed ? 1 : 0);
