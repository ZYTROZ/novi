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
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        JSON.stringify(defaultValue, null, 2),
        "utf8"
      );
    }
  } catch (error) {
    console.error("FAILED TO CREATE FILE:", file);
    console.error(error);
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
    console.error("FAILED TO READ JSON:", file);
    console.error(error);

    return fallback;
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(data, null, 2),
      "utf8"
    );

    return true;
  } catch (error) {
    console.error("FAILED TO WRITE JSON:", file);
    console.error(error);

    return false;
  }
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
    crypto
      .randomBytes(3)
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
  if (
    !Object.prototype.hasOwnProperty.call(
      DURATIONS,
      duration
    )
  ) {
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
    console.error("keys.json is not an array. Using empty key list.");
    return [];
  }

  return data;
}

function saveKeys(keys) {
  return writeJSON(KEY_FILE, keys);
}

function createKeyRecord(duration) {
  return {
    key: generateKey(),
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

  console.log("VERIFY KEY START");
  console.log("Key supplied:", Boolean(key));
  console.log("Device ID supplied:", Boolean(deviceId));

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

  console.log("Keys loaded:", keys.length);

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
    console.log("VERIFY RESULT: INVALID KEY");

    return {
      success: false,
      valid: false,
      message: "Invalid key."
    };
  }

  /*
     Convert old string-only keys into objects.
  */

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

  /*
     Check expiration.
  */

  if (
    found.expiresAt !== null &&
    found.expiresAt !== undefined &&
    Number(found.expiresAt) <= Date.now()
  ) {
    console.log("VERIFY RESULT: EXPIRED");

    return {
      success: false,
      valid: false,
      message: "This key has expired."
    };
  }

  /*
     Bind key to first device.
  */

  if (!found.deviceId) {
    console.log("First activation. Binding device.");

    found.deviceId = deviceId;
    found.activatedAt = Date.now();

    keys[foundIndex] = found;

    const saved = saveKeys(keys);

    if (!saved) {
      console.error("KEY SAVE FAILED");

      return {
        success: false,
        valid: false,
        message: "Could not save key activation."
      };
    }

    console.log("Key successfully saved.");
  } else {
    if (
      !safeEqual(
        normalizeDeviceId(found.deviceId),
        deviceId
      )
    ) {
      console.log("VERIFY RESULT: WRONG DEVICE");

      return {
        success: false,
        valid: false,
        message: "This key is already bound to another device."
      };
    }

    console.log("Existing device accepted.");
  }

  console.log("VERIFY RESULT: VALID");

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

  if (
    !safeEqual(
      supplied || "",
      ADMIN_SECRET
    )
  ) {
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
  return writeJSON(STOCK_FILE, stock);
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
  console.log("=================================");
  console.log("VERIFY REQUEST RECEIVED");
  console.log("=================================");

  console.log("Request body:", {
    hasKey: Boolean(req.body?.key),
    hasDeviceId: Boolean(req.body?.deviceId)
  });

  try {
    const key = req.body?.key;
    const deviceId = req.body?.deviceId;

    console.log("VERIFY: checking key");

    const result =
      verifyKey(
        key,
        deviceId
      );

    console.log("VERIFY RESULT:", {
      success: result.success,
      valid: result.valid,
      message: result.message || null
    });

    if (!result.success) {
      return res.status(401).json(result);
    }

    console.log("VERIFY: creating session");

    const session =
      createSession(
        key,
        deviceId
      );

    console.log("VERIFY: session created");

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
    console.error("========== VERIFY CRASH ==========");
    console.error(error);
    console.error("==================================");

    return res.status(500).json({
      success: false,
      valid: false,
      message: "Internal server error."
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

      const saved =
        saveStock(stock);

      if (!saved) {
        return res.status(500).json({
          success: false,
          message: "Failed to save inventory."
        });
      }

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

    try {
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

      const saved =
        saveKeys(keys);

      if (!saved) {
        return res.status(500).json({
          success: false,
          message: "Failed to save key."
        });
      }

      res.json({
        success: true,
        key: record
      });

    } catch (error) {
      console.error(
        "CREATE KEY ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to create key."
      });
    }
  }
);

/* =========================================================
   ADMIN: ADD STOCK
========================================================= */

app.post(
  "/api/stock/add",
  requireAdmin,
  (req, res) => {

    try {
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

      const saved =
        saveStock(stock);

      if (!saved) {
        return res.status(500).json({
          success: false,
          message: "Failed to save inventory."
        });
      }

      res.json({
        success: true,
        count: stock.length
      });

    } catch (error) {
      console.error(
        "ADD STOCK ERROR:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Failed to add inventory."
      });
    }
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
