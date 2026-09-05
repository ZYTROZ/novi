require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = Number(process.env.PORT) || 10000;

const PUBLIC_DIR = path.join(__dirname, "public");
const KEY_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "epicgames-stock.json");
const SAVED_LOGINS_FILE = path.join(__dirname, "saved-logins.json");

const NOVI_ADMIN_SECRET = process.env.NOVI_ADMIN_SECRET;
const NOVI_CREDENTIAL_SECRET = process.env.NOVI_CREDENTIAL_SECRET;

const SESSION_DURATION = 30 * 60 * 1000;

// ============================================================
// EXPRESS
// ============================================================

app.use(cors());

app.use(
  express.json({
    limit: "2mb"
  })
);

// ============================================================
// FILE HELPERS
// ============================================================

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
    console.error(`[FILE] Failed to create ${file}:`, error.message);
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      ensureFile(file, fallback);
      return fallback;
    }

    const data = fs.readFileSync(file, "utf8");

    if (!data.trim()) {
      return fallback;
    }

    return JSON.parse(data);
  } catch (error) {
    console.error(`[FILE] Failed to read ${file}:`, error.message);
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function readKeys() {
  return readJson(KEY_FILE, []);
}

function saveKeys(keys) {
  writeJson(KEY_FILE, keys);
}

function readStock() {
  const stock = readJson(STOCK_FILE, []);

  if (!Array.isArray(stock)) {
    return [];
  }

  return stock;
}

function saveStock(stock) {
  writeJson(STOCK_FILE, stock);
}

function readSavedLogins() {
  const data = readJson(SAVED_LOGINS_FILE, []);

  if (!Array.isArray(data)) {
    return [];
  }

  return data;
}

function saveSavedLogins(logins) {
  writeJson(SAVED_LOGINS_FILE, logins);
}

// ============================================================
// INITIAL FILES
// ============================================================

ensureFile(KEY_FILE, []);
ensureFile(STOCK_FILE, []);
ensureFile(SAVED_LOGINS_FILE, []);

// ============================================================
// KEY SYSTEM
// ============================================================

const DURATIONS = {
  "1d": {
    name: "1 Day",
    milliseconds: 1 * 24 * 60 * 60 * 1000
  },

  "3d": {
    name: "3 Days",
    milliseconds: 3 * 24 * 60 * 60 * 1000
  },

  "1week": {
    name: "1 Week",
    milliseconds: 7 * 24 * 60 * 60 * 1000
  },

  "1month": {
    name: "1 Month",
    milliseconds: 30 * 24 * 60 * 60 * 1000
  },

  "lifetime": {
    name: "Lifetime",
    milliseconds: null
  }
};

function generateKey() {
  const part = () =>
    crypto.randomBytes(3).toString("hex").toUpperCase();

  return `NOVI-${part()}-${part()}-${part()}`;
}

function getExpiration(duration, createdAt) {
  if (duration === "lifetime") {
    return null;
  }

  const info = DURATIONS[duration];

  if (!info) {
    return null;
  }

  return new Date(
    new Date(createdAt).getTime() + info.milliseconds
  ).toISOString();
}

// ============================================================
// ADMIN AUTH
// ============================================================

function requireAdmin(req, res, next) {
  if (!NOVI_ADMIN_SECRET) {
    return res.status(500).json({
      success: false,
      message: "NOVI_ADMIN_SECRET is not configured."
    });
  }

  const providedSecret =
    req.headers["x-novi-admin-secret"];

  if (
    typeof providedSecret !== "string" ||
    providedSecret !== NOVI_ADMIN_SECRET
  ) {
    return res.status(403).json({
      success: false,
      message: "Unauthorized."
    });
  }

  next();
}

// ============================================================
// SESSIONS
// ============================================================

const sessions = new Map();

function createSession(keyRecord, deviceId) {
  const sessionToken =
    crypto.randomBytes(32).toString("hex");

  const createdAt = Date.now();
  const expiresAt = createdAt + SESSION_DURATION;

  sessions.set(sessionToken, {
    key: keyRecord.key,
    deviceId,
    createdAt,
    expiresAt
  });

  return {
    sessionToken,
    expiresAt
  };
}

function getSession(req) {
  const token = req.headers["x-novi-session"];

  if (!token || typeof token !== "string") {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return session;
}

function requireSession(req, res, next) {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      message: "Session expired or invalid."
    });
  }

  req.noviSession = session;

  next();
}

// Clean expired sessions every minute
setInterval(() => {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token);
    }
  }
}, 60 * 1000);

// ============================================================
// DEVICE ID
// ============================================================

function normalizeDeviceId(deviceId) {
  if (
    typeof deviceId !== "string" ||
    !deviceId.trim()
  ) {
    return null;
  }

  return deviceId.trim().slice(0, 200);
}

// ============================================================
// ENCRYPTION FOR SAVED LOGINS
// ============================================================

function getEncryptionKey() {
  if (!NOVI_CREDENTIAL_SECRET) {
    return null;
  }

  return crypto
    .createHash("sha256")
    .update(NOVI_CREDENTIAL_SECRET)
    .digest();
}

function encryptPassword(password) {
  const key = getEncryptionKey();

  if (!key) {
    throw new Error(
      "NOVI_CREDENTIAL_SECRET is not configured."
    );
  }

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(password, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    content: encrypted.toString("base64"),
    authTag: authTag.toString("base64")
  };
}

function decryptPassword(encryptedData) {
  const key = getEncryptionKey();

  if (!key) {
    throw new Error(
      "NOVI_CREDENTIAL_SECRET is not configured."
    );
  }

  const iv = Buffer.from(
    encryptedData.iv,
    "base64"
  );

  const content = Buffer.from(
    encryptedData.content,
    "base64"
  );

  const authTag = Buffer.from(
    encryptedData.authTag,
    "base64"
  );

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(content),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

// ============================================================
// STOCK PARSER
// ============================================================

function parseStockItem(item) {
  if (typeof item !== "string") {
    return {
      email: "",
      password: ""
    };
  }

  const value = item.trim();

  const separator = value.indexOf(":");

  if (separator === -1) {
    return {
      email: value,
      password: ""
    };
  }

  return {
    email: value.slice(0, separator).trim(),
    password: value
      .slice(separator + 1)
      .trim()
  };
}

// ============================================================
// HEALTH / API
// ============================================================

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    service: "Novi"
  });
});

app.get("/api", (req, res) => {
  res.json({
    success: true,
    name: "Novi API",
    status: "online"
  });
});

// ============================================================
// ADMIN - GENERATE KEY
// ============================================================

app.post("/api/keys", requireAdmin, (req, res) => {
  try {
    console.log("[API/KEYS] Request received");
    console.log("[API/KEYS] Body:", req.body);

    const duration =
      typeof req.body?.duration === "string"
        ? req.body.duration.toLowerCase()
        : "";

    if (!DURATIONS[duration]) {
      return res.status(400).json({
        success: false,
        message: "Invalid duration."
      });
    }

    const createdAt = new Date().toISOString();

    const keyRecord = {
      key: generateKey(),
      duration,
      createdAt,
      expiresAt: getExpiration(
        duration,
        createdAt
      ),

      // First device that successfully activates
      // the key gets permanently bound to it.
      deviceId: null,

      used: false
    };

    const keys = readKeys();

    keys.push(keyRecord);

    saveKeys(keys);

    console.log(
      "[API/KEYS] Generated:",
      keyRecord.key
    );

    return res.status(201).json({
      success: true,
      key: keyRecord.key,
      duration: keyRecord.duration,
      durationName: DURATIONS[duration].name,
      createdAt: keyRecord.createdAt,
      expiresAt: keyRecord.expiresAt
    });
  } catch (error) {
    console.error(
      "[API/KEYS] Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to generate key."
    });
  }
});

// ============================================================
// ADMIN - LIST KEYS
// ============================================================

app.get("/api/keys", requireAdmin, (req, res) => {
  try {
    const keys = readKeys();

    return res.json({
      success: true,
      keys
    });
  } catch (error) {
    console.error(
      "[API/KEYS GET] Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to read keys."
    });
  }
});

// ============================================================
// ADMIN - DELETE KEY
// ============================================================

app.delete(
  "/api/keys/:key",
  requireAdmin,
  (req, res) => {
    try {
      const targetKey = req.params.key;

      const keys = readKeys();

      const filtered = keys.filter(
        item => item.key !== targetKey
      );

      if (filtered.length === keys.length) {
        return res.status(404).json({
          success: false,
          message: "Key not found."
        });
      }

      saveKeys(filtered);

      return res.json({
        success: true,
        message: "Key deleted."
      });
    } catch (error) {
      console.error(
        "[API/KEYS DELETE] Error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to delete key."
      });
    }
  }
);

// ============================================================
// VERIFY KEY
// ============================================================

app.post("/api/verify", (req, res) => {
  try {
    const providedKey =
      typeof req.body?.key === "string"
        ? req.body.key.trim()
        : "";

    const deviceId =
      normalizeDeviceId(req.body?.deviceId);

    if (!providedKey) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: "Key is required."
      });
    }

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        valid: false,
        message: "Device ID is required."
      });
    }

    const keys = readKeys();

    const keyRecord = keys.find(
      item => item.key === providedKey
    );

    if (!keyRecord) {
      return res.status(401).json({
        success: false,
        valid: false,
        message: "Invalid key."
      });
    }

    // ========================================================
    // CHECK KEY EXPIRATION
    // ========================================================

    if (
      keyRecord.expiresAt &&
      Date.now() >=
        new Date(keyRecord.expiresAt).getTime()
    ) {
      return res.status(401).json({
        success: false,
        valid: false,
        message: "This key has expired."
      });
    }

    // ========================================================
    // ONE DEVICE PER KEY
    // ========================================================

    if (
      keyRecord.deviceId &&
      keyRecord.deviceId !== deviceId
    ) {
      return res.status(403).json({
        success: false,
        valid: false,
        message:
          "This key is already locked to another device."
      });
    }

    // First successful device activation
    if (!keyRecord.deviceId) {
      keyRecord.deviceId = deviceId;
      keyRecord.used = true;

      saveKeys(keys);

      console.log(
        `[VERIFY] Key ${keyRecord.key} bound to first device.`
      );
    }

    const session = createSession(
      keyRecord,
      deviceId
    );

    return res.json({
      success: true,
      valid: true,

      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,

      key: {
        key: keyRecord.key,
        duration: keyRecord.duration,
        durationName:
          DURATIONS[keyRecord.duration]?.name ||
          keyRecord.duration,
        createdAt: keyRecord.createdAt,
        keyExpiresAt: keyRecord.expiresAt
      }
    });
  } catch (error) {
    console.error(
      "[VERIFY] Error:",
      error
    );

    return res.status(500).json({
      success: false,
      valid: false,
      message: "Verification failed."
    });
  }
});

// ============================================================
// STOCK - ADMIN ADD
// ============================================================

app.post(
  "/api/stock/add",
  requireAdmin,
  (req, res) => {
    try {
      const body = req.body || {};

      let items = [];

      // Supports:
      // { item: "email:password" }
      if (
        typeof body.item === "string" &&
        body.item.trim()
      ) {
        items.push(body.item.trim());
      }

      // Supports:
      // { items: ["email:password", "email2:password2"] }
      if (Array.isArray(body.items)) {
        items.push(
          ...body.items
            .filter(
              item =>
                typeof item === "string"
            )
            .map(item => item.trim())
            .filter(Boolean)
        );
      }

      // Remove duplicates
      items = [...new Set(items)];

      if (items.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Item is required."
        });
      }

      const stock = readStock();

      stock.push(...items);

      saveStock(stock);

      console.log(
        `[STOCK] Added ${items.length} item(s). Total stock: ${stock.length}`
      );

      // IMPORTANT:
      // Do not return the actual credentials.
      return res.status(201).json({
        success: true,
        added: items.length,
        count: stock.length
      });
    } catch (error) {
      console.error(
        "[STOCK ADD ERROR]",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to add stock."
      });
    }
  }
);

// ============================================================
// ADMIN - STOCK COUNT
// ============================================================

app.get(
  "/api/admin/stock",
  requireAdmin,
  (req, res) => {
    try {
      const stock = readStock();

      return res.json({
        success: true,
        count: stock.length
      });
    } catch (error) {
      console.error(
        "[ADMIN STOCK] Error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to get stock."
      });
    }
  }
);

// ============================================================
// STOCK COUNT - SESSION
// ============================================================

app.get(
  "/api/stock/count",
  requireSession,
  (req, res) => {
    try {
      const stock = readStock();

      return res.json({
        success: true,
        count: stock.length
      });
    } catch (error) {
      console.error(
        "[STOCK COUNT] Error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to get stock count."
      });
    }
  }
);

// ============================================================
// STOCK - VIEW COUNT
// ============================================================

app.get(
  "/api/stock",
  requireSession,
  (req, res) => {
    try {
      const stock = readStock();

      return res.json({
        success: true,
        count: stock.length
      });
    } catch (error) {
      console.error(
        "[STOCK] Error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to get stock."
      });
    }
  }
);

// ============================================================
// STOCK - GENERATE
// ============================================================

app.post(
  "/api/stock/generate",
  requireSession,
  (req, res) => {
    try {
      const stock = readStock();

      if (stock.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No stock available."
        });
      }

      const rawItem = stock.shift();

      saveStock(stock);

      const parsed = parseStockItem(rawItem);

      console.log(
        `[STOCK] Generated item for key ${req.noviSession.key}`
      );

      return res.json({
        success: true,

        item: {
          email: parsed.email,
          password: parsed.password
        },

        remaining: stock.length
      });
    } catch (error) {
      console.error(
        "[STOCK GENERATE ERROR]",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to generate stock."
      });
    }
  }
);

// ============================================================
// SAVED LOGINS - SAVE
// ============================================================

app.post(
  "/api/saved-logins",
  requireSession,
  (req, res) => {
    try {
      if (!NOVI_CREDENTIAL_SECRET) {
        return res.status(500).json({
          success: false,
          message:
            "NOVI_CREDENTIAL_SECRET is not configured."
        });
      }

      const email =
        typeof req.body?.email === "string"
          ? req.body.email.trim()
          : "";

      const password =
        typeof req.body?.password === "string"
          ? req.body.password
          : "";

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message:
            "Email and password are required."
        });
      }

      const logins = readSavedLogins();

      const encryptedPassword =
        encryptPassword(password);

      const savedLogin = {
        id: crypto.randomUUID(),

        ownerKey: req.noviSession.key,

        deviceId:
          req.noviSession.deviceId,

        email,

        password: encryptedPassword,

        createdAt:
          new Date().toISOString()
      };

      logins.push(savedLogin);

      saveSavedLogins(logins);

      return res.status(201).json({
        success: true,

        login: {
          id: savedLogin.id,
          email: savedLogin.email,
          createdAt: savedLogin.createdAt
        }
      });
    } catch (error) {
      console.error(
        "[SAVED LOGIN SAVE ERROR]",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Failed to save login."
      });
    }
  }
);

// ============================================================
// SAVED LOGINS - LIST
// ============================================================

app.get(
  "/api/saved-logins",
  requireSession,
  (req, res) => {
    try {
      const logins = readSavedLogins();

      const owned = logins
        .filter(
          login =>
            login.ownerKey ===
            req.noviSession.key
        )
        .map(login => ({
          id: login.id,
          email: login.email,
          createdAt: login.createdAt
        }));

      return res.json({
        success: true,
        logins: owned
      });
    } catch (error) {
      console.error(
        "[SAVED LOGIN LIST ERROR]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to load saved logins."
      });
    }
  }
);

// ============================================================
// SAVED LOGINS - REVEAL PASSWORD
// ============================================================

app.get(
  "/api/saved-logins/:id",
  requireSession,
  (req, res) => {
    try {
      if (!NOVI_CREDENTIAL_SECRET) {
        return res.status(500).json({
          success: false,
          message:
            "NOVI_CREDENTIAL_SECRET is not configured."
        });
      }

      const logins = readSavedLogins();

      const login = logins.find(
        item =>
          item.id === req.params.id &&
          item.ownerKey ===
            req.noviSession.key
      );

      if (!login) {
        return res.status(404).json({
          success: false,
          message: "Saved login not found."
        });
      }

      const password =
        decryptPassword(login.password);

      return res.json({
        success: true,

        login: {
          id: login.id,
          email: login.email,
          password
        }
      });
    } catch (error) {
      console.error(
        "[SAVED LOGIN REVEAL ERROR]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to reveal saved login."
      });
    }
  }
);

// ============================================================
// SAVED LOGINS - DELETE
// ============================================================

app.delete(
  "/api/saved-logins/:id",
  requireSession,
  (req, res) => {
    try {
      const logins = readSavedLogins();

      const originalLength =
        logins.length;

      const filtered = logins.filter(
        login =>
          !(
            login.id === req.params.id &&
            login.ownerKey ===
              req.noviSession.key
          )
      );

      if (
        filtered.length === originalLength
      ) {
        return res.status(404).json({
          success: false,
          message: "Saved login not found."
        });
      }

      saveSavedLogins(filtered);

      return res.json({
        success: true,
        message: "Saved login deleted."
      });
    } catch (error) {
      console.error(
        "[SAVED LOGIN DELETE ERROR]",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Failed to delete saved login."
      });
    }
  }
);

// ============================================================
// LOGOUT
// ============================================================

app.post(
  "/api/logout",
  requireSession,
  (req, res) => {
    const token =
      req.headers["x-novi-session"];

    sessions.delete(token);

    return res.json({
      success: true,
      message: "Logged out."
    });
  }
);

// ============================================================
// STATIC WEBSITE
// ============================================================

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));

  app.get("*", (req, res) => {
    if (
      req.path.startsWith("/api/")
    ) {
      return res.status(404).json({
        success: false,
        message: "API endpoint not found."
      });
    }

    return res.sendFile(
      path.join(PUBLIC_DIR, "index.html")
    );
  });
}

// ============================================================
// API 404
// ============================================================

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      success: false,
      message: "API endpoint not found."
    });
  }

  return res.status(404).send("Not found.");
});

// ============================================================
// ERROR HANDLER
// ============================================================

app.use((error, req, res, next) => {
  console.error(
    "[SERVER ERROR]",
    error
  );

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    success: false,
    message: "Internal server error."
  });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("========================================");
  console.log("           NOVI SERVER ONLINE");
  console.log("========================================");
  console.log(`Port: ${PORT}`);
  console.log(`Public: ${PUBLIC_DIR}`);
  console.log(`Keys: ${KEY_FILE}`);
  console.log(`Stock: ${STOCK_FILE}`);
  console.log(`Saved Logins: ${SAVED_LOGINS_FILE}`);
  console.log("");
  console.log("API Endpoints:");
  console.log("Health: GET /health");
  console.log("Verify: POST /api/verify");
  console.log("Keys: POST /api/keys");
  console.log("Stock Add: POST /api/stock/add");
  console.log("Stock Count: GET /api/stock");
  console.log("Stock Generate: POST /api/stock/generate");
  console.log("Saved Logins: /api/saved-logins");
  console.log("========================================");
  console.log("");
});
