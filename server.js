require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 10000;
const PUBLIC_DIR = path.join(__dirname, "public");

const KEY_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "epicgames-stock.json");

const ADMIN_SECRET = String(
    process.env.NOVI_ADMIN_SECRET || ""
).trim();

const SESSION_DURATION = 30 * 60 * 1000;

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());

app.use(express.json({
    limit: "5mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "5mb"
}));

/* =========================================================
   FILE HELPERS
========================================================= */

function ensureFile(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(
                file,
                JSON.stringify(fallback, null, 2),
                "utf8"
            );
        }
    } catch (error) {
        console.error(
            `[FILE CREATE ERROR] ${file}`,
            error
        );
    }
}

function readJsonArray(file) {
    try {
        ensureFile(file, []);

        const raw = fs.readFileSync(
            file,
            "utf8"
        ).trim();

        if (!raw) {
            return [];
        }

        const data = JSON.parse(raw);

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
            `[JSON READ ERROR] ${path.basename(file)}`,
            error.message
        );

        return [];
    }
}

function saveJsonArray(file, data) {
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
            `[JSON SAVE ERROR] ${path.basename(file)}`,
            error.message
        );

        return false;
    }
}

ensureFile(KEY_FILE, []);
ensureFile(STOCK_FILE, []);

/* =========================================================
   STOCK
========================================================= */

/*
 * Accept any non-empty stock value.
 *
 * No format checking is performed.
 * Characters such as:
 * @
 * :
 * /
 * |
 * -
 * _
 * .
 * etc.
 * are all allowed.
 */
function normalizeStockItem(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    const item =
        String(value).trim();

    if (!item) {
        return null;
    }

    return item;
}

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

        let stock = [];

        if (Array.isArray(data)) {

            stock = data;

        } else if (
            data &&
            Array.isArray(data.stock)
        ) {

            stock = data.stock;
        }

        return stock
            .map(
                normalizeStockItem
            )
            .filter(Boolean);

    } catch (error) {

        console.error(
            "[STOCK READ ERROR]",
            error.message
        );

        return [];
    }
}

function saveStock(stock) {

    return saveJsonArray(
        STOCK_FILE,
        stock
    );
}

/* =========================================================
   WEBSOCKET / LIVE STOCK
========================================================= */

const wss =
    new WebSocketServer({
        server,
        path: "/ws"
    });

const wsClients =
    new Set();

wss.on(
    "connection",
    ws => {

        console.log(
            "[WS] Novi real-time client connected"
        );

        wsClients.add(ws);

        const stock =
            readStock();

        ws.send(
            JSON.stringify({
                type: "stock:update",
                count: stock.length
            })
        );

        ws.on(
            "close",
            () => {

                wsClients.delete(ws);

                console.log(
                    "[WS] Novi real-time client disconnected"
                );
            }
        );

        ws.on(
            "error",
            error => {

                console.error(
                    "[WS] Client error:",
                    error.message
                );

                wsClients.delete(ws);
            }
        );
    }
);

function broadcastStockCount() {

    const stock =
        readStock();

    const message =
        JSON.stringify({
            type: "stock:update",
            count: stock.length
        });

    for (
        const client of wsClients
    ) {

        if (
            client.readyState === 1
        ) {

            try {

                client.send(
                    message
                );

            } catch (error) {

                console.error(
                    "[WS] Send error:",
                    error.message
                );

                wsClients.delete(
                    client
                );
            }
        }
    }
}

/*
 * Discord modifies epicgames-stock.json directly.
 * This watcher detects those changes and pushes the
 * new count to connected website clients.
 */

let lastStockMtime = 0;

try {

    if (
        fs.existsSync(
            STOCK_FILE
        )
    ) {

        lastStockMtime =
            fs.statSync(
                STOCK_FILE
            ).mtimeMs;
    }

} catch {}

setInterval(
    () => {

        try {

            if (
                !fs.existsSync(
                    STOCK_FILE
                )
            ) {
                return;
            }

            const mtime =
                fs.statSync(
                    STOCK_FILE
                ).mtimeMs;

            if (
                mtime !==
                lastStockMtime
            ) {

                lastStockMtime =
                    mtime;

                console.log(
                    "[STOCK] Stock file changed - broadcasting update"
                );

                broadcastStockCount();
            }

        } catch (error) {

            console.error(
                "[STOCK WATCH ERROR]",
                error.message
            );
        }

    },
    1000
);

/* =========================================================
   ADMIN AUTH
========================================================= */

function requireAdmin(
    req,
    res,
    next
) {

    if (!ADMIN_SECRET) {

        return res.status(500).json({
            success: false,
            message:
                "NOVI_ADMIN_SECRET is not configured."
        });
    }

    const supplied =
        String(
            req.headers[
                "x-novi-admin-secret"
            ] || ""
        ).trim();

    if (!supplied) {

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

    const suppliedBuffer =
        Buffer.from(
            supplied
        );

    if (
        expectedBuffer.length !==
        suppliedBuffer.length
    ) {

        return res.status(403).json({
            success: false,
            message:
                "Invalid admin secret."
        });
    }

    if (
        !crypto.timingSafeEqual(
            expectedBuffer,
            suppliedBuffer
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
   KEY SYSTEM
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

    "lifetime": {
        name: "Lifetime",
        ms: null
    }
};

function readKeys() {

    return readJsonArray(
        KEY_FILE
    );
}

function saveKeys(keys) {

    return saveJsonArray(
        KEY_FILE,
        keys
    );
}

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

function createKey(duration) {

    const info =
        DURATIONS[duration];

    const now =
        Date.now();

    const expiresAt =
        info.ms === null
            ? null
            : new Date(
                now + info.ms
            ).toISOString();

    return {

        key:
            generateKey(),

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
   SESSIONS
========================================================= */

const sessions =
    new Map();

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
            key,
            deviceId,
            expiresAt
        }
    );

    return {
        token,
        expiresAt
    };
}

function getSession(req) {

    const token =
        String(
            req.headers[
                "x-novi-session"
            ] || ""
        ).trim();

    if (!token) {
        return null;
    }

    const session =
        sessions.get(token);

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

    return {
        token,
        ...session
    };
}

function requireSession(
    req,
    res,
    next
) {

    const session =
        getSession(req);

    if (!session) {

        return res.status(401).json({

            success: false,

            message:
                "Your session has expired."
        });
    }

    req.noviSession =
        session;

    next();
}

/* =========================================================
   HEALTH
========================================================= */

app.get(
    "/health",
    (req, res) => {

        res.json({

            success: true,

            status:
                "online",

            service:
                "Novi",

            websocket:
                true,

            stock:
                readStock().length,

            timestamp:
                new Date()
                    .toISOString()
        });
    }
);

app.get(
    "/api",
    (req, res) => {

        res.json({

            success: true,

            name:
                "Novi API",

            status:
                "online"
        });
    }
);

/* =========================================================
   CREATE KEY
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
                !saveKeys(
                    keys
                )
            ) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Failed to save key."
                });
            }

            res.status(201).json({

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
                "[KEY GENERATION ERROR]",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Failed to generate key."
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

        const keys =
            readKeys();

        res.json({

            success: true,

            count:
                keys.length,

            keys
        });
    }
);

/* =========================================================
   DELETE KEY
========================================================= */

app.delete(
    "/api/keys/:key",
    requireAdmin,
    (req, res) => {

        const requested =
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
                    requested
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
                    "Failed to delete key."
            });
        }

        res.json({

            success: true,

            message:
                "Key deleted."
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

            if (
                !keyRecord.deviceId
            ) {

                keyRecord.deviceId =
                    deviceId;

                keyRecord.activatedAt =
                    new Date()
                        .toISOString();

                if (
                    !saveKeys(
                        keys
                    )
                ) {

                    return res.status(500).json({

                        success: false,

                        valid: false,

                        message:
                            "Failed to save key activation."
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

            const session =
                createSession(
                    keyRecord.key,
                    deviceId
                );

            res.json({

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
   ADD ONE STOCK ITEM
========================================================= */

app.post(
    "/api/stock/add",
    requireAdmin,
    (req, res) => {

        try {

            const item =
                normalizeStockItem(
                    req.body?.item
                );

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
                        )
                            .toLowerCase() ===
                        item.toLowerCase()
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

            lastStockMtime =
                fs.statSync(
                    STOCK_FILE
                ).mtimeMs;

            broadcastStockCount();

            console.log(
                `[STOCK] Added 1 item | Total: ${stock.length}`
            );

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
   ADD MANY STOCK ITEMS
========================================================= */

app.post(
    "/api/stock/add-many",
    requireAdmin,
    (req, res) => {

        try {

            const incoming =
                Array.isArray(
                    req.body?.items
                )
                    ? req.body.items
                    : [];

            if (
                incoming.length === 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "No stock items supplied."
                });
            }

            const stock =
                readStock();

            const existing =
                new Set(
                    stock.map(
                        item =>
                            String(
                                item
                            )
                                .trim()
                                .toLowerCase()
                    )
                );

            let added = 0;
            let duplicates = 0;
            let invalid = 0;

            for (
                const raw of incoming
            ) {

                const item =
                    normalizeStockItem(
                        raw
                    );

                /*
                 * The only invalid value is an
                 * empty/null value.
                 */
                if (!item) {

                    invalid++;

                    continue;
                }

                const normalized =
                    item.toLowerCase();

                if (
                    existing.has(
                        normalized
                    )
                ) {

                    duplicates++;

                    continue;
                }

                stock.push(
                    item
                );

                existing.add(
                    normalized
                );

                added++;
            }

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

            lastStockMtime =
                fs.statSync(
                    STOCK_FILE
                ).mtimeMs;

            broadcastStockCount();

            console.log(
                `[STOCK] Bulk add | Added: ${added} | Duplicates: ${duplicates} | Invalid: ${invalid} | Total: ${stock.length}`
            );

            res.json({

                success: true,

                added,

                duplicates,

                invalid,

                count:
                    stock.length
            });

        } catch (error) {

            console.error(
                "[STOCK ADD MANY ERROR]",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Failed to import stock."
            });
        }
    }
);

/* =========================================================
   ADMIN STOCK
========================================================= */

app.get(
    "/api/admin/stock",
    requireAdmin,
    (req, res) => {

        const stock =
            readStock();

        res.json({

            success: true,

            count:
                stock.length,

            stock
        });
    }
);

/* =========================================================
   PUBLIC STOCK COUNT
========================================================= */

app.get(
    "/api/stock/count",
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

/* =========================================================
   AUTHENTICATED STOCK COUNT
========================================================= */

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

/* =========================================================
   ONE-CLICK GENERATOR
========================================================= */

app.post(
    "/api/stock/generate",
    requireSession,
    (req, res) => {

        try {

            const stock =
                readStock();

            console.log(
                `[Novi] Generate requested | Actual stock: ${stock.length}`
            );

            if (
                stock.length === 0
            ) {

                return res.json({

                    success: true,

                    item: null,

                    remaining: 0
                });
            }

            /*
             * Consume exactly one inventory item.
             */
            const item =
                stock.shift();

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

            lastStockMtime =
                fs.statSync(
                    STOCK_FILE
                ).mtimeMs;

            broadcastStockCount();

            console.log(
                `[STOCK] Generated 1 item | Remaining: ${stock.length}`
            );

            res.json({

                success: true,

                item,

                remaining:
                    stock.length
            });

        } catch (error) {

            console.error(
                "[GENERATE ERROR]",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "Unable to generate inventory."
            });
        }
    }
);

/* =========================================================
   LOGOUT
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

            success: true
        });
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
   FRONTEND
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
   API 404
========================================================= */

app.use(
    "/api",
    (req, res) => {

        res.status(404).json({

            success: false,

            message:
                "API route not found."
        });
    }
);

/* =========================================================
   FRONTEND FALLBACK
========================================================= */

if (
    fs.existsSync(
        path.join(
            PUBLIC_DIR,
            "index.html"
        )
    )
) {

    app.get(
        "/{*splat}",
        (req, res) => {

            res.sendFile(
                path.join(
                    PUBLIC_DIR,
                    "index.html"
                )
            );
        }
    );
}

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "[SERVER ERROR]",
            error
        );

        if (
            res.headersSent
        ) {
            return next(
                error
            );
        }

        res.status(500).json({

            success: false,

            message:
                "Internal server error."
        });
    }
);

/* =========================================================
   START SERVER
========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("");
        console.log(
            "======================================"
        );
        console.log(
            "             NOVI ONLINE"
        );
        console.log(
            "======================================"
        );

        console.log(
            `Website running on port ${PORT}`
        );

        console.log(
            "WebSocket: /ws"
        );

        console.log(
            "Real-time stock: ENABLED"
        );

        console.log(
            `Current stock: ${readStock().length}`
        );

        console.log(
            "One-click generator: ENABLED"
        );

        console.log(
            "======================================"
        );
        console.log("");
    }
);

/* =========================================================
   SHUTDOWN
========================================================= */

function shutdown(signal) {

    console.log(
        `[NOVI] ${signal} received.`
    );

    for (
        const client of wsClients
    ) {

        try {
            client.close();
        } catch {}
    }

    try {
        wss.close();
    } catch {}

    server.close(
        () => {
            process.exit(0);
        }
    );

    setTimeout(
        () => {
            process.exit(0);
        },
        5000
    );
}

process.on(
    "SIGTERM",
    () => shutdown("SIGTERM")
);

process.on(
    "SIGINT",
    () => shutdown("SIGINT")
);

process.on(
    "uncaughtException",
    error => {

        console.error(
            "[NOVI] Uncaught exception:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "[NOVI] Unhandled rejection:",
            error
        );
    }
);

module.exports = {
    app,
    server,
    readStock,
    saveStock,
    broadcastStockCount
};
