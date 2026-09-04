const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, "public");

const KEY_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "epicgames-stock.json");

const ADMIN_SECRET = process.env.NOVI_ADMIN_SECRET || "";

const SESSION_DURATION = 30 * 60 * 1000;

const sessions = new Map();


/* =========================================================
   BASIC SETUP
========================================================= */

app.disable("x-powered-by");

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Accept",
    "x-novi-session",
    "x-novi-admin-secret"
  ]
}));

app.use(express.json({
  limit: "1mb"
}));


/* =========================================================
   FILE HELPERS
========================================================= */

function ensureFile(file, defaultValue) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify(defaultValue, null, 2),
      "utf8"
    );
  }
}


ensureFile(KEY_FILE, []);
ensureFile(STOCK_FILE, []);


function readJSON(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf8");

    if (!raw.trim()) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.error("Failed to read:", file, error);
    return fallback;
  }
}


function writeJSON(file, data) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}


/* =========================================================
   KEY HELPERS
========================================================= */

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}


function normalizeDeviceId(value) {
  return String(value || "").trim();
}


function generateKey() {
  const part = () =>
    crypto.randomBytes(3)
      .toString("hex")
      .toUpperCase();

  return `NOVI-${part()}-${part()}-${part()}`;
}


function safeEqual(a, b) {
  try {
    const aBuffer = Buffer.from(String(a));
    const bBuffer = Buffer.from(String(b));

    if (aBuffer.length !== bBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      aBuffer,
      bBuffer
    );
  } catch {
    return false;
  }
}


/* =========================================================
   KEY DURATIONS
========================================================= */

const DURATIONS = {
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "1week": 7 * 24 * 60 * 60 * 1000,
  "1month": 30 * 24 * 60 * 60 * 1000,
  "1year": 365 * 24 * 60 * 60 * 1000,
  "lifetime": null
};


function calculateExpiration(duration) {
  if (!Object.prototype.hasOwnProperty.call(
    DURATIONS,
    duration
  )) {
    return null;
  }

  const length = DURATIONS[duration];

  if (length === null) {
    return null;
  }

  return Date.now() + length;
}


/* =========================================================
   KEY STORAGE
========================================================= */

function readKeys() {
  const data = readJSON(KEY_FILE, []);

  if (!Array.isArray(data)) {
    return [];
  }

  return data;
}


function saveKeys(keys) {
  writeJSON(KEY_FILE, keys);
}


function createKeyRecord(duration) {
  const key = generateKey();

  return {
    key,
    duration,
    createdAt: Date.now(),
    expiresAt: calculateExpiration(duration),
    deviceId: null,
    activatedAt: null
  };
}


/* =========================================================
   VERIFY KEY
========================================================= */

function verifyKey(rawKey, rawDeviceId) {
  const key = normalizeKey(rawKey);
  const deviceId = normalizeDeviceId(rawDeviceId);

  if (!key) {
    return {
      success: false,
      valid: false,
      message: "Please enter a key."
    };
  }

  if (!deviceId) {
    return {
      success: false,
      valid: false,
      message: "Device ID is required."
    };
  }

  const keys = readKeys();

  let found = null;
  let foundIndex = -1;

  for (let i = 0; i < keys.length; i++) {
    const record = keys[i];

    const storedKey =
      typeof record === "string"
        ? normalizeKey(record)
        : normalizeKey(record?.key);

    if (safeEqual(storedKey, key)) {
      found = record;
      foundIndex = i;
      break;
    }
  }

  if (!found) {
    return {
      success: false,
      valid: false,
      message: "Invalid key."
    };
  }


  /* -------------------------------------------------------
     Support old string-only keys
  ------------------------------------------------------- */

  if (typeof found === "string") {
    found = {
      key: normalizeKey(found),
      duration: "lifetime",
      createdAt: Date.now(),
      expiresAt: null,
      deviceId: null,
      activatedAt: null
    };

    keys[foundIndex] = found;
  }


  /* -------------------------------------------------------
     Check expiration
  ------------------------------------------------------- */

  if (
    found.expiresAt !== null &&
    found.expiresAt !== undefined &&
    Number(found.expiresAt) <= Date.now()
  ) {
    return {
      success: false,
      valid: false,
      message: "This key has expired."
    };
  }


  /* -------------------------------------------------------
     Bind key to first device
  ------------------------------------------------------- */

  if (!found.deviceId) {
    found.deviceId = deviceId;
    found.activatedAt = Date.now();

    keys[foundIndex] = found;

    saveKeys(keys);

  } else {

    if (!safeEqual(
      normalizeDeviceId(found.deviceId),
      deviceId
    )) {
      return {
        success: false,
        valid: false,
        message: "This key is already bound to another device."
      };
    }
  }


  return {
    success: true,
    valid: true,
    key: found
  };
}


/* =========================================================
   SESSIONS
========================================================= */

function createSession(key, deviceId) {
  const token =
    crypto.randomBytes(32).toString("hex");

  const expiresAt =
    Date.now() + SESSION_DURATION;

  sessions.set(token, {
    key: normalizeKey(key),
    deviceId: normalizeDeviceId(deviceId),
    expiresAt
  });

  return {
    token,
    expiresAt
  };
}


function getSession(token) {
  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session;
}


/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function requireSession(req, res, next) {
  const token =
    req.headers["x-novi-session"];

  const session =
    getSession(token);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: "Authentication required."
    });
  }

  req.noviSession = session;

  next();
}


function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET) {
    return res.status(503).json({
      success: false,
      message: "Admin secret is not configured."
    });
  }

  const supplied =
    req.headers["x-novi-admin-secret"];

  if (!safeEqual(
    supplied || "",
    ADMIN_SECRET
  )) {
    return res.status(403).json({
      success: false,
      message: "Admin access denied."
    });
  }

  next();
}


/* =========================================================
   STOCK
========================================================= */

function readStock() {
  const data =
    readJSON(STOCK_FILE, []);

  return Array.isArray(data)
    ? data
    : [];
}


function saveStock(stock) {
  writeJSON(STOCK_FILE, stock);
}


/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    service: "Novi"
  });
});


/* =========================================================
   API ROOT
========================================================= */

app.get("/api", (req, res) => {
  res.json({
    success: true,
    name: "Novi API"
  });
});


/* =========================================================
   VERIFY KEY
========================================================= */

app.post("/api/verify", (req, res) => {
  try {
    const {
      key,
      deviceId
    } = req.body || {};

    const result =
      verifyKey(key, deviceId);

    if (!result.success) {
      return res.status(401).json(result);
    }

    const session =
      createSession(
        key,
        deviceId
      );

    return res.json({
      success: true,
      valid: true,

      sessionToken:
        session.token,

      expiresAt:
        session.expiresAt,

      key: {
        duration:
          result.key.duration,

        expiresAt:
          result.key.expiresAt
      }
    });

  } catch (error) {

    console.error(
      "VERIFY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      valid: false,
      message: "Server error while verifying key."
    });
  }
});


/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/api/logout",
  requireSession,
  (req, res) => {

    const token =
      req.headers["x-novi-session"];

    sessions.delete(token);

    res.json({
      success: true
    });
  }
);


/* =========================================================
   STOCK COUNT
========================================================= */

app.get(
  "/api/stock",
  requireSession,
  (req, res) => {

    const stock =
      readStock();

    res.json({
      success: true,
      count: stock.length
    });
  }
);


/* =========================================================
   GENERATE STOCK ITEM
========================================================= */

app.post(
  "/api/stock/generate",
  requireSession,
  (req, res) => {

    try {

      const stock =
        readStock();

      if (stock.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No inventory is currently available."
        });
      }

      const item =
        stock.shift();

      saveStock(stock);

      return res.json({
        success: true,
        item,
        remaining: stock.length
      });

    } catch (error) {

      console.error(
        "STOCK GENERATE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to generate inventory."
      });
    }
  }
);


/* =========================================================
   ADMIN: CREATE KEY
========================================================= */

app.post(
  "/api/keys",
  requireAdmin,
  (req, res) => {

    const duration =
      String(
        req.body?.duration || "lifetime"
      ).trim();

    if (
      !Object.prototype.hasOwnProperty.call(
        DURATIONS,
        duration
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid duration."
      });
    }

    const keys =
      readKeys();

    const record =
      createKeyRecord(duration);

    keys.push(record);

    saveKeys(keys);

    res.json({
      success: true,
      key: record
    });
  }
);


/* =========================================================
   ADMIN: ADD STOCK
========================================================= */

app.post(
  "/api/stock/add",
  requireAdmin,
  (req, res) => {

    const item =
      req.body?.item;

    if (
      item === undefined ||
      item === null
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing inventory item."
      });
    }

    const stock =
      readStock();

    stock.push(item);

    saveStock(stock);

    res.json({
      success: true,
      count: stock.length
    });
  }
);


/* =========================================================
   STATIC WEBSITE
========================================================= */

if (fs.existsSync(PUBLIC_DIR)) {

  app.use(
    express.static(PUBLIC_DIR)
  );

  app.get("/", (req, res) => {

    const indexFile =
      path.join(
        PUBLIC_DIR,
        "index.html"
      );

    if (
      fs.existsSync(indexFile)
    ) {
      return res.sendFile(
        indexFile
      );
    }

    res.status(404).send(
      "Novi frontend not found."
    );
  });
}


/* =========================================================
   UNKNOWN API ROUTES
========================================================= */

app.use(
  "/api",
  (req, res) => {

    res.status(404).json({
      success: false,
      message: "API endpoint not found."
    });
  }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (error, req, res, next) => {

    console.error(
      "SERVER ERROR:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Internal server error."
    });
  }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Novi server running on port ${PORT}`
    );

    console.log(
      `API health: /api/health`
    );

    console.log(
      `API verify: POST /api/verify`
    );
  }
);
