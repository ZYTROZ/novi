const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { WebSocketServer } = require("ws");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 10000);
const PUBLIC_DIR = path.join(__dirname, "public");

const KEYS_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "stock-data.json");
const SAVED_FILE = path.join(__dirname, "saved-items.json");

const ADMIN_SECRET =
  process.env.NOVI_ADMIN_SECRET || "";

const sessions = new Map();

/* =========================================================
   BASIC SETUP
========================================================= */

app.use(cors());

app.use(express.json({
  limit: "5mb"
}));

app.use(express.urlencoded({
  extended: true,
  limit: "5mb"
}));

/* =========================================================
   FILE HELPERS
========================================================= */

function ensureJsonFile(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify(fallback, null, 2),
      "utf8"
    );
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      ensureJsonFile(file, fallback);
      return fallback;
    }

    const raw =
      fs.readFileSync(file, "utf8").trim();

    if (!raw) {
      return fallback;
    }

    return JSON.parse(raw);

  } catch (error) {

    console.error(
      `Failed reading ${path.basename(file)}:`,
      error.message
    );

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

  fs.renameSync(
    tempFile,
    file
  );
}

ensureJsonFile(KEYS_FILE, []);
ensureJsonFile(STOCK_FILE, []);
ensureJsonFile(SAVED_FILE, []);

/* =========================================================
   STOCK
========================================================= */

/*
  Generic stock parser.

  Novi treats each stock value as an opaque inventory
  string. It does not require a specific format.
*/

function cleanStockValue(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    return null;
  }

  const cleaned =
    String(value).trim();

  if (!cleaned) {
    return null;
  }

  return cleaned;
}

function normalizeStock(stock) {

  if (!Array.isArray(stock)) {
    return [];
  }

  return stock
    .map((item) => {

      if (typeof item === "string") {

        const value =
          cleanStockValue(item);

        if (!value) {
          return null;
        }

        return {
          id:
            crypto.randomUUID(),

          stock_id:
            value,

          created_at:
            Date.now()
        };
      }

      if (
        item &&
        typeof item === "object"
      ) {

        const value =
          cleanStockValue(
            item.stock_id ??
            item.stockId ??
            item.value ??
            item.code ??
            item.item
          );

        if (!value) {
          return null;
        }

        return {
          id:
            item.id ||
            crypto.randomUUID(),

          stock_id:
            value,

          created_at:
            item.created_at ??
            item.createdAt ??
            Date.now()
        };
      }

      return null;

    })
    .filter(Boolean);
}

function getStock() {

  const raw =
    readJson(
      STOCK_FILE,
      []
    );

  const normalized =
    normalizeStock(raw);

  if (
    JSON.stringify(raw) !==
    JSON.stringify(normalized)
  ) {

    writeJson(
      STOCK_FILE,
      normalized
    );
  }

  return normalized;
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
      value === null ||
      value === undefined
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

      for (
        const item of value
      ) {
        walk(item);
      }

      return;
    }

    if (
      typeof value === "object"
    ) {

      const directKeys = [
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

      for (
        const key of directKeys
      ) {

        if (
          value[key] !== undefined
        ) {
          walk(value[key]);
        }
      }

      const arrayKeys = [
        "stock",
        "stocks",
        "items",
        "data",
        "values",
        "list",
        "stockIds",
        "stock_ids"
      ];

      for (
        const key of arrayKeys
      ) {

        if (
          value[key] !== undefined
        ) {
          walk(value[key]);
        }
      }
    }
  }

  walk(input);

  return [
    ...new Set(values)
  ];
}

/* =========================================================
   WEBSOCKET
========================================================= */

const wss =
  new WebSocketServer({
    server,
    path: "/ws"
  });

const wsClients =
  new Set();

wss.on(
  "connection",
  (ws) => {

    console.log(
      "Novi real-time client connected"
    );

    wsClients.add(ws);

    const stock =
      getStock();

    ws.send(
      JSON.stringify({
        type: "stock:update",
        count: stock.length
      })
    );

    ws.on(
      "close",
      () => {

        wsClients.delete(ws);

        console.log(
          "Novi real-time client disconnected"
        );
      }
    );

    ws.on(
      "error",
      () => {
        wsClients.delete(ws);
      }
    );
  }
);

function broadcastStockUpdate() {

  const stock =
    getStock();

  const message =
    JSON.stringify({
      type: "stock:update",
      count: stock.length
    });

  for (
    const client of wsClients
  ) {

    if (
      client.readyState === 1
    ) {

      try {
        client.send(message);
      } catch {
        wsClients.delete(client);
      }
    }
  }
}

/*
  Watch stock-data.json so Discord imports
  automatically update connected dashboards.
*/

let lastStockSignature =
  "";

function getStockSignature() {

  try {

    const stat =
      fs.statSync(
        STOCK_FILE
      );

    return `${stat.mtimeMs}:${stat.size}`;

  } catch {

    return "missing";
  }
}

lastStockSignature =
  getStockSignature();

setInterval(
  () => {

    const currentSignature =
      getStockSignature();

    if (
      currentSignature !==
      lastStockSignature
    ) {

      lastStockSignature =
        currentSignature;

      console.log(
        "Stock file changed - broadcasting update"
      );

      broadcastStockUpdate();
    }

  },
  500
);

/* =========================================================
   ADMIN AUTH
========================================================= */

function getAdminSecret(req) {

  const headerSecret =
    req.headers[
      "x-admin-secret"
    ];

  if (headerSecret) {
    return String(headerSecret);
  }

  const apiKey =
    req.headers[
      "x-api-key"
    ];

  if (apiKey) {
    return String(apiKey);
  }

  const authorization =
    req.headers.authorization;

  if (
    authorization &&
    authorization.startsWith(
      "Bearer "
    )
  ) {

    return authorization
      .slice(7)
      .trim();
  }

  if (
    req.body &&
    req.body.adminSecret
  ) {

    return String(
      req.body.adminSecret
    );
  }

  if (
    req.query &&
    req.query.adminSecret
  ) {

    return String(
      req.query.adminSecret
    );
  }

  return "";
}

function requireAdmin(
  req,
  res,
  next
) {

  if (!ADMIN_SECRET) {

    return res.status(500).json({
      success: false,
      error:
        "NOVI_ADMIN_SECRET is not configured."
    });
  }

  const supplied =
    getAdminSecret(req);

  if (
    !supplied ||
    supplied !== ADMIN_SECRET
  ) {

    return res.status(401).json({
      success: false,
      error:
        "Unauthorized"
    });
  }

  next();
}

/* =========================================================
   SESSION AUTH
========================================================= */

function getSessionToken(req) {

  const headerToken =
    req.headers[
      "x-novi-session"
    ] ||
    req.headers[
      "x-session-token"
    ];

  if (headerToken) {
    return String(headerToken);
  }

  const authorization =
    req.headers.authorization;

  if (
    authorization &&
    authorization.startsWith(
      "Bearer "
    )
  ) {

    return authorization
      .slice(7)
      .trim();
  }

  return "";
}

function getSession(req) {

  const token =
    getSessionToken(req);

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
    Date.now() >=
      Number(session.expiresAt)
  ) {

    sessions.delete(token);

    return null;
  }

  return {
    token,
    ...session
  };
}

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
        "Invalid or expired session."
    });
  }

  req.noviSession =
    session;

  next();
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      success: true,
      status: "online",
      name: "Novi",
      websocket: true,
      stock:
        getStock().length,
      time:
        new Date().toISOString()
    });
  }
);

/* =========================================================
   KEYS
========================================================= */

function parseDuration(value) {

  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const text =
    String(value)
      .trim()
      .toLowerCase();

  if (
    text === "lifetime" ||
    text === "permanent" ||
    text === "forever"
  ) {
    return null;
  }

  const match =
    text.match(
      /^(\d+)\s*(d|day|days|w|week|weeks|m|mo|month|months|y|year|years)$/
    );

  if (!match) {

    const number =
      Number(text);

    if (
      Number.isFinite(number) &&
      number > 0
    ) {
      return number;
    }

    return null;
  }

  const amount =
    Number(match[1]);

  const unit =
    match[2];

  if (
    unit.startsWith("w")
  ) {
    return amount * 7;
  }

  if (
    unit.startsWith("m")
  ) {
    return amount * 30;
  }

  if (
    unit.startsWith("y")
  ) {
    return amount * 365;
  }

  return amount;
}

app.post(
  "/api/keys",
  requireAdmin,
  (req, res) => {

    const keys =
      readJson(
        KEYS_FILE,
        []
      );

    const key =
      String(
        req.body.key ||
        req.body.license ||
        ""
      ).trim();

    if (!key) {

      return res.status(400).json({
        success: false,
        error:
          "Key is required."
      });
    }

    const durationDays =
      parseDuration(
        req.body.durationDays ||
        req.body.duration ||
        req.body.expiresIn
      );

    const existingIndex =
      keys.findIndex(
        item =>
          String(item.key)
            .toLowerCase() ===
          key.toLowerCase()
      );

    const createdAt =
      existingIndex >= 0
        ? keys[existingIndex]
            .createdAt ||
          new Date().toISOString()
        : new Date().toISOString();

    const expiresAt =
      durationDays === null
        ? null
        : Date.now() +
          durationDays *
          24 *
          60 *
          60 *
          1000;

    const record = {
      key,
      durationDays,
      expiresAt,
      createdAt
    };

    if (
      existingIndex >= 0
    ) {

      keys[existingIndex] =
        record;

    } else {

      keys.push(record);
    }

    writeJson(
      KEYS_FILE,
      keys
    );

    res.json({
      success: true,
      key: record
    });
  }
);

app.get(
  "/api/keys",
  requireAdmin,
  (req, res) => {

    const keys =
      readJson(
        KEYS_FILE,
        []
      );

    res.json({
      success: true,
      keys
    });
  }
);

/* =========================================================
   VERIFY
========================================================= */

app.post(
  "/api/verify",
  (req, res) => {

    const suppliedKey =
      String(
        req.body.key || ""
      ).trim();

    const deviceId =
      String(
        req.body.deviceId || ""
      ).trim();

    if (!suppliedKey) {

      return res.status(400).json({
        success: false,
        error:
          "Key is required."
      });
    }

    const keys =
      readJson(
        KEYS_FILE,
        []
      );

    const record =
      keys.find(
        item =>
          String(item.key)
            .toLowerCase() ===
          suppliedKey.toLowerCase()
      );

    if (!record) {

      return res.status(401).json({
        success: false,
        error:
          "Invalid key."
      });
    }

    if (
      record.expiresAt &&
      Date.now() >=
        Number(record.expiresAt)
    ) {

      return res.status(401).json({
        success: false,
        error:
          "This key has expired."
      });
    }

    const sessionToken =
      crypto.randomBytes(32)
        .toString("hex");

    sessions.set(
      sessionToken,
      {
        key:
          record.key,

        deviceId,

        durationDays:
          record.durationDays,

        expiresAt:
          record.expiresAt
            ? Number(
                record.expiresAt
              )
            : null,

        createdAt:
          Date.now()
      }
    );

    res.json({
      success: true,
      session:
        sessionToken,
      token:
        sessionToken,
      key:
        record.key,
      durationDays:
        record.durationDays,
      expiresAt:
        record.expiresAt
          ? Number(
              record.expiresAt
            )
          : null
    });
  }
);

/* =========================================================
   ADD STOCK
========================================================= */

function handleAddStock(
  req,
  res
) {

  const values =
    extractStockValues(
      req.body
    );

  if (!values.length) {

    return res.status(400).json({
      success: false,
      error:
        "No valid stock provided."
    });
  }

  const stock =
    getStock();

  const existing =
    new Set(
      stock.map(
        item =>
          String(
            item.stock_id
          ).toLowerCase()
      )
    );

  let added = 0;
  let duplicate = 0;

  for (
    const value of values
  ) {

    const normalized =
      String(value).trim();

    const lower =
      normalized.toLowerCase();

    if (
      existing.has(lower)
    ) {

      duplicate++;
      continue;
    }

    stock.push({
      id:
        crypto.randomUUID(),

      stock_id:
        normalized,

      created_at:
        Date.now()
    });

    existing.add(lower);

    added++;
  }

  writeJson(
    STOCK_FILE,
    stock
  );

  broadcastStockUpdate();

  res.json({
    success: true,
    added,
    duplicate,
    count:
      stock.length
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

/* =========================================================
   STOCK COUNT
========================================================= */

app.get(
  "/api/stock/count",
  requireSession,
  (req, res) => {

    const stock =
      getStock();

    res.json({
      success: true,
      count:
        stock.length
    });
  }
);

/* =========================================================
   STOCK
========================================================= */

/*
  IMPORTANT:

  Never return the complete stock list to normal
  authenticated users.

  The frontend only needs the number available.
*/

app.get(
  "/api/stock",
  requireSession,
  (req, res) => {

    const stock =
      getStock();

    res.json({
      success: true,
      count:
        stock.length
    });
  }
);

/* =========================================================
   ADMIN STOCK
========================================================= */

app.get(
  "/api/admin/stock",
  requireAdmin,
  (req, res) => {

    const stock =
      getStock();

    res.json({
      success: true,
      stock,
      count:
        stock.length
    });
  }
);

/* =========================================================
   GENERATE ONE STOCK ITEM
========================================================= */

app.post(
  "/api/stock/generate",
  requireSession,
  (req, res) => {

    const stock =
      getStock();

    console.log(
      `[Novi] Generate requested | Actual stock: ${stock.length}`
    );

    if (!stock.length) {

      return res.status(400).json({
        success: false,
        error:
          "No stock available.",
        stockRemaining:
          0
      });
    }

    /*
      EXACTLY ONE ITEM.

      Ignore amount/quantity sent by the frontend.
    */

    const generated =
      stock.shift();

    writeJson(
      STOCK_FILE,
      stock
    );

    broadcastStockUpdate();

    const item = {
      id:
        generated.id,

      value:
        generated.stock_id,

      stock_id:
        generated.stock_id,

      created_at:
        generated.created_at
    };

    res.json({
      success: true,

      generated: 1,

      item,

      items: [
        item
      ],

      stockRemaining:
        stock.length
    });
  }
);

/* =========================================================
   SAVED ITEMS
========================================================= */

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

    const savedItems =
      readJson(
        SAVED_FILE,
        []
      );

    const deviceId =
      req.noviSession.deviceId ||
      "unknown";

    const existing =
      savedItems.find(
        item =>
          item.device_id ===
            deviceId &&
          String(item.value)
            .toLowerCase() ===
          value.toLowerCase()
      );

    if (existing) {

      return res.json({
        success: true,
        item:
          existing,
        alreadySaved:
          true
      });
    }

    const item = {

      id:
        crypto.randomUUID(),

      value,

      device_id:
        deviceId,

      created_at:
        Date.now()
    };

    savedItems.push(item);

    writeJson(
      SAVED_FILE,
      savedItems
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

    const savedItems =
      readJson(
        SAVED_FILE,
        []
      );

    const deviceId =
      req.noviSession.deviceId ||
      "unknown";

    const items =
      savedItems.filter(
        item =>
          item.device_id ===
          deviceId
      );

    res.json({
      success: true,
      items
    });
  }
);

app.delete(
  "/api/saved-items/:id",
  requireSession,
  (req, res) => {

    const savedItems =
      readJson(
        SAVED_FILE,
        []
      );

    const deviceId =
      req.noviSession.deviceId ||
      "unknown";

    const index =
      savedItems.findIndex(
        item =>
          String(item.id) ===
            String(
              req.params.id
            ) &&
          item.device_id ===
            deviceId
      );

    if (index === -1) {

      return res.status(404).json({
        success: false,
        error:
          "Saved item not found."
      });
    }

    savedItems.splice(
      index,
      1
    );

    writeJson(
      SAVED_FILE,
      savedItems
    );

    res.json({
      success: true
    });
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/api/logout",
  requireSession,
  (req, res) => {

    sessions.delete(
      req.noviSession.token
    );

    res.json({
      success: true
    });
  }
);

/* =========================================================
   STATIC FRONTEND
========================================================= */

app.use(
  express.static(
    PUBLIC_DIR
  )
);

/* =========================================================
   API 404
========================================================= */

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

/* =========================================================
   FRONTEND FALLBACK
========================================================= */

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

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (err, req, res, next) => {

    console.error(
      "Novi server error:",
      err
    );

    res.status(500).json({
      success: false,
      error:
        "Internal server error."
    });
  }
);

/* =========================================================
   START
========================================================= */

server.listen(
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
      "WebSocket: /ws"
    );

    console.log(
      "Real-time stock: ENABLED"
    );

    console.log(
      `Current stock: ${getStock().length}`
    );

    console.log(
      "Saved items: ENABLED"
    );

    console.log(
      "======================================"
    );
  }
);

/* =========================================================
   SHUTDOWN
========================================================= */

function shutdown(signal) {

  console.log(
    `Received ${signal}. Shutting down Novi...`
  );

  for (
    const client of wsClients
  ) {

    try {
      client.close();
    } catch {}
  }

  server.close(
    () => {
      process.exit(0);
    }
  );

  setTimeout(
    () => {
      process.exit(0);
    },
    5000
  );
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
