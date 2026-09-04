```js
require("dotenv").config();

const express = require("express");
const { Client, GatewayIntentBits } = require("discord.js");
const crypto = require("crypto");
const axios = require("axios");

const SERVER_URL = "https://novi-1.onrender.com";
const PORT = Number(process.env.PORT) || 10000;

const ALLOWED_ROLE_IDS = [
    "1529705570209366167",
    "1378500563456626719"
];

const app = express();

app.get("/", (req, res) => {
    res.status(200).send("Novi Discord Bot is online.");
});

app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "online",
        service: "Novi Discord Bot"
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Novi web server listening on port ${PORT}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

function generateKey() {
    const parts = [];

    for (let i = 0; i < 4; i++) {
        parts.push(
            crypto
                .randomBytes(2)
                .toString("hex")
                .toUpperCase()
        );
    }

    return `NOVI-${parts.join("-")}`;
}

function hasPermission(message) {
    if (!message.member) {
        return false;
    }

    return ALLOWED_ROLE_IDS.some((roleId) =>
        message.member.roles.cache.has(roleId)
    );
}

client.once("ready", () => {
    console.log("==============================");
    console.log("NOVI DISCORD BOT IS ONLINE");
    console.log(`Logged in as: ${client.user.tag}`);
    console.log(`Novi server: ${SERVER_URL}`);
    console.log("==============================");
});

client.on("error", (error) => {
    console.error("Discord client error:", error);
});

client.on("messageCreate", async (message) => {
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

        console.log(
            `Command: ${command} | User: ${message.author.tag}`
        );

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

            const duration = (args[1] || "").toLowerCase();

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

            try {
                console.log("Sending key to Novi server...");

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
                    response.data.success !== true
                ) {
                    console.error(
                        "Novi server response:",
                        response.data
                    );

                    return message.reply(
                        `The Novi server rejected the key.\n${
                            response.data?.message ||
                            "Unknown server error."
                        }`
                    );
                }

                console.log(
                    `Key saved successfully: ${key}`
                );

                return message.reply(
                    `Novi Key Generated\n\n` +
                    `${key}\n\n` +
                    `Duration: ${duration}`
                );
            } catch (error) {
                console.error(
                    "Novi key request failed:",
                    error.response?.data ||
                    error.message
                );

                return message.reply(
                    "Could not connect to the Novi server."
                );
            }
        }

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

            const commandItems = args
                .slice(1)
                .map((item) => item.trim())
                .filter((item) => item.length > 0);

            items.push(...commandItems);

            if (message.attachments.size > 0) {
                const attachment =
                    message.attachments.first();

                const filename =
                    (attachment.name || "").toLowerCase();

                if (!filename.endsWith(".txt")) {
                    return message.reply(
                        "The attachment must be a .txt file."
                    );
                }

                try {
                    console.log(
                        `Reading stock file: ${attachment.name}`
                    );

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
                            .map((line) => line.trim())
                            .filter(
                                (line) =>
                                    line.length > 0
                            );

                    items.push(...fileItems);
                } catch (error) {
                    console.error(
                        "Could not read stock file:",
                        error.message
                    );

                    return message.reply(
                        "I couldn't read that .txt file."
                    );
                }
            }

            items = [...new Set(items)];

            if (items.length === 0) {
                return message.reply(
                    "Nothing to add.\n\n" +
                    "Use: !add CODE-123\n\n" +
                    "Or attach a .txt file with one item per line and type !add."
                );
            }

            let added = 0;
            let duplicates = 0;
            let failed = 0;

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
                        response.data.success === true
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
                        `Failed to add item: ${item}`,
                        error.response?.data ||
                        error.message
                    );

                    failed++;
                }
            }

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
            "Command error:",
            error
        );

        try {
            await message.reply(
                "Something went wrong while processing that command."
            );
        } catch (replyError) {
            console.error(
                "Could not send error message:",
                replyError.message
            );
        }
    }
});

process.on(
    "unhandledRejection",
    (error) => {
        console.error(
            "Unhandled promise rejection:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    (error) => {
        console.error(
            "Uncaught exception:",
            error
        );
    }
);

if (!process.env.DISCORD_TOKEN) {
    console.error(
        "DISCORD_TOKEN is missing from Render Environment Variables."
    );

    process.exit(1);
}

console.log("Connecting to Discord...");

client
    .login(process.env.DISCORD_TOKEN)
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
```
