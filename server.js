require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = Number(process.env.PORT) || 10000;

const PUBLIC_DIR = path.join(__dirname, "public");
const KEY_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "epicgames-stock.json");
const SAVED_LOGINS_FILE = path.join(
    __dirname,
    "saved-logins.json"
);

const ADMIN_SECRET = String(
    process.env.NOVI_ADMIN_SECRET || ""
).trim();

/*
 * Used to encrypt saved passwords before writing
 * them to saved-logins.json.
 */
const CREDENTIAL_SECRET = String(
    process.env.NOVI_CREDENTIAL_SECRET || ""
).trim();

const SESSION_DURATION = 30 * 60 * 1000;

/*
 * In-memory sessions.
 *
 * Sessions disappear if the server restarts,
 * which is intentional.
 */
const sessions = new Map();

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());

app.use(
    express.json({
        limit: "2mb"
    })
);

app.use(
    express.urlencoded({
        extended: true,
        limit: "2mb"
    })
);

/* =========================================================
   FILE SETUP
========================================================= */

function ensureFile(file, defaultValue) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(
                file,
                JSON.stringify(
                    defaultValue,
                    null,
                    2
                ),
                "utf8"
            );
        }
    } catch (error) {
        console.error(
            "[FILE ERROR]",
            error
        );
    }
}

ensureFile(KEY_FILE, []);
ensureFile(STOCK_FILE, []);
ensureFile(SAVED_LOGINS_FILE, []);

/* =========================================================
   GENERIC JSON HELPERS
========================================================= */

function readJsonFile(file, fallback = []) {
    try {
        ensureFile(file, fallback);

        const raw =
            fs.readFileSync(
                file,
                "utf8"
            ).trim();

        if (!raw) {
            return fallback;
        }

        const data =
            JSON.parse(raw);

        return data;
    } catch (error) {
        console.error(
            "[JSON READ ERROR]",
            file,
            error
        );

        return fallback;
    }
}

function writeJsonFile(
    file,
    data
) {
    try {
        fs.writeFileSync(
            file,
            JSON.stringify(
                data,
                null,
                2
            ),
            "utf8"
        );

        return true;
    } catch (error) {
        console.error(
            "[JSON WRITE ERROR]",
            file,
            error
        );

        return false;
    }
}

/* =========================================================
   KEYS
========================================================= */

function readKeys() {
    try {
        ensureFile(
            KEY_FILE,
            []
        );

        const raw =
            fs.readFileSync(
                KEY_FILE,
                "utf8"
            ).trim();

        if (!raw) {
            return [];
        }

        const data =
            JSON.parse(raw);

        if (Array.isArray(data)) {
            return data;
        }

        if (
            data &&
            Array.isArray(data.keys)
        ) {
            return data.keys;
        }

        if (
            data &&
            typeof data ===
                "object"
        ) {
            return Object.entries(
                data
            ).map(
                ([key, value]) => ({
                    key,

                    ...(value &&
                    typeof value ===
                        "object"
                        ? value
                        : {})
                })
            );
        }

        return [];
    } catch (error) {
        console.error(
            "[KEYS READ ERROR]",
            error
        );

        return [];
    }
}

function saveKeys(keys) {
    return writeJsonFile(
        KEY_FILE,
        keys
    );
}

/* =========================================================
   STOCK
========================================================= */

function readStock() {
    try {
        ensureFile(
            STOCK_FILE,
            []
        );

        const raw =
            fs.readFileSync(
                STOCK_FILE,
                "utf8"
            ).trim();

        if (!raw) {
            return [];
        }

        const data =
            JSON.parse(raw);

        if (Array.isArray(data)) {
            return data;
        }

        if (
            data &&
            Array.isArray(data.stock)
        ) {
            return data.stock;
        }

        return [];
    } catch (error) {
        console.error(
            "[STOCK READ ERROR]",
            error
        );

        return [];
    }
}

function saveStock(stock) {
    return writeJsonFile(
        STOCK_FILE,
        stock
    );
}

/* =========================================================
   SAVED LOGINS
========================================================= */

function readSavedLogins() {
    const data =
        readJsonFile(
            SAVED_LOGINS_FILE,
            []
        );

    return Array.isArray(data)
        ? data
        : [];
}

function saveSavedLogins(
    logins
) {
    return writeJsonFile(
        SAVED_LOGINS_FILE,
        logins
    );
}

/* =========================================================
   ADMIN AUTH
========================================================= */

function requireAdmin(
    req,
    res,
    next
) {
    if (!ADMIN_SECRET) {
        console.error(
            "[ADMIN] NOVI_ADMIN_SECRET is missing."
        );

        return res.status(500).json({
            success: false,
            message:
                "Admin secret is not configured."
        });
    }

    const provided =
        String(
            req.headers[
                "x-novi-admin-secret"
            ] || ""
        ).trim();

    if (!provided) {
        return res.status(401).json({
            success: false,
            message:
                "Missing admin secret."
        });
    }

    const expectedBuffer =
        Buffer.from(
            ADMIN_SECRET
        );

    const providedBuffer =
        Buffer.from(
            provided
        );

    if (
        expectedBuffer.length !==
            providedBuffer.length ||
        !crypto.timingSafeEqual(
            expectedBuffer,
            providedBuffer
        )
    ) {
        return res.status(403).json({
            success: false,
            message:
                "Invalid admin secret."
        });
    }

    next();
}

/* =========================================================
   DURATIONS
========================================================= */

const DURATIONS = {
    "1d": {
        name: "1 Day",
        ms:
            24 *
            60 *
            60 *
            1000
    },

    "3d": {
        name: "3 Days",
        ms:
            3 *
            24 *
            60 *
            60 *
            1000
    },

    "1week": {
        name: "1 Week",
        ms:
            7 *
            24 *
            60 *
            60 *
            1000
    },

    "1month": {
        name: "1 Month",
        ms:
            30 *
            24 *
            60 *
            60 *
            1000
    },

    lifetime: {
        name: "Lifetime",
        ms: null
    }
};

/* =========================================================
   KEY GENERATOR
========================================================= */

function generateKey() {
    const a =
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

    const b =
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

    const c =
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

    return `NOVI-${a}-${b}-${c}`;
}

function createKey(
    duration
) {
    const info =
        DURATIONS[
            duration
        ];

    const now =
        Date.now();

    const expiresAt =
        info.ms === null
            ? null
            : new Date(
                  now +
                      info.ms
              ).toISOString();

    return {
        key: generateKey(),

        duration,

        durationName:
            info.name,

        createdAt:
            new Date(
                now
            ).toISOString(),

        expiresAt,

        activatedAt:
            null,

        deviceId:
            null
    };
}

/* =========================================================
   SESSION HELPERS
========================================================= */

function createSession(
    keyRecord
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
                keyRecord.key,

            deviceId:
                keyRecord.deviceId,

            createdAt:
                Date.now(),

            expiresAt
        }
    );

    return {
        token,
        expiresAt
    };
}

function getSession(
    token
) {
    if (!token) {
        return null;
    }

    const session =
        sessions.get(
            token
        );

    if (!session) {
        return null;
    }

    if (
        Date.now() >=
        session.expiresAt
    ) {
        sessions.delete(
            token
        );

        return null;
    }

    return session;
}

function requireSession(
    req,
    res,
    next
) {
    const token =
        String(
            req.headers[
                "x-novi-session"
            ] || ""
        ).trim();

    if (!token) {
        return res.status(401).json({
            success: false,
            message:
                "Authentication required."
        });
    }

    const session =
        getSession(token);

    if (!session) {
        return res.status(401).json({
            success: false,
            message:
                "Session expired."
        });
    }

    const keys =
        readKeys();

    const keyRecord =
        keys.find(
            item =>
                String(
                    item?.key ||
                        ""
                )
                    .trim()
                    .toUpperCase() ===
                String(
                    session.key ||
                        ""
                )
                    .trim()
                    .toUpperCase()
        );

    if (!keyRecord) {
        sessions.delete(
            token
        );

        return res.status(401).json({
            success: false,
            message:
                "Key no longer exists."
        });
    }

    if (
        keyRecord.expiresAt &&
        Date.now() >=
            new Date(
                keyRecord.expiresAt
            ).getTime()
    ) {
        sessions.delete(
            token
        );

        return res.status(403).json({
            success: false,
            message:
                "Key has expired."
        });
    }

    if (
        keyRecord.deviceId &&
        session.deviceId &&
        String(
            keyRecord.deviceId
        ) !==
            String(
                session.deviceId
            )
    ) {
        sessions.delete(
            token
        );

        return res.status(403).json({
            success: false,
            message:
                "Session device mismatch."
        });
    }

    req.noviSession = session;

    req.noviKey = keyRecord;

    req.noviSessionToken =
        token;

    next();
}

/* =========================================================
   PASSWORD ENCRYPTION
========================================================= */

function getEncryptionKey() {
    if (!CREDENTIAL_SECRET) {
        throw new Error(
            "NOVI_CREDENTIAL_SECRET is not configured."
        );
    }

    return crypto
        .createHash("sha256")
        .update(
            CREDENTIAL_SECRET
        )
        .digest();
}

function encryptPassword(
    password
) {
    const key =
        getEncryptionKey();

    const iv =
        crypto.randomBytes(
            12
        );

    const cipher =
        crypto.createCipheriv(
            "aes-256-gcm",
            key,
            iv
        );

    const encrypted =
        Buffer.concat([
            cipher.update(
                String(password),
                "utf8"
            ),

            cipher.final()
        ]);

    const authTag =
        cipher.getAuthTag();

    return {
        iv:
            iv.toString(
                "base64"
            ),

        data:
            encrypted.toString(
                "base64"
            ),

        tag:
            authTag.toString(
                "base64"
            )
    };
}

function decryptPassword(
    encrypted
) {
    const key =
        getEncryptionKey();

    const iv =
        Buffer.from(
            encrypted.iv,
            "base64"
        );

    const data =
        Buffer.from(
            encrypted.data,
            "base64"
        );

    const tag =
        Buffer.from(
            encrypted.tag,
            "base64"
        );

    const decipher =
        crypto.createDecipheriv(
            "aes-256-gcm",
            key,
            iv
        );

    decipher.setAuthTag(
        tag
    );

    const decrypted =
        Buffer.concat([
            decipher.update(
                data
            ),

            decipher.final()
        ]);

    return decrypted.toString(
        "utf8"
    );
}

/* =========================================================
   STOCK LOGIN PARSER
========================================================= */

function parseStockItem(
    item
) {
    /*
     * Stock format:
     *
     * email:password
     *
     * Only the FIRST ":" is used,
     * so passwords can contain ":".
     */

    const value =
        String(
            item || ""
        ).trim();

    const separator =
        value.indexOf(":");

    if (separator <= 0) {
        return {
            email: value,
            password: ""
        };
    }

    return {
        email:
            value
                .slice(
                    0,
                    separator
                )
                .trim(),

        password:
            value
                .slice(
                    separator + 1
                )
                .trim()
    };
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
    "/health",
    (req, res) => {
        res.json({
            success: true,

            status: "online",

            service: "Novi",

            timestamp:
                new Date().toISOString()
        });
    }
);

/* =========================================================
   API INFO
========================================================= */

app.get(
    "/api",
    (req, res) => {
        res.json({
            success: true,

            name: "Novi API",

            status: "online"
        });
    }
);

/* =========================================================
   GENERATE KEY
   POST /api/keys
========================================================= */

app.post(
    "/api/keys",
    requireAdmin,
    (req, res) => {
        try {
            console.log(
                "[API/KEYS] Request received"
            );

            console.log(
                "[API/KEYS] Body:",
                req.body
            );

            const duration =
                String(
                    req.body?.duration ||
                        ""
                )
                    .trim()
                    .toLowerCase();

            if (
                !DURATIONS[
                    duration
                ]
            ) {
                return res.status(400).json({
                    success: false,

                    message:
                        "Invalid duration. Use 1d, 3d, 1week, 1month, or lifetime."
                });
            }

            const keys =
                readKeys();

            const keyRecord =
                createKey(
                    duration
                );

            keys.push(
                keyRecord
            );

            if (
                !saveKeys(keys)
            ) {
                return res.status(500).json({
                    success: false,

                    message:
                        "Failed to save generated key."
                });
            }

            console.log(
                "[API/KEYS] Generated:",
                keyRecord.key
            );

            return res.status(201).json({
                success: true,

                key:
                    keyRecord.key,

                duration:
                    keyRecord.duration,

                durationName:
                    keyRecord.durationName,

                createdAt:
                    keyRecord.createdAt,

                expiresAt:
                    keyRecord.expiresAt
            });
        } catch (error) {
            console.error(
                "[API/KEYS ERROR]",
                error
            );

            return res.status(500).json({
                success: false,

                message:
                    "Failed to generate key.",

                error:
                    error.message
            });
        }
    }
);

/* =========================================================
   GET KEYS
========================================================= */

app.get(
    "/api/keys",
    requireAdmin,
    (req, res) => {
        try {
            const keys =
                readKeys();

            res.json({
                success: true,

                count:
                    keys.length,

                keys
            });
        } catch (error) {
            console.error(
                "[GET KEYS ERROR]",
                error
            );

            res.status(500).json({
                success: false,

                message:
                    "Failed to read keys."
            });
        }
    }
);

/* =========================================================
   DELETE KEY
========================================================= */

app.delete(
    "/api/keys/:key",
    requireAdmin,
    (req, res) => {
        try {
            const requestedKey =
                String(
                    req.params.key ||
                        ""
                )
                    .trim()
                    .toUpperCase();

            const keys =
                readKeys();

            const filtered =
                keys.filter(
                    item =>
                        String(
                            item?.key ||
                                ""
                        )
                            .trim()
                            .toUpperCase() !==
                        requestedKey
                );

            if (
                filtered.length ===
                keys.length
            ) {
                return res.status(404).json({
                    success: false,

                    message:
                        "Key not found."
                });
            }

            if (
                !saveKeys(
                    filtered
                )
            ) {
                return res.status(500).json({
                    success: false,

                    message:
                        "Failed to save key changes."
                });
            }

            /*
             * Remove any active sessions
             * belonging to the deleted key.
             */
            for (
                const [
                    token,
                    session
                ] of sessions
            ) {
                if (
                    String(
                        session.key ||
                            ""
                    )
                        .trim()
                        .toUpperCase() ===
                    requestedKey
                ) {
                    sessions.delete(
                        token
                    );
                }
            }

            res.json({
                success: true,

                message:
                    "Key deleted."
            });
        } catch (error) {
            console.error(
                "[DELETE KEY ERROR]",
                error
            );

            res.status(500).json({
                success: false,

                message:
                    "Failed to delete key."
            });
        }
    }
);

/* =========================================================
   VERIFY KEY
========================================================= */

app.post(
    "/api/verify",
    (req, res) => {
        try {
            const key =
                String(
                    req.body?.key ||
                        ""
                )
                    .trim()
                    .toUpperCase();

            const deviceId =
                String(
                    req.body?.deviceId ||
                        ""
                ).trim();

            if (!key) {
                return res.status(400).json({
                    success: false,

                    valid: false,

                    message:
                        "Key is required."
                });
            }

            if (!deviceId) {
                return res.status(400).json({
                    success: false,

                    valid: false,

                    message:
                        "Device ID is required."
                });
            }

            const keys =
                readKeys();

            const keyRecord =
                keys.find(
                    item =>
                        String(
                            item?.key ||
                                ""
                        )
                            .trim()
                            .toUpperCase() ===
                        key
                );

            if (!keyRecord) {
                return res.status(404).json({
                    success: false,

                    valid: false,

                    message:
                        "Invalid key."
                });
            }

            if (
                keyRecord.expiresAt &&
                Date.now() >=
                    new Date(
                        keyRecord.expiresAt
                    ).getTime()
            ) {
                return res.status(403).json({
                    success: false,

                    valid: false,

                    message:
                        "This key has expired."
                });
            }

            /*
             * First device to use the key
             * becomes the device bound to it.
             */
            if (
                !keyRecord.deviceId
            ) {
                keyRecord.deviceId =
                    deviceId;

                keyRecord.activatedAt =
                    new Date().toISOString();

                if (
                    !saveKeys(keys)
                ) {
                    return res.status(500).json({
                        success: false,

                        valid: false,

                        message:
                            "Failed to activate key."
                    });
                }
            } else if (
                String(
                    keyRecord.deviceId
                ) !== deviceId
            ) {
                return res.status(403).json({
                    success: false,

                    valid: false,

                    message:
                        "This key is already linked to another device."
                });
            }

            /*
             * Remove any old sessions for this
             * key/device before creating a new one.
             */
            for (
                const [
                    token,
                    session
                ] of sessions
            ) {
                if (
                    String(
                        session.key ||
                            ""
                    )
                        .trim()
                        .toUpperCase() ===
                        String(
                            keyRecord.key
                        )
                            .trim()
                            .toUpperCase() &&
                    String(
                        session.deviceId ||
                            ""
                    ) ===
                        String(
                            deviceId
                        )
                ) {
                    sessions.delete(
                        token
                    );
                }
            }

            const session =
                createSession(
                    keyRecord
                );

            return res.json({
                success: true,

                valid: true,

                sessionToken:
                    session.token,

                expiresAt:
                    session.expiresAt,

                key: {
                    key:
                        keyRecord.key,

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
                "[VERIFY ERROR]",
                error
            );

            res.status(500).json({
                success: false,

                valid: false,

                message:
                    "Verification failed."
            });
        }
    }
);

/* =========================================================
   LOGOUT
   POST /api/logout
========================================================= */

app.post(
    "/api/logout",
    (req, res) => {
        const token =
            String(
                req.headers[
                    "x-novi-session"
                ] || ""
            ).trim();

        if (token) {
            sessions.delete(
                token
            );
        }

        res.json({
            success: true,

            message:
                "Logged out."
        });
    }
);

/* =========================================================
   STOCK ADD
========================================================= */

app.post(
    "/api/stock/add",
    requireAdmin,
    (req, res) => {
        try {
            const item =
                String(
                    req.body?.item ||
                        ""
                ).trim();

            if (!item) {
                return res.status(400).json({
                    success: false,

                    message:
                        "Item is required."
                });
            }

            const stock =
                readStock();

            const exists =
                stock.some(
                    existing =>
                        String(
                            existing
                        ).trim() ===
                        item
                );

            if (exists) {
                return res.json({
                    success: true,

                    added: 0,

                    duplicates: 1,

                    count:
                        stock.length
                });
            }

            stock.push(
                item
            );

            if (
                !saveStock(
                    stock
                )
            ) {
                return res.status(500).json({
                    success: false,

                    message:
                        "Failed to save stock."
                });
            }

            res.json({
                success: true,

                added: 1,

                duplicates: 0,

                count:
                    stock.length
            });
        } catch (error) {
            console.error(
                "[STOCK ADD ERROR]",
                error
            );

            res.status(500).json({
                success: false,

                message:
                    "Failed to add stock."
            });
        }
    }
);

/* =========================================================
   STOCK ADMIN
========================================================= */

app.get(
    "/api/admin/stock",
    requireAdmin,
    (req, res) => {
        try {
            const stock =
                readStock();

            res.json({
                success: true,

                count:
                    stock.length,

                stock
            });
        } catch (error) {
            console.error(
                "[STOCK GET ERROR]",
                error
            );

            res.status(500).json({
                success: false,

                message:
                    "Failed to read stock."
            });
        }
    }
);

/* =========================================================
   AUTHENTICATED STOCK COUNT
   GET /api/stock
========================================================= */

app.get(
    "/api/stock",
    requireSession,
    (req, res) => {
        try {
            const stock =
                readStock();

            res.json({
                success: true,

                count:
                    stock.length
            });
        } catch (error) {
            console.error(
                "[AUTH STOCK ERROR]",
                error
            );

            res.status(500).json({
                success: false,

                message:
                    "Failed to read stock."
            });
        }
    }
);

/* =========================================================
   GENERATE STOCK
   POST /api/stock/generate
========================================================= */

app.post(
    "/api/stock/generate",
    requireSession,
    (req, res) => {
        try {
            const stock =
                readStock();

            if (
                !stock.length
            ) {
                return res.status(404).json({
                    success: false,

                    message:
                        "No inventory is currently available."
                });
            }

            /*
             * Remove the first stock item.
             */
            const rawItem =
                stock.shift();

            /*
             * Save immediately so the same
             * item cannot be generated twice.
             */
            if (
                !saveStock(
                    stock
                )
            ) {
                return res.status(500).json({
                    success: false,

                    message:
                        "Failed to update inventory."
                });
            }

            const credentials =
                parseStockItem(
                    rawItem
                );

            /*
             * Return email/password separately.
             * Password is only sent to the
             * authenticated user who generated it.
             */
            res.json({
                success: true,

                item: {
                    email:
                        credentials.email,

                    password:
                        credentials.password
                },

                remaining:
                    stock.length
            });
        } catch (error) {
            console.error(
                "[STOCK GENERATE ERROR]",
                error
            );

            res.status(500).json({
                success: false,

                message:
                    "Failed to generate inventory."
            });
        }
    }
);

/* =========================================================
   SAVE LOGIN
   POST /api/saved-logins
========================================================= */

app.post(
    "/api/saved-logins",
    requireSession,
    (req, res) => {
        try {
            if (
                !CREDENTIAL_SECRET
            ) {
                return res.status(500).json({
                    success: false,

                    message:
                        "Credential encryption is not configured."
                });
            }

            const email =
                String(
                    req.body?.email ||
                        ""
                ).trim();

            const password =
                String(
                    req.body?.password ||
                        ""
                );

            if (!email) {
                return res.status(400).json({
                    success: false,

                    message:
                        "Email is required."
                });
            }

            if (!password) {
                return res.status(400).json({
                    success: false,

                    message:
                        "Password is required."
                });
            }

            const saved =
                readSavedLogins();

            /*
             * Prevent the same login from being
             * saved repeatedly for the same key.
             */
            const duplicate =
                saved.some(
                    item =>
                        String(
                            item?.ownerKey ||
                                ""
                        ) ===
                            String(
                                req.noviKey.key
                            ) &&
                        String(
                            item?.email ||
                                ""
                        ) ===
                            email
                );

            if (duplicate) {
                return res.json({
                    success: true,

                    alreadySaved:
                        true,

                    message:
                        "This login is already saved."
                });
            }

            const encrypted =
                encryptPassword(
                    password
                );

            const record = {
                id:
                    crypto
                        .randomBytes(
                            16
                        )
                        .toString(
                            "hex"
                        ),

                ownerKey:
                    req.noviKey.key,

                deviceId:
                    req.noviKey.deviceId,

                email,

                password:
                    encrypted,

                createdAt:
                    new Date().toISOString()
            };

            saved.push(
                record
            );

            if (
                !saveSavedLogins(
                    saved
                )
            ) {
                return res.status(500).json({
                    success: false,

                    message:
                        "Failed to save login."
                });
            }

            res.status(201).json({
                success: true,

                saved: true,

                id:
                    record.id,

                email:
                    record.email,

                createdAt:
                    record.createdAt
            });
        } catch (error) {
            console.error(
                "[SAVE LOGIN ERROR]",
                error
            );

            res.status(500).json({
                success: false,

                message:
                    "Failed to save login."
            });
        }
    }
);

/* =========================================================
   GET SAVED LOGINS
   GET /api/saved-logins
========================================================= */

app.get(
    "/api/saved-logins",
    requireSession,
    (req, res) => {
        try {
            const saved =
                readSavedLogins();

            const owned =
                saved
                    .filter(
                        item =>
                            String(
                                item?.ownerKey ||
                                    ""
                            ) ===
                            String(
                                req.noviKey.key
                            )
                    )
                    .map(
                        item => ({
                            id:
                                item.id,

                            email:
                                item.email,

                            createdAt:
                                item.createdAt,

                            /*
                             * Never send the encrypted
                             * password to the frontend.
                             */
                            passwordSaved:
                                true
                        })
                    );

            res.json({
                success: true,

                count:
                    owned.length,

                logins:
                    owned
            });
        } catch (error) {
            console.error(
                "[GET SAVED LOGINS ERROR]",
                error
            );

            res.status(500).json({
                success: false,

                message:
                    "Failed to load saved logins."
            });
        }
    }
);

/* =========================================================
   REVEAL SAVED LOGIN
   GET /api/saved-logins/:id
========================================================= */

app.get(
    "/api/saved-logins/:id",
    requireSession,
    (req, res) => {
        try {
            const id =
                String(
                    req.params.id ||
                        ""
                ).trim();

            const saved =
                readSavedLogins();

            const record =
                saved.find(
                    item =>
                        String(
                            item?.id ||
                                ""
                        ) === id &&
                        String(
                            item?.ownerKey ||
                                ""
                        ) ===
                            String(
                                req.noviKey.key
                            )
                );

            if (!record) {
                return res.status(404).json({
                    success: false,

                    message:
                        "Saved login not found."
                });
            }

            const password =
                decryptPassword(
                    record.password
                );

            res.json({
                success: true,

                login: {
                    id:
                        record.id,

                    email:
                        record.email,

                    password
                }
            });
        } catch (error) {
            console.error(
                "[REVEAL LOGIN ERROR]",
                error
            );

            res.status(500).json({
                success: false,

                message:
                    "Failed to reveal saved login."
            });
        }
    }
);

/* =========================================================
   DELETE SAVED LOGIN
   DELETE /api/saved-logins/:id
========================================================= */

app.delete(
    "/api/saved-logins/:id",
    requireSession,
    (req, res) => {
        try {
            const id =
                String(
                    req.params.id ||
                        ""
                ).trim();

            const saved =
                readSavedLogins();

            const index =
                saved.findIndex(
                    item =>
                        String(
                            item?.id ||
                                ""
                        ) === id &&
                        String(
                            item?.ownerKey ||
                                ""
                        ) ===
                            String(
                                req.noviKey.key
                            )
                );

            if (
                index === -1
            ) {
                return res.status(404).json({
                    success: false,

                    message:
                        "Saved login not found."
                });
            }

            saved.splice(
                index,
                1
            );

            if (
                !saveSavedLogins(
                    saved
                )
            ) {
                return res.status(500).json({
                    success: false,

                    message:
                        "Failed to delete saved login."
                });
            }

            res.json({
                success: true,

                message:
                    "Saved login deleted."
            });
        } catch (error) {
            console.error(
                "[DELETE SAVED LOGIN ERROR]",
                error
            );

            res.status(500).json({
                success: false,

                message:
                    "Failed to delete saved login."
            });
        }
    }
);

/* =========================================================
   PUBLIC STOCK COUNT
========================================================= */

app.get(
    "/api/stock/count",
    (req, res) => {
        try {
            const stock =
                readStock();

            res.json({
                success: true,

                count:
                    stock.length
            });
        } catch (error) {
            res.status(500).json({
                success: false,

                count: 0
            });
        }
    }
);

/* =========================================================
   SESSION CLEANUP
========================================================= */

setInterval(
    () => {
        const now =
            Date.now();

        for (
            const [
                token,
                session
            ] of sessions
        ) {
            if (
                now >=
                session.expiresAt
            ) {
                sessions.delete(
                    token
                );
            }
        }
    },
    60 * 1000
);

/* =========================================================
   WEBSITE
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
}

/* =========================================================
   404
========================================================= */

app.use(
    (req, res) => {
        res.status(404).json({
            success: false,

            message:
                "Route not found.",

            path:
                req.path,

            method:
                req.method
        });
    }
);

/* =========================================================
   SERVER
========================================================= */

const server =
    app.listen(
        PORT,
        "0.0.0.0",
        () => {
            console.log("");

            console.log(
                "========================================"
            );

            console.log(
                "          NOVI SERVER ONLINE"
            );

            console.log(
                "========================================"
            );

            console.log(
                "Port:",
                PORT
            );

            console.log(
                "Health: /health"
            );

            console.log(
                "Key API: POST /api/keys"
            );

            console.log(
                "Verify: POST /api/verify"
            );

            console.log(
                "Stock Add: POST /api/stock/add"
            );

            console.log(
                "Stock Generate: POST /api/stock/generate"
            );

            console.log(
                "Saved Logins: /api/saved-logins"
            );

            console.log(
                "========================================"
            );

            console.log("");
        }
    );

server.on(
    "error",
    error => {
        console.error(
            "[SERVER ERROR]",
            error
        );
    }
);

module.exports = {
    app,
    server
};
