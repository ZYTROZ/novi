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

const ADMIN_SECRET = String(
    process.env.NOVI_ADMIN_SECRET || ""
).trim();

const SESSION_DURATION = 30 * 60 * 1000;

/* =========================================================
   MEMORY
========================================================= */

const sessions = new Map();
const verifyAttempts = new Map();

/* =========================================================
   BASIC SETUP
========================================================= */

app.disable("x-powered-by");

app.use(
    cors({
        origin: true,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "Accept",
            "x-novi-session",
            "x-novi-admin-secret"
        ]
    })
);

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
        }
    } catch (error) {
        console.error(
            "FAILED TO CREATE FILE:",
            file
        );
        console.error(error);
    }
}

function readJSON(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            return fallback;
        }

        const raw = fs.readFileSync(
            file,
            "utf8"
        );

        if (!raw.trim()) {
            return fallback;
        }

        return JSON.parse(raw);

    } catch (error) {
        console.error(
            "FAILED TO READ JSON:",
            file
        );

        console.error(error);

        return fallback;
    }
}

function writeJSON(file, data) {
    try {
        const tempFile =
            `${file}.tmp`;

        fs.writeFileSync(
            tempFile,
            JSON.stringify(
                data,
                null,
                2
            ),
            "utf8"
        );

        fs.renameSync(
            tempFile,
            file
        );

        return true;

    } catch (error) {
        console.error(
            "FAILED TO WRITE JSON:",
            file
        );

        console.error(error);

        return false;
    }
}

ensureFile(
    KEY_FILE,
    []
);

ensureFile(
    STOCK_FILE,
    []
);

/* =========================================================
   KEY HELPERS
========================================================= */

function normalizeKey(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
}

function normalizeDeviceId(value) {
    return String(value || "")
        .trim();
}

function generateKey() {
    const part = () =>
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

    return (
        `NOVI-${part()}-${part()}-${part()}`
    );
}

function safeEqual(a, b) {
    try {
        const aBuffer =
            Buffer.from(
                String(a)
            );

        const bBuffer =
            Buffer.from(
                String(b)
            );

        if (
            aBuffer.length !==
            bBuffer.length
        ) {
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

/* =========================================================
   KEY DURATIONS
========================================================= */

const DURATIONS = {
    "1d":
        24 *
        60 *
        60 *
        1000,

    "3d":
        3 *
        24 *
        60 *
        60 *
        1000,

    "1week":
        7 *
        24 *
        60 *
        60 *
        1000,

    "1month":
        30 *
        24 *
        60 *
        60 *
        1000,

    "lifetime":
        null
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

    const length =
        DURATIONS[duration];

    if (length === null) {
        return null;
    }

    return (
        Date.now() +
        length
    );
}

/* =========================================================
   KEY STORAGE
========================================================= */

function readKeys() {
    const data =
        readJSON(
            KEY_FILE,
            []
        );

    /*
     * Normal format:
     *
     * [
     *   {
     *      key: "NOVI-...",
     *      duration: "1d"
     *   }
     * ]
     */

    if (Array.isArray(data)) {
        return data;
    }

    /*
     * Also support:
     *
     * {
     *    "keys": [...]
     * }
     */

    if (
        data &&
        Array.isArray(data.keys)
    ) {
        return data.keys;
    }

    /*
     * Also support an old object
     * containing key records.
     */

    if (
        data &&
        typeof data === "object"
    ) {
        const values =
            Object.values(data);

        const possibleKeys =
            values.filter(
                value =>
                    typeof value ===
                    "string" ||
                    (
                        value &&
                        typeof value ===
                        "object" &&
                        typeof value.key ===
                        "string"
                    )
            );

        if (
            possibleKeys.length > 0
        ) {
            return possibleKeys;
        }
    }

    /*
     * Empty {} is treated as an
     * empty key database.
     */

    return [];
}

function saveKeys(keys) {
    /*
     * Always save keys in the
     * correct array format.
     */

    return writeJSON(
        KEY_FILE,
        Array.isArray(keys)
            ? keys
            : []
    );
}

function createKeyRecord(duration) {
    return {
        key: generateKey(),

        duration,

        durationName:
            DURATION_NAMES[
                duration
            ],

        createdAt:
            Date.now(),

        expiresAt:
            calculateExpiration(
                duration
            ),

        deviceId: null,

        activatedAt: null
    };
}

/* =========================================================
   FIND KEY
========================================================= */

function findKey(rawKey) {
    const key =
        normalizeKey(rawKey);

    if (!key) {
        return null;
    }

    const keys =
        readKeys();

    for (
        let i = 0;
        i < keys.length;
        i++
    ) {
        const record =
            keys[i];

        const storedKey =
            typeof record ===
            "string"
                ? normalizeKey(
                    record
                )
                : normalizeKey(
                    record?.key
                );

        if (
            storedKey &&
            safeEqual(
                storedKey,
                key
            )
        ) {
            return {
                record,
                index: i
            };
        }
    }

    return null;
}

/* =========================================================
   VERIFY KEY
========================================================= */

function verifyKey(
    rawKey,
    rawDeviceId
) {
    const key =
        normalizeKey(rawKey);

    const deviceId =
        normalizeDeviceId(
            rawDeviceId
        );

    if (!key) {
        return {
            success: false,
            valid: false,
            message:
                "Please enter a key."
        };
    }

    if (!deviceId) {
        return {
            success: false,
            valid: false,
            message:
                "Device ID is required."
        };
    }

    const keys =
        readKeys();

    let found = null;
    let foundIndex = -1;

    for (
        let i = 0;
        i < keys.length;
        i++
    ) {
        const record =
            keys[i];

        const storedKey =
            typeof record ===
            "string"
                ? normalizeKey(
                    record
                )
                : normalizeKey(
                    record?.key
                );

        if (
            storedKey &&
            safeEqual(
                storedKey,
                key
            )
        ) {
            found =
                record;

            foundIndex =
                i;

            break;
        }
    }

    if (
        found === null ||
        foundIndex === -1
    ) {
        console.log(
            `[VERIFY] Invalid key attempt`
        );

        return {
            success: false,
            valid: false,
            message:
                "Invalid key."
        };
    }

    /* =====================================================
       CONVERT OLD STRING KEY
    ===================================================== */

    if (
        typeof found ===
        "string"
    ) {
        found = {
            key:
                normalizeKey(
                    found
                ),

            duration:
                "lifetime",

            durationName:
                "Lifetime",

            createdAt:
                Date.now(),

            expiresAt:
                null,

            deviceId:
                null,

            activatedAt:
                null
        };

        keys[foundIndex] =
            found;
    }

    /* =====================================================
       FIX MISSING DURATION
    ===================================================== */

    if (
        !found.duration ||
        !Object.prototype.hasOwnProperty.call(
            DURATIONS,
            found.duration
        )
    ) {
        found.duration =
            "lifetime";
    }

    if (
        !found.durationName
    ) {
        found.durationName =
            DURATION_NAMES[
                found.duration
            ] ||
            "Lifetime";
    }

    /* =====================================================
       EXPIRATION
    ===================================================== */

    if (
        found.expiresAt !==
            null &&
        found.expiresAt !==
            undefined &&
        Number(
            found.expiresAt
        ) <= Date.now()
    ) {
        console.log(
            `[VERIFY] Expired key`
        );

        return {
            success: false,
            valid: false,
            message:
                "This key has expired."
        };
    }

    /* =====================================================
       DEVICE BINDING
    ===================================================== */

    if (!found.deviceId) {

        found.deviceId =
            deviceId;

        found.activatedAt =
            Date.now();

        keys[foundIndex] =
            found;

        const saved =
            saveKeys(keys);

        if (!saved) {
            return {
                success: false,
                valid: false,
                message:
                    "Could not save key activation."
            };
        }

        console.log(
            `[VERIFY] Key activated successfully`
        );

    } else {

        if (
            !safeEqual(
                normalizeDeviceId(
                    found.deviceId
                ),
                deviceId
            )
        ) {
            console.log(
                `[VERIFY] Device mismatch`
            );

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

/* =========================================================
   SESSIONS
========================================================= */

function createSession(
    key,
    deviceId
) {
    const token =
        crypto
            .randomBytes(32)
            .toString("hex");

    const expiresAt =
        Date.now() +
        SESSION_DURATION;

    sessions.set(
        token,
        {
            key:
                normalizeKey(
                    key
                ),

            deviceId:
                normalizeDeviceId(
                    deviceId
                ),

            expiresAt
        }
    );

    return {
        token,
        expiresAt
    };
}

function getSession(token) {
    if (!token) {
        return null;
    }

    const session =
        sessions.get(token);

    if (!session) {
        return null;
    }

    if (
        session.expiresAt <=
        Date.now()
    ) {
        sessions.delete(
            token
        );

        return null;
    }

    const result =
        findKey(
            session.key
        );

    if (!result) {
        sessions.delete(
            token
        );

        return null;
    }

    let keyRecord =
        result.record;

    if (
        typeof keyRecord ===
        "string"
    ) {
        keyRecord = {
            key:
                normalizeKey(
                    keyRecord
                ),

            duration:
                "lifetime",

            durationName:
                "Lifetime",

            createdAt:
                Date.now(),

            expiresAt:
                null,

            deviceId:
                null,

            activatedAt:
                null
        };
    }

    if (
        keyRecord.expiresAt !==
            null &&
        keyRecord.expiresAt !==
            undefined &&
        Number(
            keyRecord.expiresAt
        ) <= Date.now()
    ) {
        sessions.delete(
            token
        );

        return null;
    }

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
        sessions.delete(
            token
        );

        return null;
    }

    return session;
}

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function requireSession(
    req,
    res,
    next
) {
    const token =
        req.headers[
            "x-novi-session"
        ];

    const session =
        getSession(token);

    if (!session) {
        return res
            .status(401)
            .json({
                success: false,
                message:
                    "Authentication required."
            });
    }

    req.noviSession =
        session;

    next();
}

function requireAdmin(
    req,
    res,
    next
) {
    if (!ADMIN_SECRET) {
        return res
            .status(503)
            .json({
                success: false,
                message:
                    "Admin secret is not configured."
            });
    }

    const supplied =
        String(
            req.headers[
                "x-novi-admin-secret"
            ] || ""
        );

    if (
        !safeEqual(
            supplied,
            ADMIN_SECRET
        )
    ) {
        return res
            .status(403)
            .json({
                success: false,
                message:
                    "Admin access denied."
            });
    }

    next();
}

/* =========================================================
   VERIFY RATE LIMIT
========================================================= */

function getClientIP(req) {
    const forwarded =
        req.headers[
            "x-forwarded-for"
        ];

    if (forwarded) {
        return String(
            forwarded
        )
            .split(",")[0]
            .trim();
    }

    return (
        req.socket
            ?.remoteAddress ||
        "unknown"
    );
}

function checkVerifyRateLimit(
    ip
) {
    const now =
        Date.now();

    const WINDOW =
        5 * 60 * 1000;

    const MAX_ATTEMPTS =
        10;

    let data =
        verifyAttempts.get(
            ip
        );

    if (!data) {
        data = {
            count: 0,
            resetAt:
                now + WINDOW
        };

        verifyAttempts.set(
            ip,
            data
        );
    }

    if (
        now >=
        data.resetAt
    ) {
        data.count = 0;

        data.resetAt =
            now + WINDOW;
    }

    data.count++;

    if (
        data.count >
        MAX_ATTEMPTS
    ) {
        return {
            allowed: false,

            retryAfter:
                Math.ceil(
                    (
                        data.resetAt -
                        now
                    ) / 1000
                )
        };
    }

    return {
        allowed: true
    };
}

/* =========================================================
   STOCK
========================================================= */

function readStock() {
    const data =
        readJSON(
            STOCK_FILE,
            []
        );

    return Array.isArray(
        data
    )
        ? data
        : [];
}

function saveStock(
    stock
) {
    return writeJSON(
        STOCK_FILE,
        stock
    );
}

/* =========================================================
   HEALTH
========================================================= */

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

/* =========================================================
   ADMIN STATUS
========================================================= */

app.get(
    "/api/admin-status",
    (req, res) => {
        res.json({
            success: true,
            adminConfigured:
                Boolean(
                    ADMIN_SECRET
                )
        });
    }
);

/* =========================================================
   API ROOT
========================================================= */

app.get(
    "/api",
    (req, res) => {
        res.json({
            success: true,
            name: "Novi API"
        });
    }
);

/* =========================================================
   VERIFY KEY
========================================================= */

app.post(
    "/api/verify",
    (req, res) => {

        try {

            const ip =
                getClientIP(req);

            const rate =
                checkVerifyRateLimit(
                    ip
                );

            if (
                !rate.allowed
            ) {

                res.setHeader(
                    "Retry-After",
                    rate.retryAfter
                );

                return res
                    .status(429)
                    .json({
                        success: false,
                        valid: false,
                        message:
                            "Too many verification attempts. Please try again later."
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

            if (
                !result.success
            ) {
                return res
                    .status(401)
                    .json(
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
                        result.key
                            .duration,

                    durationName:
                        result.key
                            .durationName,

                    expiresAt:
                        result.key
                            .expiresAt
                }
            });

        } catch (error) {

            console.error(
                "VERIFY ERROR:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    valid: false,
                    message:
                        "Internal server error."
                });
        }
    }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
    "/api/logout",
    requireSession,
    (req, res) => {

        const token =
            req.headers[
                "x-novi-session"
            ];

        sessions.delete(
            token
        );

        return res.json({
            success: true
        });
    }
);

/* =========================================================
   USER STOCK COUNT
========================================================= */

app.get(
    "/api/stock",
    requireSession,
    (req, res) => {

        const stock =
            readStock();

        return res.json({
            success: true,
            count:
                stock.length
        });
    }
);

/* =========================================================
   USER GENERATE STOCK ITEM
========================================================= */

app.post(
    "/api/stock/generate",
    requireSession,
    (req, res) => {

        try {

            const stock =
                readStock();

            if (
                stock.length === 0
            ) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "No inventory is currently available."
                    });
            }

            const item =
                stock.shift();

            const saved =
                saveStock(
                    stock
                );

            if (!saved) {
                return res
                    .status(500)
                    .json({
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

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "Failed to generate inventory."
                });
        }
    }
);

/* =========================================================
   ADMIN CREATE KEY
========================================================= */

app.post(
    "/api/keys",
    requireAdmin,
    (req, res) => {

        try {

            const duration =
                String(
                    req.body?.duration ||
                    ""
                )
                    .trim()
                    .toLowerCase();

            if (
                !Object.prototype.hasOwnProperty.call(
                    DURATIONS,
                    duration
                )
            ) {
                return res
                    .status(400)
                    .json({
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

            keys.push(
                record
            );

            const saved =
                saveKeys(
                    keys
                );

            if (!saved) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "Failed to save key."
                    });
            }

            console.log(
                `[KEY CREATED] ${record.durationName}`
            );

            console.log(
                `[KEY COUNT] ${keys.length}`
            );

            /*
             * Do not log the actual key.
             */

            return res
                .status(201)
                .json({
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

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "Failed to create key."
                });
        }
    }
);

/* =========================================================
   ADMIN ADD STOCK
========================================================= */

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
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Missing inventory item."
                    });
            }

            const normalizedItem =
                String(item).trim();

            if (
                !normalizedItem
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Inventory item cannot be empty."
                    });
            }

            const stock =
                readStock();

            const duplicate =
                stock.some(
                    existing =>
                        String(
                            existing
                        ).trim() ===
                        normalizedItem
                );

            if (duplicate) {
                return res.json({
                    success: true,
                    added: 0,
                    duplicates: 1,
                    count:
                        stock.length
                });
            }

            stock.push(
                normalizedItem
            );

            const saved =
                saveStock(
                    stock
                );

            if (!saved) {
                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "Failed to save inventory."
                    });
            }

            return res.json({
                success: true,
                added: 1,
                duplicates: 0,
                count:
                    stock.length
            });

        } catch (error) {

            console.error(
                "ADD STOCK ERROR:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "Failed to add inventory."
                });
        }
    }
);

/* =========================================================
   ADMIN STOCK COUNT
========================================================= */

app.get(
    "/api/admin/stock",
    requireAdmin,
    (req, res) => {

        try {

            const stock =
                readStock();

            return res.json({
                success: true,
                count:
                    stock.length
            });

        } catch (error) {

            console.error(
                "ADMIN STOCK COUNT ERROR:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "Failed to read inventory."
                });
        }
    }
);

/* =========================================================
   STATIC WEBSITE
========================================================= */

if (
    fs.existsSync(
        PUBLIC_DIR
    )
) {

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
                fs.existsSync(
                    indexFile
                )
            ) {
                return res.sendFile(
                    indexFile
                );
            }

            return res
                .status(404)
                .send(
                    "Novi frontend not found."
                );
        }
    );
}

/* =========================================================
   UNKNOWN API ROUTES
========================================================= */

app.use(
    "/api",
    (req, res) => {

        return res
            .status(404)
            .json({
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
            "SERVER ERROR:",
            error
        );

        return res
            .status(500)
            .json({
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
            "========================================"
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
            "========================================"
        );
    }
);
