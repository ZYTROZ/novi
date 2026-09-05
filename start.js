const { spawn } = require("child_process");

console.log("======================================");
console.log("           STARTING NOVI");
console.log("======================================");

const novi = spawn(process.execPath, ["index.js"], {
  stdio: "inherit",
  env: process.env,
});

novi.on("error", (err) => {
  console.error("Failed to start Novi:");
  console.error(err);
  process.exit(1);
});

novi.on("exit", (code, signal) => {
  if (signal) {
    console.log(`Novi stopped because of signal: ${signal}`);
    process.exit(1);
  }

  console.log(`Novi exited with code: ${code}`);
  process.exit(code ?? 1);
});
