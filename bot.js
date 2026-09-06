require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ============================================================
// CONFIG
// ============================================================

const KEY_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "stock-data.json");

const TOKEN = process.env.DISCORD_TOKEN;

// Optional admin IDs.
// If empty, commands work for everyone.
// Example:
// DISCORD_ADMIN_IDS=123456789012345678,987654321098765432
const ADMIN_IDS = String(process.env.DISCORD_ADMIN_IDS || "")
  .split(",")
  .map(id => id.trim())
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

    const text = fs.readFileSync(file, "utf8").trim();

    if (!text) {
      return fallback;
    }

    return JSON.parse(text);
  } catch (error) {
    console.error(
      `Failed reading ${path.basename(file)}:`,
      error.message
    );

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
// ID HELPER
// ============================================================

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
// ADMIN
// ============================================================

function isAdmin(message) {
  if (ADMIN_IDS.length === 0) {
    return true;
  }

  return ADMIN_IDS.includes(message.author.id);
}

// ============================================================
// STOCK
// ============================================================

function cleanStockValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const valueString = String(value).trim();

  if (!valueString) {
    return null;
  }

  // Allow normal stock IDs:
  // ITEM-123
  // ABC123
  // FORTNITE-001
  // etc.
  return valueString;
}

function addStock(values) {
  const stock = readJson(STOCK_FILE, []);

  let added = 0;
  let duplicate = 0;

  for (const rawValue of values) {
    const value = cleanStockValue(rawValue);

    if (!value) {
      continue;
    }

    const alreadyExists = stock.some(
      item =>
        String(item.stock_id).trim().toLowerCase() ===
        value.toLowerCase()
    );

    if (alreadyExists) {
      duplicate++;
      continue;
    }

    stock.push({
      id: getNextId(stock),
      stock_id: value,
      created_at: new Date().toISOString()
    });

    added++;
  }

  writeJson(STOCK_FILE, stock);

  return {
    added,
    duplicate,
    total: stock.length
  };
}

// ============================================================
// KEY GENERATOR
// ============================================================

function generateKey() {
  const random = require("crypto")
    .randomBytes(12)
    .toString("hex")
    .toUpperCase();

  return `NOVI-${random}`;
}

function parseDuration(input) {
  const value = String(input || "")
    .trim()
    .toLowerCase();

  if (value === "lifetime") {
    return {
      label: "Lifetime",
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

  switch (unit) {
    case "d":
      days = amount;
      break;

    case "w":
      days = amount * 7;
      break;

    case "mo":
      days = amount * 30;
      break;

    default:
      return null;
  }

  return {
    label: value,
    days,
    expiresAt: new Date(
      Date.now() + days * 86400000
    ).toISOString()
  };
}

function generateKeys(amount, duration) {
  const parsed = parseDuration(duration);

  if (!parsed) {
    return null;
  }

  const keys = readJson(KEY_FILE, []);

  const generated = [];

  for (let i = 0; i < amount; i++) {
    const key = generateKey();

    keys.push({
      id: getNextId(keys),
      key,
      duration:
        parsed.days === null
          ? "lifetime"
          : parsed.days,
      created_at: new Date().toISOString(),
      expires_at: parsed.expiresAt
    });

    generated.push(key);
  }

  writeJson(KEY_FILE, keys);

  return {
    keys: generated,
    duration: parsed.label
  };
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
  console.log("======================================");
});

// ============================================================
// MESSAGE COMMANDS
// ============================================================

client.on("messageCreate", async message => {
  try {
    if (message.author.bot) {
      return;
    }

    if (!message.content) {
      return;
    }

    if (!message.content.startsWith("!")) {
      return;
    }

    const args = message.content
      .trim()
      .split(/\s+/);

    const command = args.shift().toLowerCase();

    // ========================================================
    // HELP
    // ========================================================

    if (command === "!help") {
      return message.reply(
        "```text\n" +
        "NOVI COMMANDS\n" +
        "────────────────────────────\n" +
        "!gen 1d         Generate 1 day key\n" +
        "!gen 3d         Generate 3 day key\n" +
        "!gen 1w         Generate 1 week key\n" +
        "!gen 1mo        Generate 1 month key\n" +
        "!gen lifetime   Generate lifetime key\n" +
        "\n" +
        "!gen 5 1d       Generate 5 one-day keys\n" +
        "!gen 5 3d       Generate 5 three-day keys\n" +
        "!gen 5 1w       Generate 5 one-week keys\n" +
        "!gen 5 1mo      Generate 5 one-month keys\n" +
        "!gen 5 lifetime  Generate 5 lifetime keys\n" +
        "\n" +
        "!add ITEM-123   Add one stock ID\n" +
        "!add + TXT      Import TXT stock\n" +
        "!stock          Check stock\n" +
        "!clearstock     Clear all stock\n" +
        "!help           Show commands\n" +
        "```"
      );
    }

    // ========================================================
    // ADMIN CHECK
    // ========================================================

    if (!isAdmin(message)) {
      return message.reply(
        "❌ You don't have permission to use this command."
      );
    }

    // ========================================================
    // !GEN
    // ========================================================

    if (command === "!gen") {
      if (args.length === 0) {
        return message.reply(
          "❌ Usage: `!gen 1d` or `!gen 5 1d`"
        );
      }

      let amount = 1;
      let duration;

      // !gen 1d
      if (args.length === 1) {
        duration = args[0];
      }

      // !gen 5 1d
      else {
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

      const result = generateKeys(
        amount,
        duration
      );

      if (!result) {
        return message.reply(
          "❌ Invalid duration.\n\nUse:\n`1d` • `3d` • `1w` • `1mo` • `lifetime`"
        );
      }

      // One key
      if (result.keys.length === 1) {
        return message.reply(
          `✅ **Generated ${result.duration} key**\n\n` +
          `\`${result.keys[0]}\``
        );
      }

      // Multiple keys
      const output = result.keys
        .map(key => `\`${key}\``)
        .join("\n");

      // If Discord message would be too large,
      // send a TXT file instead.
      if (output.length > 1800) {
        const file = Buffer.from(
          result.keys.join("\n"),
          "utf8"
        );

        const attachment = new AttachmentBuilder(
          file,
          {
            name: "novi-keys.txt"
          }
        );

        return message.reply({
          content:
            `✅ Generated **${result.keys.length} ${result.duration} keys**.`,
          files: [attachment]
        });
      }

      return message.reply(
        `✅ **Generated ${result.keys.length} ${result.duration} keys**\n\n${output}`
      );
    }

    // ========================================================
    // !ADD
    // ========================================================

    if (command === "!add") {

      // ------------------------------------------------------
      // !add ITEM-123
      // ------------------------------------------------------

      if (args.length > 0) {
        const value = args.join(" ").trim();

        if (!value) {
          return message.reply(
            "❌ Invalid stock ID."
          );
        }

        const result = addStock([value]);

        if (result.added === 0) {
          if (result.duplicate > 0) {
            return message.reply(
              `⚠️ \`${value}\` is already in stock.`
            );
          }

          return message.reply(
            "❌ Could not add that stock ID."
          );
        }

        return message.reply(
          `✅ Added stock:\n\`${value}\`\n\n📦 Stock: **${result.total}**`
        );
      }

      // ------------------------------------------------------
      // !add + TXT ATTACHMENT
      // ------------------------------------------------------

      const attachment =
        message.attachments.first();

      if (!attachment) {
        return message.reply(
          "❌ Use `!add ITEM-123` or attach a `.txt` file to `!add`."
        );
      }

      const filename =
        String(attachment.name || "")
          .toLowerCase();

      if (!filename.endsWith(".txt")) {
        return message.reply(
          "❌ The attached file must be a `.txt` file."
        );
      }

      try {
        const response = await fetch(
          attachment.url
        );

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status}`
          );
        }

        const text = await response.text();

        const values = text
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean);

        if (values.length === 0) {
          return message.reply(
            "❌ The TXT file is empty."
          );
        }

        const result = addStock(values);

        return message.reply(
          `✅ **TXT imported successfully!**\n\n` +
          `Added: **${result.added}**\n` +
          `Duplicates: **${result.duplicate}**\n` +
          `Total stock: **${result.total}**`
        );

      } catch (error) {
        console.error(
          "TXT import error:",
          error
        );

        return message.reply(
          "❌ Failed to read the TXT file."
        );
      }
    }

    // ========================================================
    // !STOCK
    // ========================================================

    if (command === "!stock") {
      const stock = readJson(
        STOCK_FILE,
        []
      );

      return message.reply(
        `📦 **NOVI STOCK**\n\n` +
        `Available: **${stock.length}**`
      );
    }

    // ========================================================
    // !CLEARSTOCK
    // ========================================================

    if (command === "!clearstock") {
      const stock = readJson(
        STOCK_FILE,
        []
      );

      const amount = stock.length;

      writeJson(
        STOCK_FILE,
        []
      );

      return message.reply(
        `🗑️ Cleared **${amount}** stock item(s).`
      );
    }

  } catch (error) {
    console.error(
      "Discord command error:",
      error
    );

    try {
      await message.reply(
        "❌ An error occurred while processing the command."
      );
    } catch {}
  }
});

// ============================================================
// ERRORS
// ============================================================

client.on("error", error => {
  console.error(
    "Discord client error:",
    error
  );
});

client.on("shardError", error => {
  console.error(
    "Discord shard error:",
    error
  );
});

process.on("unhandledRejection", error => {
  console.error(
    "Unhandled rejection:",
    error
  );
});

// ============================================================
// LOGIN
// ============================================================

if (!TOKEN) {
  console.error(
    "❌ DISCORD_TOKEN is missing from Render Environment Variables."
  );

  process.exit(1);
}

client.login(TOKEN).catch(error => {
  console.error(
    "❌ Discord login failed:"
  );

  console.error(error);
});
