// =========================================================
// START NOVI WEBSITE / API SERVER
// =========================================================

require("./server.js");

// =========================================================
// LOAD ENVIRONMENT VARIABLES
// =========================================================

require("dotenv").config();

// =========================================================
// DISCORD
// =========================================================

const {
    Client,
    GatewayIntentBits
} = require("discord.js");

const crypto = require("crypto");
const axios = require("axios");

// =========================================================
// DISCORD CLIENT
// =========================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// =========================================================
// ALLOWED ROLES
// =========================================================

const ALLOWED_ROLE_IDS = [
    "1529705570209366167",
    "1378500563456626719"
];

// =========================================================
// NOVI WEBSITE / API
// =========================================================

const SERVER_URL = "https://novi-1.onrender.com";

// =========================================================
// BOT READY
// =========================================================

client.once("ready", () => {
    console.log("================================");
    console.log("NOVI DISCORD BOT IS ONLINE");
    console.log(`Logged in as: ${client.user.tag}`);
    console.log(`Novi server: ${SERVER_URL}`);
    console.log("================================");
});

// =========================================================
// GENERATE NOVI KEY
// =========================================================

function generateKey() {
    const part1 = crypto.randomBytes(2).toString("hex").toUpperCase();
    const part2 = crypto.randomBytes(2).toString("hex").toUpperCase();
    const part3 = crypto.randomBytes(2).toString("hex").toUpperCase();
    const part4 = crypto.randomBytes(2).toString("hex").toUpperCase();

    return `NOVI-${part1}-${part2}-${part3}-${part4}`;
}

// =========================================================
// CHECK PERMISSION
// =========================================================

function hasPermission(message) {
    if (!message.member) {
        return false;
    }

    return ALLOWED_ROLE_IDS.some(roleId =>
        message.member.roles.cache.has(roleId)
    );
}

// =========================================================
// COMMAND HANDLER
// =========================================================

client.on("messageCreate", async (message) => {

    // Ignore bots
    if (message.author.bot) {
        return;
    }

    try {

        const content = message.content.trim();

        if (!content) {
            return;
        }

        const args = content.split(/\s+/);
        const command = args[0].toLowerCase();

        // =====================================================
        // !GEN
        // =====================================================

        if (command === "!gen") {

            if (!message.member) {
                return message.reply(
                    "This command can only be used in a server."
                );
            }

            if (!hasPermission(message)) {
                return message.reply(
                    "You don't have permission to generate keys."
                );
            }

            const duration = args[1]?.toLowerCase();

            const allowedDurations = [
                "1d",
                "1week",
                "1month",
                "1year",
                "lifetime"
            ];

            if (!allowedDurations.includes(duration)) {
                return message.reply(
                    "Usage: !gen 1d, !gen 1week, !gen 1month, !gen 1year, or !gen lifetime"
                );
            }

            const key = generateKey();

            console.log(
                `Generating key: ${key} | Duration: ${duration}`
            );

            try {

                const response = await axios.post(
                    `${SERVER_URL}/api/keys`,
                    {
                        key: key,
                        duration: duration
                    },
                    {
                        timeout: 15000
                    }
                );

                if (
                    !response.data ||
                    !response.data.success
                ) {

                    console.error(
                        "Novi server rejected key:",
                        response.data
                    );

                    return message.reply(
                        `The server rejected the key.\n${
                            response.data?.message ||
                            "Unknown server error."
                        }`
                    );
                }

                console.log(
                    `Key successfully saved: ${key}`
                );

                return message.reply(
                    `Novi Key Generated\n\n` +
                    `${key}\n\n` +
                    `Duration: ${duration}`
                );

            } catch (error) {

                console.error(
                    "Novi API connection error:",
                    error.response?.data ||
                    error.message
                );

                return message.reply(
                    "Could not connect to the Novi server."
                );
            }
        }

        // =====================================================
        // !ADD
        // =====================================================

        if (command === "!add") {

            if (!message.member) {
                return message.reply(
                    "This command can only be used in a server."
                );
            }

            if (!hasPermission(message)) {
                return message.reply(
                    "You don't have permission to add stock."
                );
            }

            let items = [];

            // =================================================
            // ITEMS WRITTEN AFTER !ADD
            // =================================================

            const commandItems = args
                .slice(1)
                .map(item => item.trim())
                .filter(item => item.length > 0);

            items.push(...commandItems);

            // =================================================
            // TXT FILE
            // =================================================

            if (message.attachments.size > 0) {

                const attachment =
                    message.attachments.first();

                const filename =
                    attachment.name?.toLowerCase() || "";

                if (!filename.endsWith(".txt")) {
                    return message.reply(
                        "The attachment must be a .txt file."
                    );
                }

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
                            .map(line => line.trim())
                            .filter(
                                line => line.length > 0
                            );

                    items.push(...fileItems);

                } catch (error) {

                    console.error(
                        "Could not read TXT file:",
                        error.message
                    );

                    return message.reply(
                        "I couldn't read that .txt file."
                    );
                }
            }

            // =================================================
            // NOTHING PROVIDED
            // =================================================

            if (items.length === 0) {

                return message.reply(
                    "Nothing to add.\n\n" +
                    "Use:\n" +
                    "!add CODE-123\n\n" +
                    "Or attach a .txt file with one item per line and type:\n" +
                    "!add"
                );
            }

            // =================================================
            // REMOVE DUPLICATES FROM COMMAND
            // =================================================

            items = [...new Set(items)];

            let added = 0;
            let duplicates = 0;
            let failed = 0;

            // =================================================
            // ADD EACH ITEM TO NOVI
            // =================================================

            for (const item of items) {

                try {

                    const response =
                        await axios.post(
                            `${SERVER_URL}/api/stock/add`,
                            {
                                item: item
                            },
                            {
                                timeout: 15000
                            }
                        );

                    if (
                        response.data &&
                        response.data.success
                    ) {

                        added += Number(
                            response.data.added || 0
                        );

                        duplicates += Number(
                            response.data.duplicates || 0
                        );

                    } else {

                        failed++;
                    }

                } catch (error) {

                    console.error(
                        `Failed to add stock item: ${item}`,
                        error.response?.data ||
                        error.message
                    );

                    failed++;
                }
            }

            // =================================================
            // GET CURRENT STOCK COUNT
            // =================================================

            let totalStock = "Unknown";

            try {

                const stockResponse =
                    await axios.get(
                        `${SERVER_URL}/api/stock`,
                        {
                            timeout: 10000
                        }
                    );

                if (
                    stockResponse.data &&
                    typeof stockResponse.data.count ===
                        "number"
                ) {

                    totalStock =
                        stockResponse.data.count;
                }

            } catch (error) {

                console.error(
                    "Could not get stock count:",
                    error.message
                );
            }

            // =================================================
            // SEND RESULT
            // =================================================

            let reply =
                `Stock Added Successfully\n\n` +
                `Added: ${added}\n` +
                `Duplicates: ${duplicates}\n` +
                `Total stock: ${totalStock}`;

            if (failed > 0) {
                reply += `\nFailed: ${failed}`;
            }

            return message.reply(reply);
        }

    } catch (error) {

        console.error(
            "Discord command error:",
            error
        );

        return message.reply(
            "Something went wrong while processing that command."
        );
    }
});

// =========================================================
// DISCORD TOKEN CHECK
// =========================================================

if (!process.env.DISCORD_TOKEN) {

    console.error(
        "DISCORD_TOKEN is missing from Render Environment Variables."
    );

    process.exit(1);
}

// =========================================================
// LOGIN
// =========================================================

console.log("Connecting to Discord...");

client.login(process.env.DISCORD_TOKEN)

    .then(() => {

        console.log(
            "Discord login successful."
        );

    })

    .catch((error) => {

        console.error(
            "Discord login failed:",
            error.message
        );

        process.exit(1);
    });
