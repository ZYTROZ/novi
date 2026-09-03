const express = require("express");
const cors = require("cors");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 3000;
const KEY_FILE = "./keys.json";

// Create keys.json if it doesn't exist
if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, JSON.stringify({}, null, 2));
}

// Load keys
function loadKeys() {
    return JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
}

// Save keys
function saveKeys(keys) {
    fs.writeFileSync(KEY_FILE, JSON.stringify(keys, null, 2));
}

// Convert duration into an expiration date
function getExpiration(duration) {
    const now = new Date();

    switch (duration) {
        case "1d":
            return new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

        case "1week":
            return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        case "1month":
            const month = new Date(now);
            month.setMonth(month.getMonth() + 1);
            return month;

        case "1year":
            const year = new Date(now);
            year.setFullYear(year.getFullYear() + 1);
            return year;

        case "lifetime":
            return null;

        default:
            return null;
    }
}

// Test route
app.get("/", (req, res) => {
    res.send("Novi server is online!");
});

// Create a key
app.post("/api/keys", (req, res) => {
    const { key, duration } = req.body;

    if (!key || !duration) {
        return res.status(400).json({
            success: false,
            message: "Missing key or duration."
        });
    }

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

    const keys = loadKeys();

    // Don't allow duplicate keys
    if (keys[key]) {
        return res.status(409).json({
            success: false,
            message: "Key already exists."
        });
    }

    keys[key] = {
        duration: duration,
        createdAt: new Date().toISOString(),
        expiresAt: getExpiration(duration),
        used: false
    };

    saveKeys(keys);

    console.log(`Saved key: ${key} (${duration})`);

    res.json({
        success: true,
        message: "Key saved successfully."
    });
});

// Check a key
app.post("/api/verify", (req, res) => {
    const { key } = req.body;

    if (!key) {
        return res.status(400).json({
            valid: false,
            message: "Please enter a key."
        });
    }

    const keys = loadKeys();
    const keyData = keys[key];

    if (!keyData) {
        return res.json({
            valid: false,
            message: "Invalid Novi key."
        });
    }

    // Check expiration
    if (
        keyData.expiresAt &&
        new Date() > new Date(keyData.expiresAt)
    ) {
        return res.json({
            valid: false,
            message: "This Novi key has expired."
        });
    }

    res.json({
        valid: true,
        duration: keyData.duration,
        expiresAt: keyData.expiresAt
    });
});

app.listen(PORT, () => {
    console.log(`Novi server running on http://localhost:${PORT}`);
});
