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

/* ============================================================
   FILE STORAGE
============================================================ */

function ensureJsonFile(file, defaultValue) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify(defaultValue, null, 2),
      "utf8"
    );
  }
}

ensureJsonFile(KEYS_FILE, []);
ensureJsonFile(STOCK_FILE, []);
ensureJsonFile(SAVED_FILE, []);

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      ensureJsonFile(file, fallback);
      return fallback;
    }

    const raw = fs.readFileSync(file, "utf8").trim();

    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);

    return parsed;
  } catch (error) {
    console.error(`Error reading ${file}:`, error);
    return fallback;
  }
}

function writeJson(file, data) {
  const tempFile = `${file}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(tempFile, file);
}

/* ============================================================
   EXPRESS
============================================================ */

app.use(cors());

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "2mb"
  })
);

/* ============================================================
   HELPERS
============================================================ */

function normalizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

/* ============================================================
   ADMIN AUTH
============================================================ */

function getAdminSecret(req) {
  const headerSecret =
    req.headers["x-admin-secret"] ||
    req.headers["x-api-key"];

  if (headerSecret) {
    return String(headerSecret);
  }

  const authorization =
    req.headers.authorization;

  if (
    authorization &&
    authorization.startsWith("Bearer ")
  ) {
    return authorization
      .slice(7)
      .trim();
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
      error:
        "NOVI_ADMIN_SECRET is not configured."
    });
  }

  if (
    getAdminSecret(req) !==
    ADMIN_SECRET
  ) {
    return res.status(401).json({
      success: false,
      error: "Invalid admin secret."
    });
  }

  next();
}

/* ============================================================
   SESSION AUTH
============================================================ */

function getSessionToken(req) {
  const direct =
    req.headers["x-novi-session"] ||
    req.headers["x-session-token"];

  if (direct) {
    return String(direct);
  }

  const authorization =
    req.headers.authorization;

  if (
    authorization &&
    authorization.startsWith("Bearer ")
  ) {
    return authorization
      .slice(7)
      .trim();
  }

  return "";
}

function requireSession(req, res, next) {
  const token = getSessionToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Authentication required."
    });
  }

  const session =
    sessions.get(token);

  if (!session) {
    return res.status(401).json({
      success: false,
      error:
        "Invalid or expired session."
    });
  }

  if (
    session.expiresAt &&
    Date.now() >
      Number(session.expiresAt)
  ) {
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

/* ============================================================
   STOCK HELPERS
============================================================ */

function cleanStockValue(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    return null;
  }

  const result =
    String(value).trim();

  if (!result) {
    return null;
  }

  /*
    Stock is intended for non-sensitive
    inventory/license/product codes.
  */
  if (
    /^[^@\s:]+@[^@\s:]+:[^\s]+$/.test(
      result
    )
  ) {
    return null;
  }

  return result;
}

function extractStockValues(input) {
  const values = [];

  function add(value) {
    const cleaned =
      cleanStockValue(value);

    if (cleaned) {
      values.push(cleaned);
    }
  }

  function walk(value) {
    if (
      value === undefined ||
      value === null
    ) {
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

    if (
      typeof value === "object"
    ) {
      const fields = [
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

      let found = false;

      for (const field of fields) {
        if (
          Object.prototype.hasOwnProperty.call(
            value,
            field
          )
        ) {
          found = true;
          walk(value[field]);
        }
      }

      if (found) {
        return;
      }

      const arrays = [
        "stock",
        "stocks",
        "items",
        "data",
        "values",
        "list",
        "stockIds",
        "stock_ids"
      ];

      for (const field of arrays) {
        if (
          Object.prototype.hasOwnProperty.call(
            value,
            field
          )
        ) {
          walk(value[field]);
        }
      }
    }
  }

  walk(input);

  return [
    ...new Set(values)
  ];
}

function getNextStockId(stock) {
  if (!Array.isArray(stock)) {
    return 1;
  }

  const ids = stock
    .map(item =>
      Number(item.id)
    )
    .filter(id =>
      Number.isFinite(id)
    );

  if (!ids.length) {
    return 1;
  }

  return Math.max(...ids) + 1;
}

/* ============================================================
   WEBSITE
============================================================ */

/*
  IMPORTANT:
  Do NOT create app.get("/") returning JSON here.

  The static middleware below serves:
  public/index.html
*/

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    uptime: process.uptime()
  });
});

/* ============================================================
   KEYS
============================================================ */

app.post(
  "/api/keys",
  requireAdmin,
  (req, res) => {
    const keys =
      readJson(KEYS_FILE, []);

    const key =
      normalizeString(
        req.body.key
      ) ||
      crypto
        .randomBytes(12)
        .toString("hex")
        .toUpperCase();

    const durationDays =
      Number(
        req.body.durationDays
      );

    let expiresAt = null;

    if (
      Number.isFinite(
        durationDays
      ) &&
      durationDays > 0
    ) {
      expiresAt =
        Date.now() +
        durationDays *
          24 *
          60 *
          60 *
          1000;
    }

    const existingIndex =
      keys.findIndex(
        item =>
          item.key === key
      );

    const record = {
      key,
      durationDays:
        Number.isFinite(
          durationDays
        ) &&
        durationDays > 0
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

    writeJson(
      KEYS_FILE,
      keys
    );

    res.json({
      success: true,
      key,
      durationDays:
        record.durationDays,
      expiresAt
    });
  }
);

app.get(
  "/api/keys",
  requireAdmin,
  (req, res) => {
    const keys =
      readJson(KEYS_FILE, []);

    res.json({
      success: true,
      keys
    });
  }
);

/* ============================================================
   VERIFY
============================================================ */

app.post(
  "/api/verify",
  (req, res) => {
    const suppliedKey =
      normalizeString(
        req.body.key
      );

    const deviceId =
      normalizeString(
        req.body.deviceId
      );

    if (!suppliedKey) {
      return res.status(400).json({
        success: false,
        error: "Key is required."
      });
    }

    const keys =
      readJson(KEYS_FILE, []);

    const keyRecord =
      keys.find(
        item =>
          item.key ===
          suppliedKey
      );

    if (!keyRecord) {
      return res.status(401).json({
        success: false,
        error:
          "Invalid Novi key."
      });
    }

    if (
      keyRecord.expiresAt &&
      Date.now() >
        Number(
          keyRecord.expiresAt
        )
    ) {
      return res.status(401).json({
        success: false,
        error:
          "This key has expired."
      });
    }

    const token =
      createToken();

    sessions.set(token, {
      key: suppliedKey,
      deviceId,
      createdAt: Date.now(),
      expiresAt:
        keyRecord.expiresAt ||
        null
    });

    res.json({
      success: true,
      session: token,
      token,
      key: suppliedKey,
      durationDays:
        keyRecord.durationDays,
      expiresAt:
        keyRecord.expiresAt
    });
  }
);

/* ============================================================
   ADD STOCK
============================================================ */

function handleAddStock(req, res) {
  const values =
    extractStockValues(
      req.body
    );

  if (!values.length) {
    return res.status(400).json({
      success: false,
      error:
        "No valid stock found. Use non-sensitive inventory codes/items."
    });
  }

  const stock =
    readJson(
      STOCK_FILE,
      []
    );

  let nextId =
    getNextStockId(stock);

  const created = [];

  for (const value of values) {
    const item = {
      id: nextId,
      stock_id: value,
      created_at: Date.now()
    };

    stock.push(item);
    created.push(item);

    nextId++;
  }

  writeJson(
    STOCK_FILE,
    stock
  );

  res.json({
    success: true,
    added: created.length,
    count: stock.length,
    stock: created
  });
}

app.post(
  "/api/stock/add",
  requireAdmin,
  handleAddStock
);

app.post(
  "/api/add-stock",
  requireAdmin,
  handleAddStock
);

app.post(
  "/api/stock",
  requireAdmin,
  handleAddStock
);

/* ============================================================
   STOCK COUNT
============================================================ */

app.get(
  "/api/stock/count",
  requireSession,
  (req, res) => {
    const stock =
      readJson(
        STOCK_FILE,
        []
      );

    res.json({
      success: true,
      count: stock.length
    });
  }
);

/* ============================================================
   STOCK LIST
============================================================ */

app.get(
  "/api/stock",
  requireSession,
  (req, res) => {
    const stock =
      readJson(
        STOCK_FILE,
        []
      );

    res.json({
      success: true,
      stock,
      items: stock,
      accounts: stock,
      count: stock.length
    });
  }
);

/* ============================================================
   ADMIN STOCK
============================================================ */

app.get(
  "/api/admin/stock",
  requireAdmin,
  (req, res) => {
    const stock =
      readJson(
        STOCK_FILE,
        []
      );

    res.json({
      success: true,
      stock,
      count: stock.length
    });
  }
);

/* ============================================================
   GENERATE STOCK
============================================================ */

app.post(
  "/api/stock/generate",
  requireSession,
  (req, res) => {
    let amount =
      Number(
        req.body.amount
      );

    if (!Number.isFinite(amount)) {
      amount = 1;
    }

    amount = Math.floor(amount);

    amount =
      Math.max(
        1,
        Math.min(
          100,
          amount
        )
      );

    const stock =
      readJson(
        STOCK_FILE,
        []
      );

    if (!stock.length) {
      return res.status(404).json({
        success: false,
        error: "Out of stock.",
        stockRemaining: 0
      });
    }

    const quantity =
      Math.min(
        amount,
        stock.length
      );

    const generated =
      stock.splice(
        0,
        quantity
      );

    writeJson(
      STOCK_FILE,
      stock
    );

    const items =
      generated.map(item => ({
        id: item.id,
        value: item.stock_id,
        stock_id: item.stock_id,
        created_at:
          item.created_at
      }));

    res.json({
      success: true,
      requested: amount,
      generated:
        items.length,
      items,
      stockRemaining:
        stock.length
    });
  }
);

/* ============================================================
   SAVED ITEMS
============================================================ */

app.post(
  "/api/saved-items",
  requireSession,
  (req, res) => {
    const value =
      cleanStockValue(
        req.body.value ||
        req.body.stock_id ||
        req.body.item
      );

    if (!value) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid item."
      });
    }

    const saved =
      readJson(
        SAVED_FILE,
        []
      );

    const ids =
      saved
        .map(item =>
          Number(item.id)
        )
        .filter(Number.isFinite);

    const id =
      ids.length
        ? Math.max(...ids) + 1
        : 1;

    const item = {
      id,
      value,
      device_id:
        req.noviSession
          .deviceId || "",
      created_at: Date.now()
    };

    saved.push(item);

    writeJson(
      SAVED_FILE,
      saved
    );

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
    const saved =
      readJson(
        SAVED_FILE,
        []
      );

    const deviceId =
      req.query.deviceId ||
      req.noviSession
        .deviceId ||
      "";

    const result =
      saved.filter(
        item =>
          !deviceId ||
          item.device_id ===
            deviceId
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
    const saved =
      readJson(
        SAVED_FILE,
        []
      );

    const id =
      Number(
        req.params.id
      );

    const index =
      saved.findIndex(
        item =>
          Number(item.id) ===
          id
      );

    if (index === -1) {
      return res.status(404).json({
        success: false,
        error:
          "Saved item not found."
      });
    }

    saved.splice(
      index,
      1
    );

    writeJson(
      SAVED_FILE,
      saved
    );

    res.json({
      success: true
    });
  }
);

/* ============================================================
   LOGOUT
============================================================ */

app.post(
  "/api/logout",
  requireSession,
  (req, res) => {
    sessions.delete(
      req.noviSessionToken
    );

    res.json({
      success: true
    });
  }
);

/* ============================================================
   STATIC WEBSITE
============================================================ */

app.use(
  express.static(
    PUBLIC_DIR
  )
);

/* ============================================================
   API 404
============================================================ */

app.use(
  "/api",
  (req, res) => {
    res.status(404).json({
      success: false,
      error:
        "API endpoint not found."
    });
  }
);

/* ============================================================
   WEBSITE FALLBACK
============================================================ */

app.get(
  "/{*splat}",
  (req, res) => {
    res.sendFile(
      path.join(
        PUBLIC_DIR,
        "index.html"
      )
    );
  }
);

/* ============================================================
   ERROR HANDLER
============================================================ */

app.use(
  (err, req, res, next) => {
    console.error(
      "Server error:",
      err
    );

    res.status(500).json({
      success: false,
      error:
        "Internal server error."
    });
  }
);

/* ============================================================
   START SERVER
============================================================ */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "======================================"
    );

    console.log(
      "             NOVI ONLINE"
    );

    console.log(
      "======================================"
    );

    console.log(
      `Website running on port ${PORT}`
    );

    console.log(
      `Public directory: ${PUBLIC_DIR}`
    );

    console.log(
      "======================================"
    );
  }
);
