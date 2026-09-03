const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

/* =========================================================
   CONFIG
========================================================= */

const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(
    __dirname,
    "public"
);

const KEY_FILE = path.join(
    __dirname,
    "keys.json"
);

const STOCK_FILE = path.join(
    __dirname,
    "epicgames-stock.json"
);

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());

app.use(
    express.json({
        limit: "5mb"
    })
);

/* =========================================================
   FILE SETUP
========================================================= */

if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(
        KEY_FILE,
        JSON.stringify({}, null, 2),
        "utf8"
    );

    console.log("Created keys.json");
}

if (!fs.existsSync(STOCK_FILE)) {
    fs.writeFileSync(
        STOCK_FILE,
        JSON.stringify([], null, 2),
        "utf8"
    );

    console.log("Created epicgames-stock.json");
}

/* =========================================================
   KEY SYSTEM
========================================================= */

function loadKeys() {
    try {
        if (!fs.existsSync(KEY_FILE)) {
            return {};
        }

        const data = fs.readFileSync(
            KEY_FILE,
            "utf8"
        );

        if (!data.trim()) {
            return {};
        }

        const keys = JSON.parse(data);

        if (
            !keys ||
            typeof keys !== "object" ||
            Array.isArray(keys)
        ) {
            console.error(
                "keys.json must contain an object."
            );

            return {};
        }

        return keys;

    } catch (error) {
        console.error(
            "Could not load keys:",
            error
        );

        return {};
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
        console.error(
            "Could not save keys:",
            error
        );

        return false;
    }
}

/* =========================================================
   GET EXPIRATION
========================================================= */

function getExpiration(duration) {

    const now = new Date();

    switch (duration) {

        case "1d":
            return new Date(
                now.getTime() +
                24 * 60 * 60 * 1000
            ).toISOString();

        case "1week":
            return new Date(
                now.getTime() +
                7 * 24 * 60 * 60 * 1000
            ).toISOString();

        case "1month": {
            const date = new Date(now);

            date.setMonth(
                date.getMonth() + 1
            );

            return date.toISOString();
        }

        case "1year": {
            const date = new Date(now);

            date.setFullYear(
                date.getFullYear() + 1
            );

            return date.toISOString();
        }

        case "lifetime":
            return null;

        default:
            return null;
    }
}

/* =========================================================
   STOCK SYSTEM
========================================================= */

function loadStock() {
    try {

        if (!fs.existsSync(STOCK_FILE)) {
            return [];
        }

        const data = fs.readFileSync(
            STOCK_FILE,
            "utf8"
        );

        if (!data.trim()) {
            return [];
        }

        const stock = JSON.parse(data);

        if (!Array.isArray(stock)) {
            console.error(
                "Stock file must contain an array."
            );

            return [];
        }

        return stock;

    } catch (error) {

        console.error(
            "Could not load stock:",
            error
        );

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

        console.error(
            "Could not save stock:",
            error
        );

        return false;
    }
}

/* =========================================================
   PUBLIC WEBSITE
========================================================= */

if (!fs.existsSync(PUBLIC_DIR)) {

    console.error(
        "ERROR: public folder does not exist!"
    );

} else {

    console.log(
        "Public folder found."
    );
}

app.use(
    express.static(
        PUBLIC_DIR,
        {
            index: "index.html"
        }
    )
);

app.get(
    "/",
    (req, res) => {

        const indexPath = path.join(
            PUBLIC_DIR,
            "index.html"
        );

        if (!fs.existsSync(indexPath)) {

            return res
                .status(404)
                .send(
                    "Novi is running, but public/index.html was not found."
                );
        }

        res.sendFile(indexPath);
    }
);

/* =========================================================
   CREATE NOVI KEY
========================================================= */

app.post(
    "/api/keys",
    (req, res) => {

        try {

            const {
                key,
                duration
            } = req.body || {};

            if (!key || !duration) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Missing key or duration."
                    });
            }

            /*
                Normalize the key.

                This means:
                novi-abcd
                Novi-Abcd
                NOVI-ABCD

                will all be treated consistently.
            */

            const cleanKey = String(key)
                .trim()
                .toUpperCase();

            const allowedDurations = [
                "1d",
                "1week",
                "1month",
                "1year",
                "lifetime"
            ];

            if (
                !allowedDurations.includes(
                    duration
                )
            ) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Invalid duration."
                    });
            }

            if (!cleanKey) {

                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Invalid key."
                    });
            }

            const keys = loadKeys();

            if (keys[cleanKey]) {

                return res
                    .status(409)
                    .json({
                        success: false,
                        message:
                            "Key already exists."
                    });
            }

            keys[cleanKey] = {

                duration: duration,

                createdAt:
                    new Date()
                        .toISOString(),

                expiresAt:
                    getExpiration(
                        duration
                    ),

                used: false
            };

            if (!saveKeys(keys)) {

                return res
                    .status(500)
                    .json({
                        success: false,
                        message:
                            "Could not save key."
                    });
            }

            console.log(
                `Saved key: ${cleanKey} (${duration})`
            );

            return res.json({

                success: true,

                message:
                    "Key saved successfully."

            });

        } catch (error) {

            console.error(
                "Create key error:",
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
    }
);

/* =========================================================
   VERIFY NOVI KEY
========================================================= */

app.post(
    "/api/verify",
    (req, res) => {

        try {

            const { key } =
                req.body || {};

            if (!key) {

                return res
                    .status(400)
                    .json({
                        valid: false,
                        message:
                            "Please enter a key."
                    });
            }

            /*
                Normalize the entered key
                the exact same way as when
                the key was created.
            */

            const cleanKey = String(key)
                .trim()
                .toUpperCase();

            const keys = loadKeys();

            const keyData =
                keys[cleanKey];

            /* =================================================
               KEY DOES NOT EXIST
            ================================================= */

            if (!keyData) {

                console.log(
                    `Invalid key attempt: ${cleanKey}`
                );

                return res.json({

                    valid: false,

                    message:
                        "Invalid Novi key."

                });
            }

            /* =================================================
               CHECK EXPIRATION
            ================================================= */

            if (keyData.expiresAt) {

                const expirationDate =
                    new Date(
                        keyData.expiresAt
                    );

                if (
                    Number.isNaN(
                        expirationDate.getTime()
                    )
                ) {

                    console.error(
                        `Invalid expiration date for key: ${cleanKey}`
                    );

                    return res.json({

                        valid: false,

                        message:
                            "Invalid Novi key expiration."

                    });
                }

                if (
                    Date.now() >=
                    expirationDate.getTime()
                ) {

                    console.log(
                        `Expired key: ${cleanKey}`
                    );

                    return res.json({

                        valid: false,

                        message:
                            "This Novi key has expired."

                    });
                }
            }

            /* =================================================
               KEY IS VALID
            ================================================= */

            console.log(
                `Key verified successfully: ${cleanKey}`
            );

            return res.json({

                valid: true,

                duration:
                    keyData.duration,

                expiresAt:
                    keyData.expiresAt

            });

        } catch (error) {

            console.error(
                "Verify key error:",
                error
            );

            return res
                .status(500)
                .json({

                    valid: false,

                    message:
                        "Internal server error."

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
                loadStock();

            return res.json({

                success: true,

                count:
                    stock.length

            });

        } catch (error) {

            console.error(
                "Stock count error:",
                error
            );

            return res
                .status(500)
                .json({

                    success: false,

                    count: 0,

                    message:
                        "Could not load stock."

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

            const { items } =
                req.body || {};

            if (
                !Array.isArray(items)
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "Items must be an array."

                    });
            }

            if (
                items.length === 0
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "No items were provided."

                    });
            }

            const stock =
                loadStock();

            const existing =
                new Set(
                    stock.map(
                        item =>
                            String(item)
                                .trim()
                                .toLowerCase()
                    )
                );

            let added = 0;
            let duplicates = 0;
            let invalid = 0;

            for (
                const rawItem of items
            ) {

                if (
                    rawItem === null ||
                    rawItem === undefined
                ) {

                    invalid++;

                    continue;
                }

                const item =
                    String(
                        rawItem
                    ).trim();

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

                stock.push(item);

                existing.add(
                    normalized
                );

                added++;
            }

            if (
                !saveStock(stock)
            ) {

                return res
                    .status(500)
                    .json({

                        success: false,

                        message:
                            "Could not save stock."

                    });
            }

            console.log(
                `Added ${added} stock item(s). ` +
                `Duplicates: ${duplicates}. ` +
                `Invalid: ${invalid}. ` +
                `Total stock: ${stock.length}`
            );

            return res.json({

                success: true,

                added:
                    added,

                duplicates:
                    duplicates,

                invalid:
                    invalid,

                remaining:
                    stock.length

            });

        } catch (error) {

            console.error(
                "Add stock error:",
                error
            );

            return res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Could not add stock."

                });
        }
    }
);

/* =========================================================
   GENERATE ONE STOCK ITEM
========================================================= */

app.post(
    "/api/stock/generate",
    (req, res) => {

        try {

            const stock =
                loadStock();

            if (
                stock.length === 0
            ) {

                return res
                    .status(400)
                    .json({

                        success: false,

                        message:
                            "No Epic Games stock is available."

                    });
            }

            const item =
                stock.shift();

            if (
                !saveStock(stock)
            ) {

                return res
                    .status(500)
                    .json({

                        success: false,

                        message:
                            "Could not remove the item from stock."

                    });
            }

            console.log(
                `Generated stock item. Remaining: ${stock.length}`
            );

            return res.json({

                success: true,

                item:
                    item,

                remaining:
                    stock.length

            });

        } catch (error) {

            console.error(
                "Generate stock error:",
                error
            );

            return res
                .status(500)
                .json({

                    success: false,

                    message:
                        "Could not generate stock."

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

            online: true,

            message:
                "Novi server is running."

        });
    }
);

/* =========================================================
   UNKNOWN API ENDPOINT
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
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "Server error:",
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

const server =
    app.listen(
        PORT,
        "0.0.0.0",
        (error) => {

            if (error) {

                console.error(
                    "Server failed to start:",
                    error
                );

                process.exit(1);
            }

            console.log(
                "================================="
            );

            console.log(
                "       NOVI SERVER ONLINE"
            );

            console.log(
                "================================="
            );

            console.log(
                `Port: ${PORT}`
            );

            console.log(
                `Public folder: ${PUBLIC_DIR}`
            );

            console.log(
                `Keys file: ${KEY_FILE}`
            );

            console.log(
                `Stock file: ${STOCK_FILE}`
            );

            console.log(
                "Key verification: ENABLED"
            );

            console.log(
                "Stock add endpoint: ENABLED"
            );

            console.log(
                "Stock generate endpoint: ENABLED"
            );

            console.log(
                "Website server started successfully."
            );

            console.log(
                "================================="
            );
        }
    );

/* =========================================================
   SERVER ERROR HANDLER
========================================================= */

server.on(
    "error",
    (error) => {

        console.error(
            "HTTP server error:",
            error
        );
    }
);
