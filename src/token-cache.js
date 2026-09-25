import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, "..", ".token-cache.json");

export function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function writeCache(token, expiresIn) {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify({ token, expiry: Date.now() + (expiresIn - 60) * 1000 }));
  } catch { /* ignore */ }
}
