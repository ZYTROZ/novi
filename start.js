const { spawn } = require("child_process");

console.log("======================================");
console.log("           STARTING NOVI");
console.log("======================================");

// ============================================================
// START WEBSITE
// ============================================================

const website = spawn(process.execPath, ["index.js"], {
  stdio: "inherit",
  env: process.env,
});

// ============================================================
// START DISCORD BOT
// ============================================================

const bot = spawn(process.execPath, ["bot.js"], {
  stdio: "inherit",
  env: process.env,
});

// ============================================================
// ERROR HANDLING
// ============================================================

website.on("error", (err) => {
  console.error("Failed to start website:");
  console.error(err);
  process.exit(1);
});

bot.on("error", (err) => {
  console.error("Failed to start Discord bot:");
  console.error(err);
  process.exit(1);
});

// ============================================================
// PROCESS EXIT
// ============================================================

website.on("exit", (code, signal) => {
  if (signal) {
    console.log(`Website stopped because of signal: ${signal}`);
  } else {
    console.log(`Website exited with code: ${code}`);
  }
});

bot.on("exit", (code, signal) => {
  if (signal) {
    console.log(`Discord bot stopped because of signal: ${signal}`);
  } else {
    console.log(`Discord bot exited with code: ${code}`);
  }
});

// ============================================================
// RENDER SHUTDOWN
// ============================================================

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
