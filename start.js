const { spawn } = require("child_process");

console.log("======================================");
console.log("           STARTING NOVI");
console.log("======================================");

const bot = spawn(process.execPath, ["index.js"], {
  stdio: "inherit",
  env: process.env,
});

bot.on("error", (err) => {
  console.error("Failed to start index.js:");
  console.error(err);
  process.exit(1);
});

bot.on("exit", (code, signal) => {
  if (signal) {
    console.log(`Novi stopped because of signal: ${signal}`);
  } else {
    console.log(`Novi exited with code: ${code}`);
  }

  process.exit(code ?? 1);
});
