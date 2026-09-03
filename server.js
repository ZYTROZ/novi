```js
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

// Render gives the app its port through process.env.PORT
const PORT = process.env.PORT || 3000;

// Location of keys.json
const KEY_FILE = path.join(__dirname, "keys.json");

// Middleware
app.use(cors());
app.use(express.json());

// Serve your website from the public folder
app.use(express.static(path.join(__dirname, "public")));

// Create keys.json if it doesn't exist
if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, JSON.stringify({}, null, 2));
}

// Load keys
function loadKeys() {
    try {
        return JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
    } catch (error) {
        console.error("Could not load keys.json:", error);
        return {};
    }
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
            return new Date(
                now.getTime() + 1 * 24 * 60 * 60 * 1000
            );

        case "1week":
            return new Date(
                now.getTime() + 7 * 24 * 60 * 60 * 1000
            );

        case "1month": {
            const month = new Date(now);
            month.setMonth(month.getMonth() + 1);
            return month;
        }

        case "1year": {
            const year = new Date(now);
            year.setFullYear(year.getFullYear() + 1);
            return year;
        }

        case "lifetime":
            return null;

        default:
            return null;
    }
}

// Homepage
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
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

    // Correct JavaScript template literal
    console.log(`Saved key: ${key} (${duration})`);

    res.json({
        success: true,
        message: "Key saved successfully."
    });
});

// Verify a key
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

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Novi server running on port ${PORT}`);
});
```
