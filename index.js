// =========================================================
// LOAD ENVIRONMENT VARIABLES FIRST
// =========================================================

require("dotenv").config();

// =========================================================
// START NOVI WEBSITE / API SERVER
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
// NOVI API
// =========================================================

const SERVER_URL =
    `http://127.0.0.1:${process.env.PORT || 10000}`;

// =========================================================
// ENVIRONMENT VARIABLES
// =========================================================

const DISCORD_TOKEN =
    process.env.DISCORD_TOKEN;

const ADMIN_SECRET =
    process.env.NOVI_ADMIN_SECRET;

// =========================================================
// CONNECTION STATE
// =========================================================

let discordLoginStarted = false;

// =========================================================
// CHECK ENVIRONMENT
// =========================================================

if (!DISCORD_TOKEN) {
    console.error(
        "================================"
    );

    console.error(
        "DISCORD_TOKEN is missing."
    );

    console.error(
        "Add DISCORD_TOKEN to Render Environment Variables."
    );

    console.error(
        "================================"
    );

    process.exit(1);
}

if (!ADMIN_SECRET) {
    console.error(
        "================================"
    );

    console.error(
        "NOVI_ADMIN_SECRET is missing."
    );

    console.error(
        "Add NOVI_ADMIN_SECRET to Render Environment Variables."
    );

    console.error(
        "================================"
    );

    process.exit(1);
}

// =========================================================
// DISCORD ERROR LOGGING
// =========================================================

client.on(
    "error",
    (error) => {
        console.error(
            "================================"
        );

        console.error(
            "Discord client error:"
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
            "Discord warning:",
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
            "Discord gateway error:"
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
            `Discord disconnected. Code: ${event.code}`
        );

        if (event.reason) {
            console.warn(
                `Reason: ${event.reason}`
            );
        }

        console.warn(
            "discord.js will attempt to reconnect automatically."
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
            "================================"
        );

        console.log(
            "Discord reconnecting..."
        );

        console.log(
            "================================"
        );
    }
);

client.on(
    "shardResume",
    (shardId, replayedEvents) => {
        console.log(
            "================================"
        );

        console.log(
            `Discord connection resumed. Shard: ${shardId}`
        );

        console.log(
            `Replayed events: ${replayedEvents}`
        );

        console.log(
            "================================"
        );
    }
);

// =========================================================
// BOT READY
// =========================================================

client.once(
    "ready",
    () => {
        console.log(
            "================================"
        );

        console.log(
            "NOVI DISCORD BOT IS ONLINE"
        );

        console.log(
            `Logged in as: ${client.user.tag}`
        );

        console.log(
            `Bot ID: ${client.user.id}`
        );

        console.log(
            `Servers: ${client.guilds.cache.size}`
        );

        console.log(
            `Novi API: ${SERVER_URL}`
        );

        console.log(
            "================================"
        );
    }
);

// =========================================================
// API HEADERS
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
// CHECK PERMISSION
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
// COMMAND HANDLER
// =========================================================

client.on(
    "messageCreate",
    async (message) => {

        /* ---------------------------------------------------
           Ignore bots
        --------------------------------------------------- */

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

            /* =================================================
               !GEN
            ================================================= */

            if (command === "!gen") {

                if (!message.member) {
                    return message.reply(
                        "This command can only be used in a server."
                    );
                }

                if (
                    !hasPermission(
                        message
                    )
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
                        "Usage: !gen 1d, !gen 3d, !gen 1week, !gen 1month, or !gen lifetime"
                    );
                }

                console.log(
                    `Generating ${duration} key...`
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

                    const generatedKey =
                        response.data.key;

                    if (!generatedKey) {
                        console.error(
                            "Server created key but did not return it:",
                            response.data
                        );

                        return message.reply(
                            "The key was created, but the server did not return the key."
                        );
                    }

                    console.log(
                        `Key successfully created: ${generatedKey}`
                    );

                    const durationName =
                        response.data.durationName ||
                        duration;

                    return message.reply(
                        `**Novi Key Generated**\n\n` +
                        `\`${generatedKey}\`\n\n` +
                        `**Duration:** ${durationName}`
                    );

                } catch (error) {

                    console.error(
                        "Novi API key error:",
                        error.response?.data ||
                        error.message
                    );

                    if (
                        error.response?.status ===
                        403
                    ) {
                        return message.reply(
                            "The bot is not authorized to access the Novi admin API."
                        );
                    }

                    if (
                        error.response?.status ===
                        503
                    ) {
                        return message.reply(
                            "The Novi admin secret is not configured on the server."
                        );
                    }

                    return message.reply(
                        "Could not connect to the Novi server."
                    );
                }
            }

            /* =================================================
               !ADD
            ================================================= */

            if (command === "!add") {

                if (!message.member) {
                    return message.reply(
                        "This command can only be used in a server."
                    );
                }

                if (
                    !hasPermission(
                        message
                    )
                ) {
                    return message.reply(
                        "You don't have permission to add stock."
                    );
                }

                let items = [];

                /* ------------------------------------------------
                   Items after !add
                ------------------------------------------------ */

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

                /* ------------------------------------------------
                   TXT attachment
                ------------------------------------------------ */

                if (
                    message.attachments.size >
                    0
                ) {
                    const attachment =
                        message.attachments.first();

                    const filename =
                        attachment.name
                            ?.toLowerCase() ||
                        "";

                    if (
                        !filename.endsWith(
                            ".txt"
                        )
                    ) {
                        return message.reply(
                            "The attachment must be a .txt file."
                        );
                    }

                    try {
                        const fileResponse =
                            await axios.get(
                                attachment.url,
                                {
                                    responseType:
                                        "text",
                                    timeout: 15000
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
                                        line.length >
                                        0
                                );

                        items.push(
                            ...fileItems
                        );

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

                /* ------------------------------------------------
                   Nothing provided
                ------------------------------------------------ */

                if (
                    items.length === 0
                ) {
                    return message.reply(
                        "Nothing to add.\n\n" +
                        "Use:\n" +
                        "`!add CODE-123`\n\n" +
                        "Or attach a `.txt` file with one item per line and type:\n" +
                        "`!add`"
                    );
                }

                /* ------------------------------------------------
                   Remove duplicates from the
                   submitted list itself
                ------------------------------------------------ */

                items =
                    [...new Set(items)];

                let added = 0;
                let duplicates = 0;
                let failed = 0;

                /* ------------------------------------------------
                   Add every item
                ------------------------------------------------ */

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
                            response.data &&
                            response.data.success
                        ) {
                            added +=
                                Number(
                                    response
                                        .data
                                        .added ||
                                    0
                                );

                            duplicates +=
                                Number(
                                    response
                                        .data
                                        .duplicates ||
                                    0
                                );
                        } else {
                            failed++;
                        }

                    } catch (error) {

                        console.error(
                            `Failed to add stock item: ${item}`,
                            error.response
                                ?.data ||
                            error.message
                        );

                        failed++;
                    }
                }

                /* ------------------------------------------------
                   Get stock count using
                   admin endpoint
                ------------------------------------------------ */

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
                        stockResponse.data &&
                        typeof stockResponse
                            .data
                            .count ===
                            "number"
                    ) {
                        totalStock =
                            stockResponse
                                .data
                                .count;
                    }

                } catch (error) {

                    console.error(
                        "Could not get stock count:",
                        error.response
                            ?.data ||
                        error.message
                    );
                }

                /* ------------------------------------------------
                   Result
                ------------------------------------------------ */

                let reply =
                    `**Stock Added Successfully**\n\n` +
                    `**Added:** ${added}\n` +
                    `**Duplicates:** ${duplicates}\n` +
                    `**Total stock:** ${totalStock}`;

                if (
                    failed > 0
                ) {
                    reply +=
                        `\n**Failed:** ${failed}`;
                }

                return message.reply(
                    reply
                );
            }

        } catch (error) {

            console.error(
                "Discord command error:",
                error
            );

            try {
                await message.reply(
                    "Something went wrong while processing that command."
                );
            } catch (
                replyError
            ) {
                console.error(
                    "Could not send error reply:",
                    replyError.message
                );
            }
        }
    }
);

/* =========================================================
   DISCORD LOGIN
========================================================= */

async function startDiscord() {

    if (
        discordLoginStarted
    ) {
        console.log(
            "Discord login has already been started."
        );

        return;
    }

    discordLoginStarted = true;

    console.log(
        "================================"
    );

    console.log(
        "Connecting to Discord..."
    );

    console.log(
        "Token detected: YES"
    );

    console.log(
        "Admin secret detected: YES"
    );

    console.log(
        "================================"
    );

    try {

        await client.login(
            DISCORD_TOKEN
        );

        console.log(
            "================================"
        );

        console.log(
            "Discord login successful."
        );

        console.log(
            "Waiting for READY event..."
        );

        console.log(
            "================================"
        );

    } catch (error) {

        console.error(
            "================================"
        );

        console.error(
            "Discord login failed."
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

        console.log(
            "Discord login failed. Retrying in 15 seconds..."
        );

        setTimeout(
            () => {
                startDiscord().catch(
                    (retryError) => {
                        console.error(
                            "Discord retry error:",
                            retryError
                        );
                    }
                );
            },
            15000
        );
    }
}

/* =========================================================
   PROCESS ERROR HANDLING
========================================================= */

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

/* =========================================================
   START DISCORD
========================================================= */

startDiscord();
