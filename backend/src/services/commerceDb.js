const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { isConnected } = require('../config/db');

let database;

function commerceDb() {
    if (!database) {
        const file = process.env.COMMERCE_DB_PATH || resolve(__dirname, '../../data/commerce.sqlite');
        if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });
        database = new DatabaseSync(file);
        database.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS admin_audit (
                action TEXT NOT NULL,
                target TEXT NOT NULL,
                timestamp TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS published_events (
                id TEXT PRIMARY KEY,
                starts_at INTEGER NOT NULL,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS orders (
                reference TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                data TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS passes (
                token TEXT PRIMARY KEY,
                reference TEXT NOT NULL UNIQUE,
                order_reference TEXT NOT NULL REFERENCES orders(reference),
                data TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS passes_order ON passes(order_reference);
            CREATE TABLE IF NOT EXISTS holds (
                order_reference TEXT NOT NULL REFERENCES orders(reference),
                product TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                PRIMARY KEY (order_reference, product)
            );
            CREATE INDEX IF NOT EXISTS holds_product_expiry ON holds(product, expires_at);
            CREATE TABLE IF NOT EXISTS sales (
                product TEXT PRIMARY KEY,
                quantity INTEGER NOT NULL
            );
        `);
    }
    return database;
}

function transaction(work) {
    const db = commerceDb();
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = work(db);
        db.exec('COMMIT');
        return result;
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

function demoEnabled() {
    return process.env.PAYMENT_MODE !== 'live';
}

function soldQuantity(product) {
    return commerceDb().prepare('SELECT quantity FROM sales WHERE product = ?').get(product)?.quantity ?? 0;
}

function heldQuantity(product, exceptOrder = '') {
    return commerceDb().prepare(
        'SELECT COALESCE(SUM(quantity), 0) AS quantity FROM holds WHERE product = ? AND expires_at > ? AND order_reference != ?'
    ).get(product, Date.now(), exceptOrder)?.quantity ?? 0;
}

function stockKey(product, mode = demoEnabled() ? 'demo' : 'live') {
    return mode + ':' + product;
}

function checkoutMode() {
    if (process.env.PAYMENT_MODE === 'demo') return 'demo';
    return 'live';
}

function availability(product, totalStock) {
    return Math.max(0, totalStock - soldQuantity(product) - heldQuantity(product));
}

async function createIndexes() {
    return true;
}

function collection(name) {
    const mongoose = require('mongoose');
    if (isConnected() && mongoose.connection?.db) {
        return mongoose.connection.db.collection(name);
    }
    const emptyCursor = {
        sort() { return this; },
        limit() { return this; },
         async toArray() { return []; }
    };
    return {
        find() { return emptyCursor; },
        async insertOne() { return { acknowledged: true }; },
        async updateOne() { return { matchedCount: 0 }; }
    };
}

module.exports = {
    commerceDb,
    transaction,
    soldQuantity,
    heldQuantity,
    availability,
    createIndexes,
    collection,
    demoEnabled,
    checkoutMode,
    stockKey
};
