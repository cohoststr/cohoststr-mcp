/**
 * IoT Webhook Receiver — Guesty MCP Server Enterprise
 *
 * POST /webhooks/iot
 *
 * Accepts payloads from Tuya, Google Nest, SmartThings, and a
 * generic format. Normalises everything, stores readings, and
 * auto-creates alerts when thresholds are breached.
 */

import { Router } from "express";
import {
  saveReading,
  saveAlert,
  upsertDevice,
  getLatestReadings,
  getAlerts
} from "./iot-db.js";

const router = Router();

// ── Threshold config ───────────────────────────────────────────────────────

const THRESHOLDS = {
  temperature: { min: 60, max: 85 },   // Fahrenheit
  humidity:    { max: 70 },             // percent
  leak_detected: { trigger: "true" },
  lock_status: { unlocked_max_minutes: 60 }
};

// ── Format normalisation ───────────────────────────────────────────────────

/**
 * Detect the payload format and return a normalised reading object
 * (or array of objects).
 */
function normalise(body) {
  // Tuya format
  if (body.devId && body.status && Array.isArray(body.status)) {
    return normaliseTuya(body);
  }

  // Google Nest format
  if (body.name && body.traits && typeof body.traits === "object") {
    return normaliseNest(body);
  }

  // SmartThings format
  if (body.deviceId && body.capability) {
    return normaliseSmartThings(body);
  }

  // Generic format (pass-through)
  if (body.device_id && body.reading_type) {
    return [normaliseGeneric(body)];
  }

  throw new Error("Unrecognised payload format");
}

// ── Tuya ───────────────────────────────────────────────────────────────────

const TUYA_CODE_MAP = {
  temp_current:      { reading_type: "temperature", device_type: "temp_sensor" },
  va_temperature:    { reading_type: "temperature", device_type: "temp_sensor" },
  humidity_value:    { reading_type: "humidity",    device_type: "humidity_sensor" },
  va_humidity:       { reading_type: "humidity",    device_type: "humidity_sensor" },
  watersensor_state: { reading_type: "leak_detected", device_type: "leak_sensor" },
  doorcontact_state: { reading_type: "lock_status",   device_type: "smart_lock" },
  pir:               { reading_type: "motion",         device_type: "motion_sensor" },
  switch:            { reading_type: "lock_status",    device_type: "smart_lock" }
};

function normaliseTuya(body) {
  const results = [];
  for (const item of body.status) {
    const mapping = TUYA_CODE_MAP[item.code];
    if (!mapping) continue;

    let value = String(item.value);
    // Tuya often sends temp * 10
    if (mapping.reading_type === "temperature" && Number(value) > 200) {
      value = String(Number(value) / 10);
    }
    // Tuya booleans / water states
    if (mapping.reading_type === "leak_detected") {
      value = (value === "1" || value === "true" || value === "alarm") ? "true" : "false";
    }
    if (mapping.reading_type === "lock_status") {
      value = (value === "true" || value === "1" || value === "open") ? "unlocked" : "locked";
    }

    results.push({
      device_id: body.devId,
      device_type: mapping.device_type,
      property_id: body.property_id || null,
      reading_type: mapping.reading_type,
      value,
      raw_payload: body
    });
  }
  return results;
}

// ── Google Nest ────────────────────────────────────────────────────────────

const NEST_TRAIT_MAP = {
  "sdm.devices.traits.Temperature": {
    field: "ambientTemperatureCelsius",
    reading_type: "temperature",
    device_type: "temp_sensor",
    transform: (c) => String(Math.round(c * 9 / 5 + 32))  // C → F
  },
  "sdm.devices.traits.Humidity": {
    field: "ambientHumidityPercent",
    reading_type: "humidity",
    device_type: "humidity_sensor",
    transform: (v) => String(v)
  },
  "sdm.devices.traits.CameraMotion": {
    field: null,
    reading_type: "motion",
    device_type: "motion_sensor",
    transform: () => "true"
  }
};

function normaliseNest(body) {
  const results = [];
  const deviceId = body.name.split("/").pop() || body.name;

  for (const [trait, data] of Object.entries(body.traits)) {
    const mapping = NEST_TRAIT_MAP[trait];
    if (!mapping) continue;

    const raw = mapping.field ? data[mapping.field] : true;
    const value = mapping.transform(raw);

    results.push({
      device_id: deviceId,
      device_type: mapping.device_type,
      property_id: body.property_id || null,
      reading_type: mapping.reading_type,
      value,
      raw_payload: body
    });
  }
  return results;
}

// ── SmartThings ────────────────────────────────────────────────────────────

const ST_CAPABILITY_MAP = {
  temperatureMeasurement: { reading_type: "temperature", device_type: "temp_sensor" },
  relativeHumidityMeasurement: { reading_type: "humidity", device_type: "humidity_sensor" },
  waterSensor: { reading_type: "leak_detected", device_type: "leak_sensor" },
  lock: { reading_type: "lock_status", device_type: "smart_lock" },
  motionSensor: { reading_type: "motion", device_type: "motion_sensor" }
};

function normaliseSmartThings(body) {
  const mapping = ST_CAPABILITY_MAP[body.capability];
  if (!mapping) {
    throw new Error(`Unsupported SmartThings capability: ${body.capability}`);
  }

  let value = String(body.value);
  if (mapping.reading_type === "leak_detected") {
    value = (value === "wet" || value === "true" || value === "1") ? "true" : "false";
  }
  if (mapping.reading_type === "lock_status") {
    value = (value === "unlocked" || value === "open") ? "unlocked" : "locked";
  }
  if (mapping.reading_type === "motion") {
    value = (value === "active" || value === "true" || value === "1") ? "true" : "false";
  }

  return [{
    device_id: body.deviceId,
    device_type: mapping.device_type,
    property_id: body.property_id || null,
    reading_type: mapping.reading_type,
    value,
    raw_payload: body
  }];
}

// ── Generic ────────────────────────────────────────────────────────────────

function normaliseGeneric(body) {
  return {
    device_id: body.device_id,
    device_type: body.device_type || "temp_sensor",
    property_id: body.property_id || null,
    reading_type: body.reading_type,
    value: String(body.value),
    raw_payload: body
  };
}

// ── Alert evaluation ───────────────────────────────────────────────────────

function evaluateAlerts(reading, device) {
  const alerts = [];
  const propertyId = reading.property_id || device?.property_id || null;

  switch (reading.reading_type) {
    case "temperature": {
      const temp = parseFloat(reading.value);
      if (!isNaN(temp) && (temp < THRESHOLDS.temperature.min || temp > THRESHOLDS.temperature.max)) {
        alerts.push({
          device_id: reading.device_id,
          property_id: propertyId,
          alert_type: "temp_out_of_range",
          severity: temp < 45 || temp > 95 ? "critical" : "warning",
          message: `Temperature ${temp}°F is outside safe range (${THRESHOLDS.temperature.min}-${THRESHOLDS.temperature.max}°F)`
        });
      }
      break;
    }

    case "humidity": {
      const hum = parseFloat(reading.value);
      if (!isNaN(hum) && hum > THRESHOLDS.humidity.max) {
        alerts.push({
          device_id: reading.device_id,
          property_id: propertyId,
          alert_type: "temp_out_of_range",  // closest match — humidity threshold
          severity: hum > 85 ? "critical" : "warning",
          message: `Humidity ${hum}% exceeds threshold (${THRESHOLDS.humidity.max}%)`
        });
      }
      break;
    }

    case "leak_detected": {
      if (reading.value === "true") {
        alerts.push({
          device_id: reading.device_id,
          property_id: propertyId,
          alert_type: "leak",
          severity: "critical",
          message: "Water leak detected!"
        });
      }
      break;
    }

    case "lock_status": {
      if (reading.value === "unlocked") {
        // For now, create an info-level alert; a background job could
        // escalate after THRESHOLDS.lock_status.unlocked_max_minutes.
        alerts.push({
          device_id: reading.device_id,
          property_id: propertyId,
          alert_type: "lock_offline",
          severity: "info",
          message: "Smart lock is unlocked — will escalate if still unlocked after 1 hour"
        });
      }
      break;
    }

    case "motion": {
      // Motion alerts only fire if there is no active reservation
      // (would need Guesty integration). For now, log as info.
      if (reading.value === "true") {
        alerts.push({
          device_id: reading.device_id,
          property_id: propertyId,
          alert_type: "motion_unusual",
          severity: "info",
          message: "Motion detected — verify if property should be occupied"
        });
      }
      break;
    }
  }

  return alerts;
}

// ── Route ──────────────────────────────────────────────────────────────────

router.post("/webhooks/iot", (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Empty or invalid payload" });
    }

    const normalised = normalise(body);

    if (!normalised || normalised.length === 0) {
      return res.status(422).json({ error: "No recognisable readings in payload" });
    }

    let readingsSaved = 0;
    let alertsCreated = 0;
    let deviceId = null;

    for (const reading of normalised) {
      // Auto-register / update device
      const device = upsertDevice({
        device_id: reading.device_id,
        device_type: reading.device_type,
        property_id: reading.property_id,
        location: reading.location || null
      });

      // Save reading
      saveReading({
        device_id: reading.device_id,
        reading_type: reading.reading_type,
        value: reading.value,
        raw_payload: reading.raw_payload
      });
      readingsSaved++;
      deviceId = reading.device_id;

      // Evaluate thresholds
      const alerts = evaluateAlerts(reading, device);
      for (const alert of alerts) {
        saveAlert(alert);
        alertsCreated++;
      }
    }

    console.log(`[iot-webhook] ${readingsSaved} reading(s) saved, ${alertsCreated} alert(s) from device ${deviceId}`);

    return res.status(200).json({
      status: "ok",
      device_id: deviceId,
      readings_saved: readingsSaved,
      alerts_created: alertsCreated
    });
  } catch (err) {
    console.error("[iot-webhook] Error:", err.message);
    return res.status(400).json({ error: err.message });
  }
});

// ── Read-only endpoints (optional convenience) ─────────────────────────────

router.get("/webhooks/iot/readings/:propertyId", (req, res) => {
  try {
    const readings = getLatestReadings(req.params.propertyId);
    return res.status(200).json({ property_id: req.params.propertyId, readings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/webhooks/iot/alerts/:propertyId", (req, res) => {
  try {
    const includeResolved = req.query.resolved === "true";
    const alerts = getAlerts(req.params.propertyId, { includeResolved });
    return res.status(200).json({ property_id: req.params.propertyId, alerts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
