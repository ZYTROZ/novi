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
   KEY HELPERS
========================================================= */

function normalizeKey(key) {
    if (key === undefined || key === null) {
        return "";
    }

    return String(key)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
}

/*
 * Supports keys.json in multiple formats:
 *
 * [
 *   {
 *     "key": "NOVI-XXXX-XXXX-XXXX-XXXX"
 *   }
 * ]
 *
 * OR
 *
 * [
 *   "NOVI-XXXX-XXXX-XXXX-XXXX"
 * ]
 */

function readKeys() {
    const data = readJSON(KEY_FILE, []);

    if (!Array.isArray(data)) {
        return [];
    }

    return data
        .map(item => {
            if (typeof item === "string") {
                return {
                    key: item,
                    duration: "lifetime",
                    createdAt: Date.now(),
                    expiresAt: null,
                    deviceId: null,
                    activatedAt: null
                };
            }

            if (
                item &&
                typeof item === "object" &&
                item.key
            ) {
                return {
                    key: item.key,
                    duration:
                        item.duration || "lifetime",
                    createdAt:
                        typeof item.createdAt === "number"
                            ? item.createdAt
                            : Date.now(),
                    expiresAt:
                        item.expiresAt === undefined
                            ? null
                            : item.expiresAt,
                    deviceId:
                        item.deviceId || null,
                    activatedAt:
                        item.activatedAt || null
                };
            }

            return null;
        })
        .filter(Boolean);
}

function writeKeys(keys) {
    return writeJSON(
        KEY_FILE,
        keys
    );
}

/* =========================================================
   ENVIRONMENT KEYS
========================================================= */

/*
 * You can optionally put keys in Render as:
 *
 * NOVI_KEYS=NOVI-AAAA-BBBB-CCCC-DDDD,NOVI-1111-2222-3333-4444
 *
 * These keys are treated as lifetime keys.
 */

function getEnvironmentKeys() {
    const raw =
        process.env.NOVI_KEYS || "";

    if (!raw.trim()) {
        return [];
    }

    return raw
        .split(",")
        .map(key => normalizeKey(key))
        .filter(Boolean)
        .map(key => ({
            key,
            duration: "lifetime",
            createdAt: Date.now(),
            expiresAt: null,
            deviceId: null,
            activatedAt: null
        }));
}

/* =========================================================
   ALL AVAILABLE KEYS
========================================================= */

function getAllKeys() {
    const fileKeys = readKeys();
    const environmentKeys = getEnvironmentKeys();

    const combined = [
        ...fileKeys,
        ...environmentKeys
    ];

    const unique = [];

    for (const item of combined) {
        const normalized =
            normalizeKey(item.key);

        if (!normalized) {
            continue;
        }

        const alreadyExists =
            unique.some(
                existing =>
                    normalizeKey(existing.key) ===
                    normalized
            );

        if (!alreadyExists) {
            unique.push(item);
        }
    }

    return unique;
}

/* =========================================================
   STOCK
========================================================= */

function readStock() {
    const stock =
        readJSON(
            STOCK_FILE,
            []
        );

    return Array.isArray(stock)
        ? stock
        : [];
}

function writeStock(stock) {
    return writeJSON(
        STOCK_FILE,
        stock
    );
}

/* =========================================================
   CREATE FILES
========================================================= */

ensureFile(
    KEY_FILE,
    []
);

ensureFile(
    STOCK_FILE,
    []
);

/* =========================================================
   DURATIONS
========================================================= */

const DURATIONS = {
    "1d":
        1 * 24 * 60 * 60 * 1000,

    "3d":
        3 * 24 * 60 * 60 * 1000,

    "1week":
        7 * 24 * 60 * 60 * 1000,

    "1month":
        30 * 24 * 60 * 60 * 1000,

    "1year":
        365 * 24 * 60 * 60 * 1000,

    "lifetime":
        null
};

/* =========================================================
   DURATION NORMALIZATION
========================================================= */

function normalizeDuration(duration) {
    if (!duration) {
        return null;
    }

    const value =
        String(duration)
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
                        Math.random() *
                        chars.length
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

    const keys =
        readKeys();

    let key;

    do {
        key =
            generateKey();
    } while (
        keys.some(
            item =>
                normalizeKey(item.key) ===
                normalizeKey(key)
        )
    );

    const createdAt =
        Date.now();

    const durationLength =
        DURATIONS[normalized];

    const expiresAt =
        durationLength === null
            ? null
            : createdAt +
              durationLength;

    const newKey = {
        key,
        duration:
            normalized,
        createdAt,
        expiresAt,
        deviceId: null,
        activatedAt: null
    };

    keys.push(
        newKey
    );

    if (
        !writeKeys(keys)
    ) {
        throw new Error(
            "The key could not be saved."
        );
    }

    console.log(
        `Created Novi key: ${key}`
    );

    return newKey;
}

/* =========================================================
   VERIFY KEY
========================================================= */

function verifyKey(
    suppliedKey,
    deviceId
) {
    const cleanKey =
        normalizeKey(
            suppliedKey
        );

    const cleanDeviceId =
        String(
            deviceId || ""
        ).trim();

    if (!cleanKey) {
        return {
            valid: false,
            message:
                "Key is required."
        };
    }

    if (!cleanDeviceId) {
        return {
            valid: false,
            message:
                "Device ID is required."
        };
    }

    const keys =
        getAllKeys();

    console.log(
        `Checking key: ${cleanKey}`
    );

    console.log(
        `Available keys: ${keys.length}`
    );

    const index =
        keys.findIndex(
            item =>
                normalizeKey(
                    item.key
                ) === cleanKey
        );

    if (index === -1) {
        console.log(
            `Key NOT FOUND: ${cleanKey}`
        );

        return {
            valid: false,
            message:
                "Invalid key."
        };
    }

    const currentKey =
        keys[index];

    /* =====================================================
       EXPIRATION
    ===================================================== */

    if (
        currentKey.expiresAt !== null &&
        typeof currentKey.expiresAt ===
            "number" &&
        Date.now() >
            currentKey.expiresAt
    ) {
        return {
            valid: false,
            message:
                "This key has expired."
        };
    }

    /* =====================================================
       DEVICE ACTIVATION
    ===================================================== */

    if (!currentKey.deviceId) {
        currentKey.deviceId =
            cleanDeviceId;

        currentKey.activatedAt =
            Date.now();

        /*
         * Only save file-based keys.
         * Environment keys are read-only.
         */
        const fileKeys =
            readKeys();

        const fileIndex =
            fileKeys.findIndex(
                item =>
                    normalizeKey(
                        item.key
                    ) === cleanKey
            );

        if (fileIndex !== -1) {
            fileKeys[fileIndex] =
                currentKey;

            writeKeys(
                fileKeys
            );
        }

        console.log(
            `Key activated: ${cleanKey}`
        );

        return {
            valid: true,
            key: currentKey
        };
    }

    /* =====================================================
       DEVICE CHECK
    ===================================================== */

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

    return {
        valid: true,
        key: currentKey
    };
}

/* =========================================================
   CREATE KEY API
========================================================= */

app.post(
    "/api/keys",
    (req, res) => {
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
                createKey(
                    duration
                );

            return res.json({
                success: true,
                key:
                    newKey.key,
                duration:
                    newKey.duration,
                createdAt:
                    newKey.createdAt,
                expiresAt:
                    newKey.expiresAt,
                keyData:
                    newKey
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
    }
);

/* =========================================================
   VERIFY API
========================================================= */

app.post(
    "/api/verify",
    (req, res) => {
        try {
            const key =
                req.body?.key;

            const deviceId =
                req.body?.deviceId;

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
                key:
                    result.key
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
    }
);

/* =========================================================
   STOCK COUNT
========================================================= */

app.get(
    "/api/stock",
    (req, res) => {
        try {
            const stock =
                readStock();

            res.set(
                "Cache-Control",
                "no-store"
            );

            return res.json({
                success: true,
                count:
                    stock.length
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
    }
);

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

            stock.push(
                item
            );

            if (
                !writeStock(stock)
            ) {
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
   GENERATE STOCK
========================================================= */

app.post(
    "/api/stock/generate",
    (req, res) => {
        try {
            const key =
                req.body?.key;

            const deviceId =
                req.body?.deviceId;

            const verification =
                verifyKey(
                    key,
                    deviceId
                );

            if (
                !verification.valid
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        verification.message
                });
            }

            const stock =
                readStock();

            if (
                stock.length === 0
            ) {
                return res.status(404).json({
                    success: false,
                    message:
                        "No stock available."
                });
            }

            const generatedItem =
                stock.shift();

            if (
                !writeStock(stock)
            ) {
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
   DEBUG / STATUS
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

app.get(
    "/api",
    (req, res) => {
        return res.json({
            success: true,
            name: "Novi API",
            keyCount:
                getAllKeys().length,
            stockCount:
                readStock().length,
            endpoints: [
                "POST /api/keys",
                "POST /api/verify",
                "GET /api/stock",
                "POST /api/stock/add",
                "POST /api/stock/generate",
                "GET /api/health"
            ]
        });
    }
);

/* =========================================================
   WEBSITE
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

app.get(
    "/",
    (req, res) => {
        return res.sendFile(
            path.join(
                PUBLIC_DIR,
                "index.html"
            )
        );
    }
);

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
   START
========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "================================="
        );

        console.log(
            `Novi running on port ${PORT}`
        );

        console.log(
            `Public: ${PUBLIC_DIR}`
        );

        console.log(
            `Keys: ${KEY_FILE}`
        );

        console.log(
            `Stock: ${STOCK_FILE}`
        );

        console.log(
            `Loaded keys: ${getAllKeys().length}`
        );

        console.log(
            `Loaded stock: ${readStock().length}`
        );

        console.log(
            "================================="
        );
    }
);
