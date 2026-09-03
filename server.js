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
const STOCK_FILE = path.join(__dirname, "epicgames-stock.json");

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());
app.use(express.json());

/* =========================================================
   FILE HELPERS
========================================================= */

function ensureFile(file, defaultValue) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(defaultValue, null, 2),
            "utf8"
        );
    }
}

function readJSON(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            return fallback;
        }

        const data = fs.readFileSync(file, "utf8");

        if (!data.trim()) {
            return fallback;
        }

        return JSON.parse(data);
    } catch (error) {
        console.error(`Failed reading ${file}:`, error);
        return fallback;
    }
}

function writeJSON(file, data) {
    fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2),
        "utf8"
    );
}

function readKeys() {
    return readJSON(KEY_FILE, []);
}

function writeKeys(keys) {
    writeJSON(KEY_FILE, keys);
}

function readStock() {
    const stock = readJSON(STOCK_FILE, []);

    return Array.isArray(stock) ? stock : [];
}

function writeStock(stock) {
    writeJSON(STOCK_FILE, stock);
}

/* =========================================================
   CREATE FILES IF MISSING
========================================================= */

ensureFile(KEY_FILE, []);
ensureFile(STOCK_FILE, []);

/* =========================================================
   KEY HELPERS
========================================================= */

const DURATIONS = {
    "1d": 1 * 24 * 60 * 60 * 1000,
    "1week": 7 * 24 * 60 * 60 * 1000,
    "1month": 30 * 24 * 60 * 60 * 1000,
    "1year": 365 * 24 * 60 * 60 * 1000,
    "lifetime": null
};

function generateKey() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let key = "NOVI-";

    for (let i = 0; i < 4; i++) {
        let section = "";

        for (let j = 0; j < 4; j++) {
            section += chars[
                Math.floor(Math.random() * chars.length)
            ];
        }

        key += section;

        if (i < 3) {
            key += "-";
        }
    }

    return key;
}

function createKey(duration) {
    const keys = readKeys();

    if (!DURATIONS.hasOwnProperty(duration)) {
        throw new Error("Invalid duration.");
    }

    const key = generateKey();

    const createdAt = Date.now();

    const expiresAt =
        DURATIONS[duration] === null
            ? null
            : createdAt + DURATIONS[duration];

    const newKey = {
        key,
        duration,
        createdAt,
        expiresAt,
        deviceId: null,
        activatedAt: null
    };

    keys.push(newKey);

    writeKeys(keys);

    return newKey;
}

function verifyKey(key, deviceId) {
    if (!key || !deviceId) {
        return {
            valid: false,
            message: "Key and device are required."
        };
    }

    const keys = readKeys();

    const index = keys.findIndex(
        item => item.key === key
    );

    if (index === -1) {
        return {
            valid: false,
            message: "Invalid key."
        };
    }

    const currentKey = keys[index];

    /* Expiration */

    if (
        currentKey.expiresAt !== null &&
        Date.now() > currentKey.expiresAt
    ) {
        return {
            valid: false,
            message: "This key has expired."
        };
    }

    /* Device binding */

    if (!currentKey.deviceId) {
        currentKey.deviceId = deviceId;
        currentKey.activatedAt = Date.now();

        keys[index] = currentKey;

        writeKeys(keys);

        return {
            valid: true,
            key: currentKey
        };
    }

    if (currentKey.deviceId !== deviceId) {
        return {
            valid: false,
            message: "This key is already activated on another device."
        };
    }

    return {
        valid: true,
        key: currentKey
    };
}

/* =========================================================
   KEY API
========================================================= */

app.post("/api/keys", (req, res) => {
    try {
        const { duration } = req.body;

        const newKey = createKey(duration);

        res.json({
            success: true,
            key: newKey
        });

    } catch (error) {
        console.error("Create key error:", error);

        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

/* =========================================================
   VERIFY
========================================================= */

app.post("/api/verify", (req, res) => {
    try {
        const { key, deviceId } = req.body;

        const result = verifyKey(key, deviceId);

        if (!result.valid) {
            return res.status(403).json({
                success: false,
                valid: false,
                message: result.message
            });
        }

        res.json({
            success: true,
            valid: true,
            key: result.key
        });

    } catch (error) {
        console.error("Verify error:", error);

        res.status(500).json({
            success: false,
            valid: false,
            message: "Verification failed."
        });
    }
});

/* =========================================================
   STOCK COUNT
========================================================= */

app.get("/api/stock", (req, res) => {
    try {
        const stock = readStock();

        res.set("Cache-Control", "no-store");

        res.json({
            success: true,
            count: stock.length
        });

    } catch (error) {
        console.error("Stock error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to load stock."
        });
    }
});

/* =========================================================
   ADD STOCK
========================================================= */

app.post("/api/stock/add", (req, res) => {
    try {
        const { item } = req.body;

        if (
            item === undefined ||
            item === null ||
            item === ""
        ) {
            return res.status(400).json({
                success: false,
                message: "Stock item is required."
            });
        }

        const stock = readStock();

        stock.push(item);

        writeStock(stock);

        res.json({
            success: true,
            count: stock.length
        });

    } catch (error) {
        console.error("Add stock error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to add stock."
        });
    }
});

/* =========================================================
   GENERATE ONE STOCK ITEM
   ITEM IS REMOVED PERMANENTLY
========================================================= */

app.post("/api/stock/generate", (req, res) => {
    try {
        const { key, deviceId } = req.body;

        /* Verify key/device first */

        const verification = verifyKey(
            key,
            deviceId
        );

        if (!verification.valid) {
            return res.status(403).json({
                success: false,
                message: verification.message
            });
        }

        /* Read current stock */

        const stock = readStock();

        if (stock.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No stock available."
            });
        }

        /*
         * Remove exactly ONE item.
         *
         * shift() removes it from the array,
         * then writeStock() saves the new array.
         */

        const generatedItem = stock.shift();

        writeStock(stock);

        /*
         * Return ONLY the generated inventory item.
         * We do not return the remaining stock.
         */

        res.set("Cache-Control", "no-store");

        return res.json({
            success: true,
            item: generatedItem,
            remaining: stock.length
        });

    } catch (error) {
        console.error("Generate stock error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to generate stock."
        });
    }
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        status: "online"
    });
});

/* =========================================================
   STATIC WEBSITE
========================================================= */

app.use(
    express.static(PUBLIC_DIR, {
        index: "index.html",
        etag: false,
        maxAge: 0
    })
);

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {
    res.sendFile(
        path.join(PUBLIC_DIR, "index.html")
    );
});

/* =========================================================
   API 404
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
    console.error(error);

    res.status(500).json({
        success: false,
        message: "Internal server error."
    });
});

/* =========================================================
   START
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Novi server running on port ${PORT}`);
});
