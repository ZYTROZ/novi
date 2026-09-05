require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const {
  Client,
  GatewayIntentBits,
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

const ALLOWED_ROLE_IDS = [
  "1529705570209366167",
  "1378500563456626719",
];

// ============================================================
// REQUIRED ENVIRONMENT VARIABLES
// ============================================================

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

app.use(
  express.json({
    limit: "2mb",
  })
);

// ============================================================
// SESSION SYSTEM
// ============================================================

const sessions = new Map();

function createSession(keyId, expiresAt) {
  const token = crypto
    .randomBytes(32)
    .toString("hex");

  sessions.set(token, {
    keyId,
    expiresAt: expiresAt ?? null,
  });

  return token;
}

function getSession(req) {
  const token = req.headers["x-novi-session"];

  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (
    session.expiresAt !== null &&
    Date.now() >= Number(session.expiresAt)
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
  const session = getSession(req);

  if (!session) {
    return res.status(401).json({
      success: false,
      error:
        "Your session has expired or is invalid.",
    });
  }

  req.noviSession = session;

  next();
}

// ============================================================
// GENERAL HELPERS
// ============================================================

function generateKey() {
  const random = crypto
    .randomBytes(12)
    .toString("hex")
    .toUpperCase();

  return `NOVI-${random.slice(
    0,
    4
  )}-${random.slice(
    4,
    8
  )}-${random.slice(
    8,
    12
  )}-${random.slice(
    12,
    16
  )}-${random.slice(
    16,
    24
  )}`;
}

function normalizeLogin(item) {
  if (
    item === null ||
    item === undefined
  ) {
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

  if (separator === -1) {
    return {
      email: value,
      password: "",
    };
  }

  return {
    email: value.slice(0, separator),
    password: value.slice(separator + 1),
  };
}

function isExpired(expiresAt) {
  if (
    expiresAt === null ||
    expiresAt === undefined
  ) {
    return false;
  }

  const timestamp = Number(expiresAt);

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return Date.now() >= timestamp;
}

// ============================================================
// DURATIONS
// ============================================================

const DURATION_MS = {
  "1d":
    24 *
    60 *
    60 *
    1000,

  "3d":
    3 *
    24 *
    60 *
    60 *
    1000,

  "1w":
    7 *
    24 *
    60 *
    60 *
    1000,

  "1mo":
    30 *
    24 *
    60 *
    60 *
    1000,

  lifetime: null,
};

function normalizeDuration(input) {
  if (!input) {
    return null;
  }

  const value = String(input)
    .toLowerCase()
    .trim();

  if (value === "1d") {
    return "1d";
  }

  if (value === "3d") {
    return "3d";
  }

  if (
    value === "1w" ||
    value === "1week"
  ) {
    return "1w";
  }

  if (
    value === "1mo" ||
    value === "1month"
  ) {
    return "1mo";
  }

  if (value === "lifetime") {
    return "lifetime";
  }

  return null;
}

// ============================================================
// DATABASE TYPE VARIABLES
// ============================================================

let stockCreatedAtType = "timestamp";
let savedCreatedAtType = "timestamp";

// ============================================================
// CLEAN SAVED ITEMS TABLE
// ============================================================

async function cleanSavedLoginTable() {
  console.log(
    "🧹 Cleaning novi_saved_items..."
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_saved_items (
      id SERIAL PRIMARY KEY,
      email TEXT,
      password TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  const allowedColumns = new Set([
    "id",
    "email",
    "password",
    "created_at",
  ]);

  const columnsResult = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'novi_saved_items'
    ORDER BY ordinal_position
  `);

  const columnsToRemove =
    columnsResult.rows
      .map(row => row.column_name)
      .filter(
        column =>
          !allowedColumns.has(column)
      );

  for (const column of columnsToRemove) {
    const safeColumn =
      `"${column.replace(
        /"/g,
        '""'
      )}"`;

    console.log(
      `🧹 Removing old saved-login column: ${column}`
    );

    await pool.query(`
      ALTER TABLE novi_saved_items
      DROP COLUMN IF EXISTS ${safeColumn}
    `);
  }

  await pool.query(`
    ALTER TABLE novi_saved_items
    ADD COLUMN IF NOT EXISTS email TEXT
  `);

  await pool.query(`
    ALTER TABLE novi_saved_items
    ADD COLUMN IF NOT EXISTS password TEXT
  `);

  await pool.query(`
    ALTER TABLE novi_saved_items
    ADD COLUMN IF NOT EXISTS created_at
    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE novi_saved_items
    ALTER COLUMN email DROP NOT NULL
  `);

  await pool.query(`
    ALTER TABLE novi_saved_items
    ALTER COLUMN password DROP NOT NULL
  `);

  await pool.query(`
    ALTER TABLE novi_saved_items
    ALTER COLUMN created_at DROP NOT NULL
  `);

  const finalResult = await pool.query(`
    SELECT
      column_name,
      data_type,
      is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'novi_saved_items'
    ORDER BY ordinal_position
  `);

  console.log(
    "📋 Final novi_saved_items structure:"
  );

  for (const row of finalResult.rows) {
    console.log(
      `   ${row.column_name} | ${row.data_type} | nullable=${row.is_nullable}`
    );
  }

  console.log(
    "✅ novi_saved_items cleanup complete."
  );
}

// ============================================================
// FIX OLD DURATION COLUMN
// ============================================================

async function fixDurationColumn() {
  const result = await pool.query(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'novi_keys'
      AND column_name = 'duration'
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    return;
  }

  const dataType = result.rows[0].data_type;

  if (
    dataType === "bigint" ||
    dataType === "integer" ||
    dataType === "numeric"
  ) {
    console.log(
      "🔧 Converting old duration values..."
    );

    await pool.query(`
      ALTER TABLE novi_keys
      ALTER COLUMN duration TYPE TEXT
      USING CASE
        WHEN duration IS NULL
          THEN 'lifetime'

        WHEN duration::text = '86400000'
          THEN '1d'

        WHEN duration::text = '259200000'
          THEN '3d'

        WHEN duration::text = '604800000'
          THEN '1w'

        WHEN duration::text = '2592000000'
          THEN '1mo'

        ELSE duration::text
      END
    `);

    console.log(
      "✅ Duration column converted."
    );
  }
}

// ============================================================
// DETECT DATABASE TYPES
// ============================================================

async function detectDatabaseTypes() {
  const result = await pool.query(`
    SELECT
      table_name,
      data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'novi_stock_items',
        'novi_saved_items'
      )
      AND column_name = 'created_at'
  `);

  for (const row of result.rows) {
    const type =
      row.data_type.includes("timestamp")
        ? "timestamp"
        : "bigint";

    if (
      row.table_name ===
      "novi_stock_items"
    ) {
      stockCreatedAtType = type;
    }

    if (
      row.table_name ===
      "novi_saved_items"
    ) {
      savedCreatedAtType = type;
    }
  }

  console.log(
    `📊 stock created_at: ${stockCreatedAtType}`
  );

  console.log(
    `📊 saved created_at: ${savedCreatedAtType}`
  );
}

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

async function initializeDatabase() {
  console.log(
    "========================================"
  );

  console.log(
    "🔧 INITIALIZING NOVI DATABASE"
  );

  console.log(
    "========================================"
  );

  // ----------------------------------------------------------
  // KEYS
  // ----------------------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_keys (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      created_at BIGINT NOT NULL,
      expires_at BIGINT,
      duration TEXT,
      used BOOLEAN DEFAULT FALSE
    )
  `);

  // ----------------------------------------------------------
  // STOCK
  // ----------------------------------------------------------

  await pool.query(`
    CREATE TABLE IF NOT EXISTS novi_stock_items (
      id SERIAL PRIMARY KEY,
      stock_id TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE novi_stock_items
    ADD COLUMN IF NOT EXISTS stock_id TEXT
  `);

  await pool.query(`
    ALTER TABLE novi_stock_items
    ADD COLUMN IF NOT EXISTS created_at
    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  `);

  // ----------------------------------------------------------
  // SAVED ITEMS
  // ----------------------------------------------------------

  await cleanSavedLoginTable();

  // ----------------------------------------------------------
  // INDEXES
  // ----------------------------------------------------------

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    novi_keys_key_idx
    ON novi_keys(key)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS
    novi_stock_items_stock_id_idx
    ON novi_stock_items(stock_id)
  `);

  // ----------------------------------------------------------
  // OLD DATA FIXES
  // ----------------------------------------------------------

  await fixDurationColumn();

  await detectDatabaseTypes();

  console.log(
    "========================================"
  );

  console.log(
    "✅ NOVI DATABASE READY"
  );

  console.log(
    "========================================"
  );
}

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/api/health",
  async (req, res) => {
    try {
      await pool.query("SELECT 1");

      return res.json({
        success: true,
        ok: true,
        database: true,
      });
    } catch (error) {
      console.error(
        "❌ Health check failed:",
        error
      );

      return res.status(500).json({
        success: false,
        ok: false,
        database: false,
        error: error.message,
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
      const suppliedKey = String(
        req.body?.key || ""
      ).trim();

      if (!suppliedKey) {
        return res.status(400).json({
          success: false,
          error: "Key is required.",
        });
      }

      const result =
        await pool.query(
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
          error:
            "This key has already been used.",
        });
      }

      const expiresAt =
        keyRow.expires_at === null
          ? null
          : Number(
              keyRow.expires_at
            );

      if (isExpired(expiresAt)) {
        return res.status(403).json({
          success: false,
          error:
            "This key has expired.",
        });
      }

      const duration =
        normalizeDuration(
          keyRow.duration
        ) ||
        (
          keyRow.duration === null
            ? "lifetime"
            : String(
                keyRow.duration
              )
        );

      const sessionToken =
        createSession(
          keyRow.id,
          expiresAt
        );

      await pool.query(
        `
        UPDATE novi_keys
        SET used = TRUE
        WHERE id = $1
        `,
        [keyRow.id]
      );

      return res.json({
        success: true,
        sessionToken,
        duration,
        expiresAt,

        key: {
          key: keyRow.key,
          duration,
          expiresAt,
          keyExpiresAt: expiresAt,
        },
      });
    } catch (error) {
      console.error(
        "❌ /api/verify:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "Server error.",
      });
    }
  }
);

// ============================================================
// STOCK COUNT
// ============================================================

app.get(
  "/api/stock",
  requireSession,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT COUNT(*)::INTEGER AS count
          FROM novi_stock_items
        `);

      return res.json({
        success: true,
        count: Number(
          result.rows[0].count
        ),
      });
    } catch (error) {
      console.error(
        "❌ /api/stock:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Could not load stock.",
      });
    }
  }
);

// ============================================================
// GENERATE STOCK ITEM
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
            stock_id,
            created_at
          FROM novi_stock_items
          ORDER BY id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `);

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          success: false,
          error:
            "No stock available.",
        });
      }

      const stockRow = result.rows[0];

      await client.query(
        `
        DELETE FROM novi_stock_items
        WHERE id = $1
        `,
        [stockRow.id]
      );

      await client.query("COMMIT");

      const item =
        normalizeLogin(
          stockRow.stock_id
        );

      return res.json({
        success: true,
        item,
        account: item,
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(
        "❌ /api/stock/generate:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Could not generate item.",
      });
    } finally {
      client.release();
    }
  }
);

// ============================================================
// GET SAVED ITEMS
// ============================================================

app.get(
  "/api/saved-logins",
  requireSession,
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            id,
            email,
            password,
            created_at
          FROM novi_saved_items
          ORDER BY id DESC
        `);

      return res.json({
        success: true,
        logins: result.rows,
        savedLogins: result.rows,
        items: result.rows,
      });
    } catch (error) {
      console.error(
        "❌ GET saved items:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Could not load saved items.",
      });
    }
  }
);

// ============================================================
// SAVE ITEM
// ============================================================

app.post(
  "/api/saved-logins",
  requireSession,
  async (req, res) => {
    try {
      const email = String(
        req.body?.email || ""
      ).trim();

      const password = String(
        req.body?.password || ""
      );

      if (!email) {
        return res.status(400).json({
          success: false,
          error:
            "Email is required.",
        });
      }

      let result;

      if (
        savedCreatedAtType ===
        "timestamp"
      ) {
        result =
          await pool.query(
            `
            INSERT INTO novi_saved_items
              (
                email,
                password,
                created_at
              )
            VALUES
              (
                $1,
                $2,
                NOW()
              )
            RETURNING
              id,
              email,
              password,
              created_at
            `,
            [
              email,
              password,
            ]
          );
      } else {
        result =
          await pool.query(
            `
            INSERT INTO novi_saved_items
              (
                email,
                password,
                created_at
              )
            VALUES
              (
                $1,
                $2,
                $3
              )
            RETURNING
              id,
              email,
              password,
              created_at
            `,
            [
              email,
              password,
              Date.now(),
            ]
          );
      }

      const savedItem =
        result.rows[0];

      console.log(
        `✅ Saved item #${savedItem.id}`
      );

      return res.json({
        success: true,
        login: savedItem,
        item: savedItem,
      });
    } catch (error) {
      console.error(
        "========================================"
      );

      console.error(
        "❌ SAVE ITEM FAILED"
      );

      console.error(
        "Message:",
        error.message
      );

      console.error(
        "Code:",
        error.code
      );

      console.error(
        "Detail:",
        error.detail || ""
      );

      console.error(
        "Hint:",
        error.hint || ""
      );

      console.error(
        "========================================"
      );

      return res.status(500).json({
        success: false,
        error:
          error.message ||
          "Could not save item.",
      });
    }
  }
);

// ============================================================
// GET ONE SAVED ITEM
// ============================================================

app.get(
  "/api/saved-logins/:id",
  requireSession,
  async (req, res) => {
    try {
      const id = Number(
        req.params.id
      );

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          error: "Invalid ID.",
        });
      }

      const result =
        await pool.query(
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
          error:
            "Saved item not found.",
        });
      }

      return res.json({
        success: true,
        login: result.rows[0],
        item: result.rows[0],
      });
    } catch (error) {
      console.error(
        "❌ GET saved item:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Could not load saved item.",
      });
    }
  }
);

// ============================================================
// DELETE SAVED ITEM
// ============================================================

app.delete(
  "/api/saved-logins/:id",
  requireSession,
  async (req, res) => {
    try {
      const id = Number(
        req.params.id
      );

      if (!Number.isInteger(id)) {
        return res.status(400).json({
          success: false,
          error: "Invalid ID.",
        });
      }

      const result =
        await pool.query(
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
          error:
            "Saved item not found.",
        });
      }

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "❌ DELETE saved item:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Could not delete saved item.",
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
      ];

    if (token) {
      sessions.delete(token);
    }

    return res.json({
      success: true,
    });
  }
);

// ============================================================
// DISCORD BOT
// ============================================================

const discordClient =
  new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

// ============================================================
// DISCORD ROLE CHECK
// ============================================================

function hasAllowedDiscordRole(message) {
  if (!message.member) {
    return false;
  }

  return ALLOWED_ROLE_IDS.some(
    roleId =>
      message.member.roles.cache.has(
        roleId
      )
  );
}

async function denyDiscordCommand(message) {
  return message.reply(
    "❌ You don't have permission to use this command."
  );
}

// ============================================================
// !gen
// ============================================================

async function handleGen(message, args) {
  if (
    !hasAllowedDiscordRole(
      message
    )
  ) {
    return denyDiscordCommand(
      message
    );
  }

  let amount = 1;
  let durationInput = args[0];

  if (
    /^\d+$/.test(
      args[0] || ""
    )
  ) {
    amount = Number(args[0]);
    durationInput = args[1];
  }

  if (
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > 100
  ) {
    return message.reply(
      "❌ Amount must be between 1 and 100."
    );
  }

  const duration =
    normalizeDuration(
      durationInput
    );

  if (!duration) {
    return message.reply(
      "❌ Valid durations: `1d`, `3d`, `1w`, `1mo`, `lifetime`"
    );
  }

  const generated = [];

  for (
    let i = 0;
    i < amount;
    i++
  ) {
    const key =
      generateKey();

    const createdAt =
      Date.now();

    const durationMs =
      DURATION_MS[
        duration
      ];

    const expiresAt =
      durationMs === null
        ? null
        : createdAt +
          durationMs;

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
        duration,
      ]
    );

    generated.push(key);
  }

  return message.reply(
    `✅ Generated **${generated.length}** ${duration} key(s):\n${generated
      .map(
        key =>
          `\`${key}\``
      )
      .join("\n")}`
  );
}

// ============================================================
// !add
//
// Supports:
//
// !add item
//
// OR
//
// !add
// + attach .txt
//
// Every non-empty TXT line becomes one stock item.
// ============================================================

async function handleAdd(message, args) {
  if (
    !hasAllowedDiscordRole(
      message
    )
  ) {
    return denyDiscordCommand(
      message
    );
  }

  let items = [];

  // ----------------------------------------------------------
  // DIRECT !add ITEM
  // ----------------------------------------------------------

  if (
    args &&
    args.length > 0
  ) {
    const text =
      args
        .join(" ")
        .trim();

    if (text) {
      items.push(text);
    }
  }

  // ----------------------------------------------------------
  // ATTACHED TXT FILE
  // ----------------------------------------------------------

  if (
    message.attachments &&
    message.attachments.size > 0
  ) {
    console.log(
      `📎 Discord attachments detected: ${message.attachments.size}`
    );

    for (
      const attachment of
        message.attachments.values()
    ) {
      console.log(
        `📎 File: ${attachment.name || "unknown"}`
      );

      console.log(
        `📎 URL: ${attachment.url}`
      );

      console.log(
        `📎 Type: ${attachment.contentType || "unknown"}`
      );

      const fileName =
        String(
          attachment.name || ""
        ).toLowerCase();

      const contentType =
        String(
          attachment.contentType || ""
        ).toLowerCase();

      const isTxt =
        fileName.endsWith(
          ".txt"
        ) ||
        contentType ===
          "text/plain" ||
        contentType.startsWith(
          "text/"
        );

      if (!isTxt) {
        console.log(
          `⚠️ Skipping non-TXT attachment: ${attachment.name}`
        );

        continue;
      }

      try {
        console.log(
          `📄 Downloading TXT file: ${attachment.name}`
        );

        const response =
          await fetch(
            attachment.url
          );

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`
          );
        }

        const text =
          await response.text();

        if (!text.trim()) {
          return message.reply(
            "❌ The TXT file is empty."
          );
        }

        const lines =
          text
            .split(/\r?\n/)
            .map(
              line =>
                line.trim()
            )
            .filter(
              line =>
                line.length > 0
            );

        console.log(
          `📄 TXT contained ${lines.length} non-empty line(s)`
        );

        items.push(
          ...lines
        );
      } catch (error) {
        console.error(
          "❌ TXT download error:",
          error
        );

        return message.reply(
          `❌ Couldn't read \`${attachment.name || "file"}\`.\n` +
          `Error: \`${error.message}\``
        );
      }
    }
  } else {
    console.log(
      "📎 No Discord attachment detected."
    );
  }

  // ----------------------------------------------------------
  // NOTHING PROVIDED
  // ----------------------------------------------------------

  if (
    items.length === 0
  ) {
    return message.reply(
      "❌ No stock was provided.\n\n" +
      "**Use:**\n" +
      "`!add item`\n" +
      "or attach a `.txt` file to `!add`."
    );
  }

  // ----------------------------------------------------------
  // MAXIMUM
  // ----------------------------------------------------------

  if (
    items.length > 5000
  ) {
    return message.reply(
      "❌ Maximum **5000** items can be added at once."
    );
  }

  // ----------------------------------------------------------
  // INSERT STOCK
  // ----------------------------------------------------------

  let added = 0;

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    for (
      const rawItem of
        items
    ) {
      const stockId =
        String(
          rawItem
        ).trim();

      if (!stockId) {
        continue;
      }

      if (
        stockCreatedAtType ===
        "timestamp"
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
              NOW()
            )
          `,
          [stockId]
        );
      } else {
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

    await client.query(
      "COMMIT"
    );
  } catch (error) {
    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {}

    console.error(
      "❌ Stock insert error:",
      error
    );

    return message.reply(
      `❌ Failed to add stock.\n` +
      `Error: \`${error.message}\``
    );
  } finally {
    client.release();
  }

  // ----------------------------------------------------------
  // FINAL STOCK COUNT
  // ----------------------------------------------------------

  const countResult =
    await pool.query(`
      SELECT COUNT(*)::INTEGER AS count
      FROM novi_stock_items
    `);

  const count =
    Number(
      countResult.rows[0].count
    );

  return message.reply(
    `✅ Added **${added}** item(s).\n` +
    `📦 Current stock: **${count}**`
  );
}

// ============================================================
// !stock
// ============================================================

async function handleStock(message) {
  if (
    !hasAllowedDiscordRole(
      message
    )
  ) {
    return denyDiscordCommand(
      message
    );
  }

  try {
    const result =
      await pool.query(`
        SELECT COUNT(*)::INTEGER AS count
        FROM novi_stock_items
      `);

    const count =
      Number(
        result.rows[0].count
      );

    return message.reply(
      `📦 Novi stock: **${count}**`
    );
  } catch (error) {
    console.error(
      "❌ Stock count error:",
      error
    );

    return message.reply(
      "❌ Failed to check stock."
    );
  }
}

// ============================================================
// !clearstock
// ============================================================

async function handleClearStock(message) {
  if (
    !hasAllowedDiscordRole(
      message
    )
  ) {
    return denyDiscordCommand(
      message
    );
  }

  try {
    const result =
      await pool.query(`
        DELETE FROM novi_stock_items
      `);

    return message.reply(
      `🗑️ Cleared **${result.rowCount}** stock item(s).\n` +
      `📦 Current stock: **0**`
    );
  } catch (error) {
    console.error(
      "❌ Clear stock error:",
      error
    );

    return message.reply(
      "❌ Failed to clear stock."
    );
  }
}

// ============================================================
// !help
// ============================================================

async function handleHelp(message) {
  if (
    !hasAllowedDiscordRole(
      message
    )
  ) {
    return denyDiscordCommand(
      message
    );
  }

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
      "`!add item` — Add one stock item",
      "`!add + TXT` — Import a TXT file",
      "`!stock` — Check stock",
      "`!clearstock` — Remove ALL stock",
      "`!help` — Show commands",
    ].join("\n")
  );
}

// ============================================================
// DISCORD MESSAGE HANDLER
// ============================================================

discordClient.on(
  "messageCreate",
  async message => {
    try {
      if (
        message.author.bot
      ) {
        return;
      }

      if (
        !message.content.startsWith(
          "!"
        )
      ) {
        return;
      }

      const parts =
        message.content
          .trim()
          .split(/\s+/);

      const command =
        parts
          .shift()
          .toLowerCase();

      const args =
        parts;

      // --------------------------------------------------------
      // !gen
      // --------------------------------------------------------

      if (
        command ===
        "!gen"
      ) {
        await handleGen(
          message,
          args
        );

        return;
      }

      // --------------------------------------------------------
      // !add
      // --------------------------------------------------------

      if (
        command ===
        "!add"
      ) {
        await handleAdd(
          message,
          args
        );

        return;
      }

      // --------------------------------------------------------
      // !stock
      // --------------------------------------------------------

      if (
        command ===
        "!stock"
      ) {
        await handleStock(
          message
        );

        return;
      }

      // --------------------------------------------------------
      // !clearstock
      // --------------------------------------------------------

      if (
        command ===
        "!clearstock"
      ) {
        await handleClearStock(
          message
        );

        return;
      }

      // --------------------------------------------------------
      // !help
      // --------------------------------------------------------

      if (
        command ===
        "!help"
      ) {
        await handleHelp(
          message
        );

        return;
      }
    } catch (error) {
      console.error(
        "❌ Discord command error:",
        error
      );

      try {
        await message.reply(
          "❌ Something went wrong while running that command."
        );
      } catch {}
    }
  }
);

// ============================================================
// DISCORD READY
// ============================================================

discordClient.once(
  "ready",
  () => {
    console.log(
      `🤖 Discord bot logged in as ${discordClient.user.tag}`
    );

    console.log(
      "🔐 Allowed Discord roles:"
    );

    for (
      const roleId of
        ALLOWED_ROLE_IDS
    ) {
      console.log(
        `   • ${roleId}`
      );
    }
  }
);

// ============================================================
// DISCORD LOGIN
// ============================================================

if (DISCORD_TOKEN) {
  discordClient
    .login(
      DISCORD_TOKEN
    )
    .catch(error => {
      console.error(
        "❌ Discord login failed:",
        error
      );
    });
} else {
  console.warn(
    "⚠️ DISCORD_TOKEN is missing. Discord bot will not start."
  );
}

// ============================================================
// WEBSITE
// ============================================================

app.use(
  express.static(
    PUBLIC_DIR
  )
);

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
// START SERVER
// ============================================================

async function start() {
  try {
    await initializeDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `🌐 Novi website running on port ${PORT}`
        );
      }
    );
  } catch (error) {
    console.error(
      "❌ FAILED TO START NOVI"
    );

    console.error(
      error
    );

    process.exit(1);
  }
}

start();
