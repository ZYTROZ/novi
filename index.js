require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
} = require("discord.js");

// ============================================================
// CONFIG
// ============================================================

const app = express();

const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, "public");

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_SECRET = process.env.NOVI_ADMIN_SECRET;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL is missing.");
  process.exit(1);
}

if (!ADMIN_SECRET) {
  console.error("❌ NOVI_ADMIN_SECRET is missing.");
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

// ============================================================
// EXPRESS
// ============================================================

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ============================================================
// HELPERS
// ============================================================

function generateKey() {
  const random = crypto.randomBytes(12).toString("hex").toUpperCase();

  return `NOVI-${random.slice(0, 4)}-${random.slice(
    4,
    8
  )}-${random.slice(8, 12)}-${random.slice(12, 16)}-${random.slice(16, 24)}`;
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function normalizeDuration(input) {
  if (!input) return null;

  const value = String(input).toLowerCase().trim();

  if (value === "1d") {
    return {
      name: "1d",
      ms: 24 * 60 * 60 * 1000,
    };
  }

  if (value === "3d") {
    return {
      name: "3d",
      ms: 3 * 24 * 60 * 60 * 1000,
    };
  }

  if (value === "1w" || value === "1week") {
    return {
      name: "1w",
      ms: 7 * 24 * 60 * 60 * 1000,
    };
  }

  if (value === "1mo" || value === "1month") {
    return {
      name: "1mo",
      ms: 30 * 24 * 60 * 60 * 1000,
    };
  }

  if (value === "lifetime") {
    return {
      name: "lifetime",
      ms: null,
    };
  }

  return null;
}

function isAdmin(req) {
  const provided =
    req.headers["x-admin-secret"] ||
    req.body?.adminSecret ||
    req.query?.adminSecret;

  return provided && provided === ADMIN_SECRET;
}

function durationDisplay(duration) {
  switch (duration) {
    case "1d":
      return "1d";

    case "3d":
      return "3d";

    case "1w":
      return "1w";

    case "1mo":
      return "1mo";

    case "lifetime":
      return "lifetime";

    default:
      return duration;
  }
}

function isExpired(expiresAt) {
  if (expiresAt === null || expiresAt === undefined) {
    return false;
  }

  const timestamp =
    typeof expiresAt === "number"
      ? expiresAt
      : new Date(expiresAt).getTime();

  return Date.now() >= timestamp;
}

function normalizeLogin(item) {
  if (item === null || item === undefined) {
    return {
      email: "",
      password: "",
    };
  }

  if (typeof item === "object") {
    return {
      email: String(item.email || ""),
      password: String(item.password || ""),
    };
  }

  const value = String(item);

  const separator = value.indexOf(":");

  if (separator !== -1) {
    return {
      email: value.slice(0, separator),
      password: value.slice(separator + 1),
    };
  }

  return {
    email: value,
    password: "",
  };
}

// ============================================================
// DATABASE SCHEMA TYPE DETECTION
// ============================================================
//
// Your existing database may have created_at as either:
// BIGINT
// or
// TIMESTAMP WITH TIME ZONE
//
// We detect it so the old database doesn't break.
//

let stockCreatedAtType = "timestamp";
let savedCreatedAtType = "timestamp";

async function detectDatabaseTypes() {
  try {
    const result = await pool.query(`
      SELECT
        table_name,
        column_name,
        data_type
      FROM information_schema.columns
      WHERE table_name IN (
        'novi_stock_items',
        'novi_saved_items'
      )
      AND column_name = 'created_at'
    `);

    for (const row of result.rows) {
      if (row.table_name === "novi_stock_items") {
        stockCreatedAtType = row.data_type.includes("timestamp")
          ? "timestamp"
          : "bigint";
      }

      if (row.table_name === "novi_saved_items") {
        savedCreatedAtType = row.data_type.includes("timestamp")
          ? "timestamp"
          : "bigint";
      }
    }

    console.log("📊 Database timestamp types:");
    console.log("   stock:", stockCreatedAtType);
    console.log("   saved:", savedCreatedAtType);
  } catch (error) {
    console.error("❌ Could not detect database types:", error.message);
  }
}

// ============================================================
// DATABASE INIT
// ============================================================

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_keys (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT,
      duration BIGINT,
      used BOOLEAN DEFAULT FALSE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_stock_items (
      id SERIAL PRIMARY KEY,
      stock_id TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_saved_items (
      id SERIAL PRIMARY KEY,
      email TEXT,
      password TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS novi_keys_key_idx
    ON novi_keys(key)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS novi_stock_items_stock_id_idx
    ON novi_stock_items(stock_id)
  `);

  await detectDatabaseTypes();

  console.log("✅ Database ready.");
}

// ============================================================
// API HEALTH
// ============================================================

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      database: true,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      database: false,
      error: error.message,
    });
  }
});

// ============================================================
// VERIFY LICENSE KEY
// ============================================================

app.post("/api/verify", async (req, res) => {
  try {
    const suppliedKey = String(req.body?.key || "").trim();

    if (!suppliedKey) {
      return res.status(400).json({
        success: false,
        error: "Key is required.",
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        key,
        created_at,
        expires_at,
        duration,
        used
      FROM novi_keys
      WHERE key = $1
      LIMIT 1
      `,
      [suppliedKey]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Invalid key.",
      });
    }

    const keyRow = result.rows[0];

    if (keyRow.used) {
      return res.status(403).json({
        success: false,
        error: "This key has already been used.",
      });
    }

    const expiresAt =
      keyRow.expires_at === null
        ? null
        : Number(keyRow.expires_at);

    if (expiresAt !== null && Date.now() >= expiresAt) {
      return res.status(403).json({
        success: false,
        error: "This key has expired.",
      });
    }

    const sessionToken = generateSessionToken();

    // Mark key as used.
    await pool.query(
      `
      UPDATE novi_keys
      SET used = TRUE
      WHERE id = $1
      `,
      [keyRow.id]
    );

    const durationName =
      keyRow.duration === null
        ? "lifetime"
        : keyRow.duration === 86400000
        ? "1d"
        : keyRow.duration === 259200000
        ? "3d"
        : keyRow.duration === 604800000
        ? "1w"
        : keyRow.duration === 2592000000
        ? "1mo"
        : String(keyRow.duration);

    return res.json({
      success: true,

      sessionToken,

      duration: durationDisplay(durationName),

      durationMs:
        keyRow.duration === null
          ? null
          : Number(keyRow.duration),

      expiresAt,

      key: {
        key: keyRow.key,
        duration: durationDisplay(durationName),

        durationMs:
          keyRow.duration === null
            ? null
            : Number(keyRow.duration),

        expiresAt,
        keyExpiresAt: expiresAt,
      },
    });
  } catch (error) {
    console.error("❌ /api/verify:", error);

    res.status(500).json({
      success: false,
      error: "Server error.",
    });
  }
});

// ============================================================
// STOCK COUNT
// ============================================================

app.get("/api/stock", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*)::INTEGER AS count
      FROM novi_stock_items
    `);

    res.json({
      success: true,
      count: Number(result.rows[0].count),
    });
  } catch (error) {
    console.error("❌ /api/stock:", error);

    res.status(500).json({
      success: false,
      error: "Could not load stock.",
    });
  }
});

// ============================================================
// ADD STOCK - WEBSITE
// ============================================================

app.post("/api/stock/generate", async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized.",
      });
    }

    const amount = Math.max(
      1,
      Math.min(1000, Number(req.body?.amount) || 1)
    );

    const stockItems = Array.isArray(req.body?.items)
      ? req.body.items
      : [];

    if (stockItems.length > 0) {
      let added = 0;

      for (const rawItem of stockItems) {
        const item = String(rawItem).trim();

        if (!item) continue;

        if (stockCreatedAtType === "timestamp") {
          await pool.query(
            `
            INSERT INTO novi_stock_items
              (stock_id, created_at)
            VALUES
              ($1, NOW())
            `,
            [item]
          );
        } else {
          await pool.query(
            `
            INSERT INTO novi_stock_items
              (stock_id, created_at)
            VALUES
              ($1, $2)
            `,
            [item, Date.now()]
          );
        }

        added++;
      }

      return res.json({
        success: true,
        added,
      });
    }

    return res.status(400).json({
      success: false,
      error: "No stock items supplied.",
    });
  } catch (error) {
    console.error("❌ /api/stock/generate:", error);

    res.status(500).json({
      success: false,
      error: "Could not add stock.",
    });
  }
});

// ============================================================
// SAVED LOGINS
// ============================================================

app.get("/api/saved-logins", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        email,
        password,
        created_at
      FROM novi_saved_items
      ORDER BY id DESC
    `);

    res.json({
      success: true,
      items: result.rows,
    });
  } catch (error) {
    console.error("❌ GET /api/saved-logins:", error);

    res.status(500).json({
      success: false,
      error: "Could not load saved logins.",
    });
  }
});

// ============================================================
// SAVE LOGIN
// ============================================================

app.post("/api/saved-logins", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required.",
      });
    }

    let result;

    if (savedCreatedAtType === "timestamp") {
      result = await pool.query(
        `
        INSERT INTO novi_saved_items
          (email, password, created_at)
        VALUES
          ($1, $2, NOW())
        RETURNING
          id,
          email,
          password,
          created_at
        `,
        [email, password]
      );
    } else {
      result = await pool.query(
        `
        INSERT INTO novi_saved_items
          (email, password, created_at)
        VALUES
          ($1, $2, $3)
        RETURNING
          id,
          email,
          password,
          created_at
        `,
        [email, password, Date.now()]
      );
    }

    res.json({
      success: true,
      item: result.rows[0],
    });
  } catch (error) {
    console.error("❌ POST /api/saved-logins:", error);

    res.status(500).json({
      success: false,
      error: "Could not save login.",
    });
  }
});

// ============================================================
// GET ONE SAVED LOGIN
// ============================================================

app.get("/api/saved-logins/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID.",
      });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        email,
        password,
        created_at
      FROM novi_saved_items
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Saved login not found.",
      });
    }

    res.json({
      success: true,
      item: result.rows[0],
    });
  } catch (error) {
    console.error("❌ GET /api/saved-logins/:id:", error);

    res.status(500).json({
      success: false,
      error: "Could not load saved login.",
    });
  }
});

// ============================================================
// DELETE SAVED LOGIN
// ============================================================

app.delete("/api/saved-logins/:id", async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized.",
      });
    }

    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid ID.",
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

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Saved login not found.",
      });
    }

    res.json({
      success: true,
    });
  } catch (error) {
    console.error("❌ DELETE /api/saved-logins/:id:", error);

    res.status(500).json({
      success: false,
      error: "Could not delete saved login.",
    });
  }
});

// ============================================================
// LOGOUT
// ============================================================

app.post("/api/logout", async (req, res) => {
  res.json({
    success: true,
  });
});

// ============================================================
// DISCORD BOT
// ============================================================

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ============================================================
// DISCORD ADMIN CHECK
// ============================================================

function isDiscordAdmin(message) {
  if (!message.member) return false;

  return message.member.permissions.has(
    PermissionsBitField.Flags.Administrator
  );
}

// ============================================================
// !gen
// ============================================================

async function handleGen(message, args) {
  if (!isDiscordAdmin(message)) {
    return message.reply("❌ You need Administrator permission.");
  }

  let amount = 1;
  let durationInput = args[0];

  if (/^\d+$/.test(args[0] || "")) {
    amount = Number(args[0]);
    durationInput = args[1];
  }

  if (amount < 1 || amount > 100) {
    return message.reply("❌ Amount must be between 1 and 100.");
  }

  const duration = normalizeDuration(durationInput);

  if (!duration) {
    return message.reply(
      "❌ Valid durations: `1d`, `3d`, `1w`, `1mo`, `lifetime`"
    );
  }

  const generated = [];

  for (let i = 0; i < amount; i++) {
    const key = generateKey();

    const createdAt = Date.now();

    const expiresAt =
      duration.ms === null
        ? null
        : createdAt + duration.ms;

    await pool.query(
      `
      INSERT INTO novi_keys
        (
          key,
          created_at,
          expires_at,
          duration,
          used
        )
      VALUES
        (
          $1,
          $2,
          $3,
          $4,
          FALSE
        )
      `,
      [
        key,
        createdAt,
        expiresAt,
        duration.ms,
      ]
    );

    generated.push(key);
  }

  const output = generated
    .map((key) => `\`${key}\``)
    .join("\n");

  return message.reply(
    `✅ Generated **${generated.length}** ${duration.name} key(s):\n${output}`
  );
}

// ============================================================
// !add
// ============================================================

async function handleAdd(message, args) {
  if (!isDiscordAdmin(message)) {
    return message.reply("❌ You need Administrator permission.");
  }

  if (!args.length) {
    return message.reply(
      "❌ Usage: `!add email:password`"
    );
  }

  let added = 0;

  for (const rawItem of args) {
    const stockId = String(rawItem).trim();

    if (!stockId) continue;

    // IMPORTANT:
    // Your existing database has created_at as
    // TIMESTAMP WITH TIME ZONE.
    //
    // So use NOW() instead of Date.now().

    if (stockCreatedAtType === "timestamp") {
      await pool.query(
        `
        INSERT INTO novi_stock_items
          (
            stock_id,
            created_at
          )
        VALUES
          (
            $1,
            NOW()
          )
        `,
        [stockId]
      );
    } else {
      await pool.query(
        `
        INSERT INTO novi_stock_items
          (
            stock_id,
            created_at
          )
        VALUES
          (
            $1,
            $2
          )
        `,
        [
          stockId,
          Date.now(),
        ]
      );
    }

    added++;
  }

  const countResult = await pool.query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM novi_stock_items
  `);

  const count = Number(countResult.rows[0].count);

  return message.reply(
    `✅ Added **${added}** stock item(s).\n📦 Current stock: **${count}**`
  );
}

// ============================================================
// !stock
// ============================================================

async function handleStock(message) {
  if (!isDiscordAdmin(message)) {
    return message.reply("❌ You need Administrator permission.");
  }

  const result = await pool.query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM novi_stock_items
  `);

  const count = Number(result.rows[0].count);

  return message.reply(
    `📦 Novi stock: **${count}**`
  );
}

// ============================================================
// DISCORD MESSAGE HANDLER
// ============================================================

discordClient.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    if (!message.content.startsWith("!")) return;

    const parts = message.content
      .trim()
      .split(/\s+/);

    const command = parts.shift().toLowerCase();
    const args = parts;

    if (command === "!gen") {
      await handleGen(message, args);
      return;
    }

    if (command === "!add") {
      await handleAdd(message, args);
      return;
    }

    if (command === "!stock") {
      await handleStock(message);
      return;
    }

    if (command === "!help") {
      return message.reply(
        [
          "**Novi Commands**",
          "",
          "`!gen 1d` — Generate 1 day key",
          "`!gen 3d` — Generate 3 day key",
          "`!gen 1w` — Generate 1 week key",
          "`!gen 1mo` — Generate 1 month key",
          "`!gen lifetime` — Generate lifetime key",
          "",
          "`!gen 5 1d` — Generate 5 one-day keys",
          "`!gen 5 3d` — Generate 5 three-day keys",
          "`!gen 5 1w` — Generate 5 one-week keys",
          "`!gen 5 1mo` — Generate 5 one-month keys",
          "`!gen 5 lifetime` — Generate 5 lifetime keys",
          "",
          "`!add email:password` — Add stock",
          "`!stock` — Check stock",
        ].join("\n")
      );
    }
  } catch (error) {
    console.error("❌ Discord command error:", error);

    try {
      await message.reply(
        "❌ Something went wrong while running that command."
      );
    } catch {}
  }
});

// ============================================================
// DISCORD READY
// ============================================================

discordClient.once("ready", () => {
  console.log(
    `🤖 Discord bot logged in as ${discordClient.user.tag}`
  );
});

// ============================================================
// START DISCORD
// ============================================================

if (DISCORD_TOKEN) {
  discordClient
    .login(DISCORD_TOKEN)
    .catch((error) => {
      console.error("❌ Discord login failed:", error);
    });
} else {
  console.warn(
    "⚠️ DISCORD_TOKEN is missing. Discord bot will not start."
  );
}

// ============================================================
// WEBSITE
// ============================================================

// Serve the actual Novi website.
app.use(express.static(PUBLIC_DIR));

// Make sure unknown frontend routes still load index.html.
app.get("/{*splat}", (req, res) => {
  res.sendFile(
    path.join(PUBLIC_DIR, "index.html")
  );
});

// ============================================================
// START SERVER
// ============================================================

async function start() {
  try {
    await initializeDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `🌐 Novi website running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "❌ Failed to start Novi:",
      error
    );

    process.exit(1);
  }
}

start();
