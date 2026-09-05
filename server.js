require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = Number(process.env.PORT) || 10000;

const PUBLIC_DIR = path.join(__dirname, "public");
const KEY_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "epicgames-stock.json");

const ADMIN_SECRET = String(
    process.env.NOVI_ADMIN_SECRET || ""
).trim();

/* Sessions last 30 minutes */
const SESSION_DURATION = 30 * 60 * 1000;

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());

app.use(express.json({
    limit: "1mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "1mb"
}));

/* =========================================================
   FILE HELPERS
========================================================= */

function ensureFile(filePath, defaultValue) {
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(
                filePath,
                JSON.stringify(defaultValue, null, 2),
                "utf8"
            );
        }
    } catch (error) {
        console.error("[FILE] Failed to create:", filePath);
        console.error(error);
    }
}

ensureFile(KEY_FILE, []);
ensureFile(STOCK_FILE, []);

/* =========================================================
   KEY STORAGE
========================================================= */

function readKeys() {
    try {
        ensureFile(KEY_FILE, []);

        const raw = fs.readFileSync(KEY_FILE, "utf8").trim();

        if (!raw) {
            return [];
        }

        const data = JSON.parse(raw);

        /*
         * Supports:
         * []
         * { "keys": [] }
         * old object-based key storage
         */

        if (Array.isArray(data)) {
            return data;
        }

        if (data && Array.isArray(data.keys)) {
            return data.keys;
        }

        if (data && typeof data === "object") {
            return Object.entries(data).map(([key, value]) => {
                if (value && typeof value === "object") {
                    return {
                        key,
                        ...value
                    };
                }

                return {
                    key,
                    duration: String(value || "lifetime")
                };
            });
        }

        return [];
    } catch (error) {
        console.error("[KEYS] Failed to read keys.json:", error);
        return [];
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
        console.error("[KEYS] Failed to save keys.json:", error);
        return false;
    }
}

/* =========================================================
   STOCK STORAGE
========================================================= */

function readStock() {
    try {
        ensureFile(STOCK_FILE, []);

        const raw = fs.readFileSync(STOCK_FILE, "utf8").trim();

        if (!raw) {
            return [];
        }

        const data = JSON.parse(raw);

        if (Array.isArray(data)) {
            return data;
        }

        if (data && Array.isArray(data.stock)) {
            return data.stock;
        }

        return [];
    } catch (error) {
        console.error("[STOCK] Failed to read stock:", error);
        return [];
    }
}

function saveStock(stock) {
    try {
        fs.writeFileSync(
            STOCK_FILE,
            JSON.stringify(stock, null, 2),
            "utf8"
        );

        return true;
    } catch (error) {
        console.error("[STOCK] Failed to save stock:", error);
        return false;
    }
}

/* =========================================================
   ADMIN AUTHENTICATION
========================================================= */

function requireAdmin(req, res, next) {
    if (!ADMIN_SECRET) {
        console.error(
            "[ADMIN] NOVI_ADMIN_SECRET is missing from environment variables."
        );

        return res.status(500).json({
            success: false,
            message: "Admin secret is not configured."
        });
    }

    const provided = String(
        req.headers["x-novi-admin-secret"] || ""
    ).trim();

    if (!provided) {
        return res.status(401).json({
            success: false,
            message: "Missing admin secret."
        });
    }

    try {
        const expectedBuffer = Buffer.from(ADMIN_SECRET);
        const providedBuffer = Buffer.from(provided);

        if (
            expectedBuffer.length !== providedBuffer.length ||
            !crypto.timingSafeEqual(
                expectedBuffer,
                providedBuffer
            )
        ) {
            return res.status(403).json({
                success: false,
                message: "Invalid admin secret."
            });
        }
    } catch (error) {
        console.error("[ADMIN] Authentication error:", error);

        return res.status(403).json({
            success: false,
            message: "Invalid admin secret."
        });
    }

    next();
}

/* =========================================================
   KEY HELPERS
========================================================= */

const DURATIONS = {
    "1d": {
        name: "1 Day",
        milliseconds: 24 * 60 * 60 * 1000
    },

    "3d": {
        name: "3 Days",
        milliseconds: 3 * 24 * 60 * 60 * 1000
    },

    "1week": {
        name: "1 Week",
        milliseconds: 7 * 24 * 60 * 60 * 1000
    },

    "1month": {
        name: "1 Month",
        milliseconds: 30 * 24 * 60 * 60 * 1000
    },

    "lifetime": {
        name: "Lifetime",
        milliseconds: null
    }
};

function generateKey() {
    const part1 = crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase();

    const part2 = crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase();

    const part3 = crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase();

    return `NOVI-${part1}-${part2}-${part3}`;
}

function createKeyRecord(duration) {
    const durationInfo = DURATIONS[duration];

    const now = Date.now();

    const expiresAt =
        durationInfo.milliseconds === null
            ? null
            : new Date(
                now + durationInfo.milliseconds
            ).toISOString();

    return {
        key: generateKey(),

        duration,

        durationName: durationInfo.name,

        createdAt: new Date(now).toISOString(),

        expiresAt,

        activatedAt: null,

        deviceId: null
    };
}

function findKey(keys, key) {
    const normalized = String(key || "")
        .trim()
        .toUpperCase();

    return keys.find(
        item =>
            String(item?.key || "")
                .trim()
                .toUpperCase() === normalized
    );
}

function isKeyExpired(keyRecord) {
    if (!keyRecord) {
        return true;
    }

    if (!keyRecord.expiresAt) {
        return false;
    }

    const expires = new Date(
        keyRecord.expiresAt
    ).getTime();

    if (!Number.isFinite(expires)) {
        return true;
    }

    return Date.now() >= expires;
}

/* =========================================================
   SESSION STORAGE
========================================================= */

const sessions = new Map();

function createSession(keyRecord) {
    const token = crypto.randomBytes(32).toString("hex");

    const expiresAt =
        Date.now() + SESSION_DURATION;

    sessions.set(token, {
        key: keyRecord.key,
        deviceId: keyRecord.deviceId,
        expiresAt
    });

    return {
        token,
        expiresAt
    };
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

/* Clean expired sessions */
setInterval(() => {
    const now = Date.now();

    for (const [token, session] of sessions.entries()) {
        if (now >= session.expiresAt) {
            sessions.delete(token);
        }
    }
}, 5 * 60 * 1000);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "online",
        service: "Novi",
        timestamp: new Date().toISOString()
    });
});

/* =========================================================
   BASIC API INFO
========================================================= */

app.get("/api", (req, res) => {
    res.json({
        success: true,
        name: "Novi API",
        status: "online"
    });
});

/* =========================================================
   GENERATE KEY
   POST /api/keys
========================================================= */

app.post("/api/keys", requireAdmin, (req, res) => {
    try {
        const duration = String(
            req.body?.duration || ""
        )
            .trim()
            .toLowerCase();

        console.log(
            `[API/KEYS] Generating key: ${duration}`
        );

        if (!DURATIONS[duration]) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid duration. Use 1d, 3d, 1week, 1month, or lifetime."
            });
        }

        const keys = readKeys();

        const keyRecord =
            createKeyRecord(duration);

        keys.push(keyRecord);

        const saved = saveKeys(keys);

        if (!saved) {
            return res.status(500).json({
                success: false,
                message: "Failed to save generated key."
            });
        }

        console.log(
            `[API/KEYS] Generated: ${keyRecord.key}`
        );

        return res.status(201).json({
            success: true,

            key: keyRecord.key,

            duration: keyRecord.duration,

            durationName:
                keyRecord.durationName,

            createdAt:
                keyRecord.createdAt,

            expiresAt:
                keyRecord.expiresAt
        });
    } catch (error) {
        console.error(
            "[API/KEYS] ERROR:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to generate key.",
            error: error.message
        });
    }
});

/* =========================================================
   GET ALL KEYS
   ADMIN ONLY
========================================================= */

app.get("/api/keys", requireAdmin, (req, res) => {
    try {
        const keys = readKeys();

        res.json({
            success: true,
            count: keys.length,
            keys
        });
    } catch (error) {
        console.error(
            "[API/KEYS GET] ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Failed to read keys."
        });
    }
});

/* =========================================================
   DELETE KEY
   ADMIN ONLY
========================================================= */

app.delete("/api/keys/:key", requireAdmin, (req, res) => {
    try {
        const key = String(
            req.params.key || ""
        )
            .trim()
            .toUpperCase();

        const keys = readKeys();

        const originalLength = keys.length;

        const filtered = keys.filter(
            item =>
                String(item?.key || "")
                    .trim()
                    .toUpperCase() !== key
        );

        if (filtered.length === originalLength) {
            return res.status(404).json({
                success: false,
                message: "Key not found."
            });
        }

        saveKeys(filtered);

        res.json({
            success: true,
            message: "Key deleted."
        });
    } catch (error) {
        console.error(
            "[API/KEYS DELETE] ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Failed to delete key."
        });
    }
});

/* =========================================================
   VERIFY KEY
   POST /api/verify
========================================================= */

app.post("/api/verify", (req, res) => {
    try {
        const key = String(
            req.body?.key || ""
        )
            .trim()
            .toUpperCase();

        const deviceId = String(
            req.body?.deviceId || ""
        ).trim();

        if (!key) {
            return res.status(400).json({
                success: false,
                valid: false,
                message: "Key is required."
            });
        }

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                valid: false,
                message: "Device ID is required."
            });
        }

        const keys = readKeys();

        const keyRecord =
            findKey(keys, key);

        if (!keyRecord) {
            return res.status(404).json({
                success: false,
                valid: false,
                message: "Invalid key."
            });
        }

        if (isKeyExpired(keyRecord)) {
            return res.status(403).json({
                success: false,
                valid: false,
                message: "This key has expired."
            });
        }

        /*
         * First activation binds the key to the device.
         */

        if (!keyRecord.deviceId) {
            keyRecord.deviceId = deviceId;

            keyRecord.activatedAt =
                new Date().toISOString();

            saveKeys(keys);
        } else if (
            String(keyRecord.deviceId) !==
            deviceId
        ) {
            return res.status(403).json({
                success: false,
                valid: false,
                message:
                    "This key is already linked to another device."
            });
        }

        const session =
            createSession(keyRecord);

        return res.json({
            success: true,
            valid: true,

            sessionToken:
                session.token,

            expiresAt:
                session.expiresAt,

            key: {
                key: keyRecord.key,
                duration:
                    keyRecord.duration,
                durationName:
                    keyRecord.durationName,
                createdAt:
                    keyRecord.createdAt,
                expiresAt:
                    keyRecord.expiresAt,
                activatedAt:
                    keyRecord.activatedAt
            }
        });
    } catch (error) {
        console.error(
            "[API/VERIFY] ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            valid: false,
            message: "Verification failed."
        });
    }
});

/* =========================================================
   SESSION CHECK
========================================================= */

app.get("/api/session", (req, res) => {
    try {
        const authHeader = String(
            req.headers.authorization || ""
        );

        const token = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7).trim()
            : "";

        const session =
            getSession(token);

        if (!session) {
            return res.status(401).json({
                success: false,
                valid: false,
                message: "Invalid or expired session."
            });
        }

        const keys = readKeys();

        const keyRecord =
            findKey(keys, session.key);

        if (!keyRecord) {
            sessions.delete(token);

            return res.status(401).json({
                success: false,
                valid: false,
                message: "Key no longer exists."
            });
        }

        if (isKeyExpired(keyRecord)) {
            sessions.delete(token);

            return res.status(401).json({
                success: false,
                valid: false,
                message: "Key has expired."
            });
        }

        res.json({
            success: true,
            valid: true,
            expiresAt: session.expiresAt,
            key: keyRecord
        });
    } catch (error) {
        console.error(
            "[API/SESSION] ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            valid: false,
            message: "Session check failed."
        });
    }
});

/* =========================================================
   STOCK - ADD
   ADMIN ONLY
========================================================= */

app.post("/api/stock/add", requireAdmin, (req, res) => {
    try {
        const item = String(
            req.body?.item || ""
        ).trim();

        if (!item) {
            return res.status(400).json({
                success: false,
                message: "Stock item is required."
            });
        }

        const stock = readStock();

        const exists = stock.some(
            existing =>
                String(existing).trim() === item
        );

        if (exists) {
            return res.json({
                success: true,
                added: 0,
                duplicates: 1,
                count: stock.length
            });
        }

        stock.push(item);

        const saved = saveStock(stock);

        if (!saved) {
            return res.status(500).json({
                success: false,
                message: "Failed to save stock."
            });
        }

        return res.json({
            success: true,
            added: 1,
            duplicates: 0,
            count: stock.length
        });
    } catch (error) {
        console.error(
            "[API/STOCK/ADD] ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Failed to add stock."
        });
    }
});

/* =========================================================
   STOCK - GET
   ADMIN ONLY
========================================================= */

app.get("/api/admin/stock", requireAdmin, (req, res) => {
    try {
        const stock = readStock();

        res.json({
            success: true,
            count: stock.length,
            stock
        });
    } catch (error) {
        console.error(
            "[API/STOCK] ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Failed to read stock."
        });
    }
});

/* =========================================================
   STOCK - PUBLIC COUNT
========================================================= */

app.get("/api/stock/count", (req, res) => {
    try {
        const stock = readStock();

        res.json({
            success: true,
            count: stock.length
        });
    } catch (error) {
        console.error(
            "[API/STOCK/COUNT] ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            count: 0
        });
    }
});

/* =========================================================
   STATIC WEBSITE
========================================================= */

if (fs.existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR));

    app.get("*", (req, res, next) => {
        /*
         * Don't send index.html for API requests.
         */
        if (req.path.startsWith("/api/")) {
            return next();
        }

        const indexPath =
            path.join(PUBLIC_DIR, "index.html");

        if (fs.existsSync(indexPath)) {
            return res.sendFile(indexPath);
        }

        next();
    });
}

/* =========================================================
   404 HANDLER
========================================================= */

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route not found."
    });
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((error, req, res, next) => {
    console.error(
        "[SERVER ERROR]",
        error
    );

    res.status(500).json({
        success: false,
        message: "Internal server error."
    });
});

/* =========================================================
   START SERVER
========================================================= */

const server = app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log("");
        console.log("========================================");
        console.log("           NOVI SERVER ONLINE");
        console.log("========================================");
        console.log(`Port: ${PORT}`);
        console.log(`API: http://127.0.0.1:${PORT}`);
        console.log("Health: /health");
        console.log("Key API: POST /api/keys");
        console.log("Verify API: POST /api/verify");
        console.log("Stock API: POST /api/stock/add");
        console.log("========================================");
        console.log("");
    }
);

server.on("error", error => {
    console.error(
        "[SERVER] Failed to start:",
        error
    );
});

module.exports = {
    app,
    server
};
