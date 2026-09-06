require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STOCK_FILE = path.join(__dirname, "stock-data.json");
const KEY_FILE = path.join(__dirname, "keys.json");

const TOKEN = process.env.DISCORD_TOKEN;

const ADMIN_IDS = String(process.env.DISCORD_ADMIN_IDS || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

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

    const raw = fs.readFileSync(file, "utf8").trim();

    if (!raw) return fallback;

    const parsed = JSON.parse(raw);

    return parsed;
  } catch (error) {
    console.error(
      `[Novi] Failed reading ${path.basename(file)}:`,
      error.message
    );

    return fallback;
  }
}

function writeJson(file, data) {
  const temp = `${file}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(temp, file);
}

ensureFile(STOCK_FILE, []);
ensureFile(KEY_FILE, []);

function isAdmin(message) {
  if (ADMIN_IDS.length === 0) {
    return true;
  }

  return ADMIN_IDS.includes(message.author.id);
}

/*
  Stock is restricted to non-sensitive inventory codes.
*/
function cleanStockValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  /*
    Reject email:password-style account credentials.
  */
  if (/^[^@\s:]+@[^@\s:]+:[^\s]+$/.test(text)) {
    return null;
  }

  return text;
}

function normalizeStock(stock) {
  if (!Array.isArray(stock)) {
    return [];
  }

  return stock
    .map(item => {
      if (typeof item === "string") {
        const value = cleanStockValue(item);

        if (!value) return null;

        return {
          id: crypto.randomUUID(),
          stock_id: value,
          created_at: Date.now()
        };
      }

      if (item && typeof item === "object") {
        const value = cleanStockValue(
          item.stock_id ??
          item.stockId ??
          item.value ??
          item.code
        );

        if (!value) return null;

        return {
          id:
            item.id ??
            crypto.randomUUID(),

          stock_id: value,

          created_at:
            item.created_at ??
            item.createdAt ??
            Date.now()
        };
      }

      return null;
    })
    .filter(Boolean);
}

function getStock() {
  const raw = readJson(
    STOCK_FILE,
    []
  );

  const stock = normalizeStock(raw);

  /*
    Keep the file in the exact format
    Novi expects.
  */
  if (
    JSON.stringify(raw) !==
    JSON.stringify(stock)
  ) {
    writeJson(
      STOCK_FILE,
      stock
    );
  }

  return stock;
}

function addStock(values) {
  const stock = getStock();

  const existing = new Set(
    stock.map(item =>
      String(item.stock_id)
        .trim()
        .toLowerCase()
    )
  );

  let added = 0;
  let duplicate = 0;
  let invalid = 0;

  for (const raw of values) {
    const value = cleanStockValue(raw);

    if (!value) {
      invalid++;
      continue;
    }

    const key = value.toLowerCase();

    if (existing.has(key)) {
      duplicate++;
      continue;
    }

    stock.push({
      id: crypto.randomUUID(),
      stock_id: value,
      created_at: Date.now()
    });

    existing.add(key);
    added++;
  }

  writeJson(
    STOCK_FILE,
    stock
  );

  console.log(
    `[Novi] Stock updated | Added: ${added} | Duplicate: ${duplicate} | Invalid: ${invalid} | Total: ${stock.length}`
  );

  return {
    added,
    duplicate,
    invalid,
    total: stock.length
  };
}

function generateKey() {
  return `NOVI-${crypto
    .randomBytes(12)
    .toString("hex")
    .toUpperCase()}`;
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

  const match = value.match(
    /^(\d+)(d|w|mo)$/
  );

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);

  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }

  let days;

  switch (match[2]) {
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
    expiresAt:
      new Date(
        Date.now() +
        days * 86400000
      ).toISOString()
  };
}

function generateKeys(amount, duration) {
  const parsed =
    parseDuration(duration);

  if (!parsed) {
    return null;
  }

  const keys =
    readJson(
      KEY_FILE,
      []
    );

  const generated = [];

  for (
    let i = 0;
    i < amount;
    i++
  ) {
    const key =
      generateKey();

    keys.push({
      id: crypto.randomUUID(),
      key,
      duration:
        parsed.days === null
          ? "lifetime"
          : parsed.days,
      created_at:
        new Date().toISOString(),
      expires_at:
        parsed.expiresAt
    });

    generated.push(key);
  }

  writeJson(
    KEY_FILE,
    keys
  );

  return {
    keys: generated,
    duration: parsed.label
  };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once(
  "ready",
  () => {
    console.log(
      "======================================"
    );
    console.log(
      "       NOVI DISCORD BOT ONLINE"
    );
    console.log(
      "======================================"
    );
    console.log(
      `Logged in as: ${client.user.tag}`
    );
    console.log(
      "======================================"
    );
  }
);

client.on(
  "messageCreate",
  async message => {
    try {
      if (message.author.bot) {
        return;
      }

      if (!message.content.startsWith("!")) {
        return;
      }

      if (!isAdmin(message)) {
        return message.reply(
          "❌ You don't have permission to use this command."
        );
      }

      const args =
        message.content
          .trim()
          .split(/\s+/);

      const command =
        args.shift().toLowerCase();

      /*
        !ADD
      */

      if (command === "!add") {

        /*
          !add CODE
        */

        if (args.length > 0) {

          const value =
            args.join(" ").trim();

          const result =
            addStock([value]);

          if (result.added === 0) {

            if (result.duplicate > 0) {
              return message.reply(
                `⚠️ \`${value}\` is already in stock.`
              );
            }

            return message.reply(
              "❌ That isn't a valid non-sensitive stock code."
            );
          }

          return message.reply(
            `✅ **Stock added**\n\n` +
            `Code: \`${value}\`\n` +
            `📦 Total stock: **${result.total}**`
          );
        }

        /*
          !add + TXT attachment
        */

        const attachment =
          message.attachments.first();

        if (!attachment) {
          return message.reply(
            "❌ Use `!add CODE` or attach a `.txt` file."
          );
        }

        const filename =
          String(
            attachment.name || ""
          ).toLowerCase();

        if (!filename.endsWith(".txt")) {
          return message.reply(
            "❌ The file must be a `.txt` file."
          );
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

          const values =
            text
              .split(/\r?\n/)
              .map(x => x.trim())
              .filter(Boolean);

          if (!values.length) {
            return message.reply(
              "❌ The TXT file is empty."
            );
          }

          const result =
            addStock(values);

          return message.reply(
            `✅ **Stock imported**\n\n` +
            `Added: **${result.added}**\n` +
            `Duplicates: **${result.duplicate}**\n` +
            `Invalid: **${result.invalid}**\n` +
            `📦 Total: **${result.total}**`
          );

        } catch (error) {

          console.error(
            "[Novi] TXT import error:",
            error
          );

          return message.reply(
            "❌ Failed to import the TXT file."
          );
        }
      }

      /*
        !STOCK
      */

      if (command === "!stock") {

        const stock =
          getStock();

        return message.reply(
          `📦 **NOVI STOCK**\n\n` +
          `Available: **${stock.length}**`
        );
      }

      /*
        !CLEARSTOCK
      */

      if (command === "!clearstock") {

        const stock =
          getStock();

        const amount =
          stock.length;

        writeJson(
          STOCK_FILE,
          []
        );

        return message.reply(
          `🗑️ Cleared **${amount}** stock item(s).`
        );
      }

      /*
        !GEN
      */

      if (command === "!gen") {

        if (!args.length) {
          return message.reply(
            "❌ Usage: `!gen 1d` or `!gen 5 1d`"
          );
        }

        let amount = 1;
        let duration;

        if (args.length === 1) {
          duration = args[0];
        } else {
          amount =
            Number(args[0]);

          duration =
            args[1];
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

        const result =
          generateKeys(
            amount,
            duration
          );

        if (!result) {
          return message.reply(
            "❌ Invalid duration. Use `1d`, `3d`, `1w`, `1mo`, or `lifetime`."
          );
        }

        if (
          result.keys.length === 1
        ) {
          return message.reply(
            `✅ **Generated ${result.duration} key**\n\n` +
            `\`${result.keys[0]}\``
          );
        }

        const output =
          result.keys
            .map(key => `\`${key}\``)
            .join("\n");

        if (output.length > 1800) {

          const file =
            Buffer.from(
              result.keys.join("\n"),
              "utf8"
            );

          return message.reply({
            content:
              `✅ Generated **${result.keys.length} ${result.duration} keys**.`,
            files: [
              new AttachmentBuilder(
                file,
                {
                  name: "novi-keys.txt"
                }
              )
            ]
          });
        }

        return message.reply(
          `✅ **Generated ${result.keys.length} ${result.duration} keys**\n\n${output}`
        );
      }

      /*
        !HELP
      */

      if (command === "!help") {

        return message.reply(
          "```text\n" +
          "NOVI COMMANDS\n" +
          "────────────────────\n" +
          "!add CODE\n" +
          "!add + TXT\n" +
          "!stock\n" +
          "!clearstock\n" +
          "!gen 1d\n" +
          "!gen 5 1d\n" +
          "!gen 1w\n" +
          "!gen lifetime\n" +
          "!help\n" +
          "```"
        );
      }

    } catch (error) {

      console.error(
        "[Novi] Discord command error:",
        error
      );

      try {
        await message.reply(
          "❌ An error occurred."
        );
      } catch {}
    }
  }
);

client.on(
  "error",
  error => {
    console.error(
      "[Novi] Discord error:",
      error
    );
  }
);

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "[Novi] Unhandled rejection:",
      error
    );
  }
);

if (!TOKEN) {

  console.error(
    "❌ DISCORD_TOKEN is missing."
  );

  process.exit(1);
}

client.login(TOKEN).catch(
  error => {
    console.error(
      "❌ Discord login failed:",
      error
    );

    process.exit(1);
  }
);
