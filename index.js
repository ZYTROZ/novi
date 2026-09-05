require("dotenv").config();
require("./server.js");

const {
    Client,
    GatewayIntentBits
} = require("discord.js");

const axios = require("axios");

/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 10000;
const API_URL = `http://127.0.0.1:${PORT}`;

const TOKEN = String(
    process.env.DISCORD_TOKEN || ""
).trim();

const ADMIN_SECRET = String(
    process.env.NOVI_ADMIN_SECRET || ""
).trim();

/* =========================================================
   STARTUP
========================================================= */

console.log("");
console.log("========================================");
console.log("NOVI DISCORD BOT");
console.log("========================================");

console.log(
    "DISCORD_TOKEN:",
    TOKEN ? "FOUND" : "MISSING"
);

console.log(
    "NOVI_ADMIN_SECRET:",
    ADMIN_SECRET ? "FOUND" : "MISSING"
);

console.log(
    "API:",
    API_URL
);

console.log("========================================");
console.log("");

if (!TOKEN) {
    console.error("❌ DISCORD_TOKEN is missing.");
    process.exit(1);
}

if (!ADMIN_SECRET) {
    console.error("❌ NOVI_ADMIN_SECRET is missing.");
    process.exit(1);
}

/* =========================================================
   DISCORD CLIENT
========================================================= */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

/* =========================================================
   ALLOWED ROLES
========================================================= */

const ALLOWED_ROLE_IDS = [
    "1529705570209366167",
    "1378500563456626719"
];

/* =========================================================
   PERMISSION CHECK
========================================================= */

function hasPermission(message) {

    if (!message.member) {
        return false;
    }

    return ALLOWED_ROLE_IDS.some(
        roleId =>
            message.member.roles.cache.has(roleId)
    );
}

/* =========================================================
   ADMIN HEADERS
========================================================= */

function adminHeaders() {

    return {
        "Content-Type": "application/json",
        "x-novi-admin-secret": ADMIN_SECRET
    };
}

/* =========================================================
   READY
========================================================= */

client.once("ready", () => {

    console.log("");
    console.log("========================================");
    console.log("✅ NOVI BOT IS ONLINE");
    console.log("========================================");

    console.log(
        "Bot:",
        client.user.tag
    );

    console.log(
        "Bot ID:",
        client.user.id
    );

    console.log(
        "Servers:",
        client.guilds.cache.size
    );

    console.log("========================================");
    console.log("");
});

/* =========================================================
   DISCORD ERRORS
========================================================= */

client.on("error", error => {

    console.error(
        "❌ Discord client error:",
        error?.message || error
    );
});

client.on("shardError", error => {

    console.error(
        "❌ Discord gateway error:",
        error?.message || error
    );
});

client.on("shardReconnecting", () => {

    console.log(
        "🔄 Discord reconnecting..."
    );
});

client.on("shardResume", shardId => {

    console.log(
        `✅ Discord resumed on shard ${shardId}.`
    );
});

client.on("shardDisconnect", event => {

    console.log(
        "⚠️ Discord disconnected:",
        event?.code || "Unknown"
    );
});

/* =========================================================
   MESSAGE HANDLER
========================================================= */

client.on(
    "messageCreate",
    async message => {

        try {

            if (message.author.bot) {
                return;
            }

            if (!message.guild) {
                return;
            }

            const content =
                String(message.content || "").trim();

            if (!content) {
                return;
            }

            const args =
                content.split(/\s+/);

            const command =
                args[0].toLowerCase();

            /* =================================================
               !GEN
            ================================================= */

            if (command === "!gen") {

                if (!hasPermission(message)) {

                    await message.reply(
                        "❌ You don't have permission to use this command."
                    );

                    return;
                }

                const duration =
                    String(args[1] || "")
                        .trim()
                        .toLowerCase();

                const allowedDurations = [
                    "1d",
                    "3d",
                    "1week",
                    "1month",
                    "lifetime"
                ];

                if (
                    !allowedDurations.includes(
                        duration
                    )
                ) {

                    await message.reply(
                        "❌ Usage:\n" +
                        "`!gen 1d`\n" +
                        "`!gen 3d`\n" +
                        "`!gen 1week`\n" +
                        "`!gen 1month`\n" +
                        "`!gen lifetime`"
                    );

                    return;
                }

                console.log("");
                console.log(
                    `[GEN] ${message.author.tag} requested ${duration}`
                );

                try {

                    /*
                     * IMPORTANT:
                     * The bot talks directly to the Express
                     * server running in the same Render service.
                     */

                    const response =
                        await axios({
                            method: "POST",

                            url:
                                `${API_URL}/api/keys`,

                            data: {
                                duration
                            },

                            headers:
                                adminHeaders(),

                            timeout: 15000,

                            validateStatus:
                                () => true
                        });

                    console.log(
                        "[GEN] HTTP status:",
                        response.status
                    );

                    console.log(
                        "[GEN] Response:",
                        response.data
                    );

                    /* -----------------------------------------
                       SERVER REJECTED REQUEST
                    ----------------------------------------- */

                    if (
                        response.status < 200 ||
                        response.status >= 300
                    ) {

                        const messageText =
                            response.data?.message ||
                            `Server returned HTTP ${response.status}.`;

                        await message.reply(
                            `❌ ${messageText}`
                        );

                        return;
                    }

                    /* -----------------------------------------
                       SERVER RESPONSE
                    ----------------------------------------- */

                    if (
                        !response.data ||
                        response.data.success !== true
                    ) {

                        await message.reply(
                            `❌ ${
                                response.data?.message ||
                                "The server did not generate a key."
                            }`
                        );

                        return;
                    }

                    /* -----------------------------------------
                       GET KEY
                    ----------------------------------------- */

                    const key =
                        String(
                            response.data.key || ""
                        ).trim();

                    if (!key) {

                        console.error(
                            "[GEN] Server returned success but no key."
                        );

                        await message.reply(
                            "❌ The server generated the request but did not return a key."
                        );

                        return;
                    }

                    /* -----------------------------------------
                       SUCCESS
                    ----------------------------------------- */

                    console.log(
                        `[GEN] SUCCESS -> ${key}`
                    );

                    const durationName =
                        response.data.durationName ||
                        response.data.duration ||
                        duration;

                    await message.reply(
                        "🔑 **Novi Key Generated**\n\n" +
                        `\`${key}\`\n\n` +
                        `⏱️ **Duration:** ${durationName}`
                    );

                } catch (error) {

                    console.error("");
                    console.error(
                        "========================================"
                    );
                    console.error(
                        "❌ !GEN ERROR"
                    );
                    console.error(
                        "========================================"
                    );

                    console.error(
                        "Message:",
                        error?.message || error
                    );

                    console.error(
                        "Code:",
                        error?.code || "Unknown"
                    );

                    console.error(
                        "Status:",
                        error?.response?.status || "No response"
                    );

                    console.error(
                        "Response:",
                        error?.response?.data || "No response"
                    );

                    console.error(
                        "========================================"
                    );

                    await message.reply(
                        "❌ Something went wrong while generating the key. Check the Render logs."
                    );
                }

                return;
            }

            /* =================================================
               !ADD
            ================================================= */

            if (command === "!add") {

                if (!hasPermission(message)) {

                    await message.reply(
                        "❌ You don't have permission to use this command."
                    );

                    return;
                }

                let items = [];

                /* -----------------------------------------
                   TEXT AFTER !ADD
                ----------------------------------------- */

                const typedItems =
                    args
                        .slice(1)
                        .map(item =>
                            item.trim()
                        )
                        .filter(item =>
                            item.length > 0
                        );

                items.push(
                    ...typedItems
                );

                /* -----------------------------------------
                   TXT ATTACHMENT
                ----------------------------------------- */

                if (
                    message.attachments.size > 0
                ) {

                    const attachment =
                        message.attachments.first();

                    const filename =
                        String(
                            attachment.name || ""
                        ).toLowerCase();

                    if (
                        !filename.endsWith(".txt")
                    ) {

                        await message.reply(
                            "❌ Please attach a `.txt` file."
                        );

                        return;
                    }

                    try {

                        const response =
                            await axios.get(
                                attachment.url,
                                {
                                    responseType:
                                        "text",

                                    timeout:
                                        15000
                                }
                            );

                        const fileItems =
                            String(
                                response.data || ""
                            )
                                .split(/\r?\n/)
                                .map(line =>
                                    line.trim()
                                )
                                .filter(line =>
                                    line.length > 0
                                );

                        items.push(
                            ...fileItems
                        );

                    } catch (error) {

                        console.error(
                            "[TXT ERROR]",
                            error?.message || error
                        );

                        await message.reply(
                            "❌ I couldn't read the TXT file."
                        );

                        return;
                    }
                }

                /* -----------------------------------------
                   NOTHING PROVIDED
                ----------------------------------------- */

                if (
                    items.length === 0
                ) {

                    await message.reply(
                        "❌ Nothing to add.\n\n" +
                        "Use `!add ITEM` or attach a `.txt` file."
                    );

                    return;
                }

                /* -----------------------------------------
                   REMOVE DUPLICATES
                ----------------------------------------- */

                items =
                    [...new Set(items)];

                let added = 0;
                let duplicates = 0;
                let failed = 0;

                /* -----------------------------------------
                   ADD ITEMS
                ----------------------------------------- */

                for (
                    const item of items
                ) {

                    try {

                        const response =
                            await axios({
                                method: "POST",

                                url:
                                    `${API_URL}/api/stock/add`,

                                data: {
                                    item
                                },

                                headers:
                                    adminHeaders(),

                                timeout:
                                    15000,

                                validateStatus:
                                    () => true
                            });

                        if (
                            response.status >= 200 &&
                            response.status < 300 &&
                            response.data?.success
                        ) {

                            added +=
                                Number(
                                    response.data.added || 0
                                );

                            duplicates +=
                                Number(
                                    response.data.duplicates || 0
                                );

                        } else {

                            failed++;

                            console.error(
                                "[ADD FAILED]",
                                response.status,
                                response.data
                            );
                        }

                    } catch (error) {

                        failed++;

                        console.error(
                            "[ADD ERROR]",
                            error?.message || error
                        );
                    }
                }

                /* -----------------------------------------
                   GET TOTAL STOCK
                ----------------------------------------- */

                let totalStock =
                    "Unknown";

                try {

                    const response =
                        await axios({
                            method: "GET",

                            url:
                                `${API_URL}/api/admin/stock`,

                            headers:
                                adminHeaders(),

                            timeout:
                                10000,

                            validateStatus:
                                () => true
                        });

                    if (
                        typeof response.data?.count ===
                        "number"
                    ) {

                        totalStock =
                            response.data.count;
                    }

                } catch (error) {

                    console.error(
                        "[STOCK COUNT ERROR]",
                        error?.message || error
                    );
                }

                /* -----------------------------------------
                   RESULT
                ----------------------------------------- */

                let result =
                    `📦 **Stock Updated**\n\n` +
                    `✅ **Added:** ${added}\n` +
                    `♻️ **Duplicates:** ${duplicates}\n` +
                    `📊 **Total Stock:** ${totalStock}`;

                if (
                    failed > 0
                ) {

                    result +=
                        `\n❌ **Failed:** ${failed}`;
                }

                await message.reply(
                    result
                );

                return;
            }

        } catch (error) {

            console.error(
                "MESSAGE HANDLER ERROR:",
                error
            );
        }
    }
);

/* =========================================================
   PROCESS ERRORS
========================================================= */

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "UNHANDLED REJECTION:",
            error
        );
    }
);

process.on(
    "uncaughtException",
    error => {

        console.error(
            "UNCAUGHT EXCEPTION:",
            error
        );
    }
);

/* =========================================================
   START BOT
========================================================= */

async function startDiscord() {

    console.log("");
    console.log(
        "Connecting Discord.js..."
    );

    try {

        await client.login(TOKEN);

        console.log(
            "✅ Discord login successful."
        );

    } catch (error) {

        console.error("");
        console.error(
            "========================================"
        );

        console.error(
            "❌ DISCORD LOGIN FAILED"
        );

        console.error(
            "========================================"
        );

        console.error(
            "Name:",
            error?.name || "Unknown"
        );

        console.error(
            "Code:",
            error?.code || "Unknown"
        );

        console.error(
            "Message:",
            error?.message || error
        );

        console.error(
            "========================================"
        );
    }
}

/* =========================================================
   RUN
========================================================= */

startDiscord();
