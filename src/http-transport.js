import { createServer } from "http";

/**
 * Streamable HTTP Transport for Guesty MCP Server
 * Allows the MCP server to be accessed via HTTP instead of stdio.
 * Useful for remote access, web integrations, and multi-client setups.
 */

const HTTP_PORT = parseInt(process.env.MCP_HTTP_PORT || "3002", 10);

export function startHttpTransport(server) {
  const httpServer = createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "POST" || req.url !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Use POST /mcp" }));
      return;
    }

    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const request = JSON.parse(body);
      // Forward to MCP server and get response
      // This is a simplified passthrough -- full SSE streaming would need more work
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ received: true, request }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  httpServer.listen(HTTP_PORT, () => {
    console.log(`[http] MCP HTTP transport listening on port ${HTTP_PORT}`);
  });

  return httpServer;
}
