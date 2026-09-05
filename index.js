const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const app = express();

const PORT = Number(process.env.PORT || 10000);
const PUBLIC_DIR = path.join(__dirname, "public");

const ADMIN_SECRET = process.env.NOVI_ADMIN_SECRET || "";

const KEYS_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "stock-data.json");
const SAVED_FILE = path.join(__dirname, "saved-items.json");

const sessions = new Map();

// ============================================================
// FILE STORAGE
// ============================================================

function ensureJsonFile(file, defaultValue) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultValue, null, 2));
  }
}

ensureJsonFile(KEYS_FILE, []);
ensureJsonFile(STOCK_FILE, []);
ensureJsonFile(SAVED_FILE, []);

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    const data = fs.readFileSync(file, "utf8").trim();

    if (!data) return fallback;

    return JSON.parse(data);
  } catch (error) {
    console.error(`Failed reading ${file}:`, error);
    return fallback;
  }
}

function writeJson(file, data) {
  const temp = `${file}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(temp, file);
}

// ============================================================
// EXPRESS
// ============================================================

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ============================================================
// HELPERS
// ============================================================

function getAdminSecret(req) {
  const headerSecret =
    req.headers["x-admin-secret"] ||
    req.headers["x-api-key"];

  if (headerSecret) {
    return String(headerSecret);
  }

  const auth = req.headers.authorization;

  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }

  if (req.body && req.body.adminSecret) {
    return String(req.body.adminSecret);
  }

  if (req.query && req.query.adminSecret) {
    return String(req.query.adminSecret);
  }

  return "";
}

function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET) {
    return res.status(500).json({
      success: false,
      error: "NOVI_ADMIN_SECRET is not configured."
    });
  }

  if (getAdminSecret(req) !== ADMIN_SECRET) {
    return res.status(401).json({
      success: false,
      error: "Invalid admin secret."
    });
  }

  next();
}

function getSessionToken(req) {
  return (
    req.headers["x-novi-session"] ||
    req.headers["x-session-token"] ||
    (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer ")
        ? req.headers.authorization.slice(7).trim()
        : ""
    )
  );
}

function requireSession(req, res, next) {
  const token = getSessionToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Authentication required."
    });
  }

  const session = sessions.get(token);

  if (!session) {
    return res.status(401).json({
      success: false,
      error: "Invalid or expired session."
    });
  }

  if (session.expiresAt && Date.now() > session.expiresAt) {
    sessions.delete(token);

    return res.status(401).json({
      success: false,
      error: "Session expired."
    });
  }

  req.noviSession = session;
  req.noviSessionToken = token;

  next();
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function normalizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

// ============================================================
// STOCK HELPERS
// ============================================================

function cleanStockValue(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    return null;
  }

  const result = String(value).trim();

  if (!result) {
    return null;
  }

  // Keep this system for non-sensitive inventory/codes.
  // Do not use it to store passwords or account credentials.
  if (
    /^[^@\s:]+@[^@\s:]+:[^\s]+$/.test(result)
  ) {
    return null;
  }

  return result;
}

function extractStockValues(input) {
  const output = [];

  function add(value) {
    const cleaned = cleanStockValue(value);

    if (cleaned) {
      output.push(cleaned);
    }
  }

  function walk(value) {
    if (value === undefined || value === null) {
      return;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint"
    ) {
      add(value);
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }

      return;
    }

    if (typeof value === "object") {
      const preferredFields = [
        "stockId",
        "stock_id",
        "value",
        "code",
        "item",
        "itemId",
        "item_id",
        "productCode",
        "product_code"
      ];

      let foundPreferred = false;

      for (const field of preferredFields) {
        if (
          Object.prototype.hasOwnProperty.call(value, field)
        ) {
          walk(value[field]);
          foundPreferred = true;
        }
      }

      if (foundPreferred) {
        return;
      }

      const arrayFields = [
        "stock",
        "stocks",
        "items",
        "data",
        "values",
        "list",
        "stockIds",
        "stock_ids"
      ];

      for (const field of arrayFields) {
        if (
          Object.prototype.hasOwnProperty.call(value, field)
        ) {
          walk(value[field]);
        }
      }
    }
  }

  walk(input);

  return [...new Set(output)];
}

function nextStockId(stock) {
  if (!stock.length) {
    return 1;
  }

  const ids = stock
    .map(item => Number(item.id))
    .filter(Number.isFinite);

  return ids.length ? Math.max(...ids) + 1 : 1;
}

// ============================================================
// HEALTH
// ============================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    name: "Novi",
    status: "online"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    uptime: process.uptime()
  });
});

// ============================================================
// KEY SYSTEM
// ============================================================

// Create key
app.post("/api/keys", requireAdmin, (req, res) => {
  const keys = readJson(KEYS_FILE, []);

  const key =
    normalizeString(req.body.key) ||
    crypto.randomBytes(12).toString("hex").toUpperCase();

  const durationDays = Number(req.body.durationDays);

  let expiresAt = null;

  if (
    Number.isFinite(durationDays) &&
    durationDays > 0
  ) {
    expiresAt =
      Date.now() +
      durationDays * 24 * 60 * 60 * 1000;
  }

  const existingIndex = keys.findIndex(
    item => item.key === key
  );

  const record = {
    key,
    durationDays:
      Number.isFinite(durationDays) && durationDays > 0
        ? durationDays
        : null,
    expiresAt,
    createdAt: Date.now()
  };

  if (existingIndex >= 0) {
    keys[existingIndex] = {
      ...keys[existingIndex],
      ...record
    };
  } else {
    keys.push(record);
  }

  writeJson(KEYS_FILE, keys);

  res.json({
    success: true,
    key,
    durationDays: record.durationDays,
    expiresAt
  });
});

// Get keys
app.get("/api/keys", requireAdmin, (req, res) => {
  const keys = readJson(KEYS_FILE, []);

  res.json({
    success: true,
    keys
  });
});

// Verify key
app.post("/api/verify", (req, res) => {
  const suppliedKey = normalizeString(req.body.key);
  const deviceId = normalizeString(req.body.deviceId);

  if (!suppliedKey) {
    return res.status(400).json({
      success: false,
      error: "Key is required."
    });
  }

  const keys = readJson(KEYS_FILE, []);

  const keyRecord = keys.find(
    item => item.key === suppliedKey
  );

  if (!keyRecord) {
    return res.status(401).json({
      success: false,
      error: "Invalid Novi key."
    });
  }

  if (
    keyRecord.expiresAt &&
    Date.now() > Number(keyRecord.expiresAt)
  ) {
    return res.status(401).json({
      success: false,
      error: "This key has expired."
    });
  }

  const token = createToken();

  const session = {
    key: suppliedKey,
    deviceId,
    createdAt: Date.now(),
    expiresAt: keyRecord.expiresAt || null
  };

  sessions.set(token, session);

  res.json({
    success: true,
    session: token,
    token,
    key: suppliedKey,
    durationDays: keyRecord.durationDays,
    expiresAt: keyRecord.expiresAt
  });
});

// ============================================================
// STOCK ADMIN
// ============================================================

function addStock(req, res) {
  const values = extractStockValues(
    req.body && Object.keys(req.body).length
      ? req.body
      : req.body
  );

  if (!values.length) {
    return res.status(400).json({
      success: false,
      error:
        "No valid stock found. Add non-sensitive item/code values."
    });
  }

  const stock = readJson(STOCK_FILE, []);

  let id = nextStockId(stock);

  const created = [];

  for (const value of values) {
    const item = {
      id,
      stock_id: value,
      created_at: Date.now()
    };

    stock.push(item);
    created.push(item);

    id++;
  }

  writeJson(STOCK_FILE, stock);

  res.json({
    success: true,
    added: created.length,
    count: stock.length,
    stock: created
  });
}

app.post("/api/stock/add", requireAdmin, addStock);
app.post("/api/add-stock", requireAdmin, addStock);
app.post("/api/stock", requireAdmin, addStock);

// ============================================================
// STOCK VIEW
// ============================================================

app.get("/api/stock/count", requireSession, (req, res) => {
  const stock = readJson(STOCK_FILE, []);

  res.json({
    success: true,
    count: stock.length
  });
});

app.get("/api/stock", requireSession, (req, res) => {
  const stock = readJson(STOCK_FILE, []);

  res.json({
    success: true,
    stock,
    items: stock,
    count: stock.length
  });
});

// Admin stock view
app.get("/api/admin/stock", requireAdmin, (req, res) => {
  const stock = readJson(STOCK_FILE, []);

  res.json({
    success: true,
    stock,
    count: stock.length
  });
});

// ============================================================
// GENERATE STOCK
// ============================================================

app.post(
  "/api/stock/generate",
  requireSession,
  (req, res) => {
    const requestedAmount = Number(req.body.amount);

    const amount =
      Number.isFinite(requestedAmount)
        ? Math.max(
            1,
            Math.min(100, Math.floor(requestedAmount))
          )
        : 1;

    const stock = readJson(STOCK_FILE, []);

    if (!stock.length) {
      return res.status(404).json({
        success: false,
        error: "Out of stock.",
        count: 0
      });
    }

    const amountToGenerate = Math.min(
      amount,
      stock.length
    );

    const generated = stock.splice(
      0,
      amountToGenerate
    );

    writeJson(STOCK_FILE, stock);

    const items = generated.map(item => ({
      id: item.id,
      value: item.stock_id,
      stock_id: item.stock_id,
      created_at: item.created_at
    }));

    res.json({
      success: true,
      requested: amount,
      generated: items.length,
      items,
      stockRemaining: stock.length
    });
  }
);

// ============================================================
// SAVED NON-SENSITIVE ITEMS
// ============================================================

app.post(
  "/api/saved-items",
  requireSession,
  (req, res) => {
    const value = cleanStockValue(
      req.body.value ||
      req.body.stock_id ||
      req.body.item
    );

    if (!value) {
      return res.status(400).json({
        success: false,
        error: "Invalid item."
      });
    }

    const saved = readJson(SAVED_FILE, []);

    const item = {
      id:
        saved.length > 0
          ? Math.max(
              ...saved.map(x => Number(x.id) || 0)
            ) + 1
          : 1,
      value,
      device_id:
        req.noviSession.deviceId || "",
      created_at: Date.now()
    };

    saved.push(item);

    writeJson(SAVED_FILE, saved);

    res.json({
      success: true,
      item
    });
  }
);

app.get(
  "/api/saved-items",
  requireSession,
  (req, res) => {
    const saved = readJson(SAVED_FILE, []);

    const deviceId =
      req.query.deviceId ||
      req.noviSession.deviceId ||
      "";

    const result = saved.filter(
      item => !deviceId || item.device_id === deviceId
    );

    res.json({
      success: true,
      items: result
    });
  }
);

app.delete(
  "/api/saved-items/:id",
  requireSession,
  (req, res) => {
    const saved = readJson(SAVED_FILE, []);

    const id = Number(req.params.id);

    const index = saved.findIndex(
      item => Number(item.id) === id
    );

    if (index === -1) {
      return res.status(404).json({
        success: false,
        error: "Saved item not found."
      });
    }

    saved.splice(index, 1);

    writeJson(SAVED_FILE, saved);

    res.json({
      success: true
    });
  }
);

// ============================================================
// LOGOUT
// ============================================================

app.post("/api/logout", requireSession, (req, res) => {
  sessions.delete(req.noviSessionToken);

  res.json({
    success: true
  });
});

// ============================================================
// STATIC WEBSITE
// ============================================================

app.use(express.static(PUBLIC_DIR));

// API 404
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    error: "API endpoint not found."
  });
});

// Express 5 catch-all
app.get("/{*splat}", (req, res) => {
  res.sendFile(
    path.join(PUBLIC_DIR, "index.html")
  );
});

// ============================================================
// ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    error: "Internal server error."
  });
});

// ============================================================
// START
// ============================================================

app.listen(PORT, "0.0.0.0", () => {
  console.log("======================================");
  console.log("             NOVI ONLINE");
  console.log("======================================");
  console.log(`Website running on port ${PORT}`);
  console.log(`Public directory: ${PUBLIC_DIR}`);
  console.log("======================================");
});
