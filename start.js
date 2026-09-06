const { spawn } = require("child_process");

console.log("======================================");
console.log("           STARTING NOVI");
console.log("======================================");

// START WEBSITE
const website = spawn(process.execPath, ["index.js"], {
  stdio: "inherit",
  env: process.env
});

// START DISCORD BOT
const bot = spawn(process.execPath, ["bot.js"], {
  stdio: "inherit",
  env: process.env
});

website.on("error", (err) => {
  console.error("Failed to start website:");
  console.error(err);
});

bot.on("error", (err) => {
  console.error("Failed to start Discord bot:");
  console.error(err);
});

website.on("exit", (code, signal) => {
  console.log(
    signal
      ? `Website stopped because of signal: ${signal}`
      : `Website exited with code: ${code}`
  );
});

bot.on("exit", (code, signal) => {
  console.log(
    signal
      ? `Discord bot stopped because of signal: ${signal}`
      : `Discord bot exited with code: ${code}`
  );
});

function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down Novi...`);

  website.kill(signal);
  bot.kill(signal);

  setTimeout(() => {
    process.exit(0);
  }, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
