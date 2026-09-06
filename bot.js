require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ============================================================
// CONFIG
// ============================================================

const KEY_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "stock-data.json");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// Optional: put Discord user IDs here separated by commas
// Example: DISCORD_ADMIN_IDS=123456789,987654321
const ADMIN_IDS = String(process.env.DISCORD_ADMIN_IDS || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

// ============================================================
// FILE HELPERS
// ============================================================

function ensureFile(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      JSON.stringify(fallback, null, 2),
      "utf8"
    );
  }
}

function readJson(file, fallback) {
  try {
    ensureFile(file, fallback);

    const data = fs.readFileSync(file, "utf8").trim();

    if (!data) return fallback;

    const parsed = JSON.parse(data);

    return parsed;
  } catch (err) {
    console.error(`Failed reading ${path.basename(file)}:`, err);
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

ensureFile(KEY_FILE, []);
ensureFile(STOCK_FILE, []);

// ============================================================
// ADMIN CHECK
// ============================================================

function isAdmin(message) {
  // If DISCORD_ADMIN_IDS is configured, enforce it.
  if (ADMIN_IDS.length > 0) {
    return ADMIN_IDS.includes(message.author.id);
  }

  // If no IDs are configured, allow commands.
  // You can lock this down later with DISCORD_ADMIN_IDS.
  return true;
}

// ============================================================
// KEY GENERATOR
// ============================================================

function generateKey() {
  return `NOVI-${crypto
    .randomBytes(12)
    .toString("hex")
    .toUpperCase()}`;
}

function getNextId(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return 1;
  }

  let highest = 0;

  for (const item of items) {
    const id = Number(item?.id);

    if (Number.isFinite(id) && id > highest) {
      highest = id;
    }
  }

  return highest + 1;
}

// ============================================================
// DURATION PARSER
// ============================================================

function parseDuration(input) {
  const value = String(input || "").toLowerCase().trim();

  if (value === "lifetime") {
    return {
      name: "Lifetime",
      days: null,
      expiresAt: null
    };
  }

  const match = value.match(/^(\d+)(d|w|mo)$/);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2];

  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  let days;

  if (unit === "d") {
    days = amount;
  } else if (unit === "w") {
    days = amount * 7;
  } else if (unit === "mo") {
    days = amount * 30;
  }

  const expiresAt = new Date(
    Date.now() + days * 86400000
  ).toISOString();

  return {
    name: value,
    days,
    expiresAt
  };
}

// ============================================================
// GENERATE KEYS
// ============================================================

function generateKeys(amount, duration) {
  const parsedDuration = parseDuration(duration);

  if (!parsedDuration) {
    return {
      error: "Invalid duration"
    };
  }

  const keys = readJson(KEY_FILE, []);

  const generated = [];

  for (let i = 0; i < amount; i++) {
    const key = generateKey();

    const record = {
      id: getNextId(keys),
      key,
      duration:
        parsedDuration.days === null
          ? "lifetime"
          : parsedDuration.days,
      created_at: new Date().toISOString(),
      expires_at: parsedDuration.expiresAt
    };

    keys.push(record);
    generated.push(key);
  }

  writeJson(KEY_FILE, keys);

  return {
    keys: generated,
    duration: parsedDuration.name
  };
}

// ============================================================
// STOCK CLEANING
// ============================================================

function cleanStockValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).trim();

  if (!cleaned) {
    return null;
  }

  // Don't allow credential-style email:password data.
  if (/^[^@\s:]+@[^@\s:]+:[^\s]+$/.test(cleaned)) {
    return null;
  }

  return cleaned;
}

// ============================================================
// ADD STOCK
// ============================================================

function addStock(values) {
  const stock = readJson(STOCK_FILE, []);

  let added = 0;

  for (const value of values) {
    const cleaned = cleanStockValue(value);

    if (!cleaned) {
      continue;
    }

    // Don't duplicate an existing stock ID.
    const exists = stock.some(
      item => String(item.stock_id) === cleaned
    );

    if (exists) {
      continue;
    }

    stock.push({
      id: getNextId(stock),
      stock_id: cleaned,
      created_at: new Date().toISOString()
    });

    added++;
  }

  writeJson(STOCK_FILE, stock);

  return added;
}

// ============================================================
// DISCORD CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ============================================================
// READY
// ============================================================

client.once("ready", () => {
  console.log("======================================");
  console.log("       NOVI DISCORD BOT ONLINE");
  console.log("======================================");
  console.log(`Logged in as: ${client.user.tag}`);
  console.log("Commands: !gen !add !stock !clearstock !help");
  console.log("======================================");
});

// ============================================================
// COMMANDS
// ============================================================

client.on("messageCreate", async message => {
  try {
    if (message.author.bot) return;

    if (!message.content.startsWith("!")) {
      return;
    }

    const args = message.content.trim().split(/\s+/);

    const command = args.shift().toLowerCase();

    // ========================================================
    // HELP
    // ========================================================

    if (command === "!help") {
      return message.reply(
        "```text\n" +
        "NOVI COMMANDS\n" +
        "────────────────────────\n" +
        "!gen 1d        Generate 1 day key\n" +
        "!gen 3d        Generate 3 day key\n" +
        "!gen 1w        Generate 1 week key\n" +
        "!gen 1mo       Generate 1 month key\n" +
        "!gen lifetime  Generate lifetime key\n" +
        "\n" +
        "!gen 5 1d      Generate 5 one-day keys\n" +
        "!gen 5 3d      Generate 5 three-day keys\n" +
        "!gen 5 1w      Generate 5 one-week keys\n" +
        "!gen 5 1mo     Generate 5 one-month keys\n" +
        "!gen 5 lifetime Generate 5 lifetime keys\n" +
        "\n" +
        "!add ITEM-123  Add stock\n" +
        "!add + TXT     Import TXT attachment\n" +
        "!stock         Check stock\n" +
        "!clearstock    Clear all stock\n" +
        "!help          Show commands\n" +
        "```"
      );
    }

    // Everything below this point is admin-only.
    if (!isAdmin(message)) {
      return message.reply("❌ You don't have permission to use Novi commands.");
    }

    // ========================================================
    // GENERATE
    // ========================================================

    if (command === "!gen") {
      if (args.length === 0) {
        return message.reply(
          "❌ Usage: `!gen 1d`, `!gen 3d`, `!gen 1w`, `!gen 1mo`, `!gen lifetime`"
        );
      }

      let amount = 1;
      let duration;

      if (args.length === 1) {
        duration = args[0];
      } else {
        amount = Number(args[0]);
        duration = args[1];
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

      const parsed = parseDuration(duration);

      if (!parsed) {
        return message.reply(
          "❌ Invalid duration.\nUse: `1d`, `3d`, `1w`, `1mo`, or `lifetime`."
        );
      }

      const result = generateKeys(amount, duration);

      if (result.error) {
        return message.reply("❌ Failed to generate keys.");
      }

      // One key
      if (result.keys.length === 1) {
        return message.reply(
          `✅ **Generated ${parsed.name} key**\n\n` +
          `\`${result.keys[0]}\``
        );
      }

      // Multiple keys
      const text = result.keys
        .map(key => `\`${key}\``)
        .join("\n");

      // Discord message limit protection
      if (text.length > 1800) {
        const buffer = Buffer.from(
          result.keys.join("\n"),
          "utf8"
        );

        const attachment = new AttachmentBuilder(buffer, {
          name: "novi-keys.txt"
        });

        return message.reply({
          content:
            `✅ Generated **${result.keys.length} ${parsed.name} keys**.`,
          files: [attachment]
        });
      }

      return message.reply(
        `✅ **Generated ${result.keys.length} ${parsed.name} keys**\n\n${text}`
      );
    }

    // ========================================================
    // ADD STOCK
    // ========================================================

    if (command === "!add") {
      // !add ITEM-123
      if (args.length > 0) {
        const value = args.join(" ");

        const cleaned = cleanStockValue(value);

        if (!cleaned) {
          return message.reply(
            "❌ Invalid stock ID."
          );
        }

        const added = addStock([cleaned]);

        if (added === 0) {
          return message.reply(
            "⚠️ That stock ID already exists or is invalid."
          );
        }

        return message.reply(
          `✅ Added stock: \`${cleaned}\``
        );
      }

      // !add + TXT attachment
      const attachment = message.attachments.first();

      if (!attachment) {
        return message.reply(
          "❌ Usage:\n`!add ITEM-123`\n\nOr attach a `.txt` file with `!add`."
        );
      }

      if (
        !attachment.name.toLowerCase().endsWith(".txt")
      ) {
        return message.reply(
          "❌ Please attach a `.txt` file."
        );
      }

      try {
        const response = await fetch(attachment.url);

        if (!response.ok) {
          return message.reply(
            "❌ Failed to download the TXT file."
          );
        }

        const text = await response.text();

        const values = text
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean);

        if (!values.length) {
          return message.reply(
            "❌ The TXT file is empty."
          );
        }

        const added = addStock(values);

        return message.reply(
          `✅ Imported **${added}** stock item(s).`
        );
      } catch (err) {
        console.error("TXT import error:", err);

        return message.reply(
          "❌ Failed to import the TXT file."
        );
      }
    }

    // ========================================================
    // STOCK
    // ========================================================

    if (command === "!stock") {
      const stock = readJson(STOCK_FILE, []);

      return message.reply(
        `📦 **Novi Stock**\n\n` +
        `Available: **${stock.length}**`
      );
    }

    // ========================================================
    // CLEAR STOCK
    // ========================================================

    if (command === "!clearstock") {
      const stock = readJson(STOCK_FILE, []);

      const oldCount = stock.length;

      writeJson(STOCK_FILE, []);

      return message.reply(
        `🗑️ Cleared **${oldCount}** stock item(s).`
      );
    }
  } catch (err) {
    console.error("Discord command error:", err);

    try {
      await message.reply(
        "❌ Something went wrong while processing that command."
      );
    } catch {}
  }
});

// ============================================================
// DISCORD ERRORS
// ============================================================

client.on("error", error => {
  console.error("Discord error:", error);
});

client.on("shardError", error => {
  console.error("Discord shard error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

// ============================================================
// LOGIN
// ============================================================

if (!DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing from Render.");
  process.exit(1);
}

client.login(DISCORD_TOKEN).catch(error => {
  console.error("❌ Discord login failed:");
  console.error(error);
  process.exit(1);
});
