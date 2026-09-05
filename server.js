const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname, "public");

const KEY_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "epicgames-stock.json");

const ADMIN_SECRET = process.env.NOVI_ADMIN_SECRET || "";

const SESSION_DURATION = 30 * 60 * 1000;

// =========================================================
// SESSION STORAGE
// =========================================================

const sessions = new Map();

// =========================================================
// KEY VERIFICATION RATE LIMIT
// =========================================================

const verifyAttempts = new Map();

const VERIFY_WINDOW = 5 * 60 * 1000;
const VERIFY_MAX_ATTEMPTS = 10;

// =========================================================
// BASIC SETUP
// =========================================================

app.disable("x-powered-by");

app.use(cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
        "Content-Type",
        "Accept",
        "x-novi-session",
        "x-novi-admin-secret"
    ]
}));

app.use(express.json({
    limit: "1mb"
}));

// =========================================================
// FILE HELPERS
// =========================================================

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
        console.error("FAILED TO CREATE FILE:", file);
        console.error(error);
    }
}

ensureFile(KEY_FILE, []);
ensureFile(STOCK_FILE, []);

function readJSON(file, fallback) {
    try {
        const raw = fs.readFileSync(file, "utf8");

        if (!raw.trim()) {
            return fallback;
        }

        return JSON.parse(raw);
    } catch (error) {
        console.error("FAILED TO READ JSON:", file);
        console.error(error);

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
        console.error("FAILED TO WRITE JSON:", file);
        console.error(error);

        return false;
    }
}

// =========================================================
// KEY HELPERS
// =========================================================

function normalizeKey(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
}

function normalizeDeviceId(value) {
    return String(value || "").trim();
}

function generateKey() {
    const part = () =>
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

    return `NOVI-${part()}-${part()}-${part()}`;
}

function safeEqual(a, b) {
    try {
        const aBuffer = Buffer.from(String(a));
        const bBuffer = Buffer.from(String(b));

        if (aBuffer.length !== bBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(
            aBuffer,
            bBuffer
        );
    } catch {
        return false;
    }
}

// =========================================================
// KEY DURATIONS
// =========================================================

const DURATIONS = {
    "1d": 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "1week": 7 * 24 * 60 * 60 * 1000,
    "1month": 30 * 24 * 60 * 60 * 1000,
    "lifetime": null
};

const DURATION_NAMES = {
    "1d": "1 Day",
    "3d": "3 Days",
    "1week": "1 Week",
    "1month": "1 Month",
    "lifetime": "Lifetime"
};

function calculateExpiration(duration) {
    if (
        !Object.prototype.hasOwnProperty.call(
            DURATIONS,
            duration
        )
    ) {
        return null;
    }

    const length = DURATIONS[duration];

    if (length === null) {
        return null;
    }

    return Date.now() + length;
}

// =========================================================
// KEY STORAGE
// =========================================================

function readKeys() {
    const data = readJSON(KEY_FILE, []);

    if (!Array.isArray(data)) {
        console.error(
            "keys.json is not an array. Using empty key list."
        );

        return [];
    }

    return data;
}

function saveKeys(keys) {
    return writeJSON(KEY_FILE, keys);
}

function createKeyRecord(duration) {
    return {
        key: generateKey(),
        duration,
        durationName: DURATION_NAMES[duration],
        createdAt: Date.now(),
        expiresAt: calculateExpiration(duration),
        deviceId: null,
        activatedAt: null
    };
}

// =========================================================
// FIND KEY
// =========================================================

function findKey(rawKey) {
    const key = normalizeKey(rawKey);

    if (!key) {
        return {
            found: false,
            key: null,
            index: -1
        };
    }

    const keys = readKeys();

    for (let i = 0; i < keys.length; i++) {
        const record = keys[i];

        const storedKey =
            typeof record === "string"
                ? normalizeKey(record)
                : normalizeKey(record?.key);

        if (safeEqual(storedKey, key)) {
            return {
                found: true,
                key: record,
                index: i
            };
        }
    }

    return {
        found: false,
        key: null,
        index: -1
    };
}

// =========================================================
// VERIFY KEY
// =========================================================

function verifyKey(rawKey, rawDeviceId) {
    const key = normalizeKey(rawKey);
    const deviceId = normalizeDeviceId(rawDeviceId);

    if (!key) {
        return {
            success: false,
            valid: false,
            message: "Please enter a key."
        };
    }

    if (!deviceId) {
        return {
            success: false,
            valid: false,
            message: "Device ID is required."
        };
    }

    const keys = readKeys();

    let found = null;
    let foundIndex = -1;

    for (let i = 0; i < keys.length; i++) {
        const record = keys[i];

        const storedKey =
            typeof record === "string"
                ? normalizeKey(record)
                : normalizeKey(record?.key);

        if (safeEqual(storedKey, key)) {
            found = record;
            foundIndex = i;
            break;
        }
    }

    if (!found) {
        return {
            success: false,
            valid: false,
            message: "Invalid key."
        };
    }

    // =====================================================
    // CONVERT OLD STRING-ONLY KEYS
    // =====================================================

    if (typeof found === "string") {
        found = {
            key: normalizeKey(found),
            duration: "lifetime",
            durationName: "Lifetime",
            createdAt: Date.now(),
            expiresAt: null,
            deviceId: null,
            activatedAt: null
        };

        keys[foundIndex] = found;
    }

    // =====================================================
    // CHECK EXPIRATION
    // =====================================================

    if (
        found.expiresAt !== null &&
        found.expiresAt !== undefined &&
        Number(found.expiresAt) <= Date.now()
    ) {
        return {
            success: false,
            valid: false,
            message: "This key has expired."
        };
    }

    // =====================================================
    // BIND KEY TO FIRST DEVICE
    // =====================================================

    if (!found.deviceId) {
        found.deviceId = deviceId;
        found.activatedAt = Date.now();

        keys[foundIndex] = found;

        const saved = saveKeys(keys);

        if (!saved) {
            return {
                success: false,
                valid: false,
                message: "Could not save key activation."
            };
        }
    } else {
        if (
            !safeEqual(
                normalizeDeviceId(found.deviceId),
                deviceId
            )
        ) {
            return {
                success: false,
                valid: false,
                message:
                    "This key is already bound to another device."
            };
        }
    }

    return {
        success: true,
        valid: true,
        key: found
    };
}

// =========================================================
// SESSIONS
// =========================================================

function createSession(key, deviceId) {
    const token =
        crypto.randomBytes(32).toString("hex");

    const expiresAt =
        Date.now() + SESSION_DURATION;

    sessions.set(token, {
        key: normalizeKey(key),
        deviceId: normalizeDeviceId(deviceId),
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

    // =====================================================
    // SESSION EXPIRATION
    // =====================================================

    if (session.expiresAt <= Date.now()) {
        sessions.delete(token);
        return null;
    }

    // =====================================================
    // CHECK KEY STILL EXISTS
    // =====================================================

    const keyResult = findKey(session.key);

    if (!keyResult.found) {
        sessions.delete(token);
        return null;
    }

    let keyRecord = keyResult.key;

    // =====================================================
    // OLD STRING KEY
    // =====================================================

    if (typeof keyRecord === "string") {
        keyRecord = {
            key: normalizeKey(keyRecord),
            duration: "lifetime",
            expiresAt: null,
            deviceId: null
        };
    }

    // =====================================================
    // CHECK KEY EXPIRATION
    // =====================================================

    if (
        keyRecord.expiresAt !== null &&
        keyRecord.expiresAt !== undefined &&
        Number(keyRecord.expiresAt) <= Date.now()
    ) {
        sessions.delete(token);
        return null;
    }

    // =====================================================
    // CHECK DEVICE BINDING
    // =====================================================

    if (
        keyRecord.deviceId &&
        !safeEqual(
            normalizeDeviceId(
                keyRecord.deviceId
            ),
            normalizeDeviceId(
                session.deviceId
            )
        )
    ) {
        sessions.delete(token);
        return null;
    }

    return session;
}

// =========================================================
// AUTH MIDDLEWARE
// =========================================================

function requireSession(req, res, next) {
    const token =
        req.headers["x-novi-session"];

    const session =
        getSession(token);

    if (!session) {
        return res.status(401).json({
            success: false,
            message: "Authentication required."
        });
    }

    req.noviSession = session;

    next();
}

function requireAdmin(req, res, next) {
    if (!ADMIN_SECRET) {
        return res.status(503).json({
            success: false,
            message:
                "Admin secret is not configured."
        });
    }

    const supplied =
        req.headers["x-novi-admin-secret"];

    if (
        !safeEqual(
            supplied || "",
            ADMIN_SECRET
        )
    ) {
        return res.status(403).json({
            success: false,
            message:
                "Admin access denied."
        });
    }

    next();
}

// =========================================================
// VERIFY RATE LIMIT
// =========================================================

function getRateLimitIdentifier(req) {
    const forwarded =
        req.headers["x-forwarded-for"];

    if (forwarded) {
        return String(forwarded)
            .split(",")[0]
            .trim();
    }

    return req.ip || "unknown";
}

function checkVerifyRateLimit(req) {
    const identifier =
        getRateLimitIdentifier(req);

    const now = Date.now();

    let record =
        verifyAttempts.get(identifier);

    if (!record) {
        record = {
            count: 0,
            resetAt:
                now + VERIFY_WINDOW
        };

        verifyAttempts.set(
            identifier,
            record
        );
    }

    if (now >= record.resetAt) {
        record.count = 0;
        record.resetAt =
            now + VERIFY_WINDOW;
    }

    if (
        record.count >=
        VERIFY_MAX_ATTEMPTS
    ) {
        return false;
    }

    record.count++;

    return true;
}

// =========================================================
// STOCK
// =========================================================

function readStock() {
    const data =
        readJSON(
            STOCK_FILE,
            []
        );

    return Array.isArray(data)
        ? data
        : [];
}

function saveStock(stock) {
    return writeJSON(
        STOCK_FILE,
        stock
    );
}

// =========================================================
// HEALTH
// =========================================================

app.get(
    "/api/health",
    (req, res) => {
        res.json({
            success: true,
            status: "online",
            service: "Novi"
        });
    }
);

// =========================================================
// ADMIN STATUS
// =========================================================

app.get(
    "/api/admin-status",
    (req, res) => {
        res.json({
            success: true,
            adminConfigured:
                Boolean(ADMIN_SECRET)
        });
    }
);

// =========================================================
// API ROOT
// =========================================================

app.get(
    "/api",
    (req, res) => {
        res.json({
            success: true,
            name: "Novi API"
        });
    }
);

// =========================================================
// VERIFY KEY
// =========================================================

app.post(
    "/api/verify",
    (req, res) => {

        try {

            // =================================================
            // RATE LIMIT KEY ATTEMPTS
            // =================================================

            if (!checkVerifyRateLimit(req)) {
                return res.status(429).json({
                    success: false,
                    valid: false,
                    message:
                        "Too many key attempts. Please try again later."
                });
            }

            const key =
                req.body?.key;

            const deviceId =
                req.body?.deviceId;

            const result =
                verifyKey(
                    key,
                    deviceId
                );

            if (!result.success) {
                return res.status(401).json(
                    result
                );
            }

            const session =
                createSession(
                    key,
                    deviceId
                );

            return res.json({
                success: true,
                valid: true,

                sessionToken:
                    session.token,

                expiresAt:
                    session.expiresAt,

                key: {
                    duration:
                        result.key.duration,

                    durationName:
                        result.key.durationName ||
                        DURATION_NAMES[
                            result.key.duration
                        ] ||
                        "Lifetime",

                    expiresAt:
                        result.key.expiresAt
                }
            });

        } catch (error) {

            console.error(
                "VERIFY ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                valid: false,
                message:
                    "Internal server error."
            });
        }
    }
);

// =========================================================
// LOGOUT
// =========================================================

app.post(
    "/api/logout",
    requireSession,
    (req, res) => {

        const token =
            req.headers["x-novi-session"];

        sessions.delete(token);

        res.json({
            success: true
        });
    }
);

// =========================================================
// STOCK COUNT
// =========================================================

app.get(
    "/api/stock",
    requireSession,
    (req, res) => {

        const stock =
            readStock();

        res.json({
            success: true,
            count:
                stock.length
        });
    }
);

// =========================================================
// GENERATE STOCK ITEM
// =========================================================

app.post(
    "/api/stock/generate",
    requireSession,
    (req, res) => {

        try {

            const stock =
                readStock();

            if (stock.length === 0) {
                return res.status(404).json({
                    success: false,
                    message:
                        "No inventory is currently available."
                });
            }

            const item =
                stock.shift();

            const saved =
                saveStock(stock);

            if (!saved) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Failed to save inventory."
                });
            }

            return res.json({
                success: true,
                item,
                remaining:
                    stock.length
            });

        } catch (error) {

            console.error(
                "STOCK GENERATE ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to generate inventory."
            });
        }
    }
);

// =========================================================
// ADMIN: CREATE KEY
// =========================================================

app.post(
    "/api/keys",
    requireAdmin,
    (req, res) => {

        try {

            const duration =
                String(
                    req.body?.duration || ""
                )
                    .trim()
                    .toLowerCase();

            if (
                !Object.prototype.hasOwnProperty.call(
                    DURATIONS,
                    duration
                )
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid duration. Use 1d, 3d, 1week, 1month, or lifetime."
                });
            }

            const keys =
                readKeys();

            const record =
                createKeyRecord(
                    duration
                );

            keys.push(record);

            const saved =
                saveKeys(keys);

            if (!saved) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Failed to save key."
                });
            }

            console.log(
                "Generated key:",
                record.key,
                "| Duration:",
                record.duration
            );

            return res.status(201).json({
                success: true,

                key:
                    record.key,

                duration:
                    record.duration,

                durationName:
                    record.durationName,

                expiresAt:
                    record.expiresAt,

                createdAt:
                    record.createdAt
            });

        } catch (error) {

            console.error(
                "CREATE KEY ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to create key."
            });
        }
    }
);

// =========================================================
// ADMIN: ADD STOCK
// =========================================================

app.post(
    "/api/stock/add",
    requireAdmin,
    (req, res) => {

        try {

            const item =
                req.body?.item;

            if (
                item === undefined ||
                item === null
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Missing inventory item."
                });
            }

            const stock =
                readStock();

            stock.push(item);

            const saved =
                saveStock(stock);

            if (!saved) {
                return res.status(500).json({
                    success: false,
                    message:
                        "Failed to save inventory."
                });
            }

            res.json({
                success: true,
                count:
                    stock.length
            });

        } catch (error) {

            console.error(
                "ADD STOCK ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Failed to add inventory."
            });
        }
    }
);

// =========================================================
// STATIC WEBSITE
// =========================================================

if (fs.existsSync(PUBLIC_DIR)) {

    app.use(
        express.static(
            PUBLIC_DIR
        )
    );

    app.get(
        "/",
        (req, res) => {

            const indexFile =
                path.join(
                    PUBLIC_DIR,
                    "index.html"
                );

            if (
                fs.existsSync(indexFile)
            ) {
                return res.sendFile(
                    indexFile
                );
            }

            res.status(404).send(
                "Novi frontend not found."
            );
        }
    );
}

// =========================================================
// UNKNOWN API ROUTES
// =========================================================

app.use(
    "/api",
    (req, res) => {

        res.status(404).json({
            success: false,
            message:
                "API endpoint not found."
        });
    }
);

// =========================================================
// ERROR HANDLER
// =========================================================

app.use(
    (error, req, res, next) => {

        console.error(
            "SERVER ERROR:",
            error
        );

        res.status(500).json({
            success: false,
            message:
                "Internal server error."
        });
    }
);

// =========================================================
// START SERVER
// =========================================================

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
            `Port: ${PORT}`
        );

        console.log(
            `Keys loaded: ${readKeys().length}`
        );

        console.log(
            `Stock loaded: ${readStock().length}`
        );

        console.log(
            `Admin authentication: ${
                ADMIN_SECRET
                    ? "CONFIGURED"
                    : "NOT CONFIGURED"
            }`
        );

        console.log(
            "Dashboard protection: ENABLED"
        );

        console.log(
            "Session validation: ENABLED"
        );

        console.log(
            "Key attempt protection: ENABLED"
        );

        console.log(
            "=============================="
        );
    }
);
