const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const KEY_FILE = path.join(__dirname, "keys.json");

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());
app.use(express.json());

/* =========================================================
   CHECK PUBLIC FOLDER
========================================================= */

if (!fs.existsSync(PUBLIC_DIR)) {
    console.error("ERROR: The 'public' folder does not exist.");
    console.error("Make sure your project looks like this:");
    console.error("");
    console.error("project/");
    console.error("├── server.js");
    console.error("├── package.json");
    console.error("├── keys.json");
    console.error("└── public/");
    console.error("    └── index.html");
}

/* =========================================================
   KEYS FILE
========================================================= */

if (!fs.existsSync(KEY_FILE)) {
    try {
        fs.writeFileSync(
            KEY_FILE,
            JSON.stringify({}, null, 2),
            "utf8"
        );

        console.log("Created keys.json");
    } catch (error) {
        console.error("Could not create keys.json:", error);
    }
}

/* =========================================================
   KEY FUNCTIONS
========================================================= */

function loadKeys() {
    try {
        if (!fs.existsSync(KEY_FILE)) {
            return {};
        }

        const data = fs.readFileSync(KEY_FILE, "utf8");

        if (!data.trim()) {
            return {};
        }

        return JSON.parse(data);
    } catch (error) {
        console.error("Could not load keys.json:", error);
        return {};
    }
}

function saveKeys(keys) {
    try {
        fs.writeFileSync(
            KEY_FILE,
            JSON.stringify(keys, null, 2),
            "utf8"
        );

        return true;
    } catch (error) {
        console.error("Could not save keys.json:", error);
        return false;
    }
}

/* =========================================================
   EXPIRATION
========================================================= */

function getExpiration(duration) {
    const now = new Date();

    switch (duration) {
        case "1d":
            return new Date(
                now.getTime() +
                24 * 60 * 60 * 1000
            ).toISOString();

        case "1week":
            return new Date(
                now.getTime() +
                7 * 24 * 60 * 60 * 1000
            ).toISOString();

        case "1month": {
            const date = new Date(now);
            date.setMonth(date.getMonth() + 1);
            return date.toISOString();
        }

        case "1year": {
            const date = new Date(now);
            date.setFullYear(date.getFullYear() + 1);
            return date.toISOString();
        }

        case "lifetime":
            return null;

        default:
            return null;
    }
}

/* =========================================================
   SERVE WEBSITE
========================================================= */

app.use(
    express.static(PUBLIC_DIR, {
        extensions: ["html"],
        index: "index.html"
    })
);

/* =========================================================
   HOMEPAGE
========================================================= */

app.get("/", (req, res) => {
    const indexPath = path.join(PUBLIC_DIR, "index.html");

    if (!fs.existsSync(indexPath)) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Novi - Website Error</title>
                <style>
                    body {
                        background: #0b0b10;
                        color: white;
                        font-family: Arial, sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                        text-align: center;
                    }

                    .box {
                        max-width: 600px;
                        padding: 40px;
                    }

                    h1 {
                        color: #ff3b3b;
                    }

                    p {
                        color: #aaa;
                        line-height: 1.6;
                    }

                    code {
                        background: #181820;
                        padding: 4px 8px;
                        border-radius: 6px;
                    }
                </style>
            </head>

            <body>
                <div class="box">
                    <h1>Novi Website Error</h1>

                    <p>
                        The server is running, but
                        <code>public/index.html</code>
                        was not found.
                    </p>

                    <p>
                        Put your website files inside the
                        <code>public</code> folder.
                    </p>
                </div>
            </body>
            </html>
        `);
    }

    res.sendFile(indexPath);
});

/* =========================================================
   CREATE KEY
========================================================= */

app.post("/api/keys", (req, res) => {
    try {
        const { key, duration } = req.body || {};

        if (!key || !duration) {
            return res.status(400).json({
                success: false,
                message: "Missing key or duration."
            });
        }

        const cleanKey = String(key).trim();

        const allowedDurations = [
            "1d",
            "1week",
            "1month",
            "1year",
            "lifetime"
        ];

        if (!allowedDurations.includes(duration)) {
            return res.status(400).json({
                success: false,
                message: "Invalid duration."
            });
        }

        if (!cleanKey) {
            return res.status(400).json({
                success: false,
                message: "Invalid key."
            });
        }

        const keys = loadKeys();

        if (keys[cleanKey]) {
            return res.status(409).json({
                success: false,
                message: "Key already exists."
            });
        }

        keys[cleanKey] = {
            duration: duration,
            createdAt: new Date().toISOString(),
            expiresAt: getExpiration(duration),
            used: false
        };

        const saved = saveKeys(keys);

        if (!saved) {
            return res.status(500).json({
                success: false,
                message: "Could not save key."
            });
        }

        console.log(
            `Saved key: ${cleanKey} (${duration})`
        );

        return res.json({
            success: true,
            message: "Key saved successfully."
        });

    } catch (error) {
        console.error("Create key error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});

/* =========================================================
   VERIFY KEY
========================================================= */

app.post("/api/verify", (req, res) => {
    try {
        const { key } = req.body || {};

        if (!key) {
            return res.status(400).json({
                valid: false,
                message: "Please enter a key."
            });
        }

        const cleanKey = String(key).trim();

        const keys = loadKeys();
        const keyData = keys[cleanKey];

        if (!keyData) {
            return res.json({
                valid: false,
                message: "Invalid Novi key."
            });
        }

        /* Check expiration */

        if (keyData.expiresAt) {
            const expirationDate =
                new Date(keyData.expiresAt);

            if (
                Number.isNaN(expirationDate.getTime()) ||
                new Date() > expirationDate
            ) {
                return res.json({
                    valid: false,
                    message: "This Novi key has expired."
                });
            }
        }

        return res.json({
            valid: true,
            duration: keyData.duration,
            expiresAt: keyData.expiresAt
        });

    } catch (error) {
        console.error("Verify key error:", error);

        return res.status(500).json({
            valid: false,
            message: "Internal server error."
        });
    }
});

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/api/health", (req, res) => {
    res.json({
        online: true,
        message: "Novi server is running."
    });
});

/* =========================================================
   404 API HANDLER
========================================================= */

app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: "API endpoint not found."
    });
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((error, req, res, next) => {
    console.error("Server error:", error);

    res.status(500).json({
        success: false,
        message: "Internal server error."
    });
});

/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("=================================");
    console.log("       NOVI SERVER ONLINE");
    console.log("=================================");
    console.log(`Port: ${PORT}`);
    console.log(`Public folder: ${PUBLIC_DIR}`);
    console.log(`Keys file: ${KEY_FILE}`);
    console.log("");
    console.log("Website should be available at:");
    console.log(`http://localhost:${PORT}`);
    console.log("");
    console.log("Health check:");
    console.log(`http://localhost:${PORT}/api/health`);
    console.log("=================================");
});
```
