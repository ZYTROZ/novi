require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const app = express();

// ============================================================
// CONFIG
// ============================================================

const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, "public");

const ADMIN_SECRET =
  process.env.NOVI_ADMIN_SECRET || "";

const DATABASE_URL =
  process.env.DATABASE_URL || "";

const DISCORD_TOKEN =
  process.env.DISCORD_TOKEN || "";

const DISCORD_CLIENT_ID =
  process.env.DISCORD_CLIENT_ID || "";

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is missing.");
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

pool.on("error", (err) => {
  console.error(
    "Unexpected PostgreSQL pool error:",
    err
  );
});

// ============================================================
// EXPRESS
// ============================================================

app.use(
  cors({
    origin: true,
    credentials: false,
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

// ============================================================
// SESSIONS
// ============================================================

const sessions = new Map();

function createSession(
  keyId,
  durationMs,
  lifetime = false
) {
  const token =
    crypto.randomBytes(32).toString("hex");

  sessions.set(token, {
    keyId,
    lifetime,
    expiresAt: lifetime
      ? null
      : Date.now() + Number(durationMs),
  });

  return token;
}

function getSession(req) {
  const token =
    req.headers["x-novi-session"] ||
    req.headers["authorization"]?.replace(
      /^Bearer\s+/i,
      ""
    );

  if (!token) {
    return null;
  }

  const session =
    sessions.get(token);

  if (!session) {
    return null;
  }

  // Lifetime sessions never expire.
  if (
    !session.lifetime &&
    session.expiresAt !== null &&
    Date.now() > session.expiresAt
  ) {
    sessions.delete(token);
    return null;
  }

  return {
    token,
    ...session,
  };
}

function requireSession(req, res, next) {
  const session =
    getSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
  }

  req.noviSession = session;

  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET) {
    return res.status(500).json({
      success: false,
      error: "Admin secret is not configured",
    });
  }

  const supplied =
    req.headers["x-novi-admin-secret"] ||
    req.headers["x-admin-secret"] ||
    req.body?.adminSecret ||
    req.body?.secret ||
    req.query?.adminSecret ||
    req.query?.secret;

  if (
    !supplied ||
    supplied !== ADMIN_SECRET
  ) {
    return res.status(403).json({
      success: false,
      error: "Forbidden",
    });
  }

  next();
}

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_keys (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      duration BIGINT NOT NULL DEFAULT 86400000,
      created_at BIGINT NOT NULL,
      expires_at BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_stock_items (
      id SERIAL PRIMARY KEY,
      stock_id TEXT NOT NULL,
      created_at BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_saved_items (
      id SERIAL PRIMARY KEY,
      stock_id TEXT NOT NULL,
      device_id TEXT,
      created_at BIGINT
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    novi_stock_items_stock_id_idx
    ON novi_stock_items(stock_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    novi_saved_items_device_id_idx
    ON novi_saved_items(device_id)
  `);

  console.log("Database initialized");
}

// ============================================================
// STOCK HELPERS
// ============================================================

function cleanStockValue(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (
    typeof value === "object"
  ) {
    value =
      value.stockId ??
      value.stock_id ??
      value.id ??
      value.value ??
      value.code ??
      value.name;
  }

  if (
    value === undefined ||
    value === null
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

function extractStockIds(body) {
  const result = [];

  function add(value) {
    if (Array.isArray(value)) {
      for (const item of value) {
        add(item);
      }

      return;
    }

    const cleaned =
      cleanStockValue(value);

    if (cleaned) {
      result.push(cleaned);
    }
  }

  if (Array.isArray(body)) {
    add(body);
  } else if (
    body &&
    typeof body === "object"
  ) {
    const possibleFields = [
      "stock",
      "stocks",
      "stockIds",
      "stock_ids",
      "items",
      "data",
      "values",
      "list",
      "codes",
      "accounts",
      "account",
      "stockId",
      "stock_id",
      "value",
      "code",
      "name",
    ];

    for (
      const field of possibleFields
    ) {
      if (
        body[field] !== undefined
      ) {
        add(body[field]);
      }
    }

    if (result.length === 0) {
      for (
        const value of Object.values(body)
      ) {
        if (
          typeof value === "string" ||
          Array.isArray(value) ||
          (
            value &&
            typeof value === "object"
          )
        ) {
          add(value);
        }
      }
    }
  } else if (
    typeof body === "string"
  ) {
    add(body);
  }

  return [
    ...new Set(result),
  ];
}

// ============================================================
// LICENSE DURATION HELPERS
// ============================================================

function parseDuration(value) {
  if (!value) {
    return {
      duration: NaN,
      lifetime: false,
    };
  }

  const input =
    String(value)
      .trim()
      .toLowerCase();

  // ==========================================================
  // 1 DAY
  // ==========================================================

  if (input === "1d") {
    return {
      duration:
        1 *
        24 *
        60 *
        60 *
        1000,

      lifetime: false,
    };
  }

  // ==========================================================
  // 3 DAYS
  // ==========================================================

  if (input === "3d") {
    return {
      duration:
        3 *
        24 *
        60 *
        60 *
        1000,

      lifetime: false,
    };
  }

  // ==========================================================
  // 1 WEEK
  // ==========================================================

  if (input === "1w") {
    return {
      duration:
        7 *
        24 *
        60 *
        60 *
        1000,

      lifetime: false,
    };
  }

  // ==========================================================
  // 1 MONTH
  //
  // 1 month = 30 days
  // ==========================================================

  if (input === "1mo") {
    return {
      duration:
        30 *
        24 *
        60 *
        60 *
        1000,

      lifetime: false,
    };
  }

  // ==========================================================
  // LIFETIME
  // ==========================================================

  if (
    input === "lifetime" ||
    input === "life" ||
    input === "forever" ||
    input === "perm" ||
    input === "permanent"
  ) {
    return {
      duration: null,
      lifetime: true,
    };
  }

  return {
    duration: NaN,
    lifetime: false,
  };
}

function formatDuration(
  duration,
  lifetime = false
) {
  if (lifetime) {
    return "Lifetime";
  }

  const ms =
    Number(duration);

  if (
    !Number.isFinite(ms) ||
    ms <= 0
  ) {
    return "Unknown";
  }

  const day =
    24 *
    60 *
    60 *
    1000;

  const week =
    7 *
    day;

  const month =
    30 *
    day;

  if (ms === month) {
    return "1 month";
  }

  if (ms === week) {
    return "1 week";
  }

  if (ms === 3 * day) {
    return "3 days";
  }

  if (ms === day) {
    return "1 day";
  }

  return "Unknown";
}

// ============================================================
// LICENSE KEY GENERATOR
// ============================================================

async function generateKeys(
  amount = 1,
  duration = 86400000,
  lifetime = false
) {
  amount = Number(amount);

  if (
    !Number.isFinite(amount)
  ) {
    amount = 1;
  }

  amount =
    Math.floor(amount);

  amount =
    Math.max(
      1,
      Math.min(
        amount,
        100
      )
    );

  if (!lifetime) {
    duration =
      Number(duration);

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      throw new Error(
        "Invalid license duration."
      );
    }

    duration =
      Math.floor(duration);
  } else {
    duration = null;
  }

  const client =
    await pool.connect();

  try {
    await client.query("BEGIN");

    const keys = [];

    for (
      let i = 0;
      i < amount;
      i++
    ) {
      let inserted = false;

      for (
        let attempt = 0;
        attempt < 10;
        attempt++
      ) {
        const key =
          "NOVI-" +
          crypto
            .randomBytes(8)
            .toString("hex")
            .toUpperCase();

        const createdAt =
          Date.now();

        const expiresAt =
          lifetime
            ? null
            : createdAt +
              duration;

        const result =
          await client.query(
            `
            INSERT INTO novi_keys
              (
                key,
                duration,
                created_at,
                expires_at
              )
            VALUES
              (
                $1,
                $2::BIGINT,
                $3::BIGINT,
                $4::BIGINT
              )
            ON CONFLICT (key)
            DO NOTHING
            RETURNING
              id,
              key,
              duration,
              created_at,
              expires_at
            `,
            [
              key,

              lifetime
                ? 0
                : duration,

              createdAt,

              expiresAt,
            ]
          );

        if (
          result.rows.length > 0
        ) {
          keys.push(
            result.rows[0]
          );

          inserted = true;

          break;
        }
      }

      if (!inserted) {
        throw new Error(
          "Could not generate a unique license key."
        );
      }
    }

    await client.query("COMMIT");

    return keys;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// HEALTH
// ============================================================

// DO NOT create app.get("/") JSON here.
// The website needs "/" to serve public/index.html.

app.get(
  "/api/health",
  async (req, res) => {
    try {
      await pool.query("SELECT 1");

      res.json({
        success: true,
        status: "online",
        database: "connected",
      });
    } catch (err) {
      console.error(
        "Health check error:",
        err
      );

      res.status(500).json({
        success: false,
        status: "offline",
        database: "error",
      });
    }
  }
);

// ============================================================
// CREATE WEBSITE KEYS
// ============================================================

app.post(
  "/api/keys",
  requireAdmin,
  async (req, res) => {
    try {
      const amount =
        Math.max(
          1,
          Math.min(
            Number(
              req.body?.amount
            ) || 1,
            100
          )
        );

      let duration =
        Number(
          req.body?.duration
        ) ||
        Number(
          req.body?.durationMs
        ) ||
        86400000;

      let lifetime =
        Boolean(
          req.body?.lifetime
        );

      if (
        req.body?.durationType
      ) {
        const parsed =
          parseDuration(
            req.body.durationType
          );

        if (
          parsed.lifetime
        ) {
          lifetime = true;
          duration = null;
        } else if (
          Number.isFinite(
            parsed.duration
          )
        ) {
          duration =
            parsed.duration;

          lifetime = false;
        } else {
          return res.status(400).json({
            success: false,
            error:
              "Invalid duration. Use 1d, 3d, 1w, 1mo, or lifetime.",
          });
        }
      }

      const keys =
        await generateKeys(
          amount,
          duration,
          lifetime
        );

      res.json({
        success: true,

        keys,

        duration:
          lifetime
            ? "lifetime"
            : formatDuration(
                duration,
                false
              ),

        lifetime,
      });
    } catch (err) {
      console.error(
        "Create keys error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to create keys",
        details:
          err.message,
      });
    }
  }
);

// ============================================================
// GET WEBSITE KEYS
// ============================================================

app.get(
  "/api/keys",
  requireAdmin,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
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
        keys:
          result.rows,
      });
    } catch (err) {
      console.error(
        "Get keys error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to get keys",
      });
    }
  }
);

// ============================================================
// VERIFY WEBSITE KEY
// ============================================================

app.post(
  "/api/verify",
  async (req, res) => {
    try {
      const key =
        String(
          req.body?.key ||
            req.body?.licenseKey ||
            req.body?.token ||
            ""
        )
          .trim()
          .toUpperCase();

      if (!key) {
        return res.status(400).json({
          success: false,
          error:
            "Key is required",
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

      if (
        result.rows.length === 0
      ) {
        return res.status(401).json({
          success: false,
          valid: false,
          error:
            "Invalid key",
        });
      }

      const keyRow =
        result.rows[0];

      // NULL expires_at = lifetime.
      const isLifetime =
        keyRow.expires_at === null ||
        keyRow.expires_at === undefined;

      if (!isLifetime) {
        const expiresAt =
          Number(
            keyRow.expires_at
          );

        if (
          !Number.isFinite(
            expiresAt
          )
        ) {
          return res.status(500).json({
            success: false,
            valid: false,
            error:
              "Invalid expiration data",
          });
        }

        if (
          expiresAt <= Date.now()
        ) {
          return res.status(401).json({
            success: false,
            valid: false,
            error:
              "Key expired",
          });
        }
      }

      const durationMs =
        isLifetime
          ? 0
          : Number(
              keyRow.duration
            );

      const durationLabel =
        isLifetime
          ? "lifetime"
          : formatDuration(
              durationMs,
              false
            );

      const token =
        createSession(
          keyRow.id,
          durationMs,
          isLifetime
        );

      res.json({
        success: true,
        valid: true,

        token,

        sessionToken:
          token,

        lifetime:
          isLifetime,

        // Friendly value for your current HTML.
        duration:
          durationLabel,

        // Numeric version if needed by another client.
        durationMs,

        expiresAt:
          isLifetime
            ? null
            : Number(
                keyRow.expires_at
              ),

        key: {
          id:
            keyRow.id,

          key:
            keyRow.key,

          duration:
            durationLabel,

          durationMs,

          expiresAt:
            isLifetime
              ? null
              : Number(
                  keyRow.expires_at
                ),

          keyExpiresAt:
            isLifetime
              ? null
              : Number(
                  keyRow.expires_at
                ),
        },
      });
    } catch (err) {
      console.error(
        "Verify error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Verification failed",
      });
    }
  }
);

// ============================================================
// STOCK ADD
// ============================================================

async function stockAddHandler(
  req,
  res
) {
  try {
    const stockIds =
      extractStockIds(
        req.body
      );

    if (
      stockIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error:
          "No stock supplied",
      });
    }

    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      for (
        const stockId of stockIds
      ) {
        await client.query(
          `
          INSERT INTO novi_stock_items
            (
              stock_id,
              created_at
            )
          VALUES
            (
              $1,
              $2::BIGINT
            )
          `,
          [
            stockId,
            Date.now(),
          ]
        );
      }

      await client.query("COMMIT");

      console.log(
        `[WEBSITE STOCK] Added ${stockIds.length} item(s)`
      );

      return res.json({
        success: true,

        added:
          stockIds.length,

        count:
          stockIds.length,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(
      "Stock add error:",
      err
    );

    return res.status(500).json({
      success: false,
      error:
        "Failed to add stock",
      details:
        err.message,
    });
  }
}

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

// ============================================================
// STOCK COUNT
// ============================================================

app.get(
  "/api/stock/count",
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            COUNT(*)::int AS count
          FROM novi_stock_items
        `);

      res.json({
        success: true,

        count:
          result.rows[0].count,
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
// STOCK VIEW
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
            stock_id AS "stockId",
            created_at AS "createdAt"
          FROM novi_stock_items
          ORDER BY id ASC
        `);

      res.json({
        success: true,

        stock:
          result.rows,

        items:
          result.rows,

        count:
          result.rows.length,
      });
    } catch (err) {
      console.error(
        "Get stock error:",
        err
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
// GENERATE / TAKE STOCK
// ============================================================

app.post(
  "/api/stock/generate",
  requireSession,
  async (req, res) => {
    const client =
      await pool.connect();

    try {
      await client.query("BEGIN");

      const result =
        await client.query(`
          SELECT
            id,
            stock_id AS "stockId",
            created_at AS "createdAt"
          FROM novi_stock_items
          ORDER BY id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);

      if (
        result.rows.length === 0
      ) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          error:
            "No stock available",
        });
      }

      const item =
        result.rows[0];

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

        item,

        stock:
          item.stockId,

        stockId:
          item.stockId,

        value:
          item.stockId,
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "Generate stock error:",
        err
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
// SAVED LOGINS
//
// Compatible with your current public/index.html:
//
// GET    /api/saved-logins
// POST   /api/saved-logins
// GET    /api/saved-logins/:id
// DELETE /api/saved-logins/:id
// ============================================================

function getDeviceId(req) {
  return (
    req.headers["x-novi-device"] ||
    req.headers["x-device-id"] ||
    req.body?.deviceId ||
    req.query?.deviceId ||
    null
  );
}

// ============================================================
// GET SAVED LOGINS
// ============================================================

app.get(
  "/api/saved-logins",
  requireSession,
  async (req, res) => {
    try {
      const deviceId =
        getDeviceId(req);

      const result =
        await pool.query(
          `
          SELECT
            id,
            stock_id AS "stockId",
            device_id AS "deviceId",
            created_at AS "createdAt"
          FROM novi_saved_items
          WHERE device_id = $1
          ORDER BY id DESC
          `,
          [deviceId]
        );

      const items =
        result.rows.map(
          (row) => {
            const raw =
              String(
                row.stockId || ""
              );

            let email =
              raw;

            let password =
              "";

            const separator =
              raw.indexOf(":");

            if (
              separator !== -1
            ) {
              email =
                raw
                  .slice(
                    0,
                    separator
                  )
                  .trim();

              password =
                raw
                  .slice(
                    separator + 1
                  )
                  .trim();
            }

            return {
              id:
                row.id,

              stockId:
                row.stockId,

              deviceId:
                row.deviceId,

              createdAt:
                row.createdAt,

              email,

              password,
            };
          }
        );

      res.json({
        success: true,
        items,
      });
    } catch (err) {
      console.error(
        "Get saved logins error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to get saved logins",
      });
    }
  }
);

// ============================================================
// SAVE LOGIN
// ============================================================

app.post(
  "/api/saved-logins",
  requireSession,
  async (req, res) => {
    try {
      const email =
        String(
          req.body?.email || ""
        ).trim();

      const password =
        String(
          req.body?.password || ""
        );

      const deviceId =
        getDeviceId(req);

      if (!email) {
        return res.status(400).json({
          success: false,
          error:
            "Email is required",
        });
      }

      const stockId =
        password
          ? `${email}:${password}`
          : email;

      const result =
        await pool.query(
          `
          INSERT INTO novi_saved_items
            (
              stock_id,
              device_id,
              created_at
            )
          VALUES
            (
              $1,
              $2,
              $3::BIGINT
            )
          RETURNING
            id,
            stock_id AS "stockId",
            device_id AS "deviceId",
            created_at AS "createdAt"
          `,
          [
            stockId,
            deviceId,
            Date.now(),
          ]
        );

      const row =
        result.rows[0];

      res.json({
        success: true,

        item: {
          ...row,
          email,
          password,
        },
      });
    } catch (err) {
      console.error(
        "Save login error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to save login",
      });
    }
  }
);

// ============================================================
// REVEAL SAVED LOGIN
// ============================================================

app.get(
  "/api/saved-logins/:id",
  requireSession,
  async (req, res) => {
    try {
      const deviceId =
        getDeviceId(req);

      const result =
        await pool.query(
          `
          SELECT
            id,
            stock_id AS "stockId",
            device_id AS "deviceId",
            created_at AS "createdAt"
          FROM novi_saved_items
          WHERE id = $1
            AND device_id = $2
          LIMIT 1
          `,
          [
            req.params.id,
            deviceId,
          ]
        );

      if (
        result.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "Saved login not found",
        });
      }

      const row =
        result.rows[0];

      const raw =
        String(
          row.stockId || ""
        );

      let email =
        raw;

      let password =
        "";

      const separator =
        raw.indexOf(":");

      if (
        separator !== -1
      ) {
        email =
          raw
            .slice(
              0,
              separator
            )
            .trim();

        password =
          raw
            .slice(
              separator + 1
            )
            .trim();
      }

      res.json({
        success: true,

        item: {
          id:
            row.id,

          stockId:
            row.stockId,

          deviceId:
            row.deviceId,

          createdAt:
            row.createdAt,

          email,

          password,
        },
      });
    } catch (err) {
      console.error(
        "Reveal saved login error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to get saved login",
      });
    }
  }
);

// ============================================================
// DELETE SAVED LOGIN
// ============================================================

app.delete(
  "/api/saved-logins/:id",
  requireSession,
  async (req, res) => {
    try {
      const deviceId =
        getDeviceId(req);

      const result =
        await pool.query(
          `
          DELETE FROM novi_saved_items
          WHERE id = $1
            AND device_id = $2
          RETURNING id
          `,
          [
            req.params.id,
            deviceId,
          ]
        );

      res.json({
        success: true,

        deleted:
          result.rowCount > 0,
      });
    } catch (err) {
      console.error(
        "Delete saved login error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to delete saved login",
      });
    }
  }
);

// ============================================================
// OLD SAVED-ITEMS ROUTES
//
// Kept for compatibility.
// ============================================================

app.get(
  "/api/saved-items",
  requireSession,
  async (req, res) => {
    try {
      const deviceId =
        getDeviceId(req);

      const result =
        await pool.query(
          `
          SELECT
            id,
            stock_id AS "stockId",
            device_id AS "deviceId",
            created_at AS "createdAt"
          FROM novi_saved_items
          WHERE device_id = $1
          ORDER BY id DESC
          `,
          [deviceId]
        );

      res.json({
        success: true,
        items:
          result.rows,
      });
    } catch (err) {
      console.error(
        "Saved items error:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to get saved items",
      });
    }
  }
);

app.post(
  "/api/saved-items",
  requireSession,
  async (req, res) => {
    try {
      const stockId =
        cleanStockValue(
          req.body?.stockId ??
          req.body?.stock_id ??
          req.body?.value ??
          req.body?.item
        );

      const deviceId =
        getDeviceId(req);

      if (!stockId) {
        return res.status(400).json({
          success: false,
          error:
            "stockId is required",
        });
      }

      const result =
        await pool.query(
          `
          INSERT INTO novi_saved_items
            (
              stock_id,
              device_id,
              created_at
            )
          VALUES
            (
              $1,
              $2,
              $3::BIGINT
            )
          RETURNING
            id,
            stock_id AS "stockId",
            device_id AS "deviceId",
            created_at AS "createdAt"
          `,
          [
            stockId,
            deviceId,
            Date.now(),
          ]
        );

      res.json({
        success: true,
        item:
          result.rows[0],
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

app.delete(
  "/api/saved-items/:id",
  requireSession,
  async (req, res) => {
    try {
      const deviceId =
        getDeviceId(req);

      const result =
        await pool.query(
          `
          DELETE FROM novi_saved_items
          WHERE id = $1
            AND device_id = $2
          RETURNING id
          `,
          [
            req.params.id,
            deviceId,
          ]
        );

      res.json({
        success: true,

        deleted:
          result.rowCount > 0,
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
    const token =
      req.headers[
        "x-novi-session"
      ] ||
      req.headers[
        "authorization"
      ]?.replace(
        /^Bearer\s+/i,
        ""
      );

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

// IMPORTANT:
// This must come AFTER the API routes.

app.use(
  express.static(
    PUBLIC_DIR
  )
);

// Serve index.html for the website root
// and frontend routes.

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
// DISCORD BOT
// ============================================================

let discordClient = null;

async function startDiscordBot() {
  if (!DISCORD_TOKEN) {
    console.log(
      "Discord bot disabled: DISCORD_TOKEN is missing."
    );

    return;
  }

  discordClient =
    new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

  // ==========================================================
  // READY
  // ==========================================================

  discordClient.once(
    "ready",
    async (client) => {
      console.log(
        `Discord bot online as ${client.user.tag}`
      );

      if (!DISCORD_CLIENT_ID) {
        console.log(
          "DISCORD_CLIENT_ID missing. Slash commands skipped."
        );

        return;
      }

      try {
        const rest =
          new REST({
            version: "10",
          }).setToken(
            DISCORD_TOKEN
          );

        const commands = [
          new SlashCommandBuilder()
            .setName("ping")
            .setDescription(
              "Check if Novi is online"
            ),

          new SlashCommandBuilder()
            .setName("stock")
            .setDescription(
              "Check the current Novi website stock count"
            ),
        ].map(
          (command) =>
            command.toJSON()
        );

        await rest.put(
          Routes.applicationCommands(
            DISCORD_CLIENT_ID
          ),
          {
            body: commands,
          }
        );

        console.log(
          "Discord slash commands registered."
        );
      } catch (err) {
        console.error(
          "Discord slash command registration error:",
          err
        );
      }
    }
  );

  // ==========================================================
  // SLASH COMMANDS
  // ==========================================================

  discordClient.on(
    "interactionCreate",
    async (interaction) => {
      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      try {
        if (
          interaction.commandName ===
          "ping"
        ) {
          return interaction.reply({
            content:
              "🏓 Novi is online!",
            ephemeral: true,
          });
        }

        if (
          interaction.commandName ===
          "stock"
        ) {
          const result =
            await pool.query(`
              SELECT
                COUNT(*)::int AS count
              FROM novi_stock_items
            `);

          return interaction.reply({
            content:
              `📦 Current Novi website stock: **${result.rows[0].count}**`,
          });
        }
      } catch (err) {
        console.error(
          "Discord slash command error:",
          err
        );

        try {
          if (
            interaction.replied ||
            interaction.deferred
          ) {
            await interaction.followUp({
              content:
                "❌ Something went wrong.",
              ephemeral: true,
            });
          } else {
            await interaction.reply({
              content:
                "❌ Something went wrong.",
              ephemeral: true,
            });
          }
        } catch {}
      }
    }
  );

  // ==========================================================
  // PREFIX COMMANDS
  // ==========================================================

  discordClient.on(
    "messageCreate",
    async (message) => {
      try {
        if (
          message.author.bot
        ) {
          return;
        }

        const content =
          message.content.trim();

        if (
          !content.startsWith("!")
        ) {
          return;
        }

        console.log(
          `[DISCORD] ${message.author.tag}: ${content}`
        );

        const parts =
          content
            .slice(1)
            .trim()
            .split(/\s+/)
            .filter(Boolean);

        const command =
          (
            parts.shift() || ""
          ).toLowerCase();

        // ======================================================
        // !GEN
        // ======================================================

        if (
          command === "gen"
        ) {
          const isAdmin =
            message.member?.permissions?.has(
              "Administrator"
            );

          if (!isAdmin) {
            return message.reply(
              "❌ You need Administrator permission to use `!gen`."
            );
          }

          let amount = 1;

          let duration =
            null;

          let lifetime =
            false;

          // ==================================================
          // !gen 1d
          // !gen 3d
          // !gen 1w
          // !gen 1mo
          // !gen lifetime
          //
          // !gen 5 1d
          // !gen 5 3d
          // !gen 5 1w
          // !gen 5 1mo
          // !gen 5 lifetime
          // ==================================================

          if (!parts[0]) {
            return message.reply(
              [
                "❌ Missing duration.",
                "",
                "Use:",
                "`!gen 1d`",
                "`!gen 3d`",
                "`!gen 1w`",
                "`!gen 1mo`",
                "`!gen lifetime`",
                "",
                "Multiple:",
                "`!gen 5 1d`",
                "`!gen 5 3d`",
                "`!gen 5 1w`",
                "`!gen 5 1mo`",
                "`!gen 5 lifetime`",
              ].join("\n")
            );
          }

          const first =
            parts[0].toLowerCase();

          if (
            /^\d+$/.test(first)
          ) {
            amount =
              Number(first);

            if (!parts[1]) {
              return message.reply(
                "❌ Missing duration. Example: `!gen 5 1d`"
              );
            }

            const parsed =
              parseDuration(
                parts[1]
              );

            duration =
              parsed.duration;

            lifetime =
              parsed.lifetime;
          } else {
            const parsed =
              parseDuration(
                first
              );

            duration =
              parsed.duration;

            lifetime =
              parsed.lifetime;
          }

          if (
            !Number.isFinite(
              amount
            )
          ) {
            return message.reply(
              "❌ Invalid amount."
            );
          }

          amount =
            Math.floor(
              amount
            );

          if (
            amount < 1 ||
            amount > 100
          ) {
            return message.reply(
              "❌ You can generate between 1 and 100 keys at a time."
            );
          }

          if (
            !lifetime &&
            (
              !Number.isFinite(
                duration
              ) ||
              duration <= 0
            )
          ) {
            return message.reply(
              [
                "❌ Invalid duration.",
                "",
                "Allowed durations:",
                "`1d` = 1 day",
                "`3d` = 3 days",
                "`1w` = 1 week",
                "`1mo` = 1 month",
                "`lifetime` = never expires",
              ].join("\n")
            );
          }

          console.log(
            `[DISCORD] Generating ${amount} website key(s) for ${formatDuration(
              duration,
              lifetime
            )}...`
          );

          const keys =
            await generateKeys(
              amount,
              duration,
              lifetime
            );

          if (
            !keys ||
            keys.length === 0
          ) {
            return message.reply(
              "❌ No keys were generated."
            );
          }

          const keyText =
            keys
              .map(
                (row) =>
                  `\`${row.key}\``
              )
              .join("\n");

          console.log(
            `[DISCORD] Successfully generated ${keys.length} website key(s).`
          );

          return message.reply({
            content:
              `🔑 **Novi Website License Keys**\n\n` +
              `${keyText}\n\n` +
              `⏱️ Duration: **${formatDuration(
                duration,
                lifetime
              )}**\n` +
              `📦 Generated: **${keys.length}**`,
          });
        }

        // ======================================================
        // !ADD
        // ======================================================

        if (
          command === "add"
        ) {
          const isAdmin =
            message.member?.permissions?.has(
              "Administrator"
            );

          if (!isAdmin) {
            return message.reply(
              "❌ You need Administrator permission to use `!add`."
            );
          }

          if (
            parts.length === 0
          ) {
            return message.reply(
              "❌ Usage: `!add <stock1> <stock2> <stock3>`"
            );
          }

          const stockIds = [
            ...new Set(
              parts
                .map(
                  (item) =>
                    item.trim()
                )
                .filter(Boolean)
            ),
          ];

          const client =
            await pool.connect();

          try {
            await client.query(
              "BEGIN"
            );

            for (
              const stockId of stockIds
            ) {
              await client.query(
                `
                INSERT INTO novi_stock_items
                  (
                    stock_id,
                    created_at
                  )
                VALUES
                  (
                    $1,
                    $2::BIGINT
                  )
                `,
                [
                  stockId,
                  Date.now(),
                ]
              );
            }

            await client.query(
              "COMMIT"
            );

            console.log(
              `[DISCORD] Added ${stockIds.length} item(s) directly to website stock.`
            );

            return message.reply(
              `✅ Added **${stockIds.length}** stock item${
                stockIds.length === 1
                  ? ""
                  : "s"
              } to the **Novi website stock**.`
            );
          } catch (err) {
            await client.query(
              "ROLLBACK"
            );

            throw err;
          } finally {
            client.release();
          }
        }

        // ======================================================
        // !STOCK
        // ======================================================

        if (
          command === "stock"
        ) {
          const result =
            await pool.query(`
              SELECT
                COUNT(*)::int AS count
              FROM novi_stock_items
            `);

          return message.reply(
            `📦 Current Novi website stock: **${result.rows[0].count}**`
          );
        }

        // ======================================================
        // !HELP
        // ======================================================

        if (
          command === "help"
        ) {
          return message.reply(
            [
              "**Novi Commands**",
              "",
              "**License Keys**",
              "`!gen 1d` → 1-day key",
              "`!gen 3d` → 3-day key",
              "`!gen 1w` → 1-week key",
              "`!gen 1mo` → 1-month key",
              "`!gen lifetime` → Lifetime key",
              "",
              "`!gen 5 1d` → 5 one-day keys",
              "`!gen 5 3d` → 5 three-day keys",
              "`!gen 5 1w` → 5 one-week keys",
              "`!gen 5 1mo` → 5 one-month keys",
              "`!gen 5 lifetime` → 5 lifetime keys",
              "",
              "**Website Stock**",
              "`!add <stock>` → Add stock directly to website",
              "`!stock` → Check website stock",
              "",
              "**Other**",
              "`/ping` → Check bot status",
              "`/stock` → Check website stock",
            ].join("\n")
          );
        }
      } catch (err) {
        console.error(
          "================================"
        );

        console.error(
          "DISCORD COMMAND ERROR"
        );

        console.error(
          "================================"
        );

        console.error(err);

        console.error(
          "================================"
        );

        try {
          await message.reply(
            `❌ Command failed: ${
              err?.message ||
              "Unknown error"
            }`
          );
        } catch (
          replyError
        ) {
          console.error(
            "Could not send Discord error:",
            replyError
          );
        }
      }
    }
  );

  // ==========================================================
  // DISCORD ERRORS
  // ==========================================================

  discordClient.on(
    "error",
    (err) => {
      console.error(
        "Discord client error:"
      );

      console.error(err);
    }
  );

  discordClient.on(
    "warn",
    (info) => {
      console.warn(
        "Discord warning:",
        info
      );
    }
  );

  await discordClient.login(
    DISCORD_TOKEN
  );
}

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
          "==============================="
        );

        console.log(
          "       NOVI SERVER ONLINE"
        );

        console.log(
          "==============================="
        );

        console.log(
          `Port: ${PORT}`
        );

        console.log(
          "Database: connected"
        );

        console.log(
          "Website: ready"
        );

        console.log(
          "Website stock API: ready"
        );

        console.log(
          "Discord: starting..."
        );

        console.log(
          "==============================="
        );
      }
    );

    await startDiscordBot();
  } catch (err) {
    console.error(
      "FAILED TO START NOVI:"
    );

    console.error(err);

    process.exit(1);
  }
}

// ============================================================
// SHUTDOWN
// ============================================================

async function shutdown(signal) {
  console.log(
    `Received ${signal}. Shutting down Novi...`
  );

  try {
    if (discordClient) {
      discordClient.destroy();
    }

    await pool.end();

    process.exit(0);
  } catch (err) {
    console.error(
      "Shutdown error:",
      err
    );

    process.exit(1);
  }
}

process.on(
  "SIGTERM",
  () =>
    shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () =>
    shutdown("SIGINT")
);

// ============================================================
// RUN
// ============================================================

start();
