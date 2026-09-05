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

const PORT = Number(process.env.PORT) || 10000;
const API_URL = `http://127.0.0.1:${PORT}`;

const TOKEN = String(
    process.env.DISCORD_TOKEN || ""
).trim();

const ADMIN_SECRET = String(
    process.env.NOVI_ADMIN_SECRET || ""
).trim();

/* =========================================================
   ALLOWED ROLES
========================================================= */

const ALLOWED_ROLE_IDS = [
    "1529705570209366167",
    "1378500563456626719"
];

/* =========================================================
   STARTUP
========================================================= */

console.log("");
console.log("========================================");
console.log("             NOVI DISCORD BOT");
console.log("========================================");

console.log(
    "Discord token:",
    TOKEN ? "FOUND" : "MISSING"
);

console.log(
    "Admin secret:",
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
   ADMIN HEADERS
========================================================= */

function adminHeaders() {
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-novi-admin-secret": ADMIN_SECRET
    };
}

/* =========================================================
   ROLE CHECK
========================================================= */

function hasPermission(message) {

    if (!message.member) {
        console.log(
            "[PERMISSION] No member object."
        );

        return false;
    }

    const roles =
        message.member.roles.cache;

    console.log(
        "[PERMISSION] User roles:",
        [...roles.keys()].join(", ") || "none"
    );

    const allowed =
        ALLOWED_ROLE_IDS.some(
            roleId =>
                roles.has(roleId)
        );

    console.log(
        "[PERMISSION] Allowed:",
        allowed
    );

    return allowed;
}

/* =========================================================
   READY
========================================================= */

client.once(
    "ready",
    () => {

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
    }
);

/* =========================================================
   MESSAGE EVENT
========================================================= */

client.on(
    "messageCreate",
    async message => {

        try {

            /*
             * IMPORTANT:
             * This proves whether Discord is actually
             * sending messages to the bot.
             */

            console.log("");
            console.log(
                "========================================"
            );
            console.log(
                "[MESSAGE RECEIVED]"
            );
            console.log(
                "Author:",
                message.author?.tag || "Unknown"
            );
            console.log(
                "Guild:",
                message.guild?.name || "DM"
            );
            console.log(
                "Content:",
                message.content || "(EMPTY)"
            );
            console.log(
                "========================================"
            );

            /* Ignore bots */

            if (message.author.bot) {
                return;
            }

            /* Ignore DMs */

            if (!message.guild) {
                return;
            }

            const content =
                String(
                    message.content || ""
                ).trim();

            if (!content) {
                console.log(
                    "[MESSAGE] Empty content."
                );

                return;
            }

            const args =
                content.split(/\s+/);

            const command =
                args[0].toLowerCase();

            console.log(
                "[COMMAND]:",
                command
            );

            /* =================================================
               !GEN
            ================================================= */

            if (command === "!gen") {

                console.log(
                    "[GEN] !gen detected."
                );

                /* Permission */

                if (!hasPermission(message)) {

                    console.log(
                        "[GEN] ❌ Permission denied."
                    );

                    await message.reply(
                        "❌ You don't have permission to use this command."
                    );

                    return;
                }

                console.log(
                    "[GEN] ✅ Permission accepted."
                );

                /* Duration */

                const duration =
                    String(
                        args[1] || ""
                    )
                        .trim()
                        .toLowerCase();

                const validDurations = [
                    "1d",
                    "3d",
                    "1week",
                    "1month",
                    "lifetime"
                ];

                if (
                    !validDurations.includes(
                        duration
                    )
                ) {

                    console.log(
                        "[GEN] Invalid duration:",
                        duration
                    );

                    await message.reply(
                        "❌ Invalid duration.\n\n" +
                        "Use:\n" +
                        "`!gen 1d`\n" +
                        "`!gen 3d`\n" +
                        "`!gen 1week`\n" +
                        "`!gen 1month`\n" +
                        "`!gen lifetime`"
                    );

                    return;
                }

                console.log(
                    `[GEN] Requesting ${duration} key...`
                );

                try {

                    /*
                     * Call the local Novi server.
                     */

                    const response =
                        await axios.post(
                            `${API_URL}/api/keys`,
                            {
                                duration: duration
                            },
                            {
                                headers:
                                    adminHeaders(),

                                timeout: 15000,

                                validateStatus:
                                    () => true
                            }
                        );

                    console.log(
                        "[GEN] HTTP:",
                        response.status
                    );

                    console.log(
                        "[GEN] Response:",
                        response.data
                    );

                    /* Server rejected request */

                    if (
                        response.status < 200 ||
                        response.status >= 300
                    ) {

                        const errorMessage =
                            response.data?.message ||
                            `Novi server returned HTTP ${response.status}.`;

                        console.error(
                            "[GEN] ❌",
                            errorMessage
                        );

                        await message.reply(
                            `❌ ${errorMessage}`
                        );

                        return;
                    }

                    /* No success */

                    if (
                        response.data?.success !== true
                    ) {

                        const errorMessage =
                            response.data?.message ||
                            "The server did not generate a key.";

                        console.error(
                            "[GEN] ❌",
                            errorMessage
                        );

                        await message.reply(
                            `❌ ${errorMessage}`
                        );

                        return;
                    }

                    /* Get key */

                    const key =
                        String(
                            response.data?.key || ""
                        ).trim();

                    if (!key) {

                        console.error(
                            "[GEN] ❌ Server returned no key."
                        );

                        await message.reply(
                            "❌ Novi generated the request but didn't return a key."
                        );

                        return;
                    }

                    const durationName =
                        response.data?.durationName ||
                        duration;

                    console.log(
                        "[GEN] ✅ KEY GENERATED"
                    );

                    /*
                     * Send the generated key to Discord.
                     */

                    await message.reply(
                        "🔑 **Novi Key Generated**\n\n" +
                        `\`${key}\`\n\n` +
                        `⏱️ **Duration:** ${durationName}`
                    );

                    console.log(
                        "[GEN] ✅ Discord reply sent."
                    );

                } catch (error) {

                    console.error("");
                    console.error(
                        "========================================"
                    );
                    console.error(
                        "[GEN] ❌ REQUEST FAILED"
                    );
                    console.error(
                        "========================================"
                    );

                    console.error(
                        "Message:",
                        error?.message
                    );

                    console.error(
                        "Code:",
                        error?.code
                    );

                    console.error(
                        "Status:",
                        error?.response?.status
                    );

                    console.error(
                        "Response:",
                        error?.response?.data
                    );

                    console.error(
                        "========================================"
                    );

                    try {

                        await message.reply(
                            "❌ Novi couldn't generate the key. Check the Render logs."
                        );

                    } catch (replyError) {

                        console.error(
                            "[GEN] Could not send error reply:",
                            replyError?.message
                        );
                    }
                }

                return;
            }

            /* =================================================
               !ADD
            ================================================= */

            if (command === "!add") {

                console.log(
                    "[ADD] !add detected."
                );

                if (!hasPermission(message)) {

                    await message.reply(
                        "❌ You don't have permission to use this command."
                    );

                    return;
                }

                let items = [];

                /*
                 * Items typed after !add
                 */

                const typedItems =
                    args
                        .slice(1)
                        .map(
                            item =>
                                item.trim()
                        )
                        .filter(
                            item =>
                                item.length > 0
                        );

                items.push(
                    ...typedItems
                );

                /*
                 * TXT attachment
                 */

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
                                .map(
                                    line =>
                                        line.trim()
                                )
                                .filter(
                                    line =>
                                        line.length > 0
                                );

                        items.push(
                            ...fileItems
                        );

                    } catch (error) {

                        console.error(
                            "[ADD] TXT ERROR:",
                            error?.message
                        );

                        await message.reply(
                            "❌ I couldn't read the TXT file."
                        );

                        return;
                    }
                }

                if (
                    items.length === 0
                ) {

                    await message.reply(
                        "❌ Nothing to add.\n\n" +
                        "Use `!add ITEM` or attach a `.txt` file."
                    );

                    return;
                }

                /*
                 * Remove duplicates.
                 */

                items =
                    [...new Set(items)];

                let added = 0;
                let duplicates = 0;
                let failed = 0;

                /*
                 * Add each item.
                 */

                for (
                    const item of items
                ) {

                    try {

                        const response =
                            await axios.post(
                                `${API_URL}/api/stock/add`,
                                {
                                    item
                                },
                                {
                                    headers:
                                        adminHeaders(),

                                    timeout:
                                        15000,

                                    validateStatus:
                                        () => true
                                }
                            );

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
                                "[ADD] Failed:",
                                response.status,
                                response.data
                            );
                        }

                    } catch (error) {

                        failed++;

                        console.error(
                            "[ADD] Error:",
                            error?.message
                        );
                    }
                }

                /*
                 * Get stock count.
                 */

                let totalStock =
                    "Unknown";

                try {

                    const response =
                        await axios.get(
                            `${API_URL}/api/admin/stock`,
                            {
                                headers:
                                    adminHeaders(),

                                timeout:
                                    10000,

                                validateStatus:
                                    () => true
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
                        "[ADD] Stock count error:",
                        error?.message
                    );
                }

                let result =
                    "📦 **Stock Updated**\n\n" +
                    `✅ **Added:** ${added}\n` +
                    `♻️ **Duplicates:** ${duplicates}\n` +
                    `📊 **Total Stock:** ${totalStock}`;

                if (failed > 0) {

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
                "[MESSAGE HANDLER ERROR]",
                error
            );
        }
    }
);

/* =========================================================
   DISCORD ERRORS
========================================================= */

client.on(
    "error",
    error => {

        console.error(
            "[DISCORD ERROR]",
            error
        );
    }
);

client.on(
    "shardError",
    error => {

        console.error(
            "[DISCORD SHARD ERROR]",
            error
        );
    }
);

client.on(
    "shardReconnecting",
    () => {

        console.log(
            "[DISCORD] Reconnecting..."
        );
    }
);

client.on(
    "shardResume",
    shardId => {

        console.log(
            `[DISCORD] Resumed shard ${shardId}`
        );
    }
);

client.on(
    "shardDisconnect",
    event => {

        console.log(
            `[DISCORD] Disconnected: ${event?.code || "unknown"}`
        );
    }
);

/* =========================================================
   PROCESS ERRORS
========================================================= */

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

/* =========================================================
   LOGIN
========================================================= */

async function startBot() {

    console.log(
        "[BOT] Connecting to Discord..."
    );

    try {

        await client.login(TOKEN);

        console.log(
            "[BOT] Login request completed."
        );

    } catch (error) {

        console.error(
            "[BOT] Login failed:",
            error
        );

        process.exit(1);
    }
}

startBot();
