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

app.use(
    express.json({
        limit: "1mb"
    })
);

/* =========================================================
   FILE HELPERS
========================================================= */

function ensureFile(file, defaultValue) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(
                file,
                JSON.stringify(defaultValue, null, 2),
                "utf8"
            );

            console.log(`Created: ${file}`);
        }
    } catch (error) {
        console.error(`Could not create ${file}:`, error);
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
    try {
        fs.writeFileSync(
            file,
            JSON.stringify(data, null, 2),
            "utf8"
        );

        return true;
    } catch (error) {
        console.error(`Failed writing ${file}:`, error);
        return false;
    }
}

/* =========================================================
   KEY FILE
========================================================= */

function readKeys() {
    const keys = readJSON(KEY_FILE, []);

    return Array.isArray(keys) ? keys : [];
}

function writeKeys(keys) {
    return writeJSON(KEY_FILE, keys);
}

/* =========================================================
   STOCK FILE
========================================================= */

function readStock() {
    const stock = readJSON(STOCK_FILE, []);

    return Array.isArray(stock) ? stock : [];
}

function writeStock(stock) {
    return writeJSON(STOCK_FILE, stock);
}

/* =========================================================
   CREATE REQUIRED FILES
========================================================= */

ensureFile(KEY_FILE, []);
ensureFile(STOCK_FILE, []);

/* =========================================================
   KEY DURATIONS
========================================================= */

const DURATIONS = {
    "1d": 1 * 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "1week": 7 * 24 * 60 * 60 * 1000,
    "1month": 30 * 24 * 60 * 60 * 1000,
    "1year": 365 * 24 * 60 * 60 * 1000,
    "lifetime": null
};

/* =========================================================
   NORMALIZE DURATION
========================================================= */

function normalizeDuration(duration) {
    if (!duration) {
        return null;
    }

    const value = String(duration)
        .trim()
        .toLowerCase();

    const aliases = {
        "1d": "1d",
        "1day": "1d",
        "1-day": "1d",
        "day": "1d",

        "3d": "3d",
        "3day": "3d",
        "3days": "3d",
        "3-day": "3d",
        "3-days": "3d",

        "1week": "1week",
        "1-week": "1week",
        "1w": "1week",
        "week": "1week",

        "1month": "1month",
        "1-month": "1month",
        "1mo": "1month",
        "month": "1month",

        "1year": "1year",
        "1-year": "1year",
        "1y": "1year",
        "year": "1year",

        "lifetime": "lifetime",
        "life": "lifetime",
        "forever": "lifetime"
    };

    return aliases[value] || null;
}

/* =========================================================
   NORMALIZE KEY
========================================================= */

function normalizeKey(key) {
    if (!key) {
        return "";
    }

    return String(key)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
}

/* =========================================================
   GENERATE KEY
========================================================= */

function generateKey() {
    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let key = "NOVI-";

    for (let i = 0; i < 4; i++) {
        let section = "";

        for (let j = 0; j < 4; j++) {
            section +=
                chars[
                    Math.floor(
                        Math.random() * chars.length
                    )
                ];
        }

        key += section;

        if (i < 3) {
            key += "-";
        }
    }

    return key;
}

/* =========================================================
   CREATE KEY
========================================================= */

function createKey(duration) {
    const normalized =
        normalizeDuration(duration);

    if (!normalized) {
        throw new Error(
            "Invalid duration. Use 1d, 3d, 1week, 1month, 1year, or lifetime."
        );
    }

    const keys = readKeys();

    let key;

    do {
        key = generateKey();
    } while (
        keys.some(
            item =>
                normalizeKey(item?.key) ===
                normalizeKey(key)
        )
    );

    const createdAt = Date.now();

    const durationLength =
        DURATIONS[normalized];

    const expiresAt =
        durationLength === null
            ? null
            : createdAt + durationLength;

    const newKey = {
        key: key,
        duration: normalized,
        createdAt: createdAt,
        expiresAt: expiresAt,
        deviceId: null,
        activatedAt: null
    };

    keys.push(newKey);

    const saved = writeKeys(keys);

    if (!saved) {
        throw new Error(
            "The key could not be saved to the server."
        );
    }

    console.log(
        `Created key: ${newKey.key} (${newKey.duration})`
    );

    return newKey;
}

/* =========================================================
   VERIFY KEY
========================================================= */

function verifyKey(key, deviceId) {
    if (!key) {
        return {
            valid: false,
            message: "Key is required."
        };
    }

    if (!deviceId) {
        return {
            valid: false,
            message: "Device ID is required."
        };
    }

    const cleanKey = normalizeKey(key);

    const cleanDeviceId =
        String(deviceId).trim();

    if (!cleanKey) {
        return {
            valid: false,
            message: "Key is required."
        };
    }

    if (!cleanDeviceId) {
        return {
            valid: false,
            message: "Device ID is required."
        };
    }

    const keys = readKeys();

    const index = keys.findIndex(item => {
        if (!item || !item.key) {
            return false;
        }

        return (
            normalizeKey(item.key) ===
            cleanKey
        );
    });

    /* -----------------------------------------------------
       KEY DOES NOT EXIST
    ----------------------------------------------------- */

    if (index === -1) {
        console.log(
            `Invalid key attempt: ${cleanKey}`
        );

        return {
            valid: false,
            message: "Invalid key."
        };
    }

    const currentKey = keys[index];

    /* -----------------------------------------------------
       EXPIRATION
    ----------------------------------------------------- */

    if (
        currentKey.expiresAt !== null &&
        typeof currentKey.expiresAt === "number" &&
        Date.now() > currentKey.expiresAt
    ) {
        return {
            valid: false,
            message: "This key has expired."
        };
    }

    /* -----------------------------------------------------
       FIRST DEVICE ACTIVATION
    ----------------------------------------------------- */

    if (!currentKey.deviceId) {
        currentKey.deviceId =
            cleanDeviceId;

        currentKey.activatedAt =
            Date.now();

        keys[index] = currentKey;

        const saved =
            writeKeys(keys);

        if (!saved) {
            return {
                valid: false,
                message:
                    "Could not activate the key."
            };
        }

        console.log(
            `Key activated: ${currentKey.key}`
        );

        return {
            valid: true,
            key: currentKey
        };
    }

    /* -----------------------------------------------------
       DEVICE CHECK
    ----------------------------------------------------- */

    if (
        currentKey.deviceId !==
        cleanDeviceId
    ) {
        return {
            valid: false,
            message:
                "This key is already activated on another device."
        };
    }

    /* -----------------------------------------------------
       VALID
    ----------------------------------------------------- */

    return {
        valid: true,
        key: currentKey
    };
}

/* =========================================================
   CREATE KEY API
========================================================= */

app.post("/api/keys", (req, res) => {
    try {
        const duration =
            req.body?.duration;

        if (!duration) {
            return res.status(400).json({
                success: false,
                message:
                    "Duration is required."
            });
        }

        const newKey =
            createKey(duration);

        return res.json({
            success: true,
            key: newKey.key,
            duration: newKey.duration,
            createdAt:
                newKey.createdAt,
            expiresAt:
                newKey.expiresAt,
            keyData: newKey
        });
    } catch (error) {
        console.error(
            "Create key error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "The key could not be saved."
        });
    }
});

/* =========================================================
   VERIFY API
========================================================= */

app.post("/api/verify", (req, res) => {
    try {
        const {
            key,
            deviceId
        } = req.body || {};

        const result =
            verifyKey(
                key,
                deviceId
            );

        if (!result.valid) {
            return res.status(403).json({
                success: false,
                valid: false,
                message:
                    result.message
            });
        }

        return res.json({
            success: true,
            valid: true,
            key: result.key
        });
    } catch (error) {
        console.error(
            "Verify error:",
            error
        );

        return res.status(500).json({
            success: false,
            valid: false,
            message:
                "Verification failed."
        });
    }
});

/* =========================================================
   STOCK COUNT
========================================================= */

app.get("/api/stock", (req, res) => {
    try {
        const stock =
            readStock();

        res.set(
            "Cache-Control",
            "no-store"
        );

        return res.json({
            success: true,
            count: stock.length
        });
    } catch (error) {
        console.error(
            "Stock error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to load stock."
        });
    }
});

/* =========================================================
   ADD STOCK
========================================================= */

app.post(
    "/api/stock/add",
    (req, res) => {
        try {
            const item =
                req.body?.item;

            if (
                item === undefined ||
                item === null ||
                item === ""
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Stock item is required."
                });
            }

            const stock =
                readStock();

            stock.push(item);

            const saved =
                writeStock(stock);

            if (!saved) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Failed to save stock."
                });
            }

            return res.json({
                success: true,
                count:
                    stock.length
            });
        } catch (error) {
            console.error(
                "Add stock error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to add stock."
            });
        }
    }
);

/* =========================================================
   GENERATE STOCK ITEM
========================================================= */

app.post(
    "/api/stock/generate",
    (req, res) => {
        try {
            const {
                key,
                deviceId
            } = req.body || {};

            const verification =
                verifyKey(
                    key,
                    deviceId
                );

            if (!verification.valid) {
                return res.status(403).json({
                    success: false,
                    message:
                        verification.message
                });
            }

            const stock =
                readStock();

            if (stock.length === 0) {
                return res.status(404).json({
                    success: false,
                    message:
                        "No stock available."
                });
            }

            /*
             * Remove exactly one item
             * from the stock.
             */
            const generatedItem =
                stock.shift();

            const saved =
                writeStock(stock);

            if (!saved) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Failed to update stock."
                });
            }

            res.set(
                "Cache-Control",
                "no-store"
            );

            return res.json({
                success: true,
                item:
                    generatedItem,
                remaining:
                    stock.length
            });
        } catch (error) {
            console.error(
                "Generate stock error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to generate stock."
            });
        }
    }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
    "/api/health",
    (req, res) => {
        return res.json({
            success: true,
            status: "online",
            service: "Novi"
        });
    }
);

/* =========================================================
   API INFO
========================================================= */

app.get("/api", (req, res) => {
    return res.json({
        success: true,
        name: "Novi API",
        endpoints: [
            "POST /api/keys",
            "POST /api/verify",
            "GET /api/stock",
            "POST /api/stock/add",
            "POST /api/stock/generate",
            "GET /api/health"
        ]
    });
});

/* =========================================================
   SERVE WEBSITE
========================================================= */

app.use(
    express.static(
        PUBLIC_DIR,
        {
            index: "index.html",
            etag: false,
            maxAge: 0
        }
    )
);

/* =========================================================
   HOME PAGE
========================================================= */

app.get("/", (req, res) => {
    return res.sendFile(
        path.join(
            PUBLIC_DIR,
            "index.html"
        )
    );
});

/* =========================================================
   API 404
========================================================= */

app.use(
    "/api",
    (req, res) => {
        return res.status(404).json({
            success: false,
            message:
                "API endpoint not found."
        });
    }
);

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
    (error, req, res, next) => {
        console.error(
            "Server error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Internal server error."
        });
    }
);

/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `Novi server running on port ${PORT}`
        );

        console.log(
            `Public directory: ${PUBLIC_DIR}`
        );

        console.log(
            `Key file: ${KEY_FILE}`
        );

        console.log(
            `Stock file: ${STOCK_FILE}`
        );
    }
);
