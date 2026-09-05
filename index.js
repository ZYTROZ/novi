require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, "public");

const ADMIN_SECRET = process.env.NOVI_ADMIN_SECRET || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("PostgreSQL error:", err.message);
});

/* ============================================================
   EXPRESS
============================================================ */

app.disable("x-powered-by");

app.use(
  cors({
    origin: true,
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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

/* ============================================================
   DATABASE
============================================================ */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_keys (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      duration INTEGER DEFAULT 30,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_stock_items (
      id BIGSERIAL PRIMARY KEY,
      stock_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS novi_stock_items_created_idx
    ON novi_stock_items(created_at)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS novi_stock_items_stock_id_idx
    ON novi_stock_items(stock_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_saved_items (
      id BIGSERIAL PRIMARY KEY,
      stock_id TEXT NOT NULL,
      device_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log("Database initialized");
}

/* ============================================================
   SESSIONS
============================================================ */

const sessions = new Map();

function createSession(key, expiresAt, deviceId = null) {
  const token = crypto.randomBytes(32).toString("hex");

  sessions.set(token, {
    key,
    expiresAt,
    deviceId,
    createdAt: Date.now(),
  });

  return token;
}

function getSession(req) {
  const headerToken = req.headers["x-novi-session"];

  const auth = req.headers.authorization || "";

  let bearer = null;

  if (auth.toLowerCase().startsWith("bearer ")) {
    bearer = auth.slice(7).trim();
  }

  const token = headerToken || bearer;

  if (!token) {
    return null;
  }

  const session = sessions.get(token);

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

/* ============================================================
   ADMIN AUTH
============================================================ */

function getAdminSecret(req) {
  return (
    req.headers["x-admin-secret"] ||
    req.headers["x-api-key"] ||
    req.headers.authorization?.replace(
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

function requireAdmin(req, res, next) {
  const supplied = String(getAdminSecret(req) || "");
  const expected = String(ADMIN_SECRET || "");

  if (!expected) {
    return res.status(500).json({
      success: false,
      error: "NOVI_ADMIN_SECRET is not configured",
    });
  }

  if (!supplied) {
    return res.status(401).json({
      success: false,
      error: "Missing admin secret",
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
      error: "Invalid admin secret",
    });
  }

  next();
}

/* ============================================================
   SESSION AUTH
============================================================ */

function requireSession(req, res, next) {
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      error: "Invalid or expired session",
    });
  }

  req.noviSession = session;
  next();
}

/* ============================================================
   HEALTH
============================================================ */

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Novi API",
    status: "online",
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      status: "online",
      database: "connected",
      sessions: sessions.size,
    });
  } catch (err) {
    console.error("Health error:", err.message);

    res.status(500).json({
      success: false,
      status: "online",
      database: "error",
    });
  }
});

/* ============================================================
   KEYS
============================================================ */

app.post("/api/keys", requireAdmin, async (req, res) => {
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
        : crypto.randomBytes(16).toString("hex");

    const safeDuration =
      Number.isFinite(duration) && duration > 0
        ? Math.floor(duration)
        : 30;

    const expiresAt = new Date(
      Date.now() +
        safeDuration * 24 * 60 * 60 * 1000
    );

    const result = await pool.query(
      `
      INSERT INTO novi_keys
        (key, duration, expires_at)
      VALUES
        ($1, $2, $3)
      ON CONFLICT (key)
      DO UPDATE SET
        duration = EXCLUDED.duration,
        expires_at = EXCLUDED.expires_at
      RETURNING *
      `,
      [key, safeDuration, expiresAt]
    );

    res.json({
      success: true,
      key: result.rows[0].key,
      duration: result.rows[0].duration,
      expiresAt: result.rows[0].expires_at,
    });
  } catch (err) {
    console.error("Create key error:", err);

    res.status(500).json({
      success: false,
      error: "Failed to create key",
    });
  }
});

app.get("/api/keys", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        key,
        duration,
        created_at,
        expires_at
      FROM novi_keys
      ORDER BY id DESC
    `);

    res.json({
      success: true,
      keys: result.rows,
    });
  } catch (err) {
    console.error("Keys error:", err);

    res.status(500).json({
      success: false,
      error: "Failed to load keys",
    });
  }
});

/* ============================================================
   VERIFY
============================================================ */

app.post("/api/verify", async (req, res) => {
  try {
    const body = req.body || {};

    const key = String(
      body.key ||
      body.license ||
      body.licenseKey ||
      ""
    ).trim();

    const deviceId = String(
      body.deviceId ||
      body.device_id ||
      ""
    ).trim() || null;

    if (!key) {
      return res.status(400).json({
        success: false,
        valid: false,
        error: "Missing key",
      });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM novi_keys
      WHERE key = $1
      LIMIT 1
      `,
      [key]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        success: false,
        valid: false,
        error: "Invalid key",
      });
    }

    const row = result.rows[0];

    if (
      row.expires_at &&
      new Date(row.expires_at).getTime() <= Date.now()
    ) {
      return res.status(401).json({
        success: false,
        valid: false,
        error: "Key expired",
      });
    }

    const expiresAt = row.expires_at
      ? new Date(row.expires_at).getTime()
      : Date.now() +
        Number(row.duration || 30) * 86400000;

    const sessionToken = createSession(
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
      duration: row.duration,
      expiresAt: row.expires_at,
    });
  } catch (err) {
    console.error("Verify error:", err);

    res.status(500).json({
      success: false,
      valid: false,
      error: "Verification failed",
    });
  }
});

/* ============================================================
   STOCK HELPERS
============================================================ */

function cleanStockValue(value) {
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
    return String(value).trim() || null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();

  if (!cleaned) {
    return null;
  }

  return cleaned;
}

function extractStockValues(input) {
  const values = [];

  function add(value) {
    const cleaned = cleanStockValue(value);

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
      for (const item of value) {
        walk(item);
      }

      return;
    }

    if (typeof value === "string") {
      const lines = value
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);

      for (const line of lines) {
        add(line);
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

    if (typeof value === "object") {
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

      for (const field of directFields) {
        if (
          Object.prototype.hasOwnProperty.call(
            value,
            field
          )
        ) {
          walk(value[field]);
        }
      }

      const arrayFields = [
        "stock",
        "stocks",
        "items",
        "data",
        "values",
        "list",
        "stockIds",
        "stock_ids",
        "entries",
        "accounts",
      ];

      for (const field of arrayFields) {
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

  return [...new Set(values)];
}

/* ============================================================
   STOCK ADD
============================================================ */

async function stockAddHandler(req, res) {
  try {
    console.log(
      "================================"
    );

    console.log(
      "STOCK ADD REQUEST:",
      req.method,
      req.originalUrl
    );

    console.log(
      "CONTENT TYPE:",
      req.headers["content-type"]
    );

    let body = req.body;

    if (typeof body === "string") {
      const trimmed = body.trim();

      if (
        trimmed.startsWith("{") ||
        trimmed.startsWith("[")
      ) {
        try {
          body = JSON.parse(trimmed);
        } catch {
          body = trimmed;
        }
      }
    }

    const values = extractStockValues(body);

    console.log(
      "STOCK VALUES RECEIVED:",
      values.length
    );

    if (!values.length) {
      return res.status(400).json({
        success: false,
        error: "No valid stock IDs supplied",
        added: 0,
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const stockId of values) {
        await client.query(
          `
          INSERT INTO novi_stock_items
            (stock_id, created_at)
          VALUES
            ($1, NOW())
          `,
          [stockId]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    console.log(
      `ADDED ${values.length} STOCK ITEM(S)`
    );

    console.log(
      "================================"
    );

    return res.json({
      success: true,
      added: values.length,
      count: values.length,
      message: `Added ${values.length} stock item(s)`,
    });
  } catch (err) {
    console.error(
      "STOCK ADD ERROR:",
      err
    );

    return res.status(500).json({
      success: false,
      error: "Failed to add stock",
    });
  }
}

/* ============================================================
   STOCK ADD ROUTES
============================================================ */

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

/*
  IMPORTANT:
  GET /api/stock is handled below.
  POST /api/stock is the compatibility add route.
*/

app.post(
  "/api/stock",
  requireAdmin,
  stockAddHandler
);

/* ============================================================
   STOCK COUNT
============================================================ */

app.get(
  "/api/stock/count",
  requireSession,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT COUNT(*)::INTEGER AS count
        FROM novi_stock_items
      `);

      res.json({
        success: true,
        count: result.rows[0].count,
      });
    } catch (err) {
      console.error(
        "Stock count error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Failed to get stock count",
      });
    }
  }
);

/* ============================================================
   STOCK LIST
============================================================ */

app.get(
  "/api/stock",
  requireSession,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          id,
          stock_id,
          created_at
        FROM novi_stock_items
        ORDER BY id ASC
      `);

      res.json({
        success: true,
        stock: result.rows,
        items: result.rows,
        accounts: result.rows,
      });
    } catch (err) {
      console.error(
        "Stock list error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Failed to load stock",
      });
    }
  }
);

/* ============================================================
   ADMIN STOCK
============================================================ */

app.get(
  "/api/admin/stock",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          id,
          stock_id,
          created_at
        FROM novi_stock_items
        ORDER BY id ASC
      `);

      res.json({
        success: true,
        stock: result.rows,
        items: result.rows,
        count: result.rows.length,
      });
    } catch (err) {
      console.error(
        "Admin stock error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Failed to load stock",
      });
    }
  }
);

/* ============================================================
   GENERATE STOCK
============================================================ */

app.post(
  "/api/stock/generate",
  requireSession,
  async (req, res) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(`
        SELECT
          id,
          stock_id,
          created_at
        FROM novi_stock_items
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);

      if (!result.rows.length) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          error: "Out of stock",
        });
      }

      const item = result.rows[0];

      await client.query(
        `
        DELETE FROM novi_stock_items
        WHERE id = $1
        `,
        [item.id]
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        item: item.stock_id,
        account: item.stock_id,
        stock: item.stock_id,
        stockId: item.stock_id,
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "Generate error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Failed to generate stock",
      });
    } finally {
      client.release();
    }
  }
);

/* ============================================================
   SAVED ITEMS
============================================================ */

app.post(
  "/api/saved-items",
  requireSession,
  async (req, res) => {
    try {
      const body = req.body || {};

      const stockId = cleanStockValue(
        body.stockId ||
        body.stock_id ||
        body.item ||
        body.value
      );

      const deviceId = String(
        body.deviceId ||
        body.device_id ||
        req.noviSession.deviceId ||
        ""
      ).trim() || null;

      if (!stockId) {
        return res.status(400).json({
          success: false,
          error: "Missing stock ID",
        });
      }

      const result = await pool.query(
        `
        INSERT INTO novi_saved_items
          (stock_id, device_id, created_at)
        VALUES
          ($1, $2, NOW())
        RETURNING *
        `,
        [stockId, deviceId]
      );

      res.json({
        success: true,
        item: result.rows[0],
      });
    } catch (err) {
      console.error(
        "Save error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Failed to save item",
      });
    }
  }
);

app.get(
  "/api/saved-items",
  requireSession,
  async (req, res) => {
    try {
      const deviceId = String(
        req.query.deviceId ||
        req.query.device_id ||
        req.noviSession.deviceId ||
        ""
      ).trim();

      let result;

      if (deviceId) {
        result = await pool.query(
          `
          SELECT
            id,
            stock_id,
            device_id,
            created_at
          FROM novi_saved_items
          WHERE device_id = $1
          ORDER BY id DESC
          `,
          [deviceId]
        );
      } else {
        result = await pool.query(`
          SELECT
            id,
            stock_id,
            device_id,
            created_at
          FROM novi_saved_items
          ORDER BY id DESC
        `);
      }

      res.json({
        success: true,
        items: result.rows,
        savedItems: result.rows,
      });
    } catch (err) {
      console.error(
        "Saved items error:",
        err
      );

      res.status(500).json({
        success: false,
        error: "Failed to load saved items",
      });
    }
  }
);

/* ============================================================
   DELETE SAVED ITEM
============================================================ */

app.delete(
  "/api/saved-items/:id",
  requireSession,
  async (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          error: "Invalid item ID",
        });
      }

      const result = await pool.query(
        `
        DELETE FROM novi_saved_items
        WHERE id = $1
        RETURNING id
        `,
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          error: "Saved item not found",
        });
      }

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
        error: "Failed to delete saved item",
      });
    }
  }
);

/* ============================================================
   LOGOUT
============================================================ */

app.post("/api/logout", (req, res) => {
  const session = getSession(req);

  if (session) {
    sessions.delete(session.token);
  }

  res.json({
    success: true,
    loggedOut: true,
  });
});

/* ============================================================
   API 404
============================================================ */

app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    error: "API route not found",
    method: req.method,
    path: req.originalUrl,
  });
});

/* ============================================================
   WEBSITE
============================================================ */

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));

  /*
    Express 5 wildcard syntax.
    Do NOT change this to app.get("*").
  */
  app.get("/{*splat}", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return next();
    }

    const indexFile = path.join(
      PUBLIC_DIR,
      "index.html"
    );

    if (fs.existsSync(indexFile)) {
      return res.sendFile(indexFile);
    }

    next();
  });
}

/* ============================================================
   ERROR HANDLER
============================================================ */

app.use((err, req, res, next) => {
  console.error(
    "Unhandled server error:",
    err
  );

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

/* ============================================================
   START
============================================================ */

async function start() {
  try {
    await initDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log("================================");
      console.log("       NOVI SERVER ONLINE");
      console.log("================================");
      console.log("Port:", PORT);
      console.log("Database: connected");
      console.log("Stock API: ready");
      console.log("================================");
    });
  } catch (err) {
    console.error(
      "FAILED TO START NOVI:",
      err
    );

    process.exit(1);
  }
}

start();
