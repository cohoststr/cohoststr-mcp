#!/usr/bin/env node
// `npx cohoststr-mcp setup` -- connect CohostSTR to Claude Desktop on THIS computer.
//
// Why it exists: pasting an API key into a config file during a screen-share puts the key on
// screen (and in any recording). This command asks for the key in a HIDDEN prompt -- nothing is
// echoed, not even asterisks -- and writes Claude Desktop's config itself. The key goes from the
// keyboard into a file on this machine and is never printed. Nobody watching sees it.
//
// Options:
//   --config <path>   write this config file instead of Claude Desktop's default location
//   --name <name>     server name in the config (default "cohoststr")
//   --yes             do not ask before replacing an existing "cohoststr" entry
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const args = process.argv.slice(3);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const NAME = opt("--name", "cohoststr");
const say = (s) => process.stderr.write(s + "\n"); // stdout is never used for anything sensitive either

function defaultConfigPath() {
  const h = os.homedir();
  if (process.platform === "darwin") return path.join(h, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(h, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return path.join(h, ".config", "Claude", "claude_desktop_config.json");
}

// On a pipe, ONE reader serves every prompt (two readline interfaces on one pipe lose buffered lines).
let _pipeRL = null; const _lines = []; const _waiters = []; let _closed = false;
function pipedLine() {
  if (!_pipeRL) {
    _pipeRL = readline.createInterface({ input: process.stdin, terminal: false });
    _pipeRL.on("line", (l) => { const w = _waiters.shift(); w ? w(l) : _lines.push(l); });
    _pipeRL.on("close", () => { _closed = true; while (_waiters.length) _waiters.shift()(""); });
  }
  if (_lines.length) return Promise.resolve(_lines.shift());
  if (_closed) return Promise.resolve("");
  return new Promise((r) => _waiters.push(r));
}

// Read one line without echoing it. Works on a TTY (raw mode) and on a pipe (no echo happens on a pipe).
function hidden(prompt) {
  return new Promise((resolve, reject) => {
    process.stderr.write(prompt);
    const stdin = process.stdin;
    if (!stdin.isTTY) { pipedLine().then((l) => { process.stderr.write("\n"); resolve(l.trim()); }, reject); return; }
    let buf = "";
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") { done(); return; }
        if (ch === "\u0003") { stdin.setRawMode(false); process.stderr.write("\nCancelled.\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") { buf = buf.slice(0, -1); continue; }
        buf += ch;
      }
    };
    const done = () => { stdin.removeListener("data", onData); stdin.setRawMode(false); stdin.pause(); process.stderr.write("\n"); resolve(buf.trim()); };
    stdin.on("data", onData);
  });
}

function ask(q) {
  return new Promise((r) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(q, (a) => { rl.close(); r(a.trim()); });
  });
}

export async function runSetup() {
  const cfgPath = opt("--config", defaultConfigPath());
  say("CohostSTR setup: connects CohostSTR to Claude Desktop on this computer.");
  say("You need your Guesty Open API Client ID and Client Secret (Guesty > Integrations > API).");
  say("What you type below is NOT shown on screen, and it is saved only on this computer.\n");

  const id = await hidden("Guesty Client ID (hidden): ");
  const secret = await hidden("Guesty Client Secret (hidden): ");
  if (!id || !secret) { say("Nothing entered. No changes made."); process.exit(2); }
  if (/\s/.test(id) || /\s/.test(secret)) { say("That contains spaces, which a Guesty credential never does. No changes made."); process.exit(2); }

  let cfg = {};
  if (fs.existsSync(cfgPath)) {
    const raw = fs.readFileSync(cfgPath, "utf8");
    try { cfg = raw.trim() ? JSON.parse(raw) : {}; }
    catch { say(`Your Claude config (${cfgPath}) is not valid JSON, so I will not touch it. Fix or remove it, then run setup again.`); process.exit(3); }
    const bak = `${cfgPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(cfgPath, bak);
    try { fs.chmodSync(bak, 0o600); } catch {}
    say(`Backed up your existing config to ${bak}`);
  }
  cfg.mcpServers = cfg.mcpServers || {};
  if (cfg.mcpServers[NAME] && !args.includes("--yes")) {
    const a = await ask(`A "${NAME}" entry already exists. Replace it? [y/N] `);
    if (!/^y/i.test(a)) { say("No changes made."); process.exit(0); }
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  cfg.mcpServers[NAME] = { command: npx, args: ["-y", "cohoststr-mcp"], env: { GUESTY_CLIENT_ID: id, GUESTY_CLIENT_SECRET: secret } };
  const others = Object.keys(cfg.mcpServers).filter((k) => k !== NAME);

  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  const tmp = `${cfgPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, cfgPath);
  try { fs.chmodSync(cfgPath, 0o600); } catch {}

  say(`\nSaved to ${cfgPath} (readable by your user account only).`);
  if (others.length) say(`Your other MCP servers were kept: ${others.join(", ")}`);
  if (cfg.mcpServers.guesty && NAME !== "guesty") say('Note: an older "guesty" entry is also present. Remove it if it runs the same server, or Claude will show the tools twice.');
  say("\nNext: quit Claude Desktop completely and open it again. Then ask it: \"List my reservations checking in this week.\"");
  say('When Claude asks to use a tool that CHANGES something (sending a message, editing a reservation or a price), choose "Allow once", not "Always allow", so you approve each change.');
}
