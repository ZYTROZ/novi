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
// CREATE DATA
// ============================================================

function createEmptyData() {
  return {
    nextStockId: 1,
    keys: [],
    stock: [],
    sessions: [],
  };
}

// ============================================================
// LOAD DATA FROM DISK
// ============================================================

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
      "❌ Failed to load novi-data.json:",
      error
    );

    return createEmptyData();
  }
}

let data =
  loadData();

// ============================================================
// REFRESH DATA
// ============================================================
//
// IMPORTANT:
//
// This fixes the "Invalid key" problem when
// another Node process (such as the Discord bot)
// changes novi-data.json.
//
// The website reloads the latest file before
// checking keys/sessions/stock.
// ============================================================

function refreshData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      saveData();
      return;
    }

    const raw =
      fs.readFileSync(
        DATA_FILE,
        "utf8"
      );

    if (!raw.trim()) {
      return;
    }

    const parsed =
      JSON.parse(raw);

    data = {
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
      "❌ Could not refresh novi-data.json:",
      error
    );
  }
}

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

  const cookies =
    existing
      ? Array.isArray(existing)
        ? existing
        : [existing]
      : [];

  cookies.push(cookie);

  res.setHeader(
    "Set-Cookie",
    cookies
  );
}

// ============================================================
// DEVICE COOKIE
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
    !Number.isFinite(timestamp)
  ) {
    return false;
  }

  return (
    Date.now() >= timestamp
  );
}

// ============================================================
// SESSION
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
  // Always get latest data.

  refreshData();

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

  const key =
    data.keys.find(
      item =>
        item.id ===
        session.keyId
    );

  if (!key) {
    return null;
  }

  if (
    key.deviceId &&
    key.deviceId !==
      req.noviDeviceId
  ) {
    return null;
  }

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
// HEALTH
// ============================================================

app.get(
  "/api/health",
  (req, res) => {
    refreshData();

    return res.json({
      success: true,
      ok: true,
      database: false,
      storage: "json",
      keyLocking:
        "browser",
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
      // ======================================================
      // CRITICAL:
      // Reload latest keys from disk.
      // ======================================================

      refreshData();

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

      console.log(
        `🔎 Checking key: ${suppliedKey}`
      );

      console.log(
        `🔑 Keys currently loaded: ${data.keys.length}`
      );

      const keyRow =
        data.keys.find(
          item =>
            String(
              item.key || ""
            )
              .trim()
              .toUpperCase() ===
            suppliedKey
              .toUpperCase()
        );

      if (!keyRow) {
        console.log(
          `❌ Key not found: ${suppliedKey}`
        );

        return res.status(404).json({
          success: false,
          error:
            "Invalid key.",
        });
      }

      console.log(
        `✅ Key found: ${keyRow.key}`
      );

      // ======================================================
      // EXPIRATION
      // ======================================================

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

      // ======================================================
      // BROWSER LOCK
      // ======================================================

      const currentDeviceId =
        req.noviDeviceId;

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

      // ======================================================
      // FIRST USE
      // ======================================================

      if (!keyRow.deviceId) {
        keyRow.deviceId =
          currentDeviceId;

        keyRow.claimedAt =
          Date.now();

        saveData();

        console.log(
          `🔐 Claimed ${keyRow.key}`
        );
      }

      // ======================================================
      // SESSION
      // ======================================================

      const duration =
        normalizeDuration(
          keyRow.duration
        ) ||
        "lifetime";

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

      setSessionCookie(
        res,
        sessionToken,
        expiresAt
      );

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
        "❌ VERIFY ERROR:",
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
// STOCK
// ============================================================

app.get(
  "/api/stock",
  requireSession,
  (req, res) => {
    refreshData();

    return res.json({
      success: true,
      count:
        data.stock.length,
    });
  }
);

app.post(
  "/api/stock/generate",
  requireSession,
  (req, res) => {
    try {
      refreshData();

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
        "❌ Stock error:",
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

app.post(
  "/api/logout",
  (req, res) => {
    try {
      refreshData();

      const cookies =
        parseCookies(
          req.headers.cookie
        );

      const token =
        req.headers[
          "x-novi-session"
        ] ||
        cookies.novi_session;

      if (token) {
        data.sessions =
          data.sessions.filter(
            session =>
              session.token !==
              token
          );

        saveData();
      }

      const production =
        process.env.NODE_ENV ===
        "production";

      appendCookie(
        res,
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
          .join("; ")
      );

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "❌ Logout error:",
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
// ROLE CHECK
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
// !GEN
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

  // IMPORTANT:
  // Reload first so we don't overwrite
  // changes made by the website.

  refreshData();

  let amount = 1;

  let durationInput =
    args[0];

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

      deviceId: null,

      claimedAt: null,

      used: false,
    });

    generated.push(key);
  }

  // Save to disk.

  saveData();

  console.log(
    `🔑 Generated ${generated.length} ${duration} key(s)`
  );

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
// !ADD
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

  refreshData();

  const items = [];

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
            .filter(Boolean);

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
      "❌ Usage:\n`!add ITEM-123`\nor attach a `.txt` file."
    );
  }

  if (
    items.length > 5000
  ) {
    return message.channel.send(
      "❌ Maximum 5000 stock items."
    );
  }

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
  }

  saveData();

  return message.channel.send(
    `✅ Added **${items.length}** stock item(s).\n📦 Current stock: **${data.stock.length}**`
  );
}

// ============================================================
// !STOCK
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

  refreshData();

  return message.channel.send(
    `📦 Novi stock: **${data.stock.length}**`
  );
}

// ============================================================
// !CLEARSTOCK
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

  refreshData();

  const count =
    data.stock.length;

  data.stock = [];

  saveData();

  return message.channel.send(
    `🗑️ Cleared **${count}** stock item(s).`
  );
}

// ============================================================
// !HELP
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
    "======================================"
  );

  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `🌐 Novi running on port ${PORT}`
      );
    }
  );
}

start();
