const { spawn } = require("child_process");

const server = spawn("node", ["server.js"], {
    stdio: "inherit"
});

const bot = spawn("node", ["index.js"], {
    stdio: "inherit"
});

server.on("exit", (code) => {
    console.log(`Server exited with code ${code}`);
    process.exit(code ?? 1);
});

bot.on("exit", (code) => {
    console.log(`Bot exited with code ${code}`);
});
