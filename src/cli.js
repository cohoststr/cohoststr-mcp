#!/usr/bin/env node
/**
 * Guesty CLI - Command line tool for quick Guesty queries
 * Usage: guesty-cli <command> [options]
 */

const GUESTY_CLIENT_ID = process.env.GUESTY_CLIENT_ID;
const GUESTY_CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET;

if (!GUESTY_CLIENT_ID || !GUESTY_CLIENT_SECRET) {
  console.error("Set GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET environment variables.");
  process.exit(1);
}

let token = null;

async function auth() {
  const res = await fetch("https://open-api.guesty.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials", scope: "open-api",
      client_id: GUESTY_CLIENT_ID, client_secret: GUESTY_CLIENT_SECRET,
    }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error("Auth failed");
  token = d.access_token;
}

async function api(path) {
  const res = await fetch(`https://open-api.guesty.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

const commands = {
  reservations: async () => {
    const d = await api("/reservations?limit=10&sort=checkIn&order=desc");
    console.log(`\nUpcoming Reservations (${d.count} total):\n`);
    for (const r of d.results || []) {
      const guest = r.guest?.fullName || "Unknown";
      const dates = `${r.checkIn?.slice(0,10)} → ${r.checkOut?.slice(0,10)}`;
      const listing = r.listing?.title?.slice(0,35) || "?";
      console.log(`  ${guest.padEnd(20)} | ${dates} | ${listing}`);
    }
  },
  listings: async () => {
    const d = await api("/listings?limit=25");
    console.log(`\nProperties (${d.count} total):\n`);
    for (const l of d.results || []) {
      const status = l.active ? "ACTIVE" : "OFF";
      console.log(`  ${(l.nickname||"?").padEnd(25)} | ${status.padEnd(6)} | ${l.title?.slice(0,40)}`);
    }
  },
  revenue: async () => {
    const d = await api("/reservations?limit=100&fields=money%20guest%20checkIn%20listing%20status");
    let total = 0;
    for (const r of d.results || []) total += r.money?.totalPaid || 0;
    console.log(`\nRevenue Summary:\n  Reservations: ${d.count}\n  Total Revenue: $${total.toLocaleString()}`);
  },
  reviews: async () => {
    const d = await api("/reviews?limit=5");
    console.log(`\nRecent Reviews (${d.count} total):\n`);
    for (const r of d.results || []) {
      console.log(`  ⭐ ${r.rating}/5 | ${r.guest?.fullName || "?"} | ${r.comment?.slice(0,60) || ""}`);
    }
  },
  help: () => {
    console.log(`
Guesty CLI - Quick property management queries

Commands:
  reservations  Show upcoming reservations
  listings      List all properties
  revenue       Revenue summary
  reviews       Recent guest reviews
  help          Show this help

Usage: GUESTY_CLIENT_ID=xxx GUESTY_CLIENT_SECRET=xxx node src/cli.js <command>
    `);
  },
};

const cmd = process.argv[2] || "help";
if (!commands[cmd]) {
  console.error(`Unknown command: ${cmd}. Run with 'help' for options.`);
  process.exit(1);
}

(async () => {
  try {
    if (cmd !== "help") await auth();
    await commands[cmd]();
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
})();
