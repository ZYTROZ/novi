require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ActivityType
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
  console.log("======================================");
  console.log("       NOVI DISCORD BOT ONLINE");
  console.log("======================================");
  console.log(`Logged in as: ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      {
        name: "Novi",
        type: ActivityType.Watching
      }
    ],
    status: "online"
  });
});

client.on("error", (error) => {
  console.error("Discord error:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled error:", error);
});

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing from Render.");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("❌ Discord login failed:");
  console.error(error);
});
