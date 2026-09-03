require("dotenv").config();

const {
    Client,
    GatewayIntentBits
} = require("discord.js");

const crypto = require("crypto");
const axios = require("axios");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});


/* =========================================================
   CONFIG
========================================================= */

const ALLOWED_ROLE_IDS = [
    "1529705570209366167",
    "1378500563456626719"
];

const PORT = process.env.PORT || 3000;

const SERVER_URL =
    `http://127.0.0.1:${PORT}`;


/* =========================================================
   BOT READY
========================================================= */

client.once("ready", () => {

    console.log(
        `Novi bot is online as ${client.user.tag}`
    );

});


/* =========================================================
   GENERATE NOVI KEY
========================================================= */

function generateKey() {

    const part1 =
        crypto.randomBytes(2)
            .toString("hex")
            .toUpperCase();

    const part2 =
        crypto.randomBytes(2)
            .toString("hex")
            .toUpperCase();

    const part3 =
        crypto.randomBytes(2)
            .toString("hex")
            .toUpperCase();

    const part4 =
        crypto.randomBytes(2)
            .toString("hex")
            .toUpperCase();

    return `NOVI-${part1}-${part2}-${part3}-${part4}`;
}


/* =========================================================
   CHECK PERMISSION
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
   MESSAGE HANDLER
========================================================= */

client.on("messageCreate", async (message) => {

    if (message.author.bot) {
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
        args[0]?.toLowerCase();


    /* =====================================================
       !GEN
    ===================================================== */

    if (command === "!gen") {

        if (!message.member) {

            return message.reply(
                "❌ This command can only be used in a server."
            );

        }


        if (!hasPermission(message)) {

            return message.reply(
                "❌ You don't have permission to generate keys."
            );

        }


        const duration =
            args[1]?.toLowerCase();


        const allowedDurations = [
            "1d",
            "1week",
            "1month",
            "1year",
            "lifetime"
        ];


        if (
            !allowedDurations.includes(
                duration
            )
        ) {

            return message.reply(
                "❌ Usage: `!gen 1d`, `!gen 1week`, `!gen 1month`, `!gen 1year`, or `!gen lifetime`"
            );

        }


        const key =
            generateKey();


        try {

            const response =
                await axios.post(
                    `${SERVER_URL}/api/keys`,
                    {
                        key: key,
                        duration: duration
                    },
                    {
                        timeout: 5000
                    }
                );


            if (
                !response.data ||
                !response.data.success
            ) {

                return message.reply(
                    "❌ The server rejected the key."
                );

            }


            console.log(
                `✅ Saved key: ${key} (${duration})`
            );


            return message.reply(
                `🔑 **Novi Key Generated**\n\n` +
                `\`${key}\`\n\n` +
                `⏱️ Duration: **${duration}**`
            );


        } catch (error) {

            console.error(
                "❌ Could not save key:",
                error.response?.data ||
                error.message
            );


            return message.reply(
                "❌ The key could not be saved to the Novi server."
            );

        }

    }


    /* =====================================================
       !ADD
    ===================================================== */

    if (command === "!add") {

        if (!message.member) {

            return message.reply(
                "❌ This command can only be used in a server."
            );

        }


        if (!hasPermission(message)) {

            return message.reply(
                "❌ You don't have permission to add stock."
            );

        }


        let items = [];


        /* =================================================
           ADD ITEMS FROM COMMAND
        ================================================= */

        const commandItems =
            args
                .slice(1)
                .map(item => item.trim())
                .filter(item => item.length > 0);


        items.push(
            ...commandItems
        );


        /* =================================================
           ADD ITEMS FROM TXT ATTACHMENT
        ================================================= */

        if (message.attachments.size > 0) {

            const attachment =
                message.attachments.first();


            const filename =
                attachment.name?.toLowerCase() || "";


            if (
                !filename.endsWith(".txt")
            ) {

                return message.reply(
                    "❌ The attachment must be a `.txt` file."
                );

            }


            try {

                console.log(
                    `📥 Reading stock file: ${attachment.name}`
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
                    String(
                        fileResponse.data
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
                    "❌ Could not read stock file:",
                    error.message
                );


                return message.reply(
                    "❌ I couldn't read that `.txt` file."
                );

            }

        }


        /* =================================================
           NOTHING TO ADD
        ================================================= */

        if (items.length === 0) {

            return message.reply(
                "❌ Nothing to add.\n\n" +
                "Use:\n" +
                "`!add CODE-123`\n\n" +
                "Or attach a `.txt` file with one item per line and type:\n" +
                "`!add`"
            );

        }


        /* =================================================
           REMOVE DUPLICATES FROM SUBMISSION
        ================================================= */

        items =
            [...new Set(items)];


        /* =================================================
           ADD TO WEBSITE STOCK
        ================================================= */

        try {

            const response =
                await axios.post(
                    `${SERVER_URL}/api/stock/add`,
                    {
                        items: items
                    },
                    {
                        timeout: 15000
                    }
                );


            const result =
                response.data;


            if (
                !result ||
                !result.success
            ) {

                return message.reply(
                    `❌ ${
                        result?.message ||
                        "The server rejected the stock."
                    }`
                );

            }


            console.log(
                `✅ Added ${result.added} stock item(s).`
            );


            let reply =
                `✅ **Stock Added Successfully!**\n\n` +
                `📦 Added: **${result.added}**\n` +
                `🔁 Duplicates skipped: **${result.duplicates}**\n` +
                `📊 Total stock: **${result.remaining}**`;


            if (
                result.invalid > 0
            ) {

                reply +=
                    `\n⚠️ Invalid items skipped: **${result.invalid}**`;

            }


            return message.reply(
                reply
            );


        } catch (error) {

            console.error(
                "❌ Could not add stock:",
                error.response?.data ||
                error.message
            );


            return message.reply(
                "❌ Could not connect to the Novi stock server."
            );

        }

    }

});


/* =========================================================
   DISCORD TOKEN CHECK
========================================================= */

if (!process.env.DISCORD_TOKEN) {

    console.error(
        "❌ DISCORD_TOKEN is missing from Render Environment Variables."
    );

    process.exit(1);

}


/* =========================================================
   LOGIN
========================================================= */

client.login(
    process.env.DISCORD_TOKEN
);
