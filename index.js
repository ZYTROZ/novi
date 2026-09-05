// =========================================================
// NOVI - DISCORD BOT + API SERVER
// =========================================================

require("dotenv").config();

// =========================================================
// START NOVI SERVER
// =========================================================

require("./server.js");

// =========================================================
// IMPORTS
// =========================================================

const {
    Client,
    GatewayIntentBits
} = require("discord.js");

const axios = require("axios");

// =========================================================
// CONFIG
// =========================================================

const PORT =
    process.env.PORT || 10000;

const SERVER_URL =
    `http://127.0.0.1:${PORT}`;

const DISCORD_TOKEN =
    process.env.DISCORD_TOKEN;

const ADMIN_SECRET =
    process.env.NOVI_ADMIN_SECRET;

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
// STATE
// =========================================================

let discordLoginStarted = false;

// =========================================================
// STARTUP LOG
// =========================================================

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

// =========================================================
// ENVIRONMENT CHECK
// =========================================================

if (!DISCORD_TOKEN) {

    console.error(
        "DISCORD_TOKEN is missing."
    );

    console.error(
        "Add DISCORD_TOKEN to Render Environment Variables."
    );

    process.exit(1);
}

if (!ADMIN_SECRET) {

    console.error(
        "NOVI_ADMIN_SECRET is missing."
    );

    console.error(
        "Add NOVI_ADMIN_SECRET to Render Environment Variables."
    );

    process.exit(1);
}

// =========================================================
// DISCORD ERROR EVENTS
// =========================================================

client.on(
    "error",
    (error) => {

        console.error(
            "================================"
        );

        console.error(
            "DISCORD CLIENT ERROR"
        );

        console.error(error);

        console.error(
            "================================"
        );
    }
);

client.on(
    "warn",
    (warning) => {

        console.warn(
            "DISCORD WARNING:",
            warning
        );
    }
);

client.on(
    "shardError",
    (error) => {

        console.error(
            "================================"
        );

        console.error(
            "DISCORD SHARD ERROR"
        );

        console.error(error);

        console.error(
            "================================"
        );
    }
);

client.on(
    "shardDisconnect",
    (event) => {

        console.warn(
            "================================"
        );

        console.warn(
            "DISCORD SHARD DISCONNECTED"
        );

        console.warn(
            "Code:",
            event.code
        );

        console.warn(
            "Reason:",
            event.reason || "Unknown"
        );

        console.warn(
            "================================"
        );
    }
);

client.on(
    "shardReconnecting",
    () => {

        console.log(
            "Discord shard reconnecting..."
        );
    }
);

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

// =========================================================
// BOT READY
// =========================================================

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

// =========================================================
// ADMIN HEADERS
// =========================================================

function adminHeaders() {

    return {
        "Content-Type":
            "application/json",

        "x-novi-admin-secret":
            ADMIN_SECRET
    };
}

// =========================================================
// ROLE PERMISSION
// =========================================================

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

// =========================================================
// MESSAGE COMMANDS
// =========================================================

client.on(
    "messageCreate",
    async (message) => {

        // Ignore bots
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
                    `Generating ${duration} key for ${message.author.tag}...`
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
                        !response.data ||
                        !response.data.success
                    ) {

                        console.error(
                            "Key generation rejected:",
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
                            "Server did not return a key:",
                            response.data
                        );

                        return message.reply(
                            "The server created the key but did not return it."
                        );
                    }

                    console.log(
                        "Key generated successfully."
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
                        "Key generation error:",
                        error.response?.data ||
                        error.message
                    );

                    if (
                        error.response?.status === 403
                    ) {

                        return message.reply(
                            "The Discord bot is not authorized to use the Novi admin API."
                        );
                    }

                    if (
                        error.response?.status === 503
                    ) {

                        return message.reply(
                            "The Novi admin authentication is not configured correctly."
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

                // -------------------------------------------------
                // Direct items
                // -------------------------------------------------

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

                // -------------------------------------------------
                // TXT attachment
                // -------------------------------------------------

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
                            "TXT download error:",
                            error.message
                        );

                        return message.reply(
                            "I couldn't read the `.txt` file."
                        );
                    }
                }

                // -------------------------------------------------
                // Nothing supplied
                // -------------------------------------------------

                if (
                    items.length === 0
                ) {

                    return message.reply(
                        "**Nothing to add.**\n\n" +
                        "Use `!add ITEM` or attach a `.txt` file and type `!add`."
                    );
                }

                // -------------------------------------------------
                // Remove duplicates
                // -------------------------------------------------

                items =
                    [...new Set(items)];

                let added = 0;
                let duplicates = 0;
                let failed = 0;

                // -------------------------------------------------
                // Add stock
                // -------------------------------------------------

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
                            "Failed to add stock item:",
                            error.response?.data ||
                            error.message
                        );
                    }
                }

                // -------------------------------------------------
                // Get stock count
                // -------------------------------------------------

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
                        "Stock count error:",
                        error.response?.data ||
                        error.message
                    );
                }

                // -------------------------------------------------
                // Result
                // -------------------------------------------------

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
                "Command handler error:",
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

// =========================================================
// DISCORD LOGIN
// =========================================================

async function startDiscord() {

    if (
        discordLoginStarted
    ) {

        console.log(
            "Discord login already started."
        );

        return;
    }

    discordLoginStarted =
        true;

    console.log("");
    console.log(
        "================================"
    );

    console.log(
        "NOVI DISCORD CONNECTION"
    );

    console.log(
        "================================"
    );

    console.log(
        "Token detected:",
        Boolean(DISCORD_TOKEN)
    );

    console.log(
        "Token length:",
        DISCORD_TOKEN?.length || 0
    );

    // =====================================================
    // TEST BOT TOKEN ONCE
    // =====================================================

    console.log("");
    console.log(
        "Checking Discord bot authentication..."
    );

    try {

        const response =
            await axios.get(
                "https://discord.com/api/v10/users/@me",
                {
                    timeout: 10000,

                    headers: {
                        Authorization:
                            `Bot ${DISCORD_TOKEN}`
                    }
                }
            );

        console.log(
            "Discord authentication: SUCCESS"
        );

        console.log(
            "Bot username:",
            response.data?.username ||
            "Unknown"
        );

        console.log(
            "Bot ID:",
            response.data?.id ||
            "Unknown"
        );

    } catch (error) {

        console.error("");
        console.error(
            "================================"
        );

        console.error(
            "DISCORD AUTHENTICATION FAILED"
        );

        console.error(
            "HTTP status:",
            error.response?.status ||
            "Unknown"
        );

        console.error(
            "Error code:",
            error.code ||
            "Unknown"
        );

        console.error(
            "Error message:",
            error.message ||
            "Unknown"
        );

        if (
            error.response?.status === 401
        ) {

            console.error(
                "THE DISCORD TOKEN IS INVALID OR EXPIRED."
            );
        }

        if (
            error.response?.status === 429
        ) {

            console.error(
                "DISCORD RATE LIMITED THE REQUEST."
            );

            console.error(
                "Do not repeatedly restart/deploy the service."
            );
        }

        console.error(
            "================================"
        );

        discordLoginStarted =
            false;

        return;
    }

    // =====================================================
    // ACTUAL DISCORD.JS LOGIN
    // =====================================================

    console.log("");
    console.log(
        "Discord API authentication works."
    );

    console.log(
        "Connecting to Discord Gateway..."
    );

    console.log(
        "================================"
    );

    try {

        await client.login(
            DISCORD_TOKEN
        );

        console.log("");
        console.log(
            "================================"
        );

        console.log(
            "DISCORD LOGIN SUCCESSFUL"
        );

        console.log(
            `Logged in as: ${
                client.user?.tag ||
                "Unknown"
            }`
        );

        console.log(
            `Bot ID: ${
                client.user?.id ||
                "Unknown"
            }`
        );

        console.log(
            "================================"
        );

    } catch (error) {

        console.error("");
        console.error(
            "================================"
        );

        console.error(
            "DISCORD.JS LOGIN FAILED"
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

        discordLoginStarted =
            false;

        try {
            client.destroy();
        } catch {}

        console.error(
            "Discord login failed."
        );

        console.error(
            "Fix the error above before restarting the service."
        );
    }
}

// =========================================================
// PROCESS ERROR HANDLING
// =========================================================

process.on(
    "unhandledRejection",
    (error) => {

        console.error(
            "UNHANDLED PROMISE REJECTION:"
        );

        console.error(error);
    }
);

process.on(
    "uncaughtException",
    (error) => {

        console.error(
            "UNCAUGHT EXCEPTION:"
        );

        console.error(error);
    }
);

// =========================================================
// START DISCORD
// =========================================================

startDiscord();
