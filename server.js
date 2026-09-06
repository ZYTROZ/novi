require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 10000;

const PUBLIC_DIR = path.join(__dirname, "public");
const KEY_FILE = path.join(__dirname, "keys.json");
const STOCK_FILE = path.join(__dirname, "epicgames-stock.json");
const SAVED_ITEMS_FILE = path.join(__dirname, "saved-items.json");

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

function ensureFile(file, defaultValue = []) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(
                file,
                JSON.stringify(defaultValue, null, 2),
                "utf8"
            );
        }
    } catch (error) {
        console.error("[FILE SETUP ERROR]", error);
    }
}

function readJson(file, fallback = []) {
    try {
        ensureFile(file, fallback);

        const raw = fs.readFileSync(file, "utf8").trim();

        if (!raw) {
            return fallback;
        }

        return JSON.parse(raw);
    } catch (error) {
        console.error("[JSON READ ERROR]", file, error);
        return fallback;
    }
}

function writeJson(file, data) {
    try {
        fs.writeFileSync(
            file,
            JSON.stringify(data, null, 2),
            "utf8"
        );

        return true;
    } catch (error) {
        console.error("[JSON WRITE ERROR]", file, error);
        return false;
    }
}

ensureFile(KEY_FILE, []);
ensureFile(STOCK_FILE, []);
ensureFile(SAVED_ITEMS_FILE, []);

/* =========================================================
   KEYS
========================================================= */

function readKeys() {
    const data = readJson(KEY_FILE, []);

    if (Array.isArray(data)) {
        return data;
    }

    if (data && Array.isArray(data.keys)) {
        return data.keys;
    }

    if (data && typeof data === "object") {
        return Object.entries(data).map(([key, value]) => ({
            key,
            ...(value && typeof value === "object" ? value : {})
        }));
    }

    return [];
}

function saveKeys(keys) {
    return writeJson(KEY_FILE, keys);
}

/* =========================================================
   STOCK
========================================================= */

function normalizeStockItem(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const item = String(value).trim();

    if (!item) {
        return null;
    }

    return item;
}

function readStock() {
    const data = readJson(STOCK_FILE, []);

    let stock;

    if (Array.isArray(data)) {
        stock = data;
    } else if (data && Array.isArray(data.stock)) {
        stock = data.stock;
    } else {
        stock = [];
    }

    return stock
        .map(normalizeStockItem)
        .filter(Boolean);
}

function saveStock(stock) {
    return writeJson(STOCK_FILE, stock);
}

/* =========================================================
   WEBSOCKET STOCK UPDATES
========================================================= */

const wss = new WebSocket.Server({
    server,
    path: "/ws"
});

function broadcastStockCount() {
    const count = readStock().length;

    const message = JSON.stringify({
        type: "stock:update",
        count
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (error) {
                console.error("[WS SEND ERROR]", error);
            }
        }
    });
}

wss.on("connection", ws => {
    try {
        ws.send(JSON.stringify({
            type: "stock:update",
            count: readStock().length
        }));
    } catch (error) {
        console.error("[WS CONNECTION ERROR]", error);
    }
});

/* =========================================================
   WATCH STOCK FILE
========================================================= */

let lastStockMtime = 0;

try {
    if (fs.existsSync(STOCK_FILE)) {
        lastStockMtime = fs.statSync(STOCK_FILE).mtimeMs;
    }
} catch {}

setInterval(() => {
    try {
        if (!fs.existsSync(STOCK_FILE)) {
            return;
        }

        const stat = fs.statSync(STOCK_FILE);

        if (stat.mtimeMs !== lastStockMtime) {
            lastStockMtime = stat.mtimeMs;
            broadcastStockCount();
        }
    } catch (error) {
        console.error("[STOCK WATCH ERROR]", error);
    }
}, 1000);

/* =========================================================
   ADMIN AUTH
========================================================= */

function requireAdmin(req, res, next) {
    if (!ADMIN_SECRET) {
        return res.status(500).json({
            success: false,
            message: "NOVI_ADMIN_SECRET is not configured."
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

    next();
}

/* =========================================================
   KEY DURATIONS
========================================================= */

const DURATIONS = {
    "1d": {
        name: "1 Day",
        ms: 24 * 60 * 60 * 1000
    },

    "3d": {
        name: "3 Days",
        ms: 3 * 24 * 60 * 60 * 1000
    },

    "1week": {
        name: "1 Week",
        ms: 7 * 24 * 60 * 60 * 1000
    },

    "1month": {
        name: "1 Month",
        ms: 30 * 24 * 60 * 60 * 1000
    },

    "lifetime": {
        name: "Lifetime",
        ms: null
    }
};

/* =========================================================
   KEY GENERATOR
========================================================= */

function generateKey() {
    const a = crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase();

    const b = crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase();

    const c = crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase();

    return `NOVI-${a}-${b}-${c}`;
}

function createKey(duration) {
    const info = DURATIONS[duration];
    const now = Date.now();

    const expiresAt =
        info.ms === null
            ? null
            : new Date(
                now + info.ms
            ).toISOString();

    return {
        key: generateKey(),
        duration,
        durationName: info.name,
        createdAt: new Date(now).toISOString(),
        expiresAt,
        activatedAt: null,
        deviceId: null
    };
}

/* =========================================================
   SESSIONS
========================================================= */

const sessions = new Map();

function createSession(key, deviceId) {
    const token = crypto
        .randomBytes(32)
        .toString("hex");

    const expiresAt =
        Date.now() + SESSION_DURATION;

    sessions.set(token, {
        key,
        deviceId,
        expiresAt
    });

    return {
        sessionToken: token,
        expiresAt
    };
}

function getSession(req) {
    const token = String(
        req.headers["x-novi-session"] || ""
    ).trim();

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

    return {
        token,
        ...session
    };
}

function requireSession(req, res, next) {
    const session = getSession(req);

    if (!session) {
        return res.status(401).json({
            success: false,
            message: "Your session has expired."
        });
    }

    req.noviSession = session;

    next();
}

/* =========================================================
   HEALTH
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
   API INFO
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
========================================================= */

app.post("/api/keys", requireAdmin, (req, res) => {
    try {
        const duration = String(
            req.body?.duration || ""
        )
            .trim()
            .toLowerCase();

        if (!DURATIONS[duration]) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid duration. Use 1d, 3d, 1week, 1month, or lifetime."
            });
        }

        const keys = readKeys();
        const keyRecord = createKey(duration);

        keys.push(keyRecord);

        if (!saveKeys(keys)) {
            return res.status(500).json({
                success: false,
                message: "Failed to save generated key."
            });
        }

        return res.status(201).json({
            success: true,
            key: keyRecord.key,
            duration: keyRecord.duration,
            durationName: keyRecord.durationName,
            createdAt: keyRecord.createdAt,
            expiresAt: keyRecord.expiresAt
        });

    } catch (error) {
        console.error("[GENERATE KEY ERROR]", error);

        return res.status(500).json({
            success: false,
            message: "Failed to generate key."
        });
    }
});

/* =========================================================
   GET KEYS
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
        console.error("[GET KEYS ERROR]", error);

        res.status(500).json({
            success: false,
            message: "Failed to read keys."
        });
    }
});

/* =========================================================
   DELETE KEY
========================================================= */

app.delete("/api/keys/:key", requireAdmin, (req, res) => {
    try {
        const requestedKey = String(
            req.params.key || ""
        )
            .trim()
            .toUpperCase();

        const keys = readKeys();

        const filtered = keys.filter(item => {
            return String(
                item?.key || ""
            )
                .trim()
                .toUpperCase() !== requestedKey;
        });

        if (filtered.length === keys.length) {
            return res.status(404).json({
                success: false,
                message: "Key not found."
            });
        }

        if (!saveKeys(filtered)) {
            return res.status(500).json({
                success: false,
                message: "Failed to save keys."
            });
        }

        res.json({
            success: true,
            message: "Key deleted."
        });

    } catch (error) {
        console.error("[DELETE KEY ERROR]", error);

        res.status(500).json({
            success: false,
            message: "Failed to delete key."
        });
    }
});

/* =========================================================
   VERIFY KEY
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

        const keyRecord = keys.find(item => {
            return String(
                item?.key || ""
            )
                .trim()
                .toUpperCase() === key;
        });

        if (!keyRecord) {
            return res.status(404).json({
                success: false,
                valid: false,
                message: "Invalid key."
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
                message: "This key has expired."
            });
        }

        if (!keyRecord.deviceId) {
            keyRecord.deviceId = deviceId;
            keyRecord.activatedAt =
                new Date().toISOString();

            saveKeys(keys);

        } else if (
            String(keyRecord.deviceId) !== deviceId
        ) {
            return res.status(403).json({
                success: false,
                valid: false,
                message:
                    "This key is already linked to another device."
            });
        }

        const session = createSession(
            keyRecord.key,
            deviceId
        );

        /*
         * sessionToken is the main property.
         * session/token are included for compatibility
         * with older Novi frontends.
         */

        res.json({
            success: true,
            valid: true,

            sessionToken:
                session.sessionToken,

            session:
                session.sessionToken,

            token:
                session.sessionToken,

            expiresAt:
                session.expiresAt,

            key: {
                key: keyRecord.key,
                duration: keyRecord.duration,
                durationName: keyRecord.durationName,
                createdAt: keyRecord.createdAt,
                expiresAt: keyRecord.expiresAt,
                activatedAt: keyRecord.activatedAt
            }
        });

    } catch (error) {
        console.error("[VERIFY ERROR]", error);

        res.status(500).json({
            success: false,
            valid: false,
            message: "Verification failed."
        });
    }
});

/* =========================================================
   ADD ONE STOCK ITEM
========================================================= */

app.post("/api/stock/add", requireAdmin, (req, res) => {
    try {
        const item = normalizeStockItem(
            req.body?.item
        );

        if (!item) {
            return res.status(400).json({
                success: false,
                message: "Item is required."
            });
        }

        const stock = readStock();

        const exists = stock.some(existing => {
            return String(existing).trim() === item;
        });

        if (exists) {
            return res.json({
                success: true,
                added: 0,
                duplicates: 1,
                count: stock.length
            });
        }

        stock.push(item);

        if (!saveStock(stock)) {
            return res.status(500).json({
                success: false,
                message: "Failed to save stock."
            });
        }

        broadcastStockCount();

        res.json({
            success: true,
            added: 1,
            duplicates: 0,
            count: stock.length
        });

    } catch (error) {
        console.error("[STOCK ADD ERROR]", error);

        res.status(500).json({
            success: false,
            message: "Failed to add stock."
        });
    }
});

/* =========================================================
   ADD MANY STOCK ITEMS
========================================================= */

app.post("/api/stock/add-many", requireAdmin, (req, res) => {
    try {
        let items = req.body?.items;

        if (!Array.isArray(items)) {
            return res.status(400).json({
                success: false,
                message: "items must be an array."
            });
        }

        const stock = readStock();

        let added = 0;
        let duplicates = 0;

        for (const rawItem of items) {
            const item = normalizeStockItem(rawItem);

            if (!item) {
                continue;
            }

            const exists = stock.some(existing => {
                return String(existing).trim() === item;
            });

            if (exists) {
                duplicates++;
                continue;
            }

            stock.push(item);
            added++;
        }

        if (!saveStock(stock)) {
            return res.status(500).json({
                success: false,
                message: "Failed to save stock."
            });
        }

        broadcastStockCount();

        res.json({
            success: true,
            added,
            duplicates,
            count: stock.length
        });

    } catch (error) {
        console.error("[STOCK ADD MANY ERROR]", error);

        res.status(500).json({
            success: false,
            message: "Failed to add stock."
        });
    }
});

/* =========================================================
   ADMIN STOCK
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
        console.error("[ADMIN STOCK ERROR]", error);

        res.status(500).json({
            success: false,
            message: "Failed to read stock."
        });
    }
});

/* =========================================================
   PUBLIC STOCK COUNT
========================================================= */

app.get("/api/stock/count", (req, res) => {
    try {
        const stock = readStock();

        res.json({
            success: true,
            count: stock.length
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            count: 0
        });
    }
});

/* =========================================================
   AUTHENTICATED STOCK COUNT
========================================================= */

app.get("/api/stock", requireSession, (req, res) => {
    const stock = readStock();

    res.json({
        success: true,
        count: stock.length
    });
});

/* =========================================================
   GENERATE STOCK ITEM
========================================================= */

app.post("/api/stock/generate", requireSession, (req, res) => {
    try {
        const stock = readStock();

        if (!stock.length) {
            return res.json({
                success: true,
                item: null,
                remaining: 0
            });
        }

        /*
         * The item remains one opaque inventory string.
         * Nothing is split into credential fields.
         */

        const item = stock.shift();

        if (!saveStock(stock)) {
            return res.status(500).json({
                success: false,
                message: "Failed to update inventory."
            });
        }

        broadcastStockCount();

        return res.json({
            success: true,
            item: String(item),
            remaining: stock.length
        });

    } catch (error) {
        console.error("[GENERATE STOCK ERROR]", error);

        res.status(500).json({
            success: false,
            message: "Unable to generate inventory."
        });
    }
});

/* =========================================================
   SAVED INVENTORY ITEMS
========================================================= */

function readSavedItems() {
    const data = readJson(
        SAVED_ITEMS_FILE,
        []
    );

    return Array.isArray(data)
        ? data
        : [];
}

function saveSavedItems(items) {
    return writeJson(
        SAVED_ITEMS_FILE,
        items
    );
}

/* =========================================================
   SAVE INVENTORY ITEM
========================================================= */

app.post(
    "/api/saved-items",
    requireSession,
    (req, res) => {
        try {
            const item = normalizeStockItem(
                req.body?.item
            );

            if (!item) {
                return res.status(400).json({
                    success: false,
                    message: "Item is required."
                });
            }

            const saved = readSavedItems();

            const duplicate = saved.some(savedItem => {
                return (
                    savedItem.ownerKey ===
                        req.noviSession.key &&
                    savedItem.item === item
                );
            });

            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    message: "This item is already saved."
                });
            }

            const savedItem = {
                id: crypto.randomUUID(),
                ownerKey: req.noviSession.key,
                item,
                createdAt: new Date().toISOString()
            };

            saved.push(savedItem);

            if (!saveSavedItems(saved)) {
                return res.status(500).json({
                    success: false,
                    message: "Failed to save item."
                });
            }

            res.status(201).json({
                success: true,
                item: {
                    id: savedItem.id,
                    item: savedItem.item,
                    createdAt: savedItem.createdAt
                }
            });

        } catch (error) {
            console.error("[SAVE ITEM ERROR]", error);

            res.status(500).json({
                success: false,
                message: "Failed to save item."
            });
        }
    }
);

/* =========================================================
   GET SAVED ITEMS
========================================================= */

app.get(
    "/api/saved-items",
    requireSession,
    (req, res) => {
        try {
            const saved = readSavedItems();

            const items = saved
                .filter(item => {
                    return (
                        item.ownerKey ===
                        req.noviSession.key
                    );
                })
                .map(item => ({
                    id: item.id,
                    item: item.item,
                    createdAt: item.createdAt
                }));

            res.json({
                success: true,
                count: items.length,
                items
            });

        } catch (error) {
            console.error(
                "[GET SAVED ITEMS ERROR]",
                error
            );

            res.status(500).json({
                success: false,
                message: "Failed to load saved items."
            });
        }
    }
);

/* =========================================================
   GET ONE SAVED ITEM
========================================================= */

app.get(
    "/api/saved-items/:id",
    requireSession,
    (req, res) => {
        try {
            const id = String(
                req.params.id || ""
            ).trim();

            const saved = readSavedItems();

            const item = saved.find(savedItem => {
                return (
                    savedItem.id === id &&
                    savedItem.ownerKey ===
                        req.noviSession.key
                );
            });

            if (!item) {
                return res.status(404).json({
                    success: false,
                    message: "Saved item not found."
                });
            }

            res.json({
                success: true,
                item: {
                    id: item.id,
                    item: item.item,
                    createdAt: item.createdAt
                }
            });

        } catch (error) {
            console.error(
                "[GET SAVED ITEM ERROR]",
                error
            );

            res.status(500).json({
                success: false,
                message: "Failed to load saved item."
            });
        }
    }
);

/* =========================================================
   DELETE SAVED ITEM
========================================================= */

app.delete(
    "/api/saved-items/:id",
    requireSession,
    (req, res) => {
        try {
            const id = String(
                req.params.id || ""
            ).trim();

            const saved = readSavedItems();

            const filtered = saved.filter(item => {
                return !(
                    item.id === id &&
                    item.ownerKey ===
                        req.noviSession.key
                );
            });

            if (filtered.length === saved.length) {
                return res.status(404).json({
                    success: false,
                    message: "Saved item not found."
                });
            }

            if (!saveSavedItems(filtered)) {
                return res.status(500).json({
                    success: false,
                    message: "Failed to delete item."
                });
            }

            res.json({
                success: true,
                message: "Saved item deleted."
            });

        } catch (error) {
            console.error(
                "[DELETE SAVED ITEM ERROR]",
                error
            );

            res.status(500).json({
                success: false,
                message: "Failed to delete item."
            });
        }
    }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post("/api/logout", (req, res) => {
    const token = String(
        req.headers["x-novi-session"] || ""
    ).trim();

    if (token) {
        sessions.delete(token);
    }

    res.json({
        success: true
    });
});

/* =========================================================
   SESSION CLEANUP
========================================================= */

setInterval(() => {
    const now = Date.now();

    for (const [
        token,
        session
    ] of sessions) {
        if (now >= session.expiresAt) {
            sessions.delete(token);
        }
    }
}, 60 * 1000);

/* =========================================================
   WEBSITE
========================================================= */

if (fs.existsSync(PUBLIC_DIR)) {
    app.use(
        express.static(PUBLIC_DIR)
    );
}

/* =========================================================
   FRONTEND FALLBACK
========================================================= */

app.get("/{*splat}", (req, res, next) => {
    const indexFile =
        path.join(
            PUBLIC_DIR,
            "index.html"
        );

    if (
        fs.existsSync(indexFile) &&
        !req.path.startsWith("/api/")
    ) {
        return res.sendFile(indexFile);
    }

    next();
});

/* =========================================================
   404
========================================================= */

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route not found.",
        path: req.path,
        method: req.method
    });
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((error, req, res, next) => {
    console.error(
        "[EXPRESS ERROR]",
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

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log("");
        console.log(
            "========================================"
        );
        console.log(
            "           NOVI SERVER ONLINE"
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
            "API: /api"
        );
        console.log(
            "Verify: POST /api/verify"
        );
        console.log(
            "Keys: POST /api/keys"
        );
        console.log(
            "Stock: POST /api/stock/add"
        );
        console.log(
            "Bulk Stock: POST /api/stock/add-many"
        );
        console.log(
            "Generate: POST /api/stock/generate"
        );
        console.log(
            "Saved Items: /api/saved-items"
        );
        console.log(
            "WebSocket: /ws"
        );
        console.log(
            "========================================"
        );
        console.log("");
    }
);

server.on("error", error => {
    console.error(
        "[SERVER ERROR]",
        error
    );
});

module.exports = {
    app,
    server,
    readStock,
    saveStock,
    broadcastStockCount
};
