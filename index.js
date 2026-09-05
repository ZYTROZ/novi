require("dotenv").config();
require("./server.js");

const {
    Client,
    GatewayIntentBits
} = require("discord.js");

const axios = require("axios");
const WebSocket = require("ws");

/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 10000;

const API_URL = `http://127.0.0.1:${PORT}`;

const TOKEN = String(
    process.env.DISCORD_TOKEN || ""
)
    .trim()
    .replace(/^["']|["']$/g, "");

const ADMIN_SECRET = String(
    process.env.NOVI_ADMIN_SECRET || ""
)
    .trim()
    .replace(/^["']|["']$/g, "");

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
    "Token length:",
    TOKEN.length
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
    console.error(
        "ERROR: DISCORD_TOKEN is missing."
    );

    process.exit(1);
}

if (!ADMIN_SECRET) {
    console.error(
        "ERROR: NOVI_ADMIN_SECRET is missing."
    );

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
    ],

    ws: {
        version: 10
    }
});

/* =========================================================
   ALLOWED ROLES
========================================================= */

const ALLOWED_ROLE_IDS = [
    "1529705570209366167",
    "1378500563456626719"
];

/* =========================================================
   PERMISSION
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
   DISCORD EVENTS
========================================================= */

client.once("ready", () => {
    console.log("");
    console.log("========================================");
    console.log("✅ DISCORD BOT IS ONLINE");
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

client.on("error", error => {
    console.error("");
    console.error("========================================");
    console.error("❌ DISCORD CLIENT ERROR");
    console.error("========================================");

    console.error(
        error?.message || error
    );

    console.error("========================================");
});

client.on("shardError", error => {
    console.error("");
    console.error("========================================");
    console.error("❌ DISCORD GATEWAY ERROR");
    console.error("========================================");

    console.error(
        error?.message || error
    );

    console.error("========================================");
});

client.on("shardDisconnect", event => {
    console.error("");
    console.error("========================================");
    console.error("⚠️ DISCORD DISCONNECTED");
    console.error("========================================");

    console.error(
        "Close code:",
        event?.code || "Unknown"
    );

    console.error(
        "Reason:",
        event?.reason || "Unknown"
    );

    console.error("========================================");
});

client.on("shardReconnecting", () => {
    console.log(
        "🔄 Discord Gateway reconnecting..."
    );
});

client.on("shardResume", shardId => {
    console.log(
        `✅ Discord Gateway resumed on shard ${shardId}.`
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

                if (!hasPermission(message)) {

                    await message.reply(
                        "❌ You don't have permission to use this command."
                    );

                    return;
                }

                const duration =
                    String(
                        args[1] || ""
                    ).toLowerCase();

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
                        "❌ Usage: `!gen 1d`, `!gen 3d`, `!gen 1week`, `!gen 1month`, or `!gen lifetime`"
                    );

                    return;
                }

                try {

                    console.log(
                        `[GEN] ${message.author.tag} -> ${duration}`
                    );

                    const response =
                        await axios.post(
                            `${API_URL}/api/keys`,
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

                        await message.reply(
                            response.data?.message ||
                            "❌ Failed to generate key."
                        );

                        return;
                    }

                    const key =
                        response.data.key;

                    if (!key) {

                        await message.reply(
                            "❌ Server did not return a key."
                        );

                        return;
                    }

                    await message.reply(
                        `🔑 **Novi Key Generated**\n\n` +
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

                    await message.reply(
                        "❌ Could not connect to the Novi server."
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

                /* ---------------------------------------------
                   ITEMS AFTER !ADD
                --------------------------------------------- */

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

                /* ---------------------------------------------
                   TXT FILE
                --------------------------------------------- */

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
                                response.data
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
                            error.message
                        );

                        await message.reply(
                            "❌ I couldn't read the TXT file."
                        );

                        return;
                    }
                }

                /* ---------------------------------------------
                   NOTHING TO ADD
                --------------------------------------------- */

                if (
                    items.length === 0
                ) {

                    await message.reply(
                        "❌ Nothing to add.\n\n" +
                        "Use `!add ITEM` or attach a `.txt` file."
                    );

                    return;
                }

                /* ---------------------------------------------
                   REMOVE DUPLICATES
                --------------------------------------------- */

                items =
                    [...new Set(items)];

                let added = 0;
                let duplicates = 0;
                let failed = 0;

                /* ---------------------------------------------
                   ADD ITEMS
                --------------------------------------------- */

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
                                    response.data.added || 0
                                );

                            duplicates +=
                                Number(
                                    response.data.duplicates || 0
                                );

                        } else {

                            failed++;
                        }

                    } catch (error) {

                        failed++;

                        console.error(
                            "[ADD ERROR]",
                            error.response?.data ||
                            error.message
                        );
                    }
                }

                /* ---------------------------------------------
                   TOTAL STOCK
                --------------------------------------------- */

                let totalStock =
                    "Unknown";

                try {

                    const response =
                        await axios.get(
                            `${API_URL}/api/admin/stock`,
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

                /* ---------------------------------------------
                   RESULT
                --------------------------------------------- */

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
   GATEWAY + TOKEN TEST
========================================================= */

async function testDiscordGateway() {

    return new Promise(resolve => {

        console.log("");
        console.log("========================================");
        console.log("TESTING DISCORD GATEWAY");
        console.log("========================================");

        const socket =
            new WebSocket(
                "wss://gateway.discord.gg/?v=10&encoding=json"
            );

        let finished = false;

        let heartbeatTimer = null;

        const timeout =
            setTimeout(() => {

                if (finished) {
                    return;
                }

                finished = true;

                if (heartbeatTimer) {
                    clearInterval(
                        heartbeatTimer
                    );
                }

                console.error(
                    "❌ DISCORD GATEWAY TEST TIMED OUT"
                );

                try {
                    socket.close();
                } catch {}

                resolve(false);

            }, 15000);

        function finish(result) {

            if (finished) {
                return;
            }

            finished = true;

            clearTimeout(timeout);

            if (heartbeatTimer) {
                clearInterval(
                    heartbeatTimer
                );
            }

            try {
                socket.close();
            } catch {}

            resolve(result);
        }

        socket.on("open", () => {

            console.log(
                "✅ Discord Gateway connection opened."
            );
        });

        socket.on("message", data => {

            try {

                const payload =
                    JSON.parse(
                        data.toString()
                    );

                /*
                 * Opcode 10 = HELLO
                 */

                if (payload.op === 10) {

                    console.log(
                        "✅ Discord Gateway HELLO received."
                    );

                    const interval =
                        payload.d?.heartbeat_interval;

                    /*
                     * Opcode 2 = IDENTIFY
                     */

                    socket.send(
                        JSON.stringify({
                            op: 2,

                            d: {
                                token: TOKEN,

                                intents:
                                    GatewayIntentBits.Guilds |
                                    GatewayIntentBits.GuildMessages |
                                    GatewayIntentBits.MessageContent,

                                properties: {
                                    os: "linux",
                                    browser: "novi",
                                    device: "novi"
                                }
                            }
                        })
                    );

                    console.log(
                        "Bot identification sent."
                    );

                    /*
                     * Heartbeat
                     */

                    if (interval) {

                        heartbeatTimer =
                            setInterval(() => {

                                if (
                                    socket.readyState ===
                                    WebSocket.OPEN
                                ) {

                                    socket.send(
                                        JSON.stringify({
                                            op: 1,
                                            d: null
                                        })
                                    );
                                }

                            }, interval);
                    }

                    return;
                }

                /*
                 * Opcode 0 = DISPATCH
                 */

                if (
                    payload.op === 0 &&
                    payload.t === "READY"
                ) {

                    console.log("");
                    console.log(
                        "========================================"
                    );
                    console.log(
                        "✅ BOT TOKEN IS VALID"
                    );
                    console.log(
                        "========================================"
                    );

                    console.log(
                        "Bot ID:",
                        payload.d?.user?.id ||
                        "Unknown"
                    );

                    console.log(
                        "Bot:",
                        payload.d?.user?.username ||
                        "Unknown"
                    );

                    console.log(
                        "Guilds:",
                        payload.d?.guilds?.length ??
                        "Unknown"
                    );

                    console.log(
                        "========================================"
                    );

                    finish(true);

                    return;
                }

                /*
                 * Opcode 9 = INVALID SESSION
                 */

                if (payload.op === 9) {

                    console.error("");
                    console.error(
                        "========================================"
                    );
                    console.error(
                        "❌ DISCORD REJECTED THE BOT SESSION"
                    );
                    console.error(
                        "========================================"
                    );

                    console.error(
                        "Discord returned an invalid session."
                    );

                    console.error(
                        "The bot token or session configuration may be invalid."
                    );

                    console.error(
                        "========================================"
                    );

                    finish(false);

                    return;
                }

                /*
                 * Authentication / gateway error
                 */

                if (
                    payload.op === 0 &&
                    payload.t === "RESUMED"
                ) {

                    console.log(
                        "Discord session resumed."
                    );
                }

            } catch (error) {

                console.error(
                    "Gateway message error:",
                    error.message
                );
            }
        });

        socket.on("error", error => {

            console.error("");
            console.error(
                "❌ DISCORD GATEWAY ERROR:"
            );

            console.error(
                error?.message ||
                error
            );

            finish(false);
        });

        socket.on("close", (code, reason) => {

            if (!finished) {

                console.error("");
                console.error(
                    "========================================"
                );
                console.error(
                    "❌ DISCORD GATEWAY CLOSED"
                );
                console.error(
                    "========================================"
                );

                console.error(
                    "Close code:",
                    code
                );

                console.error(
                    "Reason:",
                    reason?.toString() ||
                    "None"
                );

                console.error(
                    "========================================"
                );

                finish(false);
            }
        });
    });
}

/* =========================================================
   START DISCORD
========================================================= */

async function startDiscord() {

    const gatewayWorks =
        await testDiscordGateway();

    if (!gatewayWorks) {

        console.error("");
        console.error(
            "❌ Discord bot startup stopped because the Gateway/token test failed."
        );

        /*
         * Keep the web server alive so Render
         * can still serve Novi.
         */

        return;
    }

    console.log("");
    console.log(
        "Starting Discord.js..."
    );

    console.log(
        "Connecting Discord.js to Discord..."
    );

    try {

        await client.login(TOKEN);

        console.log(
            "Discord.js login request completed."
        );

    } catch (error) {

        console.error("");
        console.error(
            "========================================"
        );
        console.error(
            "❌ DISCORD.JS LOGIN FAILED"
        );
        console.error(
            "========================================"
        );

        console.error(
            "Name:",
            error?.name ||
            "Unknown"
        );

        console.error(
            "Code:",
            error?.code ||
            "Unknown"
        );

        console.error(
            "Message:",
            error?.message ||
            error
        );

        console.error(
            "========================================"
        );
    }
}

startDiscord();
