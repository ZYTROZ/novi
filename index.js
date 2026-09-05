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
// ALLOWED ROLES
// =====================================================

const ALLOWED_ROLE_IDS = [
    "1529705570209366167",
    "1378500563456626719"
];

// =====================================================
// STARTUP
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
    "Token length:",
    DISCORD_TOKEN?.length || 0
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

    console.error(
        "DISCORD_TOKEN is missing."
    );

    process.exit(1);
}

if (!ADMIN_SECRET) {

    console.error(
        "NOVI_ADMIN_SECRET is missing."
    );

    process.exit(1);
}

// =====================================================
// SAFE DISCORD DEBUG
// IMPORTANT:
// NEVER PRINT THE TOKEN
// =====================================================

client.on("debug", (info) => {

    const safeInfo =
        String(info)
            .replace(
                /(?:Bot\s+)?[\w-]{20,}\.[\w-]+\.[\w-]+/g,
                "[TOKEN REDACTED]"
            );

    console.log(
        "[DISCORD DEBUG]",
        safeInfo
    );
});

// =====================================================
// DISCORD ERRORS
// =====================================================

client.on("error", (error) => {

    console.error("");
    console.error(
        "================================"
    );

    console.error(
        "DISCORD CLIENT ERROR"
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
        "================================"
    );
});

// =====================================================
// WARNINGS
// =====================================================

client.on("warn", (warning) => {

    console.warn(
        "[DISCORD WARNING]",
        warning
    );
});

// =====================================================
// SHARD ERROR
// =====================================================

client.on(
    "shardError",
    (error) => {

        console.error("");
        console.error(
            "================================"
        );

        console.error(
            "DISCORD SHARD ERROR"
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
            "================================"
        );
    }
);

// =====================================================
// SHARD DISCONNECT
// =====================================================

client.on(
    "shardDisconnect",
    (event) => {

        console.warn("");
        console.warn(
            "================================"
        );

        console.warn(
            "DISCORD SHARD DISCONNECTED"
        );

        console.warn(
            "Code:",
            event?.code || "Unknown"
        );

        console.warn(
            "Reason:",
            event?.reason || "Unknown"
        );

        console.warn(
            "================================"
        );
    }
);

// =====================================================
// SHARD RECONNECT
// =====================================================

client.on(
    "shardReconnecting",
    () => {

        console.log(
            "Discord shard reconnecting..."
        );
    }
);

// =====================================================
// SHARD RESUME
// =====================================================

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
// RATE LIMIT
// =====================================================

client.on(
    "rateLimit",
    (info) => {

        console.warn("");
        console.warn(
            "================================"
        );

        console.warn(
            "DISCORD RATE LIMIT"
        );

        console.warn(
            "Timeout:",
            info?.timeout
        );

        console.warn(
            "Limit:",
            info?.limit
        );

        console.warn(
            "Method:",
            info?.method
        );

        console.warn(
            "Path:",
            info?.path
        );

        console.warn(
            "================================"
        );
    }
);

// =====================================================
// BOT READY
// =====================================================

client.once(
    "ready",
    () => {

        console.log("");
        console.log(
            "================================"
        );

        console.log(
            "DISCORD BOT IS ONLINE"
        );

        console.log(
            "================================"
        );

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

        console.log(
            "================================"
        );

        console.log("");
    }
);

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
// PERMISSION CHECK
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

                        return message.reply(
                            response.data?.message ||
                            "The server rejected the key."
                        );
                    }

                    const key =
                        response.data.key;

                    if (!key) {

                        return message.reply(
                            "The server created the key but did not return it."
                        );
                    }

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
                        "[GEN ERROR]",
                        error.response?.data ||
                        error.message
                    );

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
                // COMMAND ITEMS
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
                                response.data
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
                            "[TXT ERROR]",
                            error.message
                        );

                        return message.reply(
                            "I couldn't read the `.txt` file."
                        );
                    }
                }

                // =================================================
                // EMPTY
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
                // REMOVE DUPLICATES
                // =================================================

                items =
                    [...new Set(items)];

                let added = 0;
                let duplicates = 0;
                let failed = 0;

                // =================================================
                // ADD STOCK
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
                            "[STOCK ERROR]",
                            error.response?.data ||
                            error.message
                        );
                    }
                }

                // =================================================
                // STOCK COUNT
                // =================================================

                let totalStock =
                    "Unknown";

                try {

                    const response =
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
                        typeof response.data?.count ===
                        "number"
                    ) {

                        totalStock =
                            response.data.count;
                    }

                } catch (error) {

                    console.error(
                        "[STOCK COUNT ERROR]",
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
// PROCESS ERRORS
// =====================================================

process.on(
    "unhandledRejection",
    (error) => {

        console.error("");
        console.error(
            "UNHANDLED PROMISE REJECTION"
        );

        console.error(error);
    }
);

process.on(
    "uncaughtException",
    (error) => {

        console.error("");
        console.error(
            "UNCAUGHT EXCEPTION"
        );

        console.error(error);
    }
);

// =====================================================
// DISCORD LOGIN
// =====================================================

async function startDiscord() {

    console.log("");
    console.log(
        "================================"
    );

    console.log(
        "CONNECTING TO DISCORD"
    );

    console.log(
        "================================"
    );

    console.log(
        "Starting Discord Gateway..."
    );

    console.log(
        "Token present:",
        Boolean(DISCORD_TOKEN)
    );

    console.log(
        "Token length:",
        DISCORD_TOKEN?.length || 0
    );

    console.log(
        "================================"
    );

    try {

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
            "================================"
        );
    }
}

// =====================================================
// START
// =====================================================

startDiscord();
