const { spawn } = require("child_process");

console.log("======================================");
console.log("           STARTING NOVI");
console.log("======================================");

const app = spawn(process.execPath, ["index.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "production",
  },
});

app.on("error", (err) => {
  console.error("Failed to start Novi:");
  console.error(err);
  process.exit(1);
});

app.on("close", (code, signal) => {
  if (signal) {
    console.log(`Novi stopped because of signal: ${signal}`);
    process.exit(1);
  }

  console.log(`Novi exited with code: ${code}`);
  process.exit(code ?? 1);
});

// Forward termination signals from Render to the Node process
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, stopping Novi...");
  app.kill("SIGTERM");
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, stopping Novi...");
  app.kill("SIGINT");
