/**
 * IoT Device Data Layer — CohostSTR MCP server Enterprise
 *
 * Zero-dependency JSON file-based store for IoT device readings,
 * alerts, and property baselines.
 *
 * Storage: ~/.cohoststr/iot-devices.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

// R5_TASK_106_IOT_DB_ENV_OVERRIDE (2026-04-18 CTO): honor IOT_DB_PATH env var
// so integration tests can isolate to a temp DB without mutating prod data.
// Unset env var = current prod behavior (default path). Tests set it at top
// of harness to `os.tmpdir()/iot-test-<ts>.json`.
//
// Lazy evaluation: ES module bodies evaluate at import time, BEFORE test
// harness code runs, so top-level `const DB_PATH = process.env.X || ...`
// would capture the pre-test env state. getDbPath()/getDataDir() resolve
// on first call (inside load/flush), after the test has set the env var.
const DEFAULT_DB_PATH = join(homedir(), ".cohoststr", "iot-devices.json");
function getDbPath() {
  return process.env.IOT_DB_PATH || DEFAULT_DB_PATH;
}
function getDataDir() {
  return dirname(getDbPath());
}

// ── Schema shape ───────────────────────────────────────────────────────────

function emptyDB() {
  return {
    devices: {},       // keyed by device_id
    readings: [],      // append-only log
    alerts: [],        // append-only log
    baselines: {},     // keyed by property_id
    _meta: {
      version: 1,
      created_at: new Date().toISOString(),
      last_write: new Date().toISOString()
    }
  };
}

// ── Persistence helpers ────────────────────────────────────────────────────

let _db = null;

function load() {
  if (_db) return _db;
  const dataDir = getDataDir();
  const dbPath = getDbPath();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  if (existsSync(dbPath)) {
    try {
      _db = JSON.parse(readFileSync(dbPath, "utf-8"));
      // Ensure all top-level keys exist (forward compat)
      const empty = emptyDB();
      for (const key of Object.keys(empty)) {
        if (!(key in _db)) _db[key] = empty[key];
      }
    } catch {
      console.error("[iot-db] Corrupt JSON store — reinitializing");
      _db = emptyDB();
    }
  } else {
    _db = emptyDB();
  }
  return _db;
}

function flush() {
  const db = load();
  db._meta.last_write = new Date().toISOString();
  writeFileSync(getDbPath(), JSON.stringify(db, null, 2), "utf-8");
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialise the database (creates the file if absent).
 * Safe to call multiple times.
 */
export function initDB() {
  load();
  flush();
  const dbPath = getDbPath();
  console.log(`[iot-db] Initialized at ${dbPath}`);
  return dbPath;
}

// ── Devices ────────────────────────────────────────────────────────────────

const VALID_DEVICE_TYPES = [
  "temp_sensor",
  "humidity_sensor",
  "leak_sensor",
  "smart_lock",
  "motion_sensor"
];

/**
 * Register or update a device. Automatically called on first reading
 * if the device isn't already known.
 */
export function upsertDevice({ device_id, device_type, property_id, location }) {
  const db = load();
  const existing = db.devices[device_id];
  db.devices[device_id] = {
    device_id,
    device_type: VALID_DEVICE_TYPES.includes(device_type) ? device_type : (existing?.device_type || "temp_sensor"),
    property_id: property_id || existing?.property_id || null,
    location: location || existing?.location || null,
    installed_at: existing?.installed_at || new Date().toISOString(),
    last_seen: new Date().toISOString()
  };
  flush();
  return db.devices[device_id];
}

// ── Readings ───────────────────────────────────────────────────────────────

const VALID_READING_TYPES = [
  "temperature",
  "humidity",
  "leak_detected",
  "lock_status",
  "motion"
];

/**
 * Persist a normalised reading. Returns the stored record.
 */
export function saveReading({ device_id, reading_type, value, raw_payload }) {
  const db = load();

  if (!VALID_READING_TYPES.includes(reading_type)) {
    throw new Error(`Invalid reading_type: ${reading_type}`);
  }

  const record = {
    id: randomUUID(),
    device_id,
    reading_type,
    value: String(value),
    timestamp: new Date().toISOString(),
    raw_payload: raw_payload || null
  };

  db.readings.push(record);

  // Update device last_seen
  if (db.devices[device_id]) {
    db.devices[device_id].last_seen = record.timestamp;
  }

  // Keep readings bounded (last 50 000)
  if (db.readings.length > 50000) {
    db.readings = db.readings.slice(-40000);
  }

  flush();
  return record;
}

/**
 * Return the most recent reading per device for a given property.
 * If no propertyId, returns all.
 */
export function getLatestReadings(propertyId) {
  const db = load();

  // Find devices for this property
  const deviceIds = propertyId
    ? Object.values(db.devices)
        .filter(d => d.property_id === propertyId)
        .map(d => d.device_id)
    : Object.keys(db.devices);

  const latest = {};
  // Walk backwards for efficiency
  for (let i = db.readings.length - 1; i >= 0; i--) {
    const r = db.readings[i];
    if (!deviceIds.includes(r.device_id)) continue;
    const key = `${r.device_id}:${r.reading_type}`;
    if (!latest[key]) {
      latest[key] = r;
    }
  }

  return Object.values(latest);
}

// ── Alerts ─────────────────────────────────────────────────────────────────

const VALID_ALERT_TYPES = [
  "leak",
  "temp_out_of_range",
  "lock_offline",
  "motion_unusual"
];

const VALID_SEVERITIES = ["critical", "warning", "info"];

/**
 * Create and persist an alert.
 */
export function saveAlert({ device_id, property_id, alert_type, severity, message }) {
  const db = load();

  const record = {
    id: randomUUID(),
    device_id,
    property_id: property_id || db.devices[device_id]?.property_id || null,
    alert_type: VALID_ALERT_TYPES.includes(alert_type) ? alert_type : "leak",
    severity: VALID_SEVERITIES.includes(severity) ? severity : "warning",
    message: message || "",
    created_at: new Date().toISOString(),
    resolved_at: null,
    resolved_by: null
  };

  db.alerts.push(record);

  // Keep alerts bounded (last 10 000)
  if (db.alerts.length > 10000) {
    db.alerts = db.alerts.slice(-8000);
  }

  flush();
  return record;
}

/**
 * Retrieve alerts for a property. Defaults to unresolved only.
 */
export function getAlerts(propertyId, { includeResolved = false } = {}) {
  const db = load();
  return db.alerts.filter(a => {
    if (propertyId && a.property_id !== propertyId) return false;
    if (!includeResolved && a.resolved_at) return false;
    return true;
  });
}

/**
 * Mark an alert as resolved.
 */
export function resolveAlert(alertId, resolvedBy = "system") {
  const db = load();
  const alert = db.alerts.find(a => a.id === alertId);
  if (!alert) return null;
  alert.resolved_at = new Date().toISOString();
  alert.resolved_by = resolvedBy;
  flush();
  return alert;
}

// ── Baselines ──────────────────────────────────────────────────────────────

/**
 * Save a property condition baseline (photos + notes).
 */
export function saveBaseline({ property_id, photo_urls, notes }) {
  const db = load();
  db.baselines[property_id] = {
    property_id,
    photo_urls: Array.isArray(photo_urls) ? photo_urls : [],
    created_at: new Date().toISOString(),
    notes: notes || ""
  };
  flush();
  return db.baselines[property_id];
}

/**
 * Retrieve the current baseline for a property.
 */
export function getBaseline(propertyId) {
  const db = load();
  return db.baselines[propertyId] || null;
}

/**
 * Save checkout photos for a property/reservation.
 * Returns a submission object with a unique ID.
 */
export function savePhotos({ property_id, reservation_id, photos }) {
  const db = load();
  if (!db.photo_submissions) db.photo_submissions = [];
  const submission = {
    id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    property_id,
    reservation_id: reservation_id || null,
    photo_urls: Array.isArray(photos) ? photos : [],
    submitted_at: new Date().toISOString(),
    analysis_status: "pending"
  };
  db.photo_submissions.push(submission);
  // Prune old submissions (keep last 1000)
  if (db.photo_submissions.length > 1000) {
    db.photo_submissions = db.photo_submissions.slice(-1000);
  }
  flush();
  return submission;
}
