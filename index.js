require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

const {
  Client,
  GatewayIntentBits,
} = require("discord.js");

// ============================================================
// CONFIG
// ============================================================

const app = express();

const PORT =
  Number(process.env.PORT) || 10000;

const PUBLIC_DIR =
  path.join(__dirname, "public");

const DATA_FILE =
  path.join(
    __dirname,
    "novi-data.json"
  );

const ADMIN_SECRET =
  process.env.NOVI_ADMIN_SECRET;

const DISCORD_TOKEN =
  process.env.DISCORD_TOKEN;

// ============================================================
// DISCORD ROLES
// ============================================================

const ALLOWED_ROLE_IDS = [
  "1529705570209366167",
  "1378500563456626719",
];

// ============================================================
// DATA
// ============================================================

const DEFAULT_DATA = {
  nextStockId: 1,
  keys: [],
  stock: [],
  sessions: [],
};

// ============================================================
// LOAD DATA
// ============================================================

function createEmptyData() {
  return {
    nextStockId: 1,
    keys: [],
    stock: [],
    sessions: [],
  };
}

function loadData() {
  try {
    if (
      !fs.existsSync(
        DATA_FILE
      )
    ) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(
          DEFAULT_DATA,
          null,
          2
        ),
        "utf8"
      );

      console.log(
        "📁 Created novi-data.json"
      );

      return createEmptyData();
    }

    const raw =
      fs.readFileSync(
        DATA_FILE,
        "utf8"
      );

    if (!raw.trim()) {
      return createEmptyData();
    }

    const parsed =
      JSON.parse(raw);

    return {
      nextStockId:
        Number(
          parsed.nextStockId
        ) || 1,

      keys:
        Array.isArray(
          parsed.keys
        )
          ? parsed.keys
          : [],

      stock:
        Array.isArray(
          parsed.stock
        )
          ? parsed.stock
          : [],

      sessions:
        Array.isArray(
          parsed.sessions
        )
          ? parsed.sessions
          : [],
    };
  } catch (error) {
    console.error(
      "❌ Could not load novi-data.json:",
      error
    );

    return createEmptyData();
  }
}

let data =
  loadData();

// ============================================================
// SAVE DATA
// ============================================================

function saveData() {
  try {
    const tempFile =
      DATA_FILE + ".tmp";

    fs.writeFileSync(
      tempFile,
      JSON.stringify(
        data,
        null,
        2
      ),
      "utf8"
    );

    fs.renameSync(
      tempFile,
      DATA_FILE
    );
  } catch (error) {
    console.error(
      "❌ Could not save novi-data.json:",
      error
    );
  }
}

// ============================================================
// EXPRESS
// ============================================================

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(
  express.json({
    limit: "2mb",
  })
);

// ============================================================
// DEVICE COOKIE
//
// This is what locks a key to one browser.
//
// It is NOT a physical-device fingerprint.
// It is a persistent browser identifier.
//
// If the browser closes:
//   cookie stays.
//
// If the website is reopened:
//   same device ID.
//
// If another browser uses the key:
//   different device ID.
// ============================================================

function parseCookies(
  cookieHeader
) {
  const cookies = {};

  if (!cookieHeader) {
    return cookies;
  }

  const parts =
    cookieHeader.split(";");

  for (
    const part of parts
  ) {
    const index =
      part.indexOf("=");

    if (index === -1) {
      continue;
    }

    const name =
      part
        .slice(0, index)
        .trim();

    const value =
      part
        .slice(index + 1)
        .trim();

    try {
      cookies[name] =
        decodeURIComponent(
          value
        );
    } catch {
      cookies[name] = value;
    }
  }

  return cookies;
}

function setDeviceCookie(
  res,
  deviceId
) {
  const isProduction =
    process.env.NODE_ENV ===
    "production";

  const cookie =
    [
      `novi_device=${encodeURIComponent(
        deviceId
      )}`,

      "Path=/",

      "Max-Age=31536000",

      "HttpOnly",

      "SameSite=Lax",

      isProduction
        ? "Secure"
        : "",
    ]
      .filter(Boolean)
      .join("; ");

  res.setHeader(
    "Set-Cookie",
    cookie
  );
}

function getOrCreateDeviceId(
  req,
  res
) {
  const cookies =
    parseCookies(
      req.headers.cookie
    );

  let deviceId =
    cookies.novi_device;

  if (
    !deviceId ||
    deviceId.length < 20
  ) {
    deviceId =
      crypto.randomUUID();

    setDeviceCookie(
      res,
      deviceId
    );
  }

  return deviceId;
}

// Create/check device cookie
// before API routes.

app.use(
  (req, res, next) => {
    req.noviDeviceId =
      getOrCreateDeviceId(
        req,
        res
      );

    next();
  }
);

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

function normalizeDuration(
  input
) {
  if (!input) {
    return null;
  }

  const value =
    String(input)
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

  if (
    value === "lifetime"
  ) {
    return "lifetime";
  }

  return null;
}

// ============================================================
// KEY HELPERS
// ============================================================

function generateKey() {
  const random =
    crypto
      .randomBytes(12)
      .toString("hex")
      .toUpperCase();

  return (
    "NOVI-" +
    random.slice(0, 4) +
    "-" +
    random.slice(4, 8) +
    "-" +
    random.slice(8, 12) +
    "-" +
    random.slice(12, 16) +
    "-" +
    random.slice(16, 24)
  );
}

function isExpired(
  expiresAt
) {
  if (
    expiresAt === null ||
    expiresAt === undefined
  ) {
    return false;
  }

  const timestamp =
    Number(expiresAt);

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    return false;
  }

  return (
    Date.now() >= timestamp
  );
}

// ============================================================
// SESSION HELPERS
// ============================================================

function generateSessionToken() {
  return crypto
    .randomBytes(32)
    .toString("hex");
}

function createSession(
  keyId,
  deviceId,
  expiresAt
) {
  const token =
    generateSessionToken();

  data.sessions.push({
    token,
    keyId,
    deviceId,
    expiresAt:
      expiresAt ?? null,
    createdAt:
      Date.now(),
  });

  saveData();

  return token;
}

function getSession(
  req
) {
  const headerToken =
    req.headers[
      "x-novi-session"
    ];

  let token =
    headerToken;

  // Also support a cookie
  // session if the frontend
  // doesn't send the header.

  if (!token) {
    const cookies =
      parseCookies(
        req.headers.cookie
      );

    token =
      cookies.novi_session;
  }

  if (!token) {
    return null;
  }

  const session =
    data.sessions.find(
      item =>
        item.token ===
        token
    );

  if (!session) {
    return null;
  }

  // Make sure session belongs
  // to this browser.

  if (
    session.deviceId !==
    req.noviDeviceId
  ) {
    return null;
  }

  if (
    isExpired(
      session.expiresAt
    )
  ) {
    data.sessions =
      data.sessions.filter(
        item =>
          item.token !==
          token
      );

    saveData();

    return null;
  }

  return {
    token,
    ...session,
  };
}

function setSessionCookie(
  res,
  token,
  expiresAt
) {
  const isProduction =
    process.env.NODE_ENV ===
    "production";

  let maxAge =
    31536000;

  if (
    expiresAt !== null &&
    expiresAt !== undefined
  ) {
    const remaining =
      Number(expiresAt) -
      Date.now();

    if (remaining > 0) {
      maxAge =
        Math.floor(
          remaining / 1000
        );
    }
  }

  const cookie =
    [
      `novi_session=${encodeURIComponent(
        token
      )}`,

      "Path=/",

      `Max-Age=${maxAge}`,

      "HttpOnly",

      "SameSite=Lax",

      isProduction
        ? "Secure"
        : "",
    ]
      .filter(Boolean)
      .join("; ");

  // Preserve existing
  // Set-Cookie header.

  const existing =
    res.getHeader(
      "Set-Cookie"
    );

  const cookies =
    existing
      ? Array.isArray(
          existing
        )
        ? existing
        : [existing]
      : [];

  cookies.push(cookie);

  res.setHeader(
    "Set-Cookie",
    cookies
  );
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
        "Your session has expired or is invalid.",
    });
  }

  req.noviSession =
    session;

  next();
}

// ============================================================
// CLEAN EXPIRED SESSIONS
// ============================================================

function cleanExpiredSessions() {
  const before =
    data.sessions.length;

  data.sessions =
    data.sessions.filter(
      session =>
        !isExpired(
          session.expiresAt
        )
    );

  if (
    data.sessions.length !==
    before
  ) {
    saveData();
  }
}

setInterval(
  cleanExpiredSessions,
  60 * 1000
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/api/health",
  (req, res) => {
    return res.json({
      success: true,
      ok: true,
      database: false,
      storage: "json",
      keyLocking:
        "device",
    });
  }
);

// ============================================================
// VERIFY KEY
//
// FIRST USE:
//
// Key has no owner
//        ↓
// Browser claims key
//        ↓
// Device ID is saved
//
// NEXT USE:
//
// Same browser
//        ↓
// Allowed
//
// Different browser
//        ↓
// Rejected
// ============================================================

app.post(
  "/api/verify",
  (req, res) => {
    try {
      const suppliedKey =
        String(
          req.body?.key || ""
        ).trim();

      if (!suppliedKey) {
        return res.status(400).json({
          success: false,
          error:
            "Key is required.",
        });
      }

      const keyRow =
        data.keys.find(
          item =>
            String(
              item.key || ""
            ).toUpperCase() ===
            suppliedKey.toUpperCase()
        );

      if (!keyRow) {
        return res.status(404).json({
          success: false,
          error:
            "Invalid key.",
        });
      }

      const expiresAt =
        keyRow.expiresAt ===
          null ||
        keyRow.expiresAt ===
          undefined
          ? null
          : Number(
              keyRow.expiresAt
            );

      // ------------------------------------------------------
      // EXPIRATION
      // ------------------------------------------------------

      if (
        isExpired(
          expiresAt
        )
      ) {
        return res.status(403).json({
          success: false,
          error:
            "This key has expired.",
        });
      }

      // ------------------------------------------------------
      // DEVICE LOCK
      // ------------------------------------------------------

      const currentDeviceId =
        req.noviDeviceId;

      // Older keys may not have
      // a deviceId property.

      const keyOwner =
        keyRow.deviceId ||
        null;

      // ------------------------------------------------------
      // KEY ALREADY BELONGS
      // TO ANOTHER DEVICE
      // ------------------------------------------------------

      if (
        keyOwner &&
        keyOwner !==
          currentDeviceId
      ) {
        return res.status(403).json({
          success: false,
          error:
            "This key is already being used on another device.",
          code:
            "KEY_ALREADY_CLAIMED",
        });
      }

      // ------------------------------------------------------
      // FIRST CLAIM
      // ------------------------------------------------------

      if (!keyOwner) {
        keyRow.deviceId =
          currentDeviceId;

        keyRow.claimedAt =
          Date.now();

        saveData();
      }

      // ------------------------------------------------------
      // SAME DEVICE
      // ------------------------------------------------------

      const duration =
        normalizeDuration(
          keyRow.duration
        ) ||
        "lifetime";

      // Check whether this
      // browser already has a
      // valid session for this key.

      let existingSession =
        data.sessions.find(
          session =>
            session.keyId ===
              keyRow.id &&
            session.deviceId ===
              currentDeviceId &&
            !isExpired(
              session.expiresAt
            )
        );

      let sessionToken;

      if (
        existingSession
      ) {
        sessionToken =
          existingSession.token;
      } else {
        sessionToken =
          createSession(
            keyRow.id,
            currentDeviceId,
            expiresAt
          );
      }

      // Persistent session cookie.
      setSessionCookie(
        res,
        sessionToken,
        expiresAt
      );

      // ------------------------------------------------------
      // RESPONSE
      // ------------------------------------------------------

      return res.json({
        success: true,

        sessionToken,

        duration,

        expiresAt,

        key: {
          key: keyRow.key,

          duration,

          expiresAt,

          keyExpiresAt:
            expiresAt,

          claimed: true,
        },
      });
    } catch (error) {
      console.error(
        "❌ /api/verify error:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Server error.",
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
  (req, res) => {
    try {
      return res.json({
        success: true,
        count:
          data.stock.length,
      });
    } catch (error) {
      console.error(
        "❌ /api/stock error:",
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
  (req, res) => {
    try {
      if (
        data.stock.length ===
        0
      ) {
        return res.status(400).json({
          success: false,
          error:
            "No stock available.",
        });
      }

      // Remove oldest item.

      const stockRow =
        data.stock.shift();

      // Save immediately.

      saveData();

      const item =
        String(
          stockRow.stock_id ||
            ""
        ).trim();

      return res.json({
        success: true,

        item,

        account: item,
      });
    } catch (error) {
      console.error(
        "❌ /api/stock/generate error:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Could not generate item.",
      });
    }
  }
);

// ============================================================
// LOGOUT
// ============================================================
//
// IMPORTANT:
// Logging out does NOT release the key.
//
// The key remains locked to the
// browser until the key expires.
//
// This prevents someone from
// logging out and giving the key
// to another person.
// ============================================================

app.post(
  "/api/logout",
  (req, res) => {
    const token =
      req.headers[
        "x-novi-session"
      ];

    if (token) {
      data.sessions =
        data.sessions.filter(
          session =>
            session.token !==
            token
        );

      saveData();
    }

    // Clear session cookie.

    const isProduction =
      process.env.NODE_ENV ===
      "production";

    const cookie =
      [
        "novi_session=",

        "Path=/",

        "Max-Age=0",

        "HttpOnly",

        "SameSite=Lax",

        isProduction
          ? "Secure"
          : "",
      ]
        .filter(Boolean)
        .join("; ");

    const existing =
      res.getHeader(
        "Set-Cookie"
      );

    const cookies =
      existing
        ? Array.isArray(
            existing
          )
          ? existing
          : [existing]
        : [];

    cookies.push(cookie);

    res.setHeader(
      "Set-Cookie",
      cookies
    );

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

function hasAllowedDiscordRole(
  message
) {
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

async function denyDiscordCommand(
  message
) {
  return message.channel.send(
    "❌ You don't have permission to use this command."
  );
}

// ============================================================
// !gen
// ============================================================

async function handleGen(
  message,
  args
) {
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

  let durationInput =
    args[0];

  // !gen 1d
  // !gen 5 1d

  if (
    /^\d+$/.test(
      args[0] || ""
    )
  ) {
    amount =
      Number(args[0]);

    durationInput =
      args[1];
  }

  if (
    !Number.isInteger(
      amount
    ) ||
    amount < 1 ||
    amount > 100
  ) {
    return message.channel.send(
      "❌ Amount must be between 1 and 100."
    );
  }

  const duration =
    normalizeDuration(
      durationInput
    );

  if (!duration) {
    return message.channel.send(
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

    const keyId =
      crypto.randomUUID();

    data.keys.push({
      id: keyId,

      key,

      createdAt,

      expiresAt,

      duration,

      // Key starts unclaimed.

      deviceId: null,

      claimedAt: null,

      // Kept for compatibility
      // with older data.

      used: false,
    });

    generated.push(key);
  }

  saveData();

  return message.channel.send(
    `✅ Generated **${generated.length}** ${duration} key(s):\n` +
      generated
        .map(
          key =>
            `\`${key}\``
        )
        .join("\n")
  );
}

// ============================================================
// !add
// ============================================================

async function handleAdd(
  message,
  args
) {
  if (
    !hasAllowedDiscordRole(
      message
    )
  ) {
    return denyDiscordCommand(
      message
    );
  }

  const items = [];

  // ----------------------------------------------------------
  // DIRECT ITEM
  // ----------------------------------------------------------

  if (
    args &&
    args.length > 0
  ) {
    const directItem =
      args
        .join(" ")
        .trim();

    if (directItem) {
      items.push(
        directItem
      );
    }
  }

  // ----------------------------------------------------------
  // TXT FILE
  // ----------------------------------------------------------

  if (
    message.attachments &&
    message.attachments.size >
      0
  ) {
    for (
      const attachment of
        message.attachments.values()
    ) {
      const fileName =
        String(
          attachment.name ||
            ""
        ).toLowerCase();

      if (
        !fileName.endsWith(
          ".txt"
        )
      ) {
        continue;
      }

      try {
        console.log(
          `📄 Downloading TXT: ${attachment.name}`
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

        items.push(
          ...lines
        );
      } catch (error) {
        console.error(
          "❌ TXT error:",
          error
        );

        return message.channel.send(
          `❌ Could not read \`${attachment.name || "file"}\`.`
        );
      }
    }
  }

  // ----------------------------------------------------------
  // NOTHING
  // ----------------------------------------------------------

  if (
    items.length === 0
  ) {
    return message.channel.send(
      "❌ Usage:\n" +
        "`!add ITEM-123`\n" +
        "or attach a `.txt` file to `!add`."
    );
  }

  // ----------------------------------------------------------
  // LIMIT
  // ----------------------------------------------------------

  if (
    items.length > 5000
  ) {
    return message.channel.send(
      "❌ Too many stock items. Maximum: **5000**."
    );
  }

  // ----------------------------------------------------------
  // ADD
  // ----------------------------------------------------------

  let added = 0;

  for (
    const rawItem of items
  ) {
    const stockId =
      String(
        rawItem
      ).trim();

    if (!stockId) {
      continue;
    }

    data.stock.push({
      id:
        data.nextStockId++,

      stock_id:
        stockId,

      created_at:
        Date.now(),
    });

    added++;
  }

  saveData();

  return message.channel.send(
    `✅ Added **${added}** stock item(s).\n` +
      `📦 Current stock: **${data.stock.length}**`
  );
}

// ============================================================
// !stock
// ============================================================

async function handleStock(
  message
) {
  if (
    !hasAllowedDiscordRole(
      message
    )
  ) {
    return denyDiscordCommand(
      message
    );
  }

  return message.channel.send(
    `📦 Novi stock: **${data.stock.length}**`
  );
}

// ============================================================
// !clearstock
// ============================================================

async function handleClearStock(
  message
) {
  if (
    !hasAllowedDiscordRole(
      message
    )
  ) {
    return denyDiscordCommand(
      message
    );
  }

  const count =
    data.stock.length;

  data.stock = [];

  saveData();

  return message.channel.send(
    `🗑️ Cleared **${count}** stock item(s).`
  );
}

// ============================================================
// !help
// ============================================================

async function handleHelp(
  message
) {
  if (
    !hasAllowedDiscordRole(
      message
    )
  ) {
    return denyDiscordCommand(
      message
    );
  }

  return message.channel.send(
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
      "`!add ITEM-123` — Add stock",
      "`!add` + `.txt` — Import TXT stock",
      "`!stock` — Check stock",
      "`!clearstock` — Clear stock",
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

      if (
        command === "!gen"
      ) {
        await handleGen(
          message,
          args
        );

        return;
      }

      if (
        command === "!add"
      ) {
        await handleAdd(
          message,
          args
        );

        return;
      }

      if (
        command === "!stock"
      ) {
        await handleStock(
          message
        );

        return;
      }

      if (
        command === "!clearstock"
      ) {
        await handleClearStock(
          message
        );

        return;
      }

      if (
        command === "!help"
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
        await message.channel.send(
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

// Express 4/5 compatible
// fallback.

app.use(
  (req, res, next) => {
    if (
      req.method !== "GET"
    ) {
      return next();
    }

    const indexPath =
      path.join(
        PUBLIC_DIR,
        "index.html"
      );

    if (
      !fs.existsSync(
        indexPath
      )
    ) {
      return res.status(404).send(
        "Novi website index.html was not found."
      );
    }

    return res.sendFile(
      indexPath
    );
  }
);

// ============================================================
// START SERVER
// ============================================================

function start() {
  try {
    if (
      !fs.existsSync(
        DATA_FILE
      )
    ) {
      saveData();
    }

    console.log(
      "======================================"
    );

    console.log(
      "           STARTING NOVI"
    );

    console.log(
      "======================================"
    );

    console.log(
      `🌐 Port: ${PORT}`
    );

    console.log(
      `📁 Public: ${PUBLIC_DIR}`
    );

    console.log(
      `💾 Storage: ${DATA_FILE}`
    );

    console.log(
      "🔐 Key locking: DEVICE"
    );

    console.log(
      `🔑 Keys: ${data.keys.length}`
    );

    console.log(
      `📦 Stock: ${data.stock.length}`
    );

    console.log(
      `👥 Sessions: ${data.sessions.length}`
    );

    console.log(
      "======================================"
    );

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
