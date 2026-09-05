require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT) || 10000;

const PUBLIC_DIR = path.join(__dirname, "public");

const ADMIN_SECRET = process.env.NOVI_ADMIN_SECRET || "";

// ============================================================
// FILE STORAGE
// ============================================================

const KEY_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "stock-data.json");
const SAVED_ITEMS_FILE = path.join(
  __dirname,
  "saved-items.json"
);

// ============================================================
// FILE HELPERS
// ============================================================

function ensureJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        JSON.stringify(fallback, null, 2),
        "utf8"
      );
      return;
    }

    const contents = fs.readFileSync(file, "utf8").trim();

    if (!contents) {
      fs.writeFileSync(
        file,
        JSON.stringify(fallback, null, 2),
        "utf8"
      );
    }
  } catch (err) {
    console.error(
      `Failed to initialize ${path.basename(file)}:`,
      err.message
    );
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      ensureJsonFile(file, fallback);
      return fallback;
    }

    const contents = fs.readFileSync(file, "utf8").trim();

    if (!contents) {
      return fallback;
    }

    const parsed = JSON.parse(contents);

    return parsed;
  } catch (err) {
    console.error(
      `Failed to read ${path.basename(file)}:`,
      err.message
    );

    return fallback;
  }
}

function writeJson(file, data) {
  const tempFile = `${file}.tmp`;

  try {
    fs.writeFileSync(
      tempFile,
      JSON.stringify(data, null, 2),
      "utf8"
    );

    fs.renameSync(tempFile, file);
  } catch (err) {
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch {}

    throw err;
  }
}

// ============================================================
// INITIALIZE FILE STORAGE
// ============================================================

ensureJsonFile(KEY_FILE, []);
ensureJsonFile(STOCK_FILE, []);
ensureJsonFile(SAVED_ITEMS_FILE, []);

// ============================================================
// OPTIONAL LEGACY STOCK MIGRATION
// ============================================================

const LEGACY_STOCK_FILE = path.join(
  __dirname,
  "epicgames-stock.json"
);

function migrateLegacyStock() {
  try {
    const currentStock = readJson(
      STOCK_FILE,
      []
    );

    if (
      Array.isArray(currentStock) &&
      currentStock.length > 0
    ) {
      return;
    }

    if (!fs.existsSync(LEGACY_STOCK_FILE)) {
      return;
    }

    const legacy = readJson(
      LEGACY_STOCK_FILE,
      []
    );

    const values = extractStockValues(legacy);

    if (!values.length) {
      return;
    }

    const stock = values.map(
      (stockId, index) => ({
        id: index + 1,
        stock_id: stockId,
        created_at: new Date().toISOString(),
      })
    );

    writeJson(STOCK_FILE, stock);

    console.log(
      `✅ Migrated ${stock.length} stock item(s) from epicgames-stock.json`
    );
  } catch (err) {
    console.error(
      "Legacy stock migration error:",
      err.message
    );
  }
}

// ============================================================
// CONFIG WARNINGS
// ============================================================

if (!ADMIN_SECRET) {
  console.warn(
    "⚠️ NOVI_ADMIN_SECRET is missing."
  );
}

console.log(
  "Database: NOT REQUIRED - using JSON file storage"
);

// ============================================================
// EXPRESS
// ============================================================

app.disable("x-powered-by");

app.use(
  cors({
    origin: true,
    credentials: false,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-novi-session",
      "x-admin-secret",
      "x-api-key",
    ],
  })
);

app.use(
  express.json({
    limit: "10mb",
    strict: false,
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);

app.use(
  express.text({
    type: ["text/plain", "text/*"],
    limit: "10mb",
  })
);

// ============================================================
// SESSIONS
// ============================================================

const sessions = new Map();

/*
  sessionToken -> {
    key,
    expiresAt,
    createdAt,
    deviceId
  }
*/

function createSession(
  key,
  expiresAt,
  deviceId = null
) {
  const sessionToken =
    crypto.randomBytes(32).toString("hex");

  sessions.set(sessionToken, {
    key,
    expiresAt,
    createdAt: Date.now(),
    deviceId,
  });

  return sessionToken;
}

function getSession(req) {
  const headerToken =
    req.headers["x-novi-session"];

  const authHeader =
    req.headers.authorization || "";

  let bearerToken = null;

  if (
    authHeader
      .toLowerCase()
      .startsWith("bearer ")
  ) {
    bearerToken =
      authHeader.slice(7).trim();
  }

  const token =
    headerToken || bearerToken;

  if (!token) {
    return null;
  }

  const session =
    sessions.get(token);

  if (!session) {
    return null;
  }

  if (
    session.expiresAt &&
    Date.now() >= session.expiresAt
  ) {
    sessions.delete(token);
    return null;
  }

  return {
    token,
    ...session,
  };
}

// ============================================================
// ADMIN AUTH
// ============================================================

function getAdminSecret(req) {
  return (
    req.headers["x-admin-secret"] ||
    req.headers["x-api-key"] ||
    req.headers["authorization"]?.replace(
      /^Bearer\s+/i,
      ""
    ) ||
    req.body?.adminSecret ||
    req.body?.secret ||
    req.body?.apiKey ||
    req.query?.secret ||
    ""
  );
}

function requireAdmin(
  req,
  res,
  next
) {
  const supplied = String(
    getAdminSecret(req) || ""
  );

  const expected = String(
    ADMIN_SECRET || ""
  );

  if (!expected) {
    return res.status(500).json({
      success: false,
      error:
        "NOVI_ADMIN_SECRET is not configured",
    });
  }

  if (!supplied) {
    return res.status(401).json({
      success: false,
      error:
        "Missing admin secret",
    });
  }

  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    return res.status(403).json({
      success: false,
      error:
        "Invalid admin secret",
    });
  }

  next();
}

// ============================================================
// USER SESSION AUTH
// ============================================================

function requireSession(
  req,
  res,
  next
) {
  const session =
    getSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      error:
        "Invalid or expired session",
    });
  }

  req.noviSession = session;

  next();
}

// ============================================================
// HEALTH
// ============================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Novi API",
    status: "online",
  });
});

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      success: true,
      status: "online",
      database: "file",
      sessions: sessions.size,
    });
  }
);

// ============================================================
// CREATE KEYS
// ============================================================

app.post(
  "/api/keys",
  requireAdmin,
  (req, res) => {
    try {
      const body = req.body || {};

      const requestedKey =
        body.key ||
        body.license ||
        body.licenseKey ||
        body.value ||
        null;

      const duration = Number(
        body.duration ||
          body.days ||
          body.durationDays ||
          30
      );

      const key =
        requestedKey &&
        String(requestedKey).trim()
          ? String(requestedKey).trim()
          : crypto
              .randomBytes(16)
              .toString("hex");

      const safeDuration =
        Number.isFinite(duration) &&
        duration > 0
          ? Math.floor(duration)
          : 30;

      const expiresAt = new Date(
        Date.now() +
          safeDuration *
            24 *
            60 *
            60 *
            1000
      ).toISOString();

      const keys = readJson(
        KEY_FILE,
        []
      );

      const existingIndex =
        keys.findIndex(
          (item) =>
            String(item.key) === key
        );

      const now =
        new Date().toISOString();

      const keyRecord = {
        id:
          existingIndex >= 0
            ? keys[existingIndex].id
            : getNextId(keys),
        key,
        duration: safeDuration,
        created_at:
          existingIndex >= 0
            ? keys[existingIndex]
                .created_at || now
            : now,
        expires_at: expiresAt,
      };

      if (existingIndex >= 0) {
        keys[existingIndex] =
          keyRecord;
      } else {
        keys.push(keyRecord);
      }

      writeJson(KEY_FILE, keys);

      res.json({
        success: true,
        key: keyRecord.key,
        duration:
          keyRecord.duration,
        expiresAt:
          keyRecord.expires_at,
      });
    } catch (err) {
      console.error(
        "Key creation error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to create key",
      });
    }
  }
);

// ============================================================
// LIST KEYS
// ============================================================

app.get(
  "/api/keys",
  requireAdmin,
  (req, res) => {
    try {
      const keys = readJson(
        KEY_FILE,
        []
      );

      keys.sort(
        (a, b) =>
          Number(b.id || 0) -
          Number(a.id || 0)
      );

      res.json({
        success: true,
        keys,
      });
    } catch (err) {
      console.error(
        "Key list error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to load keys",
      });
    }
  }
);

// ============================================================
// VERIFY KEY
// ============================================================

app.post(
  "/api/verify",
  (req, res) => {
    try {
      const body =
        req.body || {};

      const key = String(
        body.key ||
          body.license ||
          body.licenseKey ||
          ""
      ).trim();

      const deviceId =
        String(
          body.deviceId ||
            body.device_id ||
            ""
        ).trim() || null;

      if (!key) {
        return res.status(400).json({
          success: false,
          valid: false,
          error:
            "Missing key",
        });
      }

      const keys = readJson(
        KEY_FILE,
        []
      );

      const row =
        keys.find(
          (item) =>
            String(item.key) === key
        );

      if (!row) {
        return res.status(401).json({
          success: false,
          valid: false,
          error:
            "Invalid key",
        });
      }

      if (
        row.expires_at &&
        new Date(
          row.expires_at
        ).getTime() <= Date.now()
      ) {
        return res.status(401).json({
          success: false,
          valid: false,
          error:
            "Key expired",
        });
      }

      const expiresAt =
        row.expires_at
          ? new Date(
              row.expires_at
            ).getTime()
          : Date.now() +
            Number(
              row.duration || 30
            ) *
              86400000;

      const sessionToken =
        createSession(
          key,
          expiresAt,
          deviceId
        );

      res.json({
        success: true,
        valid: true,
        sessionToken,
        token: sessionToken,
        key,
        duration:
          row.duration,
        expiresAt:
          row.expires_at,
      });
    } catch (err) {
      console.error(
        "Verify error:",
        err
      );

      res.status(500).json({
        success: false,
        valid: false,
        error:
          "Verification failed",
      });
    }
  }
);

// ============================================================
// STOCK HELPERS
// ============================================================

function cleanStockValue(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return (
      String(value).trim() ||
      null
    );
  }

  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const cleaned =
    value.trim();

  if (!cleaned) {
    return null;
  }

  // Reject credential-style email:password values.
  if (
    /^[^@\s:]+@[^@\s:]+:[^\s]+$/.test(
      cleaned
    )
  ) {
    return null;
  }

  return cleaned;
}

function extractStockValues(
  input
) {
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
      value === null ||
      value === undefined
    ) {
      return;
    }

    if (Array.isArray(value)) {
      for (
        const item of value
      ) {
        walk(item);
      }

      return;
    }

    if (
      typeof value === "string"
    ) {
      const lines =
        value
          .split(/\r?\n/)
          .map((x) =>
            x.trim()
          )
          .filter(Boolean);

      if (lines.length > 1) {
        for (
          const line of lines
        ) {
          add(line);
        }
      } else {
        add(value);
      }

      return;
    }

    if (
      typeof value === "number" ||
      typeof value === "bigint"
    ) {
      add(value);
      return;
    }

    if (
      typeof value === "object"
    ) {
      const directFields = [
        "stockId",
        "stock_id",
        "id",
        "value",
        "name",
        "code",
        "item",
        "itemId",
        "item_id",
      ];

      for (
        const field of directFields
      ) {
        if (
          Object.prototype.hasOwnProperty.call(
            value,
            field
          )
        ) {
          const fieldValue =
            value[field];

          if (
            typeof fieldValue ===
              "string" ||
            typeof fieldValue ===
              "number" ||
            typeof fieldValue ===
              "bigint"
          ) {
            add(fieldValue);
          }
        }
      }

      const arrayFields = [
        "stock",
        "stocks",
        "items",
        "data",
        "values",
        "list",
        "accounts",
        "account",
        "stockIds",
        "stock_ids",
        "entries",
      ];

      for (
        const field of arrayFields
      ) {
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
    ...new Set(values),
  ];
}

function getNextId(
  items
) {
  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    return 1;
  }

  let highest = 0;

  for (
    const item of items
  ) {
    const id =
      Number(item?.id);

    if (
      Number.isFinite(id) &&
      id > highest
    ) {
      highest = id;
    }
  }

  return highest + 1;
}

// ============================================================
// STOCK ADD
// ============================================================

function stockAddHandler(
  req,
  res
) {
  try {
    console.log(
      "📥 STOCK ADD REQUEST",
      req.method,
      req.originalUrl
    );

    console.log(
      "📦 BODY TYPE:",
      typeof req.body
    );

    let body = req.body;

    if (
      typeof body === "string"
    ) {
      const trimmed =
        body.trim();

      if (
        trimmed.startsWith("{") ||
        trimmed.startsWith("[")
      ) {
        try {
          body =
            JSON.parse(trimmed);
        } catch {
          // Keep as plain text.
        }
      }
    }

    const values =
      extractStockValues(body);

    if (!values.length) {
      return res.status(400).json({
        success: false,
        error:
          "No valid stock IDs supplied",
        added: 0,
      });
    }

    const stock = readJson(
      STOCK_FILE,
      []
    );

    let added = 0;

    for (
      const stockId of values
    ) {
      stock.push({
        id: getNextId(stock),
        stock_id: stockId,
        created_at:
          new Date().toISOString(),
      });

      added++;
    }

    writeJson(
      STOCK_FILE,
      stock
    );

    console.log(
      `✅ Added ${added} stock item(s)`
    );

    return res.json({
      success: true,
      added,
      count: added,
      message:
        `Added ${added} stock item(s)`,
    });
  } catch (err) {
    console.error(
      "❌ STOCK ADD ERROR:",
      err
    );

    return res.status(500).json({
      success: false,
      error:
        "Failed to add stock",
      detail:
        process.env.NODE_ENV ===
        "production"
          ? undefined
          : err.message,
    });
  }
}

// ============================================================
// STOCK ADD ROUTES
// ============================================================

app.post(
  "/api/stock/add",
  requireAdmin,
  stockAddHandler
);

app.post(
  "/api/add-stock",
  requireAdmin,
  stockAddHandler
);

app.post(
  "/api/stock",
  requireAdmin,
  stockAddHandler
);

// ============================================================
// STOCK COUNT
// ============================================================

app.get(
  "/api/stock/count",
  requireSession,
  (req, res) => {
    try {
      const stock = readJson(
        STOCK_FILE,
        []
      );

      res.json({
        success: true,
        count: stock.length,
      });
    } catch (err) {
      console.error(
        "Stock count error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to get stock count",
      });
    }
  }
);

// ============================================================
// STOCK LIST
// ============================================================

app.get(
  "/api/stock",
  requireSession,
  (req, res) => {
    try {
      const stock = readJson(
        STOCK_FILE,
        []
      );

      stock.sort(
        (a, b) =>
          Number(a.id || 0) -
          Number(b.id || 0)
      );

      res.json({
        success: true,
        stock,
        items: stock,
        accounts: stock,
      });
    } catch (err) {
      console.error(
        "Stock list error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to load stock",
      });
    }
  }
);

// ============================================================
// ADMIN STOCK
// ============================================================

app.get(
  "/api/admin/stock",
  requireAdmin,
  (req, res) => {
    try {
      const stock = readJson(
        STOCK_FILE,
        []
      );

      stock.sort(
        (a, b) =>
          Number(a.id || 0) -
          Number(b.id || 0)
      );

      res.json({
        success: true,
        stock,
        items: stock,
        count: stock.length,
      });
    } catch (err) {
      console.error(
        "Admin stock error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to load stock",
      });
    }
  }
);

// ============================================================
// GENERATE / TAKE ONE STOCK ITEM
// ============================================================

app.post(
  "/api/stock/generate",
  requireSession,
  (req, res) => {
    try {
      const stock = readJson(
        STOCK_FILE,
        []
      );

      stock.sort(
        (a, b) =>
          Number(a.id || 0) -
          Number(b.id || 0)
      );

      if (!stock.length) {
        return res.status(404).json({
          success: false,
          error:
            "Out of stock",
        });
      }

      const item =
        stock.shift();

      writeJson(
        STOCK_FILE,
        stock
      );

      return res.json({
        success: true,
        item:
          item.stock_id,
        account:
          item.stock_id,
        stock:
          item.stock_id,
        stockId:
          item.stock_id,
      });
    } catch (err) {
      console.error(
        "Generate stock error:",
        err
      );

      return res.status(500).json({
        success: false,
        error:
          "Failed to generate stock",
      });
    }
  }
);

// ============================================================
// SAVED ITEMS
// ============================================================

app.post(
  "/api/saved-items",
  requireSession,
  (req, res) => {
    try {
      const body =
        req.body || {};

      const stockId =
        cleanStockValue(
          body.stockId ||
            body.stock_id ||
            body.item ||
            body.value
        );

      const deviceId =
        String(
          body.deviceId ||
            body.device_id ||
            req.noviSession
              .deviceId ||
            ""
        ).trim() || null;

      if (!stockId) {
        return res.status(400).json({
          success: false,
          error:
            "Missing stock ID",
        });
      }

      const savedItems =
        readJson(
          SAVED_ITEMS_FILE,
          []
        );

      const item = {
        id: getNextId(
          savedItems
        ),
        stock_id: stockId,
        device_id: deviceId,
        created_at:
          new Date().toISOString(),
      };

      savedItems.push(item);

      writeJson(
        SAVED_ITEMS_FILE,
        savedItems
      );

      res.json({
        success: true,
        item,
      });
    } catch (err) {
      console.error(
        "Save item error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to save item",
      });
    }
  }
);

// ============================================================
// GET SAVED ITEMS
// ============================================================

app.get(
  "/api/saved-items",
  requireSession,
  (req, res) => {
    try {
      const deviceId =
        String(
          req.query.deviceId ||
            req.query.device_id ||
            req.noviSession
              .deviceId ||
            ""
        ).trim();

      const savedItems =
        readJson(
          SAVED_ITEMS_FILE,
          []
        );

      savedItems.sort(
        (a, b) =>
          Number(b.id || 0) -
          Number(a.id || 0)
      );

      let filtered =
        savedItems;

      if (deviceId) {
        filtered =
          savedItems.filter(
            (item) =>
              String(
                item.device_id ||
                  ""
              ) === deviceId
          );
      }

      res.json({
        success: true,
        items: filtered,
        savedItems: filtered,
      });
    } catch (err) {
      console.error(
        "Saved items error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to load saved items",
      });
    }
  }
);

// ============================================================
// DELETE SAVED ITEM
// ============================================================

app.delete(
  "/api/saved-items/:id",
  requireSession,
  (req, res) => {
    try {
      const id = Number(
        req.params.id
      );

      if (
        !Number.isInteger(id)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid item ID",
        });
      }

      const savedItems =
        readJson(
          SAVED_ITEMS_FILE,
          []
        );

      const index =
        savedItems.findIndex(
          (item) =>
            Number(item.id) === id
        );

      if (index === -1) {
        return res.status(404).json({
          success: false,
          error:
            "Saved item not found",
        });
      }

      savedItems.splice(
        index,
        1
      );

      writeJson(
        SAVED_ITEMS_FILE,
        savedItems
      );

      res.json({
        success: true,
        deleted: true,
      });
    } catch (err) {
      console.error(
        "Delete saved item error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to delete saved item",
      });
    }
  }
);

// ============================================================
// LOGOUT
// ============================================================

app.post(
  "/api/logout",
  (req, res) => {
    try {
      const session =
        getSession(req);

      if (session) {
        sessions.delete(
          session.token
        );
      }

      res.json({
        success: true,
        loggedOut: true,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error:
          "Logout failed",
      });
    }
  }
);

// ============================================================
// API 404
// ============================================================

app.use(
  "/api",
  (req, res) => {
    res.status(404).json({
      success: false,
      error:
        "API route not found",
      method: req.method,
      path: req.originalUrl,
    });
  }
);

// ============================================================
// STATIC WEBSITE
// ============================================================

if (
  fs.existsSync(PUBLIC_DIR)
) {
  app.use(
    express.static(PUBLIC_DIR)
  );

  // EXPRESS 5 FIX
  app.get(
    "/{*splat}",
    (req, res, next) => {
      if (
        req.path.startsWith(
          "/api/"
        )
      ) {
        return next();
      }

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

      next();
    }
  );
}

// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
  (err, req, res, next) => {
    console.error(
      "Unhandled Express error:",
      err
    );

    if (
      res.headersSent
    ) {
      return next(err);
    }

    res.status(500).json({
      success: false,
      error:
        "Internal server error",
    });
  }
);

// ============================================================
// START
// ============================================================

function start() {
  try {
    migrateLegacyStock();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          "======================================"
        );

        console.log(
          "        NOVI SERVER ONLINE"
        );

        console.log(
          "======================================"
        );

        console.log(
          `Port: ${PORT}`
        );

        console.log(
          `Public: ${PUBLIC_DIR}`
        );

        console.log(
          "Database: NOT REQUIRED"
        );

        console.log(
          "Storage: JSON files"
        );

        console.log(
          "Stock API: ready"
        );

        console.log(
          "======================================"
        );
      }
    );
  } catch (err) {
    console.error(
      "❌ Failed to start Novi:",
      err
    );

    process.exit(1);
  }
}

start();
