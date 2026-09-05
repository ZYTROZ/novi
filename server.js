require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, "public");

const ADMIN_SECRET = process.env.NOVI_ADMIN_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!ADMIN_SECRET) {
  console.error("❌ Missing NOVI_ADMIN_SECRET");
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL");
  process.exit(1);
}

// ============================================================
// DATABASE
// ============================================================

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_keys (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      duration TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT,
      device_id TEXT,
      used BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS novi_stock (
      id SERIAL PRIMARY KEY,
      stock_id TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS novi_saved_items (
      id SERIAL PRIMARY KEY,
      stock_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      device_id TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS novi_stock_created_idx
    ON novi_stock(id);

    CREATE INDEX IF NOT EXISTS novi_saved_items_device_idx
    ON novi_saved_items(device_id);
  `);

  console.log("✅ PostgreSQL database ready");
}

// ============================================================
// EXPRESS
// ============================================================

app.use(cors());

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

// ============================================================
// SESSIONS
// ============================================================

const sessions = new Map();

// ============================================================
// ADMIN AUTH
// ============================================================

function requireAdmin(req, res, next) {
  const provided = String(
    req.headers["x-novi-admin-secret"] || ""
  );

  if (!provided || provided !== ADMIN_SECRET) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
  }

  next();
}

// ============================================================
// SESSION HELPERS
// ============================================================

function getSessionToken(req) {
  const authorization =
    req.headers.authorization ||
    req.headers.Authorization ||
    "";

  let token = "";

  if (authorization.startsWith("Bearer ")) {
    token = authorization
      .slice(7)
      .trim();
  }

  if (!token) {
    token = String(
      req.headers["x-novi-session"] || ""
    ).trim();
  }

  return token;
}

function getSession(req) {
  const token = getSessionToken(req);

  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (
    session.expiresAt !== null &&
    session.expiresAt <= Date.now()
  ) {
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
      error: "Invalid or expired session",
    });
  }

  req.session = session;

  next();
}

// ============================================================
// KEY HELPERS
// ============================================================

function generateKeyString() {
  const part = () =>
    crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase();

  return `NOVI-${part()}-${part()}-${part()}`;
}

function getDurationMs(duration) {
  switch (duration) {
    case "1d":
      return 24 * 60 * 60 * 1000;

    case "3d":
      return 3 * 24 * 60 * 60 * 1000;

    case "1week":
      return 7 * 24 * 60 * 60 * 1000;

    case "1month":
      return 30 * 24 * 60 * 60 * 1000;

    case "lifetime":
      return null;

    default:
      return undefined;
  }
}

// ============================================================
// HEALTH
// ============================================================

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      status: "online",
      database: "connected",
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("Health check error:", error);

    res.status(500).json({
      success: false,
      status: "online",
      database: "error",
    });
  }
});

// ============================================================
// API INFO
// ============================================================

app.get("/api", (req, res) => {
  res.json({
    success: true,
    name: "Novi API",
    status: "online",
  });
});

// ============================================================
// CREATE KEYS
// ============================================================

app.post(
  "/api/keys",
  requireAdmin,
  async (req, res) => {
    try {
      const duration = String(
        req.body?.duration || ""
      ).trim();

      const amount = Math.min(
        Math.max(
          Number(req.body?.amount) || 1,
          1
        ),
        1000
      );

      const durationMs =
        getDurationMs(duration);

      if (durationMs === undefined) {
        return res.status(400).json({
          success: false,
          error: "Invalid duration",
        });
      }

      const created = [];
      const now = Date.now();

      for (let i = 0; i < amount; i++) {
        let key;

        while (true) {
          key = generateKeyString();

          const exists = await pool.query(
            `
            SELECT id
            FROM novi_keys
            WHERE UPPER(key) = $1
            LIMIT 1
            `,
            [key]
          );

          if (exists.rowCount === 0) {
            break;
          }
        }

        const expiresAt =
          durationMs === null
            ? null
            : now + durationMs;

        await pool.query(
          `
          INSERT INTO novi_keys
          (
            key,
            duration,
            created_at,
            expires_at,
            used
          )
          VALUES
          ($1, $2, $3, $4, FALSE)
          `,
          [
            key,
            duration,
            now,
            expiresAt,
          ]
        );

        created.push({
          key,
          duration,
          createdAt: now,
          expiresAt,
        });
      }

      res.json({
        success: true,
        keys: created,
      });
    } catch (error) {
      console.error(
        "Create keys error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Failed to create keys",
      });
    }
  }
);

// ============================================================
// GET KEYS
// ============================================================

app.get(
  "/api/keys",
  requireAdmin,
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          id,
          key,
          duration,
          created_at,
          expires_at,
          device_id,
          used
        FROM novi_keys
        ORDER BY id DESC
      `);

      res.json({
        success: true,

        keys: result.rows.map((row) => ({
          id: row.id,
          key: row.key,
          duration: row.duration,

          createdAt:
            Number(row.created_at),

          expiresAt:
            row.expires_at === null
              ? null
              : Number(row.expires_at),

          deviceId:
            row.device_id,

          used:
            row.used,
        })),
      });
    } catch (error) {
      console.error(
        "Get keys error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Failed to get keys",
      });
    }
  }
);

// ============================================================
// DELETE KEY
// ============================================================

app.delete(
  "/api/keys/:key",
  requireAdmin,
  async (req, res) => {
    try {
      const key = String(
        req.params.key || ""
      )
        .trim()
        .toUpperCase();

      const result = await pool.query(
        `
        DELETE FROM novi_keys
        WHERE UPPER(key) = $1
        `,
        [key]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          error: "Key not found",
        });
      }

      res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "Delete key error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Failed to delete key",
      });
    }
  }
);

// ============================================================
// VERIFY KEY
// ============================================================

app.post(
  "/api/verify",
  async (req, res) => {
    try {
      const rawKey =
        req.body?.key;

      const deviceId = String(
        req.body?.deviceId ||
        req.body?.device_id ||
        ""
      ).trim();

      const key =
        typeof rawKey === "string"
          ? rawKey
              .trim()
              .toUpperCase()
          : "";

      if (!key || !deviceId) {
        return res.status(400).json({
          success: false,
          message:
            "Key and deviceId are required",
          error:
            "Key and deviceId are required",
        });
      }

      const result =
        await pool.query(
          `
          SELECT *
          FROM novi_keys
          WHERE UPPER(key) = $1
          LIMIT 1
          `,
          [key]
        );

      if (result.rowCount === 0) {
        return res.status(401).json({
          success: false,
          message:
            "Invalid or expired key.",
          error:
            "Invalid key",
        });
      }

      const row =
        result.rows[0];

      const now = Date.now();

      if (
        row.expires_at !== null &&
        Number(row.expires_at) <= now
      ) {
        return res.status(401).json({
          success: false,
          message:
            "Invalid or expired key.",
          error:
            "Key expired",
        });
      }

      if (
        row.device_id &&
        String(row.device_id) !==
          String(deviceId)
      ) {
        return res.status(401).json({
          success: false,
          message:
            "Key is already bound to another device.",
          error:
            "Key is already bound to another device",
        });
      }

      if (!row.device_id) {
        await pool.query(
          `
          UPDATE novi_keys
          SET
            device_id = $1,
            used = TRUE
          WHERE id = $2
          `,
          [
            deviceId,
            row.id,
          ]
        );
      }

      const token =
        crypto
          .randomBytes(32)
          .toString("hex");

      const expiresAt =
        row.expires_at === null
          ? null
          : Number(row.expires_at);

      sessions.set(token, {
        key: row.key,
        deviceId,
        createdAt: now,
        expiresAt,
      });

      res.json({
        success: true,

        sessionToken: token,
        token,

        key: {
          key: row.key,
          duration: row.duration,
          expiresAt,
          keyExpiresAt:
            expiresAt,
        },

        duration:
          row.duration,

        expiresAt,
      });
    } catch (error) {
      console.error(
        "Verify error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Verification failed",
        error:
          "Verification failed",
      });
    }
  }
);

// ============================================================
// STOCK ID NORMALIZER
// ============================================================

function normalizeStockItem(item) {
  if (typeof item === "string") {
    const value = item.trim();

    if (!value) {
      return null;
    }

    return value;
  }

  if (
    item &&
    typeof item === "object"
  ) {
    const value =
      item.stockId ??
      item.stock_id ??
      item.id ??
      item.accountId ??
      item.account_id ??
      item.value ??
      item.name;

    if (
      value !== undefined &&
      value !== null
    ) {
      const normalized =
        String(value).trim();

      return normalized || null;
    }
  }

  return null;
}

// ============================================================
// STOCK ADD
// ============================================================

app.post(
  "/api/stock/add",
  requireAdmin,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      let items = [];

      // ------------------------------------------------------
      // RAW ARRAY
      // ------------------------------------------------------

      if (Array.isArray(req.body)) {
        items = req.body;
      }

      // ------------------------------------------------------
      // OBJECT
      // ------------------------------------------------------

      else if (
        req.body &&
        typeof req.body === "object"
      ) {
        const possibleKeys = [
          "stock",
          "stocks",
          "items",
          "data",
          "accounts",
          "accountList",
          "stockIds",
          "stock_ids",
        ];

        for (
          const key of possibleKeys
        ) {
          if (
            Array.isArray(
              req.body[key]
            )
          ) {
            items =
              req.body[key];

            break;
          }
        }

        // Single stock item
        if (
          items.length === 0
        ) {
          const single =
            req.body.stockId ??
            req.body.stock_id ??
            req.body.accountId ??
            req.body.account_id ??
            req.body.value ??
            req.body.id;

          if (
            single !== undefined &&
            single !== null
          ) {
            items = [single];
          }
        }

        // Last resort: find first array
        if (
          items.length === 0
        ) {
          for (
            const value of Object.values(
              req.body
            )
          ) {
            if (
              Array.isArray(value)
            ) {
              items = value;
              break;
            }
          }
        }
      }

      if (!items.length) {
        return res.status(400).json({
          success: false,
          error:
            "No stock items supplied",
        });
      }

      await client.query("BEGIN");

      let added = 0;

      for (
        const item of items
      ) {
        const stockId =
          normalizeStockItem(
            item
          );

        if (!stockId) {
          continue;
        }

        await client.query(
          `
          INSERT INTO novi_stock
          (
            stock_id,
            created_at
          )
          VALUES
          ($1, $2)
          `,
          [
            stockId,
            Date.now(),
          ]
        );

        added++;
      }

      if (added === 0) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          success: false,
          error:
            "No valid stock IDs found",
        });
      }

      await client.query(
        "COMMIT"
      );

      console.log(
        `✅ Added ${added} stock item(s)`
      );

      res.json({
        success: true,
        added,
        count: added,
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      console.error(
        "❌ Add stock error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to add stock",
      });
    } finally {
      client.release();
    }
  }
);

// ============================================================
// ADMIN STOCK
// ============================================================

app.get(
  "/api/admin/stock",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            id,
            stock_id,
            created_at
          FROM novi_stock
          ORDER BY id ASC
        `);

      const stock =
        result.rows.map(
          (row) => ({
            id: row.id,

            stockId:
              row.stock_id,

            createdAt:
              Number(
                row.created_at
              ),
          })
        );

      res.json({
        success: true,
        stock,
        count: stock.length,
      });
    } catch (error) {
      console.error(
        "Admin stock error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to get stock",
      });
    }
  }
);

// ============================================================
// STOCK
// ============================================================

app.get(
  "/api/stock",
  requireSession,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            id,
            stock_id,
            created_at
          FROM novi_stock
          ORDER BY id ASC
        `);

      const stock =
        result.rows.map(
          (row) => ({
            id: row.id,

            stockId:
              row.stock_id,

            createdAt:
              Number(
                row.created_at
              ),
          })
        );

      res.json({
        success: true,
        stock,
        count: stock.length,
      });
    } catch (error) {
      console.error(
        "Get stock error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to get stock",
      });
    }
  }
);

// ============================================================
// STOCK COUNT
// ============================================================

app.get(
  "/api/stock/count",
  requireSession,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            COUNT(*)::int AS count
          FROM novi_stock
        `);

      res.json({
        success: true,
        count:
          result.rows[0].count,
      });
    } catch (error) {
      console.error(
        "Stock count error:",
        error
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
// GENERATE STOCK
// ============================================================

app.post(
  "/api/stock/generate",
  requireSession,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      const amount =
        Math.min(
          Math.max(
            Number(
              req.body?.amount
            ) || 1,
            1
          ),
          100
        );

      await client.query(
        "BEGIN"
      );

      const result =
        await client.query(
          `
          SELECT
            id,
            stock_id,
            created_at
          FROM novi_stock
          ORDER BY id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
          `,
          [amount]
        );

      if (
        result.rowCount === 0
      ) {
        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          success: false,
          error:
            "No stock available",
        });
      }

      const items =
        result.rows.map(
          (row) => ({
            id: row.id,

            stockId:
              row.stock_id,

            createdAt:
              Number(
                row.created_at
              ),
          })
        );

      const ids =
        result.rows.map(
          (row) => row.id
        );

      await client.query(
        `
        DELETE FROM novi_stock
        WHERE id = ANY($1::int[])
        `,
        [ids]
      );

      await client.query(
        "COMMIT"
      );

      res.json({
        success: true,

        item:
          items[0],

        items,

        // Compatibility
        account:
          items[0],

        accounts:
          items,

        count:
          items.length,
      });
    } catch (error) {
      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      console.error(
        "Generate stock error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to generate stock",
      });
    } finally {
      client.release();
    }
  }
);

// ============================================================
// SAVED STOCK ITEMS
// ============================================================

app.post(
  "/api/saved-items",
  requireSession,
  async (req, res) => {
    try {
      const stockId =
        String(
          req.body?.stockId ||
          req.body?.stock_id ||
          req.body?.id ||
          ""
        ).trim();

      if (!stockId) {
        return res.status(400).json({
          success: false,
          error:
            "Stock ID is required",
        });
      }

      const result =
        await pool.query(
          `
          INSERT INTO novi_saved_items
          (
            stock_id,
            created_at,
            device_id
          )
          VALUES
          ($1, $2, $3)
          RETURNING
            id,
            stock_id,
            created_at
          `,
          [
            stockId,
            Date.now(),
            req.session.deviceId,
          ]
        );

      const row =
        result.rows[0];

      res.json({
        success: true,

        item: {
          id: row.id,

          stockId:
            row.stock_id,

          createdAt:
            Number(
              row.created_at
            ),
        },
      });
    } catch (error) {
      console.error(
        "Save item error:",
        error
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
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            id,
            stock_id,
            created_at
          FROM novi_saved_items
          WHERE device_id = $1
          ORDER BY id DESC
          `,
          [
            req.session.deviceId,
          ]
        );

      const items =
        result.rows.map(
          (row) => ({
            id: row.id,

            stockId:
              row.stock_id,

            createdAt:
              Number(
                row.created_at
              ),
          })
        );

      res.json({
        success: true,
        items,
      });
    } catch (error) {
      console.error(
        "Get saved items error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to get saved items",
      });
    }
  }
);

// ============================================================
// GET SAVED ITEM
// ============================================================

app.get(
  "/api/saved-items/:id",
  requireSession,
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(id)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid ID",
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            stock_id,
            created_at
          FROM novi_saved_items
          WHERE id = $1
            AND device_id = $2
          LIMIT 1
          `,
          [
            id,
            req.session.deviceId,
          ]
        );

      if (
        result.rowCount === 0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Saved item not found",
        });
      }

      const row =
        result.rows[0];

      res.json({
        success: true,

        item: {
          id: row.id,

          stockId:
            row.stock_id,

          createdAt:
            Number(
              row.created_at
            ),
        },
      });
    } catch (error) {
      console.error(
        "Get saved item error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to get saved item",
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
  async (req, res) => {
    try {
      const id =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(id)
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid ID",
        });
      }

      const result =
        await pool.query(
          `
          DELETE FROM novi_saved_items
          WHERE id = $1
            AND device_id = $2
          `,
          [
            id,
            req.session.deviceId,
          ]
        );

      if (
        result.rowCount === 0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Saved item not found",
        });
      }

      res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "Delete saved item error:",
        error
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
  requireSession,
  (req, res) => {
    const token =
      getSessionToken(req);

    if (token) {
      sessions.delete(token);
    }

    res.json({
      success: true,
    });
  }
);

// ============================================================
// STATIC WEBSITE
// ============================================================

app.use(
  express.static(PUBLIC_DIR)
);

// ============================================================
// WEBSITE FALLBACK
// ============================================================

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

// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
  (error, req, res, next) => {
    console.error(
      "Unhandled server error:",
      error
    );

    if (res.headersSent) {
      return next(error);
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

async function start() {
  try {
    await initDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `🚀 Novi server running on port ${PORT}`
        );
      }
    );
  } catch (error) {
    console.error(
      "❌ Failed to start Novi:",
      error
    );

    process.exit(1);
  }
}

start();
