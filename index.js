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

const ADMIN_SECRET = process.env.NOVI_ADMIN_SECRET || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
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

function createSession(keyId, durationMs) {
  const token = crypto.randomBytes(32).toString("hex");

  sessions.set(token, {
    keyId,
    expiresAt: Date.now() + durationMs,
  });

  return token;
}

function getSession(req) {
  const token =
    req.headers["x-novi-session"] ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "");

  if (!token) return null;

  const session = sessions.get(token);

  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return {
    token,
    ...session,
  };
}

function requireSession(req, res, next) {
  const session = getSession(req);

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

  if (!supplied || supplied !== ADMIN_SECRET) {
    return res.status(403).json({
      success: false,
      error: "Forbidden",
    });
  }

  next();
}

// ============================================================
// DATABASE
// ============================================================

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_keys (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      duration INTEGER NOT NULL DEFAULT 86400000,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_stock_items (
      id SERIAL PRIMARY KEY,
      stock_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_saved_items (
      id SERIAL PRIMARY KEY,
      stock_id TEXT NOT NULL,
      device_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS novi_stock_items_stock_id_idx
    ON novi_stock_items(stock_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS novi_saved_items_device_id_idx
    ON novi_saved_items(device_id)
  `);

  console.log("Database initialized");
}

// ============================================================
// HELPERS
// ============================================================

function cleanStockValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "object") {
    value =
      value.stockId ??
      value.stock_id ??
      value.id ??
      value.value ??
      value.code ??
      value.name;
  }

  if (value === undefined || value === null) {
    return null;
  }

  const cleaned = String(value).trim();

  if (!cleaned) return null;

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

    const cleaned = cleanStockValue(value);

    if (cleaned) {
      result.push(cleaned);
    }
  }

  if (Array.isArray(body)) {
    add(body);
  } else if (body && typeof body === "object") {
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

    for (const field of possibleFields) {
      if (body[field] !== undefined) {
        add(body[field]);
      }
    }

    if (result.length === 0) {
      for (const value of Object.values(body)) {
        if (
          typeof value === "string" ||
          Array.isArray(value) ||
          (value && typeof value === "object")
        ) {
          add(value);
        }
      }
    }
  } else if (typeof body === "string") {
    add(body);
  }

  return [...new Set(result)];
}

// ============================================================
// KEY GENERATOR
// ============================================================

async function generateKeys(amount = 1, duration = 86400000) {
  amount = Math.max(1, Math.min(Number(amount) || 1, 100));
  duration = Number(duration) || 86400000;

  const keys = [];

  for (let i = 0; i < amount; i++) {
    const key = `NOVI-${crypto
      .randomBytes(8)
      .toString("hex")
      .toUpperCase()}`;

    const expiresAt = new Date(Date.now() + duration);

    await pool.query(
      `
      INSERT INTO novi_keys
      (key, duration, expires_at)
      VALUES ($1, $2, $3)
      `,
      [key, duration, expiresAt]
    );

    keys.push({
      key,
      duration,
      expiresAt,
    });
  }

  return keys;
}

// ============================================================
// HEALTH
// ============================================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Novi",
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
    });
  } catch (err) {
    console.error("Health check error:", err);

    res.status(500).json({
      success: false,
      status: "offline",
      database: "error",
    });
  }
});

// ============================================================
// KEYS
// ============================================================

app.post("/api/keys", requireAdmin, async (req, res) => {
  try {
    const amount = Math.max(
      1,
      Math.min(Number(req.body?.amount) || 1, 100)
    );

    const duration =
      Number(req.body?.duration) ||
      Number(req.body?.durationMs) ||
      86400000;

    const keys = await generateKeys(amount, duration);

    res.json({
      success: true,
      keys,
    });
  } catch (err) {
    console.error("Create keys error:", err);

    res.status(500).json({
      success: false,
      error: "Failed to create keys",
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
    console.error("Get keys error:", err);

    res.status(500).json({
      success: false,
      error: "Failed to get keys",
    });
  }
});

// ============================================================
// VERIFY KEY
// ============================================================

app.post("/api/verify", async (req, res) => {
  try {
    const key = String(
      req.body?.key ||
        req.body?.licenseKey ||
        req.body?.token ||
        ""
    ).trim();

    if (!key) {
      return res.status(400).json({
        success: false,
        error: "Key is required",
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

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        valid: false,
        error: "Invalid key",
      });
    }

    const keyRow = result.rows[0];

    if (
      keyRow.expires_at &&
      new Date(keyRow.expires_at).getTime() <= Date.now()
    ) {
      return res.status(401).json({
        success: false,
        valid: false,
        error: "Key expired",
      });
    }

    const token = createSession(
      keyRow.id,
      Number(keyRow.duration) || 86400000
    );

    res.json({
      success: true,
      valid: true,
      token,
      sessionToken: token,
      duration: keyRow.duration,
      expiresAt: keyRow.expires_at,
    });
  } catch (err) {
    console.error("Verify error:", err);

    res.status(500).json({
      success: false,
      error: "Verification failed",
    });
  }
});

// ============================================================
// STOCK ADD
// ============================================================

async function stockAddHandler(req, res) {
  try {
    const stockIds = extractStockIds(req.body);

    if (stockIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No stock supplied",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let added = 0;

      for (const stockId of stockIds) {
        await client.query(
          `
          INSERT INTO novi_stock_items
          (stock_id)
          VALUES ($1)
          `,
          [stockId]
        );

        added++;
      }

      await client.query("COMMIT");

      console.log(`Added ${added} stock item(s)`);

      return res.json({
        success: true,
        added,
        count: added,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Stock add error:", err);

    return res.status(500).json({
      success: false,
      error: "Failed to add stock",
      details: err.message,
    });
  }
}

app.post("/api/stock/add", requireAdmin, stockAddHandler);
app.post("/api/add-stock", requireAdmin, stockAddHandler);

// ============================================================
// STOCK COUNT
// ============================================================

app.get("/api/stock/count", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM novi_stock_items
    `);

    res.json({
      success: true,
      count: result.rows[0].count,
    });
  } catch (err) {
    console.error("Stock count error:", err);

    res.status(500).json({
      success: false,
      error: "Failed to get stock count",
    });
  }
});

// ============================================================
// STOCK VIEW
// ============================================================

app.get("/api/stock", requireSession, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        stock_id AS "stockId",
        created_at AS "createdAt"
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
    console.error("Get stock error:", err);

    res.status(500).json({
      success: false,
      error: "Failed to get stock",
    });
  }
});

// ============================================================
// STOCK GENERATE / TAKE ONE
// ============================================================

app.post("/api/stock/generate", requireSession, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(`
      SELECT
        id,
        stock_id AS "stockId",
        created_at AS "createdAt"
      FROM novi_stock_items
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        success: false,
        error: "No stock available",
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
      item,
      stock: item.stockId,
      stockId: item.stockId,
      value: item.stockId,
    });
  } catch (err) {
    await client.query("ROLLBACK");

    console.error("Generate stock error:", err);

    res.status(500).json({
      success: false,
      error: "Failed to generate stock",
    });
  } finally {
    client.release();
  }
});

// ============================================================
// SAVED ITEMS
// ============================================================

app.get("/api/saved-items", requireSession, async (req, res) => {
  try {
    const deviceId =
      req.headers["x-novi-device"] ||
      req.headers["x-device-id"] ||
      req.query?.deviceId ||
      null;

    const result = await pool.query(
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
      items: result.rows,
    });
  } catch (err) {
    console.error("Saved items error:", err);

    res.status(500).json({
      success: false,
      error: "Failed to get saved items",
    });
  }
});

app.post("/api/saved-items", requireSession, async (req, res) => {
  try {
    const stockId = cleanStockValue(
      req.body?.stockId ??
        req.body?.stock_id ??
        req.body?.value ??
        req.body?.item
    );

    const deviceId =
      req.headers["x-novi-device"] ||
      req.headers["x-device-id"] ||
      req.body?.deviceId ||
      null;

    if (!stockId) {
      return res.status(400).json({
        success: false,
        error: "stockId is required",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO novi_saved_items
      (stock_id, device_id)
      VALUES ($1, $2)
      RETURNING
        id,
        stock_id AS "stockId",
        device_id AS "deviceId",
        created_at AS "createdAt"
      `,
      [stockId, deviceId]
    );

    res.json({
      success: true,
      item: result.rows[0],
    });
  } catch (err) {
    console.error("Save item error:", err);

    res.status(500).json({
      success: false,
      error: "Failed to save item",
    });
  }
});

app.delete("/api/saved-items/:id", requireSession, async (req, res) => {
  try {
    const deviceId =
      req.headers["x-novi-device"] ||
      req.headers["x-device-id"] ||
      null;

    const result = await pool.query(
      `
      DELETE FROM novi_saved_items
      WHERE id = $1
        AND device_id = $2
      RETURNING id
      `,
      [req.params.id, deviceId]
    );

    res.json({
      success: true,
      deleted: result.rowCount > 0,
    });
  } catch (err) {
    console.error("Delete saved item error:", err);

    res.status(500).json({
      success: false,
      error: "Failed to delete saved item",
    });
  }
});

// ============================================================
// LOGOUT
// ============================================================

app.post("/api/logout", (req, res) => {
  const token =
    req.headers["x-novi-session"] ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "");

  if (token) {
    sessions.delete(token);
  }

  res.json({
    success: true,
  });
});

// ============================================================
// STATIC WEBSITE
// ============================================================

app.use(express.static(PUBLIC_DIR));

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ============================================================
// DISCORD BOT
// ============================================================

let discordClient = null;

async function startDiscordBot() {
  if (!DISCORD_TOKEN) {
    console.log("Discord bot disabled: DISCORD_TOKEN is missing.");
    return;
  }

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // ==========================================================
  // BOT READY
  // ==========================================================

  discordClient.once("ready", async (client) => {
    console.log(`Discord bot online as ${client.user.tag}`);

    if (DISCORD_CLIENT_ID) {
      try {
        const rest = new REST({ version: "10" }).setToken(
          DISCORD_TOKEN
        );

        const commands = [
          new SlashCommandBuilder()
            .setName("ping")
            .setDescription("Check if Novi is online"),

          new SlashCommandBuilder()
            .setName("stock")
            .setDescription("Check the current Novi stock count"),
        ].map((command) => command.toJSON());

        await rest.put(
          Routes.applicationCommands(DISCORD_CLIENT_ID),
          {
            body: commands,
          }
        );

        console.log("Discord slash commands registered.");
      } catch (err) {
        console.error(
          "Failed to register Discord commands:"
        );
        console.error(err);
      }
    }
  });

  // ==========================================================
  // SLASH COMMANDS
  // ==========================================================

  discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      if (interaction.commandName === "ping") {
        return interaction.reply({
          content: "🏓 Novi is online!",
          ephemeral: true,
        });
      }

      if (interaction.commandName === "stock") {
        const result = await pool.query(`
          SELECT COUNT(*)::int AS count
          FROM novi_stock_items
        `);

        return interaction.reply({
          content: `📦 Current Novi stock: **${result.rows[0].count}**`,
        });
      }
    } catch (err) {
      console.error("Discord command error:", err);

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "Something went wrong.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "Something went wrong.",
          ephemeral: true,
        });
      }
    }
  });

  // ==========================================================
  // ! COMMANDS
  // ==========================================================

  discordClient.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return;

      const content = message.content.trim();

      if (!content.startsWith("!")) return;

      const parts = content
        .slice(1)
        .trim()
        .split(/\s+/);

      const command = parts.shift()?.toLowerCase();

      // ========================================================
      // !GEN
      //
      // !gen
      // !gen 5
      //
      // Generates website license keys.
      // ========================================================

      if (command === "gen") {
        let amount = Number(parts[0]) || 1;

        amount = Math.max(1, Math.min(amount, 100));

        const keys = await generateKeys(
          amount,
          86400000
        );

        const keyText = keys
          .map((item) => `\`${item.key}\``)
          .join("\n");

        try {
          await message.author.send(
            [
              "🔑 **Novi License Key Generator**",
              "",
              keyText,
              "",
              "⏱️ Duration: **24 hours**",
              `📦 Amount: **${keys.length}**`,
            ].join("\n")
          );

          return message.reply(
            `✅ Generated **${keys.length}** key${
              keys.length === 1 ? "" : "s"
            } and sent ${
              keys.length === 1 ? "it" : "them"
            } to your DMs.`
          );
        } catch (dmError) {
          return message.reply(
            "❌ I generated the key, but I couldn't DM you. Please enable DMs from server members."
          );
        }
      }

      // ========================================================
      // !ADD
      //
      // !add stock1
      // !add stock1 stock2 stock3
      //
      // Only Discord server administrators can use it.
      // ========================================================

      if (command === "add") {
        const isAdmin =
          message.member?.permissions?.has("Administrator");

        if (!isAdmin) {
          return message.reply(
            "❌ You need Administrator permission to use `!add`."
          );
        }

        if (parts.length === 0) {
          return message.reply(
            "❌ Usage: `!add <stock1> <stock2> <stock3>`"
          );
        }

        const stockIds = [
          ...new Set(
            parts
              .map((item) => item.trim())
              .filter(Boolean)
          ),
        ];

        const client = await pool.connect();

        try {
          await client.query("BEGIN");

          for (const stockId of stockIds) {
            await client.query(
              `
              INSERT INTO novi_stock_items
              (stock_id)
              VALUES ($1)
              `,
              [stockId]
            );
          }

          await client.query("COMMIT");

          return message.reply(
            `✅ Added **${stockIds.length}** stock item${
              stockIds.length === 1 ? "" : "s"
            }.`
          );
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }

      // ========================================================
      // !HELP
      // ========================================================

      if (command === "help") {
        return message.reply(
          [
            "**Novi Commands**",
            "",
            "`!gen` — Generate 1 website key",
            "`!gen 5` — Generate 5 website keys",
            "`!add <stock>` — Add stock",
            "",
            "`/stock` — Check stock count",
            "`/ping` — Check bot status",
          ].join("\n")
        );
      }
    } catch (err) {
      console.error(
        "Discord prefix command error:",
        err
      );

      try {
        await message.reply(
          "❌ Something went wrong while running that command."
        );
      } catch {}
    }
  });

  // ==========================================================
  // DISCORD ERRORS
  // ==========================================================

  discordClient.on("error", (err) => {
    console.error("Discord client error:");
    console.error(err);
  });

  await discordClient.login(DISCORD_TOKEN);
}

// ============================================================
// START
// ============================================================

async function start() {
  try {
    await initDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log("===============================");
      console.log("       NOVI SERVER ONLINE");
      console.log("===============================");
      console.log(`Port: ${PORT}`);
      console.log("Database: connected");
      console.log("Stock API: ready");
      console.log("===============================");
    });

    await startDiscordBot();
  } catch (err) {
    console.error("FAILED TO START NOVI:");
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
    console.error("Shutdown error:", err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();
