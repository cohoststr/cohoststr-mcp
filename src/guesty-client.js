// Guesty Open API client.
//
// Credentials come from the current request context when one is set (hosted,
// multi-tenant mode) and from GUESTY_CLIENT_ID / GUESTY_CLIENT_SECRET otherwise
// (local stdio mode). AsyncLocalStorage carries the context through every await
// inside a tool handler, so tool code never has to know which mode it runs in.
//
// Tokens are cached per client ID. One tenant's token can never be returned for
// another tenant's request: the cache key is the client ID the request carries.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export const GUESTY_API_BASE = "https://open-api.guesty.com/v1";
const TOKEN_URL = "https://open-api.guesty.com/oauth2/token";

const als = new AsyncLocalStorage();
const tokenCache = new Map(); // key -> { token, expiry, pending }

// ---- token budget + persistence ---------------------------------------------
// Guesty allows only a handful of OAuth token requests per client per 24 hours
// (5 at the time of writing), and each token lives 24 hours. An integration that
// keeps tokens only in memory burns one request per restart, and one that treats
// every 401 as "get a new token" can exhaust the day's allowance in minutes and
// lock the account out of its own API. So:
//   1. Tokens are PERSISTED (hosted: encrypted in the service store; local: a
//      0600 file under ~/.guesty-mcp) and reused across restarts.
//   2. Every token request is COUNTED per client over a rolling 24h window, and
//      the client REFUSES to make one beyond GUESTY_TOKEN_BUDGET (default 4 -
//      one below Guesty's cap, leaving a request for the customer's other tools).
//   3. A 401 invalidates the cached token and retries ONCE, inside the budget.
const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_BUDGET = Math.max(1, parseInt(process.env.GUESTY_TOKEN_BUDGET || "4", 10));
let persistence = null; // { load(key) -> {token, expiry, requests[]} | undefined, save(key, rec) }

/** Plug in token persistence (hosted mode uses the encrypted service store). */
export function configureTokenPersistence(p) { persistence = p; }

function defaultFilePersistence() {
  const setting = process.env.GUESTY_TOKEN_CACHE_FILE;
  if (setting === "off") return null;
  const file = setting || join(homedir(), ".guesty-mcp", "tokens.json");
  const readAll = () => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return {}; } };
  return {
    load: (key) => readAll()[key],
    save: (key, rec) => {
      try {
        const all = readAll();
        all[key] = rec;
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        const tmp = `${file}.tmp-${process.pid}`;
        writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
        renameSync(tmp, file);
      } catch { /* cache is an optimisation; never fail a request over it */ }
    },
  };
}

function persist() { return persistence === null ? (persistence = defaultFilePersistence() || false) : persistence; }

function loadRecord(key) {
  const mem = tokenCache.get(key);
  if (mem) return mem;
  const p = persist();
  const rec = p ? p.load(key) : undefined;
  if (rec) tokenCache.set(key, { token: rec.token, expiry: rec.expiry, requests: rec.requests || [] });
  return tokenCache.get(key);
}

function saveRecord(key, rec) {
  tokenCache.set(key, rec);
  const p = persist();
  if (p) p.save(key, { token: rec.token, expiry: rec.expiry, requests: rec.requests || [] });
}

export class TokenBudgetError extends Error {}

/** Token-request usage for the current credentials over the last 24h. */
export function getTokenBudgetStatus() {
  const key = cacheKey(currentCredentials());
  const rec = loadRecord(key) || {};
  const now = Date.now();
  const used = (rec.requests || []).filter((t) => now - t < DAY_MS);
  return {
    tokenRequestsLast24h: used.length,
    budget: TOKEN_BUDGET,
    cachedTokenValid: !!(rec.token && now < rec.expiry),
    cachedTokenExpiresAt: rec.expiry ? new Date(rec.expiry).toISOString() : null,
    nextSlotFreesAt: used.length >= TOKEN_BUDGET ? new Date(Math.min(...used) + DAY_MS).toISOString() : null,
  };
}

/** Run fn with the given Guesty credentials bound to every Guesty call it makes. */
export function runWithCredentials(creds, fn) {
  if (!creds || !creds.clientId || !creds.clientSecret) {
    throw new Error("runWithCredentials: clientId and clientSecret are required");
  }
  return als.run({ clientId: creds.clientId, clientSecret: creds.clientSecret }, fn);
}

function currentCredentials() {
  const ctx = als.getStore();
  if (ctx) return ctx;
  const clientId = process.env.GUESTY_CLIENT_ID;
  const clientSecret = process.env.GUESTY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("No Guesty credentials: set GUESTY_CLIENT_ID and GUESTY_CLIENT_SECRET.");
  }
  return { clientId, clientSecret };
}

function cacheKey({ clientId, clientSecret }) {
  // Keyed on both halves so a rotated secret never reuses the old token.
  return createHash("sha256").update(clientId + "\0" + clientSecret).digest("hex");
}

export async function getToken({ forceRefresh = false } = {}) {
  const creds = currentCredentials();
  const key = cacheKey(creds);
  const hit = loadRecord(key);
  if (!forceRefresh && hit && hit.token && Date.now() < hit.expiry) return hit.token;
  // Collapse concurrent refreshes for the same tenant into one token request.
  if (hit && hit.pending) return hit.pending;

  const now = Date.now();
  const recent = ((hit && hit.requests) || []).filter((t) => now - t < DAY_MS);
  if (recent.length >= TOKEN_BUDGET) {
    const frees = new Date(Math.min(...recent) + DAY_MS).toISOString();
    throw new TokenBudgetError(
      `Guesty token budget reached: ${recent.length} token requests in the last 24h (limit ${TOKEN_BUDGET}, ` +
      `kept below Guesty's own cap so your account is never locked out). Next request allowed at ${frees}.`
    );
  }

  const pending = (async () => {
    recent.push(Date.now());
    // Record the attempt BEFORE the call: a failed request still counts against Guesty's cap.
    saveRecord(key, { ...(hit || {}), token: forceRefresh ? undefined : hit?.token, expiry: hit?.expiry || 0, requests: recent, pending: undefined });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "open-api",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error body */ }
    if (!res.ok || !data.access_token) {
      // Never echo the request (it contains the secret). Report status and Guesty's error code only.
      const why = data.error_description || data.error || data.message || `HTTP ${res.status}`;
      throw new Error(`Guesty authentication failed: ${why}`);
    }
    const expiry = Date.now() + Math.max(60, (data.expires_in || 3600) - 60) * 1000;
    saveRecord(key, { token: data.access_token, expiry, requests: recent });
    return data.access_token;
  })();

  tokenCache.set(key, { ...(tokenCache.get(key) || {}), pending });
  try {
    return await pending;
  } catch (e) {
    const cur = tokenCache.get(key) || {};
    tokenCache.set(key, { ...cur, pending: undefined, token: undefined, expiry: 0 });
    throw e;
  }
}

async function request(method, path, { params, body } = {}, retries = 2, authRetried = false) {
  const token = await getToken();
  const url = new URL(`${GUESTY_API_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !authRetried) {
    // Token revoked or expired early: refresh ONCE, inside the token budget.
    await getToken({ forceRefresh: true });
    return request(method, path, { params, body }, retries, true);
  }
  if (res.status === 429 && retries > 0) {
    const wait = Math.min(parseInt(res.headers.get("retry-after") || "5", 10), 30) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return request(method, path, { params, body }, retries - 1, authRetried);
  }
  if (!res.ok) throw new Error(`Guesty API error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  if (!text) return method === "DELETE" ? { success: true } : {};
  return JSON.parse(text);
}

export const guestyGet = (path, params = {}, retries = 2) => request("GET", path, { params }, retries);
export const guestyPost = (path, body, retries = 2) => request("POST", path, { body }, retries);
export const guestyPut = (path, body, retries = 2) => request("PUT", path, { body }, retries);
export const guestyDelete = (path, retries = 2) => request("DELETE", path, {}, retries);

/** Test/ops hook: seed a token obtained elsewhere so no new token is requested. */
export function _seedToken(creds, token, ttlMs) {
  tokenCache.set(cacheKey(creds), { token, expiry: Date.now() + ttlMs, requests: [] });
}

/** Test hook: drop all cached tokens. */
export function _clearTokenCache() { tokenCache.clear(); }
