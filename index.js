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
  path.join(__dirname, "novi-data.json");

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
// DEFAULT DATA
// ============================================================

const DEFAULT_DATA = {
  nextStockId: 1,
  keys: [],
  stock: [],
  sessions: [],
};

// ============================================================
// DATA STORAGE
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
    if (!fs.existsSync(DATA_FILE)) {
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
      console.log(
        "⚠️ novi-data.json was empty. Creating fresh data."
      );

      const fresh =
        createEmptyData();

      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(
          fresh,
          null,
          2
        ),
        "utf8"
      );

      return fresh;
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

    process.exit(1);
  }
}

let data = loadData();

// ============================================================
// SAVE DATA SAFELY
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
// COOKIE HELPERS
// ============================================================

function parseCookies(
  cookieHeader
) {
  const cookies = {};

  if (!cookieHeader) {
    return cookies;
  }

  for (
    const part of cookieHeader.split(";")
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

function appendCookie(
  res,
  cookie
) {
  const existing =
    res.getHeader(
      "Set-Cookie"
    );

  let cookies = [];

  if (existing) {
    cookies = Array.isArray(existing)
      ? existing
      : [existing];
  }

  cookies.push(cookie);

  res.setHeader(
    "Set-Cookie",
    cookies
  );
}

// ============================================================
// BROWSER ID
// ============================================================
//
// This identifies the browser.
//
// Closing the website does NOT remove it.
//
// The cookie lasts for one year.
//
// IMPORTANT:
// This is a browser identifier,
// not a physical hardware fingerprint.
// ============================================================

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

    const production =
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
        production
          ? "Secure"
          : "",
      ]
        .filter(Boolean)
        .join("; ");

    appendCookie(
      res,
      cookie
    );
  }

  return deviceId;
}

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
// KEY GENERATION
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
// SESSION SYSTEM
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
        item.token === token
    );

  if (!session) {
    return null;
  }

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
          item.token !== token
      );

    saveData();

    return null;
  }

  // Make sure the key still exists.
  const key =
    data.keys.find(
      item =>
        item.id ===
        session.keyId
    );

  if (!key) {
    return null;
  }

  // Make sure the key is still owned
  // by this browser.

  if (
    key.deviceId &&
    key.deviceId !==
      req.noviDeviceId
  ) {
    return null;
  }

  // Make sure the key has not expired.

  if (
    isExpired(
      key.expiresAt
    )
  ) {
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
  const production =
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
        Math.max(
          1,
          Math.floor(
            remaining / 1000
          )
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
      production
        ? "Secure"
        : "",
    ]
      .filter(Boolean)
      .join("; ");

  appendCookie(
    res,
    cookie
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
    res.json({
      success: true,
      ok: true,
      storage: "json",
      database: false,
      keyLocking:
        "browser-cookie",
      keys:
        data.keys.length,
      stock:
        data.stock.length,
    });
  }
);

// ============================================================
// VERIFY KEY
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

      // Case-insensitive lookup.

      const keyRow =
        data.keys.find(
          item =>
            String(
              item.key || ""
            )
              .trim()
              .toUpperCase() ===
            suppliedKey.toUpperCase()
        );

      // ------------------------------------------------------
      // INVALID KEY
      // ------------------------------------------------------

      if (!keyRow) {
        return res.status(404).json({
          success: false,
          error:
            "Invalid key.",
        });
      }

      // ------------------------------------------------------
      // EXPIRATION
      // ------------------------------------------------------

      const expiresAt =
        keyRow.expiresAt ===
          null ||
        keyRow.expiresAt ===
          undefined
          ? null
          : Number(
              keyRow.expiresAt
            );

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
      // CURRENT BROWSER
      // ------------------------------------------------------

      const currentDeviceId =
        req.noviDeviceId;

      // ------------------------------------------------------
      // KEY IS ALREADY LOCKED
      // ------------------------------------------------------

      if (
        keyRow.deviceId &&
        keyRow.deviceId !==
          currentDeviceId
      ) {
        return res.status(403).json({
          success: false,
          error:
            "This key is already being used on another browser.",
          code:
            "KEY_ALREADY_CLAIMED",
        });
      }

      // ------------------------------------------------------
      // FIRST USE
      // ------------------------------------------------------

      if (!keyRow.deviceId) {
        keyRow.deviceId =
          currentDeviceId;

        keyRow.claimedAt =
          Date.now();

        saveData();

        console.log(
          `🔐 Key ${keyRow.key} claimed by browser ${currentDeviceId}`
        );
      }

      // ------------------------------------------------------
      // DURATION
      // ------------------------------------------------------

      const duration =
        normalizeDuration(
          keyRow.duration
        ) ||
        "lifetime";

      // ------------------------------------------------------
      // FIND EXISTING SESSION
      // ------------------------------------------------------

      let session =
        data.sessions.find(
          item =>
            item.keyId ===
              keyRow.id &&
            item.deviceId ===
              currentDeviceId &&
            !isExpired(
              item.expiresAt
            )
        );

      let sessionToken;

      if (session) {
        sessionToken =
          session.token;
      } else {
        sessionToken =
          createSession(
            keyRow.id,
            currentDeviceId,
            expiresAt
          );
      }

      // ------------------------------------------------------
      // SAVE SESSION COOKIE
      // ------------------------------------------------------

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
          key:
            keyRow.key,

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

      const stockRow =
        data.stock.shift();

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
// Logging out DOES NOT release the key.
//
// The browser remains the owner
// until the key expires.
// ============================================================

app.post(
  "/api/logout",
  (req, res) => {
    try {
      const token =
        req.headers[
          "x-novi-session"
        ];

      const cookies =
        parseCookies(
          req.headers.cookie
        );

      const cookieToken =
        cookies.novi_session;

      const tokenToRemove =
        token ||
        cookieToken;

      if (tokenToRemove) {
        data.sessions =
          data.sessions.filter(
            session =>
              session.token !==
              tokenToRemove
          );

        saveData();
      }

      const production =
        process.env.NODE_ENV ===
        "production";

      const cookie =
        [
          "novi_session=",
          "Path=/",
          "Max-Age=0",
          "HttpOnly",
          "SameSite=Lax",
          production
            ? "Secure"
            : "",
        ]
          .filter(Boolean)
          .join("; ");

      appendCookie(
        res,
        cookie
      );

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "❌ /api/logout error:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          "Logout failed.",
      });
    }
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

    data.keys.push({
      id:
        crypto.randomUUID(),

      key,

      createdAt,

      expiresAt,

      duration,

      // ------------------------------------------------------
      // BROWSER LOCK
      // ------------------------------------------------------

      deviceId: null,

      claimedAt: null,

      // Compatibility field.

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

  // Direct item.

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

  // TXT attachment.

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

  if (
    items.length === 0
  ) {
    return message.channel.send(
      "❌ Usage:\n" +
        "`!add ITEM-123`\n" +
        "or attach a `.txt` file to `!add`."
    );
  }

  if (
    items.length > 5000
  ) {
    return message.channel.send(
      "❌ Too many stock items. Maximum: **5000**."
    );
  }

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

// ============================================================
// WEBSITE FALLBACK
// ============================================================

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
      return res
        .status(404)
        .send(
          "Novi website index.html was not found."
        );
    }

    return res.sendFile(
      indexPath
    );
  }
);

// ============================================================
// START
// ============================================================

function start() {
  try {
    // Make sure the data file exists.

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
      "🗄️ Database: NONE"
    );

    console.log(
      "🔐 Key locking: BROWSER"
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
