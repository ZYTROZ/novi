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

const ALLOWED_ROLE_IDS = [
    "1529705570209366167",
    "1378500563456626719"
];

const PORT = process.env.PORT || 3000;

client.once("ready", () => {
    console.log(`Novi bot is online as ${client.user.tag}`);
});

function generateKey() {
    const part1 = crypto.randomBytes(2).toString("hex").toUpperCase();
    const part2 = crypto.randomBytes(2).toString("hex").toUpperCase();
    const part3 = crypto.randomBytes(2).toString("hex").toUpperCase();
    const part4 = crypto.randomBytes(2).toString("hex").toUpperCase();

    return `NOVI-${part1}-${part2}-${part3}-${part4}`;
}

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/\s+/);

    if (!args[0] || args[0].toLowerCase() !== "!gen") {
        return;
    }

    if (!message.member) {
        return message.reply(
            "❌ This command can only be used in a server."
        );
    }

    const hasPermission = ALLOWED_ROLE_IDS.some(roleId =>
        message.member.roles.cache.has(roleId)
    );

    if (!hasPermission) {
        return message.reply(
            "❌ You don't have permission to generate keys."
        );
    }

    const duration = args[1]?.toLowerCase();

    const allowedDurations = [
        "1d",
        "1week",
        "1month",
        "1year",
        "lifetime"
    ];

    if (!allowedDurations.includes(duration)) {
        return message.reply(
            "❌ Usage: `!gen 1d`, `!gen 1week`, `!gen 1month`, `!gen 1year`, or `!gen lifetime`"
        );
    }

    const key = generateKey();

    try {
        const response = await axios.post(
            `http://127.0.0.1:${PORT}/api/keys`,
            {
                key: key,
                duration: duration
            },
            {
                timeout: 5000
            }
        );

        if (!response.data.success) {
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
            error.response?.data || error.message
        );

        return message.reply(
            "❌ The key could not be saved to the Novi server."
        );
    }
});

if (!process.env.DISCORD_TOKEN) {
    console.error(
        "❌ DISCORD_TOKEN is missing from Render Environment Variables."
    );
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
