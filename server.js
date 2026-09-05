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
const CREDENTIAL_SECRET = process.env.NOVI_CREDENTIAL_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

if (!ADMIN_SECRET) {
  console.error("❌ Missing NOVI_ADMIN_SECRET");
  process.exit(1);
}

if (!CREDENTIAL_SECRET) {
  console.error("❌ Missing NOVI_CREDENTIAL_SECRET");
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
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS novi_saved_logins (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      device_id TEXT NOT NULL
    );
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
  express.text({
    type: "text/plain",
    limit: "10mb",
  })
);

// ============================================================
// ENCRYPTION
// ============================================================

function getEncryptionKey() {
  return crypto
    .createHash("sha256")
    .update(CREDENTIAL_SECRET)
    .digest();
}

function encrypt(text) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  let encrypted = cipher.update(
    String(text),
    "utf8",
    "base64"
  );

  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

function decrypt(data) {
  const key = getEncryptionKey();

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(data.iv, "base64")
  );

  decipher.setAuthTag(
    Buffer.from(data.authTag, "base64")
  );

  let decrypted = decipher.update(
    data.encrypted,
    "base64",
    "utf8"
  );

  decrypted += decipher.final("utf8");

  return decrypted;
}

function encryptPassword(password) {
  return JSON.stringify(encrypt(password));
}

function decryptPassword(password) {
  try {
    return decrypt(JSON.parse(password));
  } catch {
    return password;
  }
}

// ============================================================
// SESSIONS
// ============================================================

const sessions = new Map();

// ============================================================
// ADMIN AUTH
// ============================================================

function requireAdmin(req, res, next) {
  const provided =
    req.headers["x-novi-admin-secret"];

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
      const duration = req.body?.duration;

      const amount = Math.min(
        Math.max(
          Number(req.body?.amount) || 1,
          1
        ),
        1000
      );

      const durationMs = getDurationMs(duration);

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
      console.error("Create keys error:", error);

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

          createdAt: Number(row.created_at),

          expiresAt:
            row.expires_at === null
              ? null
              : Number(row.expires_at),

          deviceId: row.device_id,
          used: row.used,
        })),
      });
    } catch (error) {
      console.error("Get keys error:", error);

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
      console.error("Delete key error:", error);

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
      const rawKey = req.body?.key;

      const deviceId = String(
        req.body?.deviceId ||
        req.body?.device_id ||
        ""
      ).trim();

      const key =
        typeof rawKey === "string"
          ? rawKey.trim().toUpperCase()
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

      const result = await pool.query(
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
          error: "Invalid key",
        });
      }

      const row = result.rows[0];
      const now = Date.now();

      if (
        row.expires_at !== null &&
        Number(row.expires_at) <= now
      ) {
        return res.status(401).json({
          success: false,
          message:
            "Invalid or expired key.",
          error: "Key expired",
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

      const token = crypto
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
          keyExpiresAt: expiresAt,
        },

        duration: row.duration,
        expiresAt,
      });
    } catch (error) {
      console.error("Verify error:", error);

      res.status(500).json({
        success: false,
        message: "Verification failed",
        error: "Verification failed",
      });
    }
  }
);

// ============================================================
// STOCK ADD
// ============================================================

app.post(
  "/api/stock/add",
  requireAdmin,
  async (req, res) => {
    const client = await pool.connect();

    try {
      let accounts = [];

      // ======================================================
      // RAW ARRAY
      // ======================================================

      if (Array.isArray(req.body)) {
        accounts = req.body;
      }

      // ======================================================
      // OBJECT CONTAINING ACCOUNTS
      // ======================================================

      else if (
        req.body &&
        typeof req.body === "object"
      ) {
        const possibleKeys = [
          "accounts",
          "account",
          "stock",
          "data",
          "items",
          "logins",
          "accountList",
        ];

        for (const key of possibleKeys) {
          if (
            Array.isArray(req.body[key])
          ) {
            accounts = req.body[key];
            break;
          }
        }

        // Single account object
        if (
          accounts.length === 0 &&
          req.body.account &&
          typeof req.body.account ===
            "object"
        ) {
          accounts = [
            req.body.account,
          ];
        }

        // username/password
        if (
          accounts.length === 0 &&
          req.body.username &&
          req.body.password
        ) {
          accounts = [
            {
              username:
                req.body.username,
              password:
                req.body.password,
            },
          ];
        }

        // email/password
        if (
          accounts.length === 0 &&
          req.body.email &&
          req.body.password
        ) {
          accounts = [
            {
              email:
                req.body.email,
              password:
                req.body.password,
            },
          ];
        }

        // ====================================================
        // LAST RESORT:
        // Find the first array anywhere in the object.
        // ====================================================

        if (accounts.length === 0) {
          for (const value of Object.values(
            req.body
          )) {
            if (Array.isArray(value)) {
              accounts = value;
              break;
            }
          }
        }
      }

      // ======================================================
      // TEXT BODY
      // ======================================================

      if (
        typeof req.body === "string"
      ) {
        const text =
          req.body.trim();

        if (text) {
          try {
            const parsed =
              JSON.parse(text);

            if (Array.isArray(parsed)) {
              accounts = parsed;
            } else if (
              parsed &&
              typeof parsed === "object"
            ) {
              for (const key of [
                "accounts",
                "stock",
                "data",
                "items",
                "logins",
              ]) {
                if (
                  Array.isArray(
                    parsed[key]
                  )
                ) {
                  accounts =
                    parsed[key];
                  break;
                }
              }
            }
          } catch {
            accounts = text
              .split(/\r?\n/)
              .map((line) =>
                line.trim()
              )
              .filter(Boolean);
          }
        }
      }

      if (!accounts.length) {
        return res.status(400).json({
          success: false,
          error: "No accounts supplied",
        });
      }

      await client.query("BEGIN");

      let added = 0;

      for (const account of accounts) {
        if (!account) continue;

        let username = "";
        let password = "";

        // ====================================================
        // STRING:
        // username:password
        // ====================================================

        if (
          typeof account === "string"
        ) {
          const value =
            account.trim();

          if (!value) continue;

          // Split only on the FIRST colon.
          // This allows colons later in the value.
          const separator =
            value.indexOf(":");

          if (separator === -1) {
            continue;
          }

          username = value
            .slice(0, separator)
            .trim();

          password = value
            .slice(separator + 1)
            .trim();
        }

        // ====================================================
        // OBJECT
        // ====================================================

        else if (
          typeof account === "object"
        ) {
          username = String(
            account.username ||
            account.email ||
            account.emailAddress ||
            account.user ||
            account.login ||
            ""
          ).trim();

          password = String(
            account.password ||
            account.pass ||
            ""
          ).trim();
        }

        if (
          !username ||
          !password
        ) {
          continue;
        }

        await client.query(
          `
          INSERT INTO novi_stock
          (
            username,
            password,
            created_at
          )
          VALUES
          ($1, $2, $3)
          `,
          [
            username,
            encryptPassword(password),
            Date.now(),
          ]
        );

        added++;
      }

      if (added === 0) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          success: false,
          error:
            "No valid accounts found in request",
        });
      }

      await client.query("COMMIT");

      console.log(
        `✅ Added ${added} stock item(s)`
      );

      res.json({
        success: true,
        added,
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "❌ Add stock error:",
        error
      );

      res.status(500).json({
        success: false,
        error: "Failed to add stock",
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
      const result = await pool.query(`
        SELECT
          id,
          username,
          password,
          created_at
        FROM novi_stock
        ORDER BY id ASC
      `);

      const stock = result.rows.map(
        (row) => ({
          id: row.id,

          username: row.username,
          email: row.username,

          password:
            decryptPassword(
              row.password
            ),

          createdAt:
            Number(row.created_at),
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
        error: "Failed to get stock",
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
      const result = await pool.query(`
        SELECT
          id,
          username,
          password,
          created_at
        FROM novi_stock
        ORDER BY id ASC
      `);

      const stock = result.rows.map(
        (row) => ({
          id: row.id,

          username: row.username,
          email: row.username,

          password:
            decryptPassword(
              row.password
            ),

          createdAt:
            Number(row.created_at),
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
        error: "Failed to get stock",
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
      const result = await pool.query(`
        SELECT COUNT(*)::int AS count
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
    const client = await pool.connect();

    try {
      const amount = Math.min(
        Math.max(
          Number(
            req.body?.amount
          ) || 1,
          1
        ),
        100
      );

      await client.query("BEGIN");

      const result =
        await client.query(
          `
          SELECT
            id,
            username,
            password,
            created_at
          FROM novi_stock
          ORDER BY id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
          `,
          [amount]
        );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          success: false,
          error: "No stock available",
        });
      }

      const accounts =
        result.rows.map(
          (row) => ({
            id: row.id,

            username:
              row.username,

            email:
              row.username,

            password:
              decryptPassword(
                row.password
              ),

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

      await client.query("COMMIT");

      res.json({
        success: true,

        account:
          accounts[0],

        accounts,

        count:
          accounts.length,
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
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
// SAVED LOGINS
// ============================================================

app.post(
  "/api/saved-logins",
  requireSession,
  async (req, res) => {
    try {
      const username = String(
        req.body?.username ||
        req.body?.email ||
        ""
      ).trim();

      const password = String(
        req.body?.password || ""
      );

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error:
            "Username and password are required",
        });
      }

      const result =
        await pool.query(
          `
          INSERT INTO novi_saved_logins
          (
            username,
            password,
            created_at,
            device_id
          )
          VALUES
          ($1, $2, $3, $4)
          RETURNING
            id,
            username,
            created_at
          `,
          [
            username,
            encryptPassword(password),
            Date.now(),
            req.session.deviceId,
          ]
        );

      const row =
        result.rows[0];

      res.json({
        success: true,

        login: {
          id: row.id,
          username: row.username,
          email: row.username,
          createdAt:
            Number(row.created_at),
        },
      });
    } catch (error) {
      console.error(
        "Save login error:",
        error
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
// GET SAVED LOGINS
// ============================================================

app.get(
  "/api/saved-logins",
  requireSession,
  async (req, res) => {
    try {
      const result =
        await pool.query(
          `
          SELECT
            id,
            username,
            password,
            created_at
          FROM novi_saved_logins
          WHERE device_id = $1
          ORDER BY id DESC
          `,
          [
            req.session.deviceId,
          ]
        );

      const logins =
        result.rows.map(
          (row) => ({
            id: row.id,

            username:
              row.username,

            email:
              row.username,

            password:
              decryptPassword(
                row.password
              ),

            createdAt:
              Number(
                row.created_at
              ),
          })
        );

      res.json({
        success: true,
        logins,
      });
    } catch (error) {
      console.error(
        "Get saved logins error:",
        error
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
// GET SAVED LOGIN
// ============================================================

app.get(
  "/api/saved-logins/:id",
  requireSession,
  async (req, res) => {
    try {
      const id =
        Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          error: "Invalid ID",
        });
      }

      const result =
        await pool.query(
          `
          SELECT
            id,
            username,
            password,
            created_at
          FROM novi_saved_logins
          WHERE id = $1
            AND device_id = $2
          LIMIT 1
          `,
          [
            id,
            req.session.deviceId,
          ]
        );

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          error:
            "Saved login not found",
        });
      }

      const row =
        result.rows[0];

      res.json({
        success: true,

        login: {
          id: row.id,
          username: row.username,
          email: row.username,

          password:
            decryptPassword(
              row.password
            ),

          createdAt:
            Number(row.created_at),
        },
      });
    } catch (error) {
      console.error(
        "Get saved login error:",
        error
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
      const id =
        Number(req.params.id);

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          error: "Invalid ID",
        });
      }

      const result =
        await pool.query(
          `
          DELETE FROM novi_saved_logins
          WHERE id = $1
            AND device_id = $2
          `,
          [
            id,
            req.session.deviceId,
          ]
        );

      if (result.rowCount === 0) {
        return res.status(404).json({
          success: false,
          error:
            "Saved login not found",
        });
      }

      res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "Delete saved login error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Failed to delete login",
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
