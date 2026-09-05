require("dotenv").config();

const axios = require("axios");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require("discord.js");

// Start the Novi API server
require("./server.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const NOVI_ADMIN_SECRET = process.env.NOVI_ADMIN_SECRET;

const PORT = process.env.PORT || 10000;
const API_URL = `http://127.0.0.1:${PORT}`;

const ALLOWED_ROLES = [
  "1529705570209366167",
  "1378500563456626719"
];

const DURATIONS = {
  "1d": "1 Day",
  "3d": "3 Days",
  "1week": "1 Week",
  "1month": "1 Month",
  "lifetime": "Lifetime"
};


/* =========================
   PERMISSIONS
========================= */

function hasPermission(member) {
  if (!member || !member.roles) {
    return false;
  }

  return member.roles.cache.some(role =>
    ALLOWED_ROLES.includes(role.id)
  );
}


/* =========================
   ADMIN HEADERS
========================= */

function adminHeaders() {
  return {
    "x-novi-admin-secret": NOVI_ADMIN_SECRET,
    "Content-Type": "application/json"
  };
}


/* =========================
   CLEAN API ERROR
========================= */

function getApiError(data) {
  if (!data) {
    return "Unknown API error.";
  }

  if (typeof data === "string") {
    return data
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000);
  }

  if (typeof data === "object") {
    return (
      data.error ||
      data.message ||
      data.details ||
      JSON.stringify(data)
    );
  }

  return "Unknown API error.";
}


/* =========================
   BOT READY
========================= */

client.once("ready", () => {
  console.log("========================================");
  console.log("       DISCORD BOT IS CONNECTED");
  console.log("========================================");
  console.log(`Bot: ${client.user.tag}`);
  console.log(`API: ${API_URL}`);
  console.log("========================================");
});


/* =========================
   !GEN
========================= */

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    const content = message.content.trim();

    if (!content.toLowerCase().startsWith("!gen")) {
      return;
    }

    console.log("");
    console.log("========================================");
    console.log("[GEN] COMMAND RECEIVED");
    console.log("========================================");
    console.log("User:", message.author.tag);
    console.log("Message:", content);

    if (!hasPermission(message.member)) {
      console.log("[GEN] Permission denied");

      return message.reply({
        content: "❌ You do not have permission to generate keys."
      });
    }

    const args = content.split(/\s+/);

    const duration =
      (args[1] || "1d").toLowerCase();

    if (!DURATIONS[duration]) {
      return message.reply({
        content:
          "❌ Invalid duration.\n\n" +
          "Available durations:\n" +
          "`1d` • `3d` • `1week` • `1month` • `lifetime`"
      });
    }

    console.log("[GEN] Duration:", duration);
    console.log(
      "[GEN] API URL:",
      `${API_URL}/api/keys`
    );
    console.log(
      "[GEN] Admin secret exists:",
      Boolean(NOVI_ADMIN_SECRET)
    );

    await message.channel.sendTyping();

    const response = await axios({
      method: "POST",
      url: `${API_URL}/api/keys`,
      headers: adminHeaders(),
      data: {
        duration
      },
      timeout: 15000,
      validateStatus: () => true
    });

    console.log(
      "[GEN] HTTP STATUS:",
      response.status
    );

    console.log(
      "[GEN] RESPONSE:",
      response.data
    );

    if (
      response.status < 200 ||
      response.status >= 300
    ) {
      const errorMessage =
        getApiError(response.data);

      console.log(
        "[GEN] API ERROR:",
        errorMessage
      );

      return message.reply({
        content:
          `❌ Failed to generate key.\n` +
          `API HTTP ${response.status}: ${errorMessage}`
      });
    }

    const data = response.data;

    if (
      !data ||
      !data.success ||
      !data.key
    ) {
      console.log(
        "[GEN] Invalid API response:",
        data
      );

      return message.reply({
        content:
          "❌ API returned an invalid response.\n" +
          `\`${JSON.stringify(data).slice(0, 1000)}\``
      });
    }

    console.log(
      "[GEN] KEY GENERATED SUCCESSFULLY"
    );

    const embed = new EmbedBuilder()
      .setTitle("🔑 Novi Key Generated")
      .setDescription(
        `Your **${DURATIONS[duration]}** key has been generated.`
      )
      .addFields(
        {
          name: "Key",
          value: `\`${data.key}\``,
          inline: false
        },
        {
          name: "Duration",
          value: DURATIONS[duration],
          inline: true
        }
      )
      .setFooter({
        text: "Novi Key System"
      })
      .setTimestamp();

    return message.reply({
      embeds: [embed]
    });

  } catch (error) {

    console.log("");
    console.log("========================================");
    console.log("[GEN] UNEXPECTED ERROR");
    console.log("========================================");
    console.log("Message:", error.message);
    console.log("Code:", error.code);

    if (error.response) {
      console.log(
        "HTTP STATUS:",
        error.response.status
      );

      console.log(
        "HTTP DATA:",
        error.response.data
      );
    }

    console.log("========================================");

    return message.reply({
      content:
        `❌ Failed to generate key.\n` +
        `API: ${error.message || "Unknown API error."}`
    }).catch(() => {});
  }
});


/* =========================
   !ADD
========================= */

client.on("messageCreate", async (message) => {

  try {

    if (message.author.bot) {
      return;
    }

    const content =
      message.content.trim();

    if (!content.toLowerCase().startsWith("!add")) {
      return;
    }

    console.log("");
    console.log("========================================");
    console.log("[ADD] COMMAND RECEIVED");
    console.log("========================================");
    console.log("User:", message.author.tag);
    console.log("Message:", content);


    /* -------------------------
       PERMISSION
    ------------------------- */

    if (!hasPermission(message.member)) {

      console.log(
        "[ADD] Permission denied"
      );

      return message.reply({
        content:
          "❌ You do not have permission to add stock."
      });
    }


    /* -------------------------
       GET TYPED ITEMS
    ------------------------- */

    const args =
      content
        .split(/\s+/)
        .slice(1);

    let items = [];


    if (args.length > 0) {
      items.push(...args);
    }


    /* -------------------------
       GET TXT ATTACHMENT
    ------------------------- */

    const attachment =
      message.attachments.first();


    if (
      attachment &&
      attachment.name &&
      attachment.name
        .toLowerCase()
        .endsWith(".txt")
    ) {

      console.log(
        "[ADD] TXT attachment detected:",
        attachment.name
      );

      try {

        const fileResponse =
          await axios.get(
            attachment.url,
            {
              responseType: "text",
              timeout: 15000
            }
          );

        const fileItems =
          String(fileResponse.data)
            .split(/\r?\n/)
            .map(item => item.trim())
            .filter(Boolean);

        items.push(...fileItems);

        console.log(
          "[ADD] TXT items:",
          fileItems.length
        );

      } catch (error) {

        console.error(
          "[ADD] Failed to download TXT:",
          error.message
        );

        return message.reply({
          content:
            "❌ Failed to read the TXT attachment."
        });
      }
    }


    /* -------------------------
       CLEAN ITEMS
    ------------------------- */

    items = items
      .map(item => String(item).trim())
      .filter(Boolean);


    /* -------------------------
       REMOVE DUPLICATES
    ------------------------- */

    items = [
      ...new Set(items)
    ];


    /* -------------------------
       EMPTY CHECK
    ------------------------- */

    if (items.length === 0) {

      return message.reply({
        content:
          "❌ Please provide stock items or attach a `.txt` file."
      });
    }


    console.log(
      "[ADD] Items to add:",
      items.length
    );


    /* -------------------------
       SEND TO API
    ------------------------- */

    const response =
      await axios({
        method: "POST",
        url: `${API_URL}/api/stock/add`,
        headers: adminHeaders(),

        data: {
          items
        },

        timeout: 15000,

        validateStatus: () => true
      });


    console.log(
      "[ADD] HTTP STATUS:",
      response.status
    );

    console.log(
      "[ADD] RESPONSE:",
      response.data
    );


    /* -------------------------
       API ERROR
    ------------------------- */

    if (
      response.status < 200 ||
      response.status >= 300
    ) {

      const errorMessage =
        getApiError(response.data);

      console.log(
        "[ADD] API ERROR:",
        errorMessage
      );

      return message.reply({
        content:
          `❌ Failed to add stock.\n` +
          `API HTTP ${response.status}: ${errorMessage}`
      });
    }


    /* -------------------------
       SUCCESS
    ------------------------- */

    const added =
      response.data?.added ??
      items.length;


    let stockCount = "?";


    /* -------------------------
       GET STOCK COUNT
    ------------------------- */

    try {

      const stockResponse =
        await axios.get(
          `${API_URL}/api/admin/stock`,
          {
            headers: adminHeaders(),
            timeout: 15000,
            validateStatus: () => true
          }
        );


      console.log(
        "[ADD] STOCK RESPONSE:",
        stockResponse.data
      );


      if (
        stockResponse.status >= 200 &&
        stockResponse.status < 300 &&
        stockResponse.data &&
        typeof stockResponse.data.count !==
          "undefined"
      ) {

        stockCount =
          stockResponse.data.count;
      }

    } catch (error) {

      console.log(
        "[ADD] Could not get stock count:",
        error.message
      );
    }


    console.log(
      `[ADD] Successfully added ${added} item(s).`
    );


    return message.reply({
      content:
        `✅ Added **${added}** stock item(s).\n` +
        `📦 Total stock: **${stockCount}**`
    });


  } catch (error) {

    console.error(
      "[ADD] Error:",
      error
    );

    return message.reply({
      content:
        `❌ Failed to add stock.\n` +
        `API: ${error.message || "Unknown API error."}`
    }).catch(() => {});
  }

});


/* =========================
   DISCORD ERRORS
========================= */

client.on("error", error => {
  console.error(
    "[DISCORD ERROR]",
    error
  );
});


process.on(
  "unhandledRejection",
  error => {
    console.error(
      "[UNHANDLED REJECTION]",
      error
    );
  }
);


process.on(
  "uncaughtException",
  error => {
    console.error(
      "[UNCAUGHT EXCEPTION]",
      error
    );
  }
);


/* =========================
   ENV CHECK
========================= */

if (!DISCORD_TOKEN) {

  console.error(
    "❌ DISCORD_TOKEN is missing."
  );

  process.exit(1);
}


if (!NOVI_ADMIN_SECRET) {

  console.error(
    "❌ NOVI_ADMIN_SECRET is missing."
  );

  process.exit(1);
}


/* =========================
   START BOT
========================= */

console.log(
  "[BOT] Starting Discord login..."
);


client
  .login(DISCORD_TOKEN)
  .then(() => {

    console.log(
      "[BOT] Discord login successful."
    );

  })
  .catch(error => {

    console.error(
      "❌ Discord login failed:"
    );

    console.error(error);

  });
