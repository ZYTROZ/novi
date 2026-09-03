const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const KEY_FILE = path.join(__dirname, "keys.json");

app.use(cors());
app.use(express.json());

/* Create keys.json if it doesn't exist */
if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(
        KEY_FILE,
        JSON.stringify({}, null, 2),
        "utf8"
    );
}

/* Load keys */
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
        console.error("Could not load keys:", error);
        return {};
    }
}

/* Save keys */
function saveKeys(keys) {
    try {
        fs.writeFileSync(
            KEY_FILE,
            JSON.stringify(keys, null, 2),
            "utf8"
        );

        return true;
    } catch (error) {
        console.error("Could not save keys:", error);
        return false;
    }
}

/* Get expiration date */
function getExpiration(duration) {
    const now = new Date();

    switch (duration) {
        case "1d":
            return new Date(
                now.getTime() + 24 * 60 * 60 * 1000
            ).toISOString();

        case "1week":
            return new Date(
                now.getTime() + 7 * 24 * 60 * 60 * 1000
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

/* Check that public folder exists */
if (!fs.existsSync(PUBLIC_DIR)) {
    console.error("ERROR: public folder does not exist!");
} else {
    console.log("Public folder found.");
}

/* Serve website */
app.use(
    express.static(PUBLIC_DIR, {
        index: "index.html"
    })
);

/* Homepage */
app.get("/", (req, res) => {
    const indexPath = path.join(PUBLIC_DIR, "index.html");

    if (!fs.existsSync(indexPath)) {
        return res.status(404).send(
            "Novi is running, but public/index.html was not found."
        );
    }

    res.sendFile(indexPath);
});

/* Create key */
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

        if (!saveKeys(keys)) {
            return res.status(500).json({
                success: false,
                message: "Could not save key."
            });
        }

        console.log(
            `Saved key: ${cleanKey} (${duration})`
        );

        res.json({
            success: true,
            message: "Key saved successfully."
        });

    } catch (error) {
        console.error("Create key error:", error);

        res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});

/* Verify key */
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

        res.json({
            valid: true,
            duration: keyData.duration,
            expiresAt: keyData.expiresAt
        });

    } catch (error) {
        console.error("Verify key error:", error);

        res.status(500).json({
            valid: false,
            message: "Internal server error."
        });
    }
});

/* Health check */
app.get("/api/health", (req, res) => {
    res.json({
        online: true,
        message: "Novi server is running."
    });
});

/* Unknown API endpoint */
app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: "API endpoint not found."
    });
});

/* Server error handler */
app.use((error, req, res, next) => {
    console.error("Server error:", error);

    res.status(500).json({
        success: false,
        message: "Internal server error."
    });
});

/* Start server */
app.listen(PORT, "0.0.0.0", () => {
    console.log("=================================");
    console.log("       NOVI SERVER ONLINE");
    console.log("=================================");
    console.log(`Port: ${PORT}`);
    console.log(`Public folder: ${PUBLIC_DIR}`);
    console.log(`Keys file: ${KEY_FILE}`);
    console.log("Website server started successfully.");
    console.log("=================================");
});
