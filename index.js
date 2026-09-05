require("dotenv").config();
require("./server.js");

const {
    Client,
    GatewayIntentBits
} = require("discord.js");

const axios = require("axios");

// =====================================================
// CONFIG
// =====================================================

const PORT = process.env.PORT || 10000;

const SERVER_URL =
    `http://127.0.0.1:${PORT}`;

const DISCORD_TOKEN =
    process.env.DISCORD_TOKEN;

const ADMIN_SECRET =
    process.env.NOVI_ADMIN_SECRET;

// =====================================================
// DISCORD CLIENT
// =====================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// =====================================================
// ALLOWED ROLE IDS
// =====================================================

const ALLOWED_ROLE_IDS = [
    "1529705570209366167",
    "1378500563456626719"
];

// =====================================================
// STARTUP LOG
// =====================================================

console.log("");
console.log("================================");
console.log("NOVI DISCORD STARTUP");
console.log("================================");

console.log(
    "Token detected:",
    Boolean(DISCORD_TOKEN)
);

console.log(
    "Admin secret detected:",
    Boolean(ADMIN_SECRET)
);

console.log(
    "API:",
    SERVER_URL
);

console.log("================================");
console.log("");

// =====================================================
// ENVIRONMENT CHECK
// =====================================================

if (!DISCORD_TOKEN) {
    console.error("DISCORD_TOKEN is missing.");
    console.error(
        "Add DISCORD_TOKEN to Render Environment Variables."
    );
    process.exit(1);
}

if (!ADMIN_SECRET) {
    console.error("NOVI_ADMIN_SECRET is missing.");
    console.error(
        "Add NOVI_ADMIN_SECRET to Render Environment Variables."
    );
    process.exit(1);
}

// =====================================================
// DISCORD DEBUG
// =====================================================

client.on("debug", (info) => {
    console.log("[DISCORD DEBUG]", info);
});

// =====================================================
// DISCORD ERRORS
// =====================================================

client.on("error", (error) => {
    console.error("");
    console.error("================================");
    console.error("DISCORD CLIENT ERROR");
    console.error("================================");
    console.error(error);
    console.error("================================");
});

client.on("warn", (warning) => {
    console.warn(
        "[DISCORD WARNING]",
        warning
    );
});

client.on("shardError", (error) => {
    console.error("");
    console.error("================================");
    console.error("DISCORD SHARD ERROR");
    console.error("================================");
    console.error(error);
    console.error("================================");
});

client.on("shardDisconnect", (event) => {
    console.warn("");
    console.warn("================================");
    console.warn("DISCORD SHARD DISCONNECTED");
    console.warn("================================");

    console.warn(
        "Code:",
        event.code
    );

    console.warn(
        "Reason:",
        event.reason || "Unknown"
    );

    console.warn("================================");
});

client.on("shardReconnecting", () => {
    console.log(
        "Discord shard reconnecting..."
    );
});

client.on(
    "shardResume",
    (shardId, replayedEvents) => {

        console.log(
            `Discord shard ${shardId} resumed.`
        );

        console.log(
            `Replayed events: ${replayedEvents}`
        );
    }
);

// =====================================================
// BOT READY
// =====================================================

client.once("ready", () => {

    console.log("");
    console.log("================================");
    console.log("DISCORD BOT IS ONLINE");
    console.log("================================");

    console.log(
        "Logged in as:",
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

    console.log(
        "API:",
        SERVER_URL
    );

    console.log("================================");
    console.log("");
});

// =====================================================
// ADMIN HEADERS
// =====================================================

function adminHeaders() {

    return {
        "Content-Type":
            "application/json",

        "x-novi-admin-secret":
            ADMIN_SECRET
    };
}

// =====================================================
// ROLE PERMISSION CHECK
// =====================================================

function hasPermission(message) {

    if (!message.member) {
        return false;
    }

    return ALLOWED_ROLE_IDS.some(
        (roleId) =>
            message.member.roles.cache.has(
                roleId
            )
    );
}

// =====================================================
// MESSAGE HANDLER
// =====================================================

client.on(
    "messageCreate",
    async (message) => {

        if (message.author.bot) {
            return;
        }

        try {

            const content =
                message.content.trim();

            if (!content) {
                return;
            }

            const args =
                content.split(/\s+/);

            const command =
                args[0].toLowerCase();

            // =================================================
            // !GEN
            // =================================================

            if (command === "!gen") {

                if (!message.member) {

                    return message.reply(
                        "This command can only be used inside a server."
                    );
                }

                if (
                    !hasPermission(message)
                ) {

                    return message.reply(
                        "You don't have permission to generate keys."
                    );
                }

                const duration =
                    args[1]?.toLowerCase();

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

                    return message.reply(
                        "Usage: `!gen 1d`, `!gen 3d`, `!gen 1week`, `!gen 1month`, or `!gen lifetime`"
                    );
                }

                console.log(
                    `[GEN] ${message.author.tag} requested ${duration}`
                );

                try {

                    const response =
                        await axios.post(
                            `${SERVER_URL}/api/keys`,
                            {
                                duration
                            },
                            {
                                timeout: 15000,
                                headers:
                                    adminHeaders()
                            }
                        );

                    if (
                        !response.data?.success
                    ) {

                        console.error(
                            "[GEN] Server rejected request:",
                            response.data
                        );

                        return message.reply(
                            response.data?.message ||
                            "The server rejected the key."
                        );
                    }

                    const key =
                        response.data.key;

                    if (!key) {

                        console.error(
                            "[GEN] No key returned:",
                            response.data
                        );

                        return message.reply(
                            "The server created the key but did not return it."
                        );
                    }

                    console.log(
                        `[GEN] Key generated: ${key}`
                    );

                    return message.reply(
                        `**Novi Key Generated**\n\n` +
                        `\`${key}\`\n\n` +
                        `**Duration:** ${
                            response.data.durationName ||
                            duration
                        }`
                    );

                } catch (error) {

                    console.error(
                        "[GEN] Error:",
                        error.response?.data ||
                        error.message
                    );

                    if (
                        error.response?.status === 401 ||
                        error.response?.status === 403
                    ) {

                        return message.reply(
                            "Novi admin authentication failed."
                        );
                    }

                    if (
                        error.response?.status === 503
                    ) {

                        return message.reply(
                            "Novi admin authentication is not configured correctly."
                        );
                    }

                    return message.reply(
                        "Could not connect to the Novi server."
                    );
                }
            }

            // =================================================
            // !ADD
            // =================================================

            if (command === "!add") {

                if (!message.member) {

                    return message.reply(
                        "This command can only be used inside a server."
                    );
                }

                if (
                    !hasPermission(message)
                ) {

                    return message.reply(
                        "You don't have permission to add stock."
                    );
                }

                let items = [];

                // =================================================
                // DIRECT ITEMS
                // =================================================

                const commandItems =
                    args
                        .slice(1)
                        .map(
                            (item) =>
                                item.trim()
                        )
                        .filter(
                            (item) =>
                                item.length > 0
                        );

                items.push(
                    ...commandItems
                );

                // =================================================
                // TXT FILE
                // =================================================

                if (
                    message.attachments.size > 0
                ) {

                    const attachment =
                        message.attachments.first();

                    const filename =
                        (
                            attachment.name ||
                            ""
                        ).toLowerCase();

                    if (
                        !filename.endsWith(".txt")
                    ) {

                        return message.reply(
                            "The attachment must be a `.txt` file."
                        );
                    }

                    try {

                        console.log(
                            `[ADD] Downloading ${attachment.name}`
                        );

                        const fileResponse =
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
                                fileResponse.data
                            )
                                .split(
                                    /\r?\n/
                                )
                                .map(
                                    (line) =>
                                        line.trim()
                                )
                                .filter(
                                    (line) =>
                                        line.length > 0
                                );

                        items.push(
                            ...fileItems
                        );

                    } catch (error) {

                        console.error(
                            "[ADD] TXT error:",
                            error.message
                        );

                        return message.reply(
                            "I couldn't read the `.txt` file."
                        );
                    }
                }

                // =================================================
                // NOTHING TO ADD
                // =================================================

                if (
                    items.length === 0
                ) {

                    return message.reply(
                        "**Nothing to add.**\n\n" +
                        "Use `!add ITEM` or attach a `.txt` file and type `!add`."
                    );
                }

                // =================================================
                // REMOVE DUPLICATES FROM REQUEST
                // =================================================

                items =
                    [...new Set(items)];

                console.log(
                    `[ADD] Processing ${items.length} items`
                );

                let added = 0;
                let duplicates = 0;
                let failed = 0;

                // =================================================
                // ADD EACH ITEM
                // =================================================

                for (
                    const item of items
                ) {

                    try {

                        const response =
                            await axios.post(
                                `${SERVER_URL}/api/stock/add`,
                                {
                                    item
                                },
                                {
                                    timeout:
                                        15000,
                                    headers:
                                        adminHeaders()
                                }
                            );

                        if (
                            response.data?.success
                        ) {

                            added +=
                                Number(
                                    response.data.added ||
                                    0
                                );

                            duplicates +=
                                Number(
                                    response.data.duplicates ||
                                    0
                                );

                        } else {

                            failed++;
                        }

                    } catch (error) {

                        failed++;

                        console.error(
                            "[ADD] Item failed:",
                            error.response?.data ||
                            error.message
                        );
                    }
                }

                // =================================================
                // GET TOTAL STOCK
                // =================================================

                let totalStock =
                    "Unknown";

                try {

                    const stockResponse =
                        await axios.get(
                            `${SERVER_URL}/api/admin/stock`,
                            {
                                timeout:
                                    10000,
                                headers:
                                    adminHeaders()
                            }
                        );

                    if (
                        typeof stockResponse.data?.count ===
                        "number"
                    ) {

                        totalStock =
                            stockResponse.data.count;
                    }

                } catch (error) {

                    console.error(
                        "[ADD] Stock count error:",
                        error.response?.data ||
                        error.message
                    );
                }

                // =================================================
                // RESULT
                // =================================================

                let result =
                    `**Stock Update**\n\n` +
                    `**Added:** ${added}\n` +
                    `**Duplicates:** ${duplicates}\n` +
                    `**Total Stock:** ${totalStock}`;

                if (
                    failed > 0
                ) {

                    result +=
                        `\n**Failed:** ${failed}`;
                }

                return message.reply(
                    result
                );
            }

        } catch (error) {

            console.error(
                "[MESSAGE HANDLER ERROR]",
                error
            );

            try {

                await message.reply(
                    "Something went wrong while processing that command."
                );

            } catch {}
        }
    }
);

// =====================================================
// PROCESS ERROR HANDLING
// =====================================================

process.on(
    "unhandledRejection",
    (error) => {

        console.error("");
        console.error(
            "================================"
        );

        console.error(
            "UNHANDLED PROMISE REJECTION"
        );

        console.error(error);

        console.error(
            "================================"
        );
    }
);

process.on(
    "uncaughtException",
    (error) => {

        console.error("");
        console.error(
            "================================"
        );

        console.error(
            "UNCAUGHT EXCEPTION"
        );

        console.error(error);

        console.error(
            "================================"
        );
    }
);

// =====================================================
// START DISCORD
// =====================================================

async function startDiscord() {

    console.log("");
    console.log("================================");
    console.log("CONNECTING TO DISCORD");
    console.log("================================");

    console.log(
        "Token detected:",
        Boolean(DISCORD_TOKEN)
    );

    console.log(
        "Token length:",
        DISCORD_TOKEN.length
    );

    console.log(
        "Connecting through Discord Gateway..."
    );

    console.log("================================");
    console.log("");

    try {

        discordLoginStarted = true;

        await client.login(
            DISCORD_TOKEN
        );

    } catch (error) {

        console.error("");
        console.error(
            "================================"
        );

        console.error(
            "DISCORD LOGIN FAILED"
        );

        console.error(
            "Error name:",
            error?.name ||
            "Unknown"
        );

        console.error(
            "Error code:",
            error?.code ||
            "Unknown"
        );

        console.error(
            "Error message:",
            error?.message ||
            error
        );

        console.error(
            "================================"
        );

        discordLoginStarted = false;

        try {
            client.destroy();
        } catch {}

    }
}

// =====================================================
// START
// =====================================================

startDiscord();
