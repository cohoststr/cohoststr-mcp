// Token budget, persistence and 401-refresh. No network: fetch is mocked.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
const dir = mkdtempSync(join(tmpdir(), "gc-tok-"));
process.env.GUESTY_TOKEN_CACHE_FILE = join(dir, "tokens.json");
process.env.GUESTY_TOKEN_BUDGET = "3";
process.env.GUESTY_CLIENT_ID = "cid-test"; process.env.GUESTY_CLIENT_SECRET = "sec-test";
const gc = await import("../src/guesty-client.js");
let tokenCalls = 0, apiCalls = 0, fail401 = 0, tokenOk = true;
globalThis.fetch = async (u, init) => {
  u = String(u);
  if (u.includes("/oauth2/token")) {
    tokenCalls++;
    if (!tokenOk) return new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
    return new Response(JSON.stringify({ access_token: "tok" + tokenCalls, expires_in: 86400 }), { status: 200 });
  }
  apiCalls++;
  if (fail401 > 0) { fail401--; return new Response("unauthorized", { status: 401 }); }
  return new Response(JSON.stringify({ ok: true, auth: init.headers.Authorization }), { status: 200 });
};
let fails = 0; const check = (name, cond) => { console.log((cond ? "PASS " : "FAIL ") + name); if (!cond) fails++; };

// 1. first call mints one token; second reuses it
await gc.guestyGet("/x"); await gc.guestyGet("/x");
check("one token for two calls", tokenCalls === 1);
// 2. survives a restart (memory dropped, file kept)
gc._clearTokenCache();
const r = await gc.guestyGet("/x");
check("token reused after restart (no new request)", tokenCalls === 1 && r.auth === "Bearer tok1");
check("cache file is 0600", (statSync(process.env.GUESTY_TOKEN_CACHE_FILE).mode & 0o777) === 0o600);
// 3. a 401 refreshes exactly once and succeeds
fail401 = 1;
const r2 = await gc.guestyGet("/x");
check("401 -> one refresh -> success", tokenCalls === 2 && r2.auth === "Bearer tok2");
// 4. a persistent 401 does not loop
fail401 = 5; let threw = false;
try { await gc.guestyGet("/x"); } catch { threw = true; }
check("persistent 401 refreshes once then fails (no loop)", threw && tokenCalls === 3);
// 5. budget: 3 used, the 4th is refused WITHOUT calling Guesty
fail401 = 0; gc._clearTokenCache();
// expire the cached token by forcing a refresh
let refused = null;
try { await gc.getToken({ forceRefresh: true }); } catch (e) { refused = e; }
check("4th token request refused by budget", refused instanceof gc.TokenBudgetError && tokenCalls === 3);
check("status reports budget reached", gc.getTokenBudgetStatus().tokenRequestsLast24h === 3 && !!gc.getTokenBudgetStatus().nextSlotFreesAt);
// 6. NEGATIVE CONTROL: with budget raised the same request goes through (proves the refusal was the budget)
// (fresh module state via a new creds pair)
process.env.GUESTY_CLIENT_ID = "cid-other";
await gc.getToken();
check("NEGCTRL other tenant unaffected by first tenant's budget", tokenCalls === 4);
// 7. failed token requests still count
process.env.GUESTY_CLIENT_ID = "cid-bad"; tokenOk = false;
for (let i = 0; i < 4; i++) { try { await gc.getToken({ forceRefresh: true }); } catch {} }
check("failed requests count toward budget (3 calls, 4th refused)", tokenCalls === 7);
rmSync(dir, { recursive: true, force: true });
console.log(fails ? `FAILED ${fails}` : "ALL PASS"); process.exit(fails ? 1 : 0);
