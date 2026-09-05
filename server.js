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

const ADMIN_SECRET = String(
    process.env.NOVI_ADMIN_SECRET || ""
).trim();

const SESSION_DURATION = 30 * 60 * 1000;

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({
    extended: true,
    limit: "2mb"
}));

/* =========================================================
   FILE SETUP
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
        console.error("[FILE ERROR]", error);
    }
}

ensureFile(KEY_FILE, []);
ensureFile(STOCK_FILE, []);

/* =========================================================
   KEYS
========================================================= */

function readKeys() {
    try {
        ensureFile(KEY_FILE, []);

        const raw = fs.readFileSync(KEY_FILE, "utf8").trim();

        if (!raw) {
            return [];
        }

        const data = JSON.parse(raw);

        if (Array.isArray(data)) {
            return data;
        }

        if (data && Array.isArray(data.keys)) {
            return data.keys;
        }

        if (data && typeof data === "object") {
            return Object.entries(data).map(([key, value]) => ({
                key,
                ...(value && typeof value === "object"
                    ? value
                    : {})
            }));
        }

        return [];
    } catch (error) {
        console.error("[KEYS READ ERROR]", error);
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
        console.error("[KEYS SAVE ERROR]", error);
        return false;
    }
}

/* =========================================================
   STOCK
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
        console.error("[STOCK READ ERROR]", error);
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
        console.error("[STOCK SAVE ERROR]", error);
        return false;
    }
}

/* =========================================================
   ADMIN AUTH
========================================================= */

function requireAdmin(req, res, next) {
    if (!ADMIN_SECRET) {
        console.error(
            "[ADMIN] NOVI_ADMIN_SECRET is missing."
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
   DURATIONS
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
    const a = crypto.randomBytes(3)
        .toString("hex")
        .toUpperCase();

    const b = crypto.randomBytes(3)
        .toString("hex")
        .toUpperCase();

    const c = crypto.randomBytes(3)
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
            : new Date(now + info.ms).toISOString();

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
   POST /api/keys
========================================================= */

app.post("/api/keys", requireAdmin, (req, res) => {
    try {
        console.log("[API/KEYS] Request received");
        console.log("[API/KEYS] Body:", req.body);

        const duration = String(
            req.body?.duration || ""
        ).trim().toLowerCase();

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

        console.log(
            "[API/KEYS] Generated:",
            keyRecord.key
        );

        return res.status(201).json({
            success: true,
            key: keyRecord.key,
            duration: keyRecord.duration,
            durationName: keyRecord.durationName,
            createdAt: keyRecord.createdAt,
            expiresAt: keyRecord.expiresAt
        });

    } catch (error) {
        console.error(
            "[API/KEYS ERROR]",
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
        ).trim().toUpperCase();

        const keys = readKeys();

        const filtered = keys.filter(
            item =>
                String(item?.key || "")
                    .trim()
                    .toUpperCase() !== requestedKey
        );

        if (filtered.length === keys.length) {
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
        ).trim().toUpperCase();

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

        const keyRecord = keys.find(
            item =>
                String(item?.key || "")
                    .trim()
                    .toUpperCase() === key
        );

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
                new Date(keyRecord.expiresAt).getTime()
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

        const sessionToken =
            crypto.randomBytes(32).toString("hex");

        const sessionExpires =
            Date.now() + SESSION_DURATION;

        res.json({
            success: true,
            valid: true,
            sessionToken,
            expiresAt: sessionExpires,
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
   STOCK ADD
========================================================= */

app.post(
    "/api/stock/add",
    requireAdmin,
    (req, res) => {
        try {
            const item = String(
                req.body?.item || ""
            ).trim();

            if (!item) {
                return res.status(400).json({
                    success: false,
                    message: "Item is required."
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

            if (!saveStock(stock)) {
                return res.status(500).json({
                    success: false,
                    message: "Failed to save stock."
                });
            }

            res.json({
                success: true,
                added: 1,
                duplicates: 0,
                count: stock.length
            });

        } catch (error) {
            console.error(
                "[STOCK ADD ERROR]",
                error
            );

            res.status(500).json({
                success: false,
                message: "Failed to add stock."
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
            const stock = readStock();

            res.json({
                success: true,
                count: stock.length,
                stock
            });
        } catch (error) {
            console.error(
                "[STOCK GET ERROR]",
                error
            );

            res.status(500).json({
                success: false,
                message: "Failed to read stock."
            });
        }
    }
);

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
   WEBSITE
========================================================= */

if (fs.existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR));
}

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
   SERVER
========================================================= */

const server = app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log("");
        console.log("========================================");
        console.log("          NOVI SERVER ONLINE");
        console.log("========================================");
        console.log("Port:", PORT);
        console.log(
            "API:",
            `http://127.0.0.1:${PORT}`
        );
        console.log("Health: /health");
        console.log("Key API: POST /api/keys");
        console.log("Verify: POST /api/verify");
        console.log("Stock: POST /api/stock/add");
        console.log("========================================");
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
    server
};
