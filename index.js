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

const PORT =
    Number(process.env.PORT) || 10000;

const API_URL =
    `http://127.0.0.1:${PORT}`;

const TOKEN =
    String(
        process.env.DISCORD_TOKEN || ""
    ).trim();

const ADMIN_SECRET =
    String(
        process.env.NOVI_ADMIN_SECRET || ""
    ).trim();

/* =========================================================
   CHECK ENV
========================================================= */

console.log(
    `[BOT] Token: ${TOKEN ? "FOUND" : "MISSING"}`
);

console.log(
    `[BOT] Admin secret: ${
        ADMIN_SECRET
            ? "FOUND"
            : "MISSING"
    }`
);

console.log(
    `[BOT] API: ${API_URL}`
);

if (!TOKEN) {
    console.error(
        "[BOT] DISCORD_TOKEN is missing."
    );

    process.exit(1);
}

if (!ADMIN_SECRET) {
    console.error(
        "[BOT] NOVI_ADMIN_SECRET is missing."
    );

    process.exit(1);
}

/* =========================================================
   CLIENT
========================================================= */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

/* =========================================================
   ROLES
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
            message.member.roles.cache.has(
                roleId
            )
    );
}

/* =========================================================
   READY
========================================================= */

client.once(
    "ready",
    () => {

        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "✅ NOVI BOT IS ONLINE"
        );
        console.log(
            "========================================"
        );

        console.log(
            `Bot: ${client.user.tag}`
        );

        console.log(
            `ID: ${client.user.id}`
        );

        console.log(
            `Servers: ${client.guilds.cache.size}`
        );

        console.log(
            "========================================"
        );
        console.log("");
    }
);

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

            /*
             * THIS LOG IS IMPORTANT.
             * It proves Discord messages are reaching
             * your Render bot.
             */

            console.log(
                `[MESSAGE] ${message.author.tag}: ${message.content}`
            );

            if (!message.guild) {
                return;
            }

            const content =
                String(
                    message.content || ""
                ).trim();

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

            if (
                command === "!gen"
            ) {

                console.log(
                    "[GEN] Command received."
                );

                /* Permission */

                if (!hasPermission(message)) {

                    console.log(
                        `[GEN] Permission denied for ${message.author.tag}`
                    );

                    await message.reply(
                        "❌ You don't have permission to use this command."
                    );

                    return;
                }

                console.log(
                    "[GEN] Permission accepted."
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

                    await message.reply(
                        "❌ Usage: `!gen 1d`, `!gen 3d`, `!gen 1week`, `!gen 1month`, or `!gen lifetime`"
                    );

                    return;
                }

                console.log(
                    `[GEN] Generating ${duration}...`
                );

                try {

                    const response =
                        await axios.post(
                            `${API_URL}/api/keys`,
                            {
                                duration
                            },
                            {
                                headers: {
                                    "Content-Type":
                                        "application/json",

                                    "x-novi-admin-secret":
                                        ADMIN_SECRET
                                },

                                timeout: 15000,

                                validateStatus:
                                    () => true
                            }
                        );

                    console.log(
                        `[GEN] Server status: ${response.status}`
                    );

                    console.log(
                        "[GEN] Server response:",
                        response.data
                    );

                    /* -----------------------------------------
                       SERVER ERROR
                    ----------------------------------------- */

                    if (
                        response.status < 200 ||
                        response.status >= 300
                    ) {

                        await message.reply(
                            `❌ ${
                                response.data?.message ||
                                `Server error ${response.status}.`
                            }`
                        );

                        return;
                    }

                    /* -----------------------------------------
                       SUCCESS CHECK
                    ----------------------------------------- */

                    if (
                        response.data?.success !== true
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
                       KEY
                    ----------------------------------------- */

                    const key =
                        String(
                            response.data?.key ||
                            ""
                        ).trim();

                    if (!key) {

                        await message.reply(
                            "❌ Server generated a response but no key was returned."
                        );

                        return;
                    }

                    console.log(
                        "[GEN] ✅ KEY GENERATED"
                    );

                    await message.reply(
                        "🔑 **Novi Key Generated**\n\n" +
                        `\`${key}\`\n\n` +
                        `⏱️ **Duration:** ${
                            response.data.durationName ||
                            duration
                        }`
                    );

                } catch (error) {

                    console.error(
                        "[GEN] REQUEST ERROR:",
                        error
                    );

                    await message.reply(
                        "❌ Failed to contact the Novi server."
                    );
                }

                return;
            }

            /* =================================================
               !ADD
            ================================================= */

            if (
                command === "!add"
            ) {

                if (!hasPermission(message)) {

                    await message.reply(
                        "❌ You don't have permission to use this command."
                    );

                    return;
                }

                let items = [];

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

                /* TXT */

                if (
                    message.attachments.size > 0
                ) {

                    const attachment =
                        message.attachments.first();

                    const filename =
                        String(
                            attachment.name ||
                            ""
                        ).toLowerCase();

                    if (
                        !filename.endsWith(
                            ".txt"
                        )
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
                                response.data ||
                                ""
                            )
                                .split(
                                    /\r?\n/
                                )
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
                            error
                        );

                        await message.reply(
                            "❌ I couldn't read the TXT file."
                        );

                        return;
                    }
                }

                /* Nothing */

                if (
                    items.length === 0
                ) {

                    await message.reply(
                        "❌ Nothing to add.\n\nUse `!add ITEM` or attach a `.txt` file."
                    );

                    return;
                }

                items =
                    [...new Set(items)];

                let added = 0;
                let duplicates = 0;
                let failed = 0;

                /* Add */

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
                                    headers: {
                                        "Content-Type":
                                            "application/json",

                                        "x-novi-admin-secret":
                                            ADMIN_SECRET
                                    },

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
                            error?.message ||
                            error
                        );
                    }
                }

                /* Count */

                let totalStock =
                    "Unknown";

                try {

                    const response =
                        await axios.get(
                            `${API_URL}/api/admin/stock`,
                            {
                                headers: {
                                    "x-novi-admin-secret":
                                        ADMIN_SECRET
                                },

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
                        "[ADD] Count error:",
                        error
                    );
                }

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
            `[DISCORD] Disconnected: ${event?.code}`
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

console.log(
    "[BOT] Connecting to Discord..."
);

client.login(TOKEN)
    .then(() => {

        console.log(
            "[BOT] Discord login completed."
        );

    })
    .catch(error => {

        console.error(
            "[BOT] Discord login failed:",
            error
        );
    });
