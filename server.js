const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 10000;

const PUBLIC_DIR = path.join(__dirname, "public");
const KEY_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "epicgames-stock.json");

/*
   SET THIS IN RENDER ENVIRONMENT VARIABLES.

   Example:
   NOVI_ADMIN_SECRET=put-a-long-random-secret-here
*/
const ADMIN_SECRET = process.env.NOVI_ADMIN_SECRET || "";

if (!ADMIN_SECRET) {
    console.warn(
        "WARNING: NOVI_ADMIN_SECRET is not configured."
    );
}

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());
app.use(express.json({ limit: "1mb" }));

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
        }
    } catch (error) {
        console.error("File creation error:", error);
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
        console.error("JSON read error:", error);
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
        console.error("JSON write error:", error);
        return false;
    }
}

ensureFile(KEY_FILE, []);
ensureFile(STOCK_FILE, []);

/* =========================================================
   SECURITY HELPERS
========================================================= */

function safeEqual(a, b) {
    const first = Buffer.from(String(a || ""));
    const second = Buffer.from(String(b || ""));

    if (first.length !== second.length) {
        return false;
    }

    return crypto.timingSafeEqual(first, second);
}

function requireAdmin(req, res, next) {
    if (!ADMIN_SECRET) {
        return res.status(503).json({
            success: false,
            message: "Admin authentication is not configured."
        });
    }

    const suppliedSecret =
        req.get("x-novi-admin-secret") || "";

    if (!safeEqual(suppliedSecret, ADMIN_SECRET)) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized."
        });
    }

    next();
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

function normalizeDeviceId(deviceId) {
    if (deviceId === undefined || deviceId === null) {
        return "";
    }

    return String(deviceId).trim();
}

/* =========================================================
   DURATIONS
========================================================= */

const DURATIONS = {
    "1d": 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "1week": 7 * 24 * 60 * 60 * 1000,
    "1month": 30 * 24 * 60 * 60 * 1000,
    "1year": 365 * 24 * 60 * 60 * 1000,
    "lifetime": null
};

function normalizeDuration(duration) {
    if (!duration) {
        return null;
    }

    const value = String(duration)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");

    const aliases = {
        "1d": "1d",
        "1day": "1d",
        "1days": "1d",

        "3d": "3d",
        "3day": "3d",
        "3days": "3d",

        "1w": "1week",
        "1week": "1week",
        "1weeks": "1week",
        "week": "1week",

        "1mo": "1month",
        "1month": "1month",
        "1months": "1month",
        "month": "1month",

        "1y": "1year",
        "1year": "1year",
        "1years": "1year",
        "year": "1year",

        "lifetime": "lifetime",
        "life": "lifetime",
        "forever": "lifetime"
    };

    return aliases[value] || null;
}

/* =========================================================
   READ KEYS
========================================================= */

function readKeys() {
    const data = readJSON(KEY_FILE, []);

    if (!Array.isArray(data)) {
        return [];
    }

    return data
        .map((item) => {
            if (typeof item === "string") {
                return {
                    key: normalizeKey(item),
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
                    key: normalizeKey(item.key),

                    duration:
                        normalizeDuration(item.duration) ||
                        "lifetime",

                    createdAt:
                        typeof item.createdAt === "number"
                            ? item.createdAt
                            : Date.now(),

                    expiresAt:
                        item.expiresAt === null ||
                        typeof item.expiresAt === "number"
                            ? item.expiresAt
                            : null,

                    deviceId:
                        item.deviceId
                            ? normalizeDeviceId(item.deviceId)
                            : null,

                    activatedAt:
                        typeof item.activatedAt === "number"
                            ? item.activatedAt
                            : null
                };
            }

            return null;
        })
        .filter(Boolean);
}

function writeKeys(keys) {
    return writeJSON(KEY_FILE, keys);
}

/* =========================================================
   SAVE KEY
========================================================= */

function saveKey(suppliedKey, duration) {
    const key = normalizeKey(suppliedKey);
    const normalizedDuration = normalizeDuration(duration);

    if (!key) {
        throw new Error("Key is required.");
    }

    if (!normalizedDuration) {
        throw new Error("Invalid duration.");
    }

    const keys = readKeys();

    const exists = keys.some(
        (item) => normalizeKey(item.key) === key
    );

    if (exists) {
        throw new Error("This key already exists.");
    }

    const createdAt = Date.now();
    const durationLength = DURATIONS[normalizedDuration];

    const expiresAt =
        durationLength === null
            ? null
            : createdAt + durationLength;

    const newKey = {
        key,
        duration: normalizedDuration,
        createdAt,
        expiresAt,
        deviceId: null,
        activatedAt: null
    };

    keys.push(newKey);

    if (!writeKeys(keys)) {
        throw new Error("Could not save key.");
    }

    return newKey;
}

/* =========================================================
   VERIFY KEY
========================================================= */

function verifyKey(suppliedKey, deviceId) {
    const cleanKey = normalizeKey(suppliedKey);
    const cleanDeviceId = normalizeDeviceId(deviceId);

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

    const index = keys.findIndex(
        (item) =>
            normalizeKey(item.key) === cleanKey
    );

    if (index === -1) {
        return {
            valid: false,
            message: "Invalid key."
        };
    }

    const currentKey = keys[index];

    /* EXPIRATION */

    if (
        currentKey.expiresAt !== null &&
        typeof currentKey.expiresAt === "number" &&
        Date.now() >= currentKey.expiresAt
    ) {
        return {
            valid: false,
            message: "This key has expired."
        };
    }

    /* FIRST ACTIVATION */

    if (!currentKey.deviceId) {
        currentKey.deviceId = cleanDeviceId;
        currentKey.activatedAt = Date.now();

        keys[index] = currentKey;

        if (!writeKeys(keys)) {
            return {
                valid: false,
                message: "Could not activate key."
            };
        }

        return {
            valid: true,
            key: currentKey
        };
    }

    /* SAME DEVICE */

    if (
        normalizeDeviceId(currentKey.deviceId) ===
        cleanDeviceId
    ) {
        return {
            valid: true,
            key: currentKey
        };
    }

    return {
        valid: false,
        message:
            "This key is already activated on another device."
    };
}

/* =========================================================
   SESSION TOKENS
========================================================= */

/*
   Sessions live only in server memory.

   Restarting Render logs everyone out.
   That is intentional and safer than trusting localStorage.
*/

const sessions = new Map();

const SESSION_DURATION = 30 * 60 * 1000;

function createSession(key, deviceId) {
    const token = crypto.randomBytes(32).toString("hex");

    sessions.set(token, {
        key: normalizeKey(key),
        deviceId: normalizeDeviceId(deviceId),
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_DURATION
    });

    return token;
}

function getSession(token) {
    if (!token) {
        return null;
    }

    const session = sessions.get(token);

    if (!session) {
        return null;
    }

    if (Date.now() >= session.expiresAt) {
        sessions.delete(token);
        return null;
    }

    return session;
}

function destroySession(token) {
    if (token) {
        sessions.delete(token);
    }
}

function requireSession(req, res, next) {
    const token =
        req.get("x-novi-session") || "";

    const session = getSession(token);

    if (!session) {
        return res.status(401).json({
            success: false,
            valid: false,
            message: "Dashboard session expired."
        });
    }

    /*
       Re-check the key every time.
       This means deleting/expiring a key invalidates
       access even if a session token still exists.
    */

    const verification = verifyKey(
        session.key,
        session.deviceId
    );

    if (!verification.valid) {
        destroySession(token);

        return res.status(403).json({
            success: false,
            valid: false,
            message: verification.message
        });
    }

    req.noviSession = session;
    req.noviToken = token;

    next();
}

/* =========================================================
   CREATE KEY
   ADMIN ONLY
========================================================= */

app.post(
    "/api/keys",
    requireAdmin,
    (req, res) => {
        try {
            const key =
                req.body &&
                req.body.key;

            const duration =
                req.body &&
                req.body.duration;

            if (!key) {
                return res.status(400).json({
                    success: false,
                    message: "Key is required."
                });
            }

            if (!duration) {
                return res.status(400).json({
                    success: false,
                    message: "Duration is required."
                });
            }

            const newKey =
                saveKey(key, duration);

            return res.json({
                success: true,
                key: newKey.key,
                duration: newKey.duration,
                createdAt: newKey.createdAt,
                expiresAt: newKey.expiresAt
            });

        } catch (error) {
            console.error(
                "Create key error:",
                error.message
            );

            return res.status(500).json({
                success: false,
                message:
                    error.message ||
                    "Could not save key."
            });
        }
    }
);

/* =========================================================
   VERIFY / LOGIN
========================================================= */

app.post(
    "/api/verify",
    (req, res) => {
        try {
            const key =
                req.body &&
                req.body.key;

            const deviceId =
                req.body &&
                req.body.deviceId;

            const result =
                verifyKey(
                    key,
                    deviceId
                );

            if (!result.valid) {
                return res.status(403).json({
                    success: false,
                    valid: false,
                    message: result.message
                });
            }

            const sessionToken =
                createSession(
                    result.key.key,
                    deviceId
                );

            return res.json({
                success: true,
                valid: true,
                sessionToken,
                expiresAt:
                    Date.now() +
                    SESSION_DURATION,
                key: {
                    duration:
                        result.key.duration,
                    expiresAt:
                        result.key.expiresAt
                }
            });

        } catch (error) {
            console.error(
                "Verification error:",
                error.message
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
   LOGOUT SESSION
========================================================= */

app.post(
    "/api/logout",
    requireSession,
    (req, res) => {
        destroySession(
            req.noviToken
        );

        return res.json({
            success: true
        });
    }
);

/* =========================================================
   STOCK HELPERS
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
   STOCK COUNT
========================================================= */

app.get(
    "/api/stock",
    requireSession,
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
                count: stock.length
            });

        } catch (error) {
            console.error(
                "Stock error:",
                error.message
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
   ADMIN ONLY
========================================================= */

app.post(
    "/api/stock/add",
    requireAdmin,
    (req, res) => {
        try {
            let items = [];

            if (
                req.body &&
                req.body.item !== undefined &&
                req.body.item !== null
            ) {
                items.push(
                    req.body.item
                );
            }

            if (
                req.body &&
                Array.isArray(
                    req.body.items
                )
            ) {
                items.push(
                    ...req.body.items
                );
            }

            items = items
                .map((item) =>
                    String(item).trim()
                )
                .filter(Boolean);

            if (!items.length) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Stock item is required."
                });
            }

            const stock =
                readStock();

            let added = 0;
            let duplicates = 0;

            for (const item of items) {
                if (stock.includes(item)) {
                    duplicates++;
                    continue;
                }

                stock.push(item);
                added++;
            }

            if (!writeStock(stock)) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Failed to save stock."
                });
            }

            return res.json({
                success: true,
                added,
                duplicates,
                count: stock.length
            });

        } catch (error) {
            console.error(
                "Add stock error:",
                error.message
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
   SESSION REQUIRED
========================================================= */

app.post(
    "/api/stock/generate",
    requireSession,
    (req, res) => {
        try {
            const stock =
                readStock();

            if (!stock.length) {
                return res.status(404).json({
                    success: false,
                    message:
                        "No stock available."
                });
            }

            const generatedItem =
                stock.shift();

            if (!writeStock(stock)) {
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
                item: generatedItem,
                remaining:
                    stock.length
            });

        } catch (error) {
            console.error(
                "Generate stock error:",
                error.message
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
   HEALTH
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

app.get(
    "/api",
    (req, res) => {
        return res.json({
            success: true,
            name: "Novi API",
            endpoints: [
                "POST /api/verify",
                "POST /api/logout",
                "GET /api/stock",
                "POST /api/stock/generate",
                "POST /api/keys (admin)",
                "POST /api/stock/add (admin)",
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
            "=============================="
        );

        console.log(
            "NOVI SERVER IS ONLINE"
        );

        console.log(
            "Port: " + PORT
        );

        console.log(
            "Keys loaded: " +
            readKeys().length
        );

        console.log(
            "Stock loaded: " +
            readStock().length
        );

        console.log(
            "Admin authentication: " +
            (ADMIN_SECRET
                ? "CONFIGURED"
                : "NOT CONFIGURED")
        );

        console.log(
            "=============================="
        );
    }
);
