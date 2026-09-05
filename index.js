const express = require("express");
const axios = require("axios");
const {
  Client,
  GatewayIntentBits,
  Partials
} = require("discord.js");

const app = express();

const PORT = process.env.PORT || 10000;
const API_URL = `http://127.0.0.1:${PORT}`;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOVI_ADMIN_SECRET = process.env.NOVI_ADMIN_SECRET;

// Your allowed Discord roles
const ALLOWED_ROLE_IDS = [
  "1529705570209366167",
  "1378500563456626719"
];

// --------------------------------------------------
// EXPRESS SERVER
// --------------------------------------------------

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "online",
    service: "Novi"
  });
});

app.get("/api/discord-status", (req, res) => {
  res.json({
    success: true,
    discord: client.isReady() ? "ready" : "connecting",
    bot: client.user
      ? {
          id: client.user.id,
          tag: client.user.tag
        }
      : null
  });
});

// --------------------------------------------------
// START EXPRESS FIRST
// --------------------------------------------------

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("========================================");
  console.log("          NOVI SERVER IS ONLINE");
  console.log("========================================");
  console.log(`Port: ${PORT}`);
  console.log(`API: ${API_URL}`);
  console.log("Health: /health");
  console.log("========================================");
  console.log("");
});

// --------------------------------------------------
// DISCORD CLIENT
// --------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Channel,
    Partials.Message
  ]
});

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function hasPermission(member) {
  if (!member || !member.roles) {
    return false;
  }

  return ALLOWED_ROLE_IDS.some((roleId) =>
    member.roles.cache.has(roleId)
  );
}

function getDurationInfo(input) {
  const value = String(input || "")
    .trim()
    .toLowerCase();

  const durations = {
    "1d": {
      duration: "1d",
      name: "1 Day"
    },

    "3d": {
      duration: "3d",
      name: "3 Days"
    },

    "1week": {
      duration: "1week",
      name: "1 Week"
    },

    "1w": {
      duration: "1week",
      name: "1 Week"
    },

    "1month": {
      duration: "1month",
      name: "1 Month"
    },

    "1mo": {
      duration: "1month",
      name: "1 Month"
    },

    "lifetime": {
      duration: "lifetime",
      name: "Lifetime"
    },

    "life": {
      duration: "lifetime",
      name: "Lifetime"
    }
  };

  return durations[value] || null;
}

function cleanItem(item) {
  return String(item || "")
    .replace(/\r/g, "")
    .trim();
}

// --------------------------------------------------
// DISCORD READY
// --------------------------------------------------

client.once("ready", () => {
  console.log("");
  console.log("========================================");
  console.log("       DISCORD BOT IS CONNECTED");
  console.log("========================================");
  console.log(`Bot: ${client.user.tag}`);
  console.log(`Bot ID: ${client.user.id}`);
  console.log(`Servers: ${client.guilds.cache.size}`);
  console.log("Commands: !gen / !add");
  console.log("========================================");
  console.log("");
});

// --------------------------------------------------
// DISCORD ERRORS
// --------------------------------------------------

client.on("error", (error) => {
  console.error("[DISCORD ERROR]", error);
});

client.on("warn", (warning) => {
  console.warn("[DISCORD WARNING]", warning);
});

client.on("shardError", (error) => {
  console.error("[DISCORD SHARD ERROR]", error);
});

// --------------------------------------------------
// MESSAGE HANDLER
// --------------------------------------------------

client.on("messageCreate", async (message) => {
  try {
    // Ignore bots
    if (message.author.bot) {
      return;
    }

    const content = message.content.trim();

    // Ignore messages that aren't commands
    if (!content.startsWith("!")) {
      return;
    }

    console.log("");
    console.log("========================================");
    console.log("[MESSAGE RECEIVED]");
    console.log(`User: ${message.author.tag}`);
    console.log(`User ID: ${message.author.id}`);
    console.log(`Channel: ${message.channel?.name || "unknown"}`);
    console.log(`Message: ${content}`);
    console.log("========================================");

    const args = content.split(/\s+/);
    const command = args[0].toLowerCase();

    // ------------------------------------------------
    // PERMISSION CHECK
    // ------------------------------------------------

    if (command === "!gen" || command === "!add") {
      if (!message.guild) {
        await message.reply("❌ This command can only be used inside the Novi server.");
        return;
      }

      console.log("[PERMISSION] Checking roles...");

      const member = message.member;

      const userRoles = member.roles.cache.map((role) => ({
        id: role.id,
        name: role.name
      }));

      console.log("[PERMISSION] User roles:", userRoles);

      const allowed = hasPermission(member);

      console.log(`[PERMISSION] Allowed: ${allowed}`);

      if (!allowed) {
        await message.reply(
          "❌ You do not have permission to use this command."
        );
        return;
      }
    }

    // ------------------------------------------------
    // !GEN
    // ------------------------------------------------

    if (command === "!gen") {
      const requestedDuration = args[1];

      if (!requestedDuration) {
        await message.reply(
          [
            "❌ Please specify a key duration.",
            "",
            "Available:",
            "`!gen 1d`",
            "`!gen 3d`",
            "`!gen 1week`",
            "`!gen 1month`",
            "`!gen lifetime`"
          ].join("\n")
        );
        return;
      }

      const durationInfo = getDurationInfo(requestedDuration);

      if (!durationInfo) {
        await message.reply(
          [
            "❌ Invalid duration.",
            "",
            "Use:",
            "`1d`",
            "`3d`",
            "`1week`",
            "`1month`",
            "`lifetime`"
          ].join("\n")
        );
        return;
      }

      console.log(
        `[GEN] Generating ${durationInfo.duration} key for ${message.author.tag}`
      );

      if (!NOVI_ADMIN_SECRET) {
        console.error("[GEN] NOVI_ADMIN_SECRET is missing.");
        await message.reply(
          "❌ Novi admin authentication is not configured."
        );
        return;
      }

      try {
        const response = await axios.post(
          `${API_URL}/api/keys`,
          {
            duration: durationInfo.duration
          },
          {
            headers: {
              "x-novi-admin-secret": NOVI_ADMIN_SECRET,
              "Content-Type": "application/json"
            },
            timeout: 10000,
            validateStatus: () => true
          }
        );

        console.log(`[GEN] API status: ${response.status}`);
        console.log("[GEN] API response:", response.data);

        if (response.status !== 200 && response.status !== 201) {
          const errorMessage =
            response.data?.error ||
            response.data?.message ||
            "Unknown API error.";

          await message.reply(
            `❌ Failed to generate key.\nAPI: ${errorMessage}`
          );

          return;
        }

        const key = response.data?.key;

        if (!key) {
          console.error("[GEN] API returned no key.");
          await message.reply(
            "❌ The API generated a response but did not return a key."
          );
          return;
        }

        const expiresAt = response.data?.expiresAt;

        let expiryText = "Lifetime";

        if (expiresAt) {
          const date = new Date(expiresAt);

          if (!Number.isNaN(date.getTime())) {
            expiryText = `<t:${Math.floor(
              date.getTime() / 1000
            )}:F>`;
          }
        }

        await message.reply(
          [
            "## 🔑 Novi Key Generated",
            "",
            `**Key:** \`${key}\``,
            `**Duration:** ${durationInfo.name}`,
            `**Expires:** ${expiryText}`,
            "",
            "Keep this key private."
          ].join("\n")
        );

        console.log(`[GEN] Successfully generated key: ${key}`);
      } catch (error) {
        console.error("[GEN] Request failed:", error.message);

        await message.reply(
          "❌ Could not connect to the Novi API."
        );
      }

      return;
    }

    // ------------------------------------------------
    // !ADD
    // ------------------------------------------------

    if (command === "!add") {
      let items = [];

      // ----------------------------------------------
      // !add ITEM
      // ----------------------------------------------

      if (args.length > 1) {
        const typedItems = content
          .slice(command.length)
          .trim();

        if (typedItems) {
          // Allow multiple items separated by new lines
          const splitItems = typedItems
            .split(/\r?\n/)
            .map(cleanItem)
            .filter(Boolean);

          if (splitItems.length > 0) {
            items.push(...splitItems);
          }
        }
      }

      // ----------------------------------------------
      // !add WITH TXT ATTACHMENT
      // ----------------------------------------------

      const attachment = message.attachments.first();

      if (attachment) {
        const fileName = String(attachment.name || "").toLowerCase();

        console.log(`[ADD] Attachment: ${attachment.name}`);
        console.log(`[ADD] URL: ${attachment.url}`);

        if (!fileName.endsWith(".txt")) {
          await message.reply(
            "❌ The attached file must be a `.txt` file."
          );
          return;
        }

        try {
          const response = await axios.get(
            attachment.url,
            {
              responseType: "text",
              timeout: 20000,
              maxContentLength: 10 * 1024 * 1024,
              maxBodyLength: 10 * 1024 * 1024
            }
          );

          const fileItems = String(response.data || "")
            .split(/\r?\n/)
            .map(cleanItem)
            .filter(Boolean);

          items.push(...fileItems);

          console.log(
            `[ADD] Loaded ${fileItems.length} items from attachment.`
          );
        } catch (error) {
          console.error(
            "[ADD] Failed to download attachment:",
            error.message
          );

          await message.reply(
            "❌ I couldn't read the attached `.txt` file."
          );

          return;
        }
      }

      // ----------------------------------------------
      // NOTHING PROVIDED
      // ----------------------------------------------

      if (items.length === 0) {
        await message.reply(
          [
            "❌ Nothing to add.",
            "",
            "Use:",
            "`!add ITEM`",
            "",
            "or attach a `.txt` file and send:",
            "`!add`"
          ].join("\n")
        );

        return;
      }

      // Remove duplicates inside this request
      items = [...new Set(items)];

      console.log(`[ADD] Items to add: ${items.length}`);

      if (!NOVI_ADMIN_SECRET) {
        console.error("[ADD] NOVI_ADMIN_SECRET is missing.");

        await message.reply(
          "❌ Novi admin authentication is not configured."
        );

        return;
      }

      let added = 0;
      let failed = 0;

      // ----------------------------------------------
      // ADD EACH ITEM TO NOVI API
      // ----------------------------------------------

      for (const item of items) {
        try {
          const response = await axios.post(
            `${API_URL}/api/stock/add`,
            {
              item: item,
              items: [item]
            },
            {
              headers: {
                "x-novi-admin-secret": NOVI_ADMIN_SECRET,
                "Content-Type": "application/json"
              },
              timeout: 10000,
              validateStatus: () => true
            }
          );

          console.log(
            `[ADD] "${item}" -> HTTP ${response.status}`
          );

          if (
            response.status >= 200 &&
            response.status < 300
          ) {
            added++;
          } else {
            failed++;

            console.error(
              `[ADD] API rejected item:`,
              response.data
            );
          }
        } catch (error) {
          failed++;

          console.error(
            `[ADD] Failed item "${item}":`,
            error.message
          );
        }
      }

      // ----------------------------------------------
      // GET CURRENT STOCK COUNT
      // ----------------------------------------------

      let stockCount = null;

      try {
        const stockResponse = await axios.get(
          `${API_URL}/api/admin/stock`,
          {
            headers: {
              "x-novi-admin-secret": NOVI_ADMIN_SECRET
            },
            timeout: 10000,
            validateStatus: () => true
          }
        );

        console.log(
          `[ADD] Stock API status: ${stockResponse.status}`
        );

        console.log(
          "[ADD] Stock API response:",
          stockResponse.data
        );

        if (stockResponse.status === 200) {
          const data = stockResponse.data;

          if (Array.isArray(data)) {
            stockCount = data.length;
          } else if (Array.isArray(data.stock)) {
            stockCount = data.stock.length;
          } else if (
            typeof data.count === "number"
          ) {
            stockCount = data.count;
          }
        }
      } catch (error) {
        console.error(
          "[ADD] Could not get stock count:",
          error.message
        );
      }

      // ----------------------------------------------
      // RESULT MESSAGE
      // ----------------------------------------------

      let resultMessage = [
        "## 📦 Stock Updated",
        "",
        `**Added:** ${added}`,
        `**Failed:** ${failed}`
      ];

      if (stockCount !== null) {
        resultMessage.push(
          `**Total Stock:** ${stockCount}`
        );
      }

      if (failed > 0) {
        resultMessage.push(
          "",
          "⚠️ Some items could not be added. Check the Render logs."
        );
      }

      await message.reply(resultMessage.join("\n"));

      console.log(
        `[ADD] Complete. Added=${added}, Failed=${failed}, Total=${stockCount ?? "unknown"}`
      );

      return;
    }
  } catch (error) {
    console.error("[MESSAGE HANDLER ERROR]", error);

    try {
      await message.reply(
        "❌ An unexpected error occurred while processing the command."
      );
    } catch (replyError) {
      console.error(
        "[MESSAGE REPLY ERROR]",
        replyError
      );
    }
  }
});

// --------------------------------------------------
// LOGIN
// --------------------------------------------------

async function startDiscord() {
  if (!DISCORD_TOKEN) {
    console.error("");
    console.error("========================================");
    console.error("❌ DISCORD_TOKEN IS MISSING");
    console.error("========================================");
    console.error("");
    return;
  }

  if (!NOVI_ADMIN_SECRET) {
    console.error("");
    console.error("========================================");
    console.error("❌ NOVI_ADMIN_SECRET IS MISSING");
    console.error("========================================");
    console.error("");
  }

  console.log("[BOT] Connecting to Discord...");

  try {
    await client.login(DISCORD_TOKEN);
  } catch (error) {
    console.error("");
    console.error("========================================");
    console.error("❌ DISCORD LOGIN FAILED");
    console.error("========================================");
    console.error(error.message);
    console.error("========================================");
    console.error("");
  }
}

startDiscord();

// --------------------------------------------------
// PROCESS ERRORS
// --------------------------------------------------

process.on("unhandledRejection", (error) => {
  console.error("[UNHANDLED REJECTION]", error);
});

process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT EXCEPTION]", error);
});

// --------------------------------------------------
// GRACEFUL SHUTDOWN
// --------------------------------------------------

function shutdown(signal) {
  console.log(`[SYSTEM] ${signal} received. Shutting down...`);

  try {
    client.destroy();
  } catch (error) {
    console.error("[SYSTEM] Discord shutdown error:", error);
  }

  server.close(() => {
    console.log("[SYSTEM] HTTP server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
