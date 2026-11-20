const mongoose = require('mongoose');
const { isConnected } = require('../config/db');
const { createPaymentGateways } = require('./payment-gateways');

// Persistent in-memory fallback store so checkout & M-Pesa STK Push NEVER go offline if MongoDB Atlas is unreachable
const fallbackStores = new Map();
function getStore(name) {
    if (!fallbackStores.has(name)) fallbackStores.set(name, new Map());
    return fallbackStores.get(name);
}

function matchesFilter(doc, filter = {}) {
    if (!doc) return false;
    for (const [k, v] of Object.entries(filter)) {
        if (k === '$or' && Array.isArray(v)) {
            if (!v.some(sub => matchesFilter(doc, sub))) return false;
            continue;
        }
        const actual = doc[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
            if ('$gt' in v && !(actual > v.$gt)) return false;
            if ('$gte' in v && !(actual >= v.$gte)) return false;
            if ('$lt' in v && !(actual < v.$lt)) return false;
            if ('$lte' in v && !(actual <= v.$lte)) return false;
            if ('$ne' in v && actual === v.$ne) return false;
            if ('$in' in v && Array.isArray(v.$in) && !v.$in.includes(actual)) return false;
            if ('$exists' in v && (actual !== undefined) !== Boolean(v.$exists)) return false;
        } else if (actual !== v) {
            return false;
        }
    }
    return true;
}

function fallbackCollection(name) {
    const store = getStore(name);
    return {
        async createIndex() { return 'ok'; },
        async findOne(filter = {}) {
            for (const doc of store.values()) {
                if (matchesFilter(doc, filter)) return { ...doc };
            }
            return null;
        },
        async findOneAndUpdate(filter = {}, update = {}, options = {}) {
            await this.updateOne(filter, update, options);
            return await this.findOne(filter._id !== undefined ? { _id: filter._id } : filter);
        },
        async findOneAndDelete(filter = {}) {
            for (const [key, doc] of store.entries()) {
                if (matchesFilter(doc, filter)) {
                    store.delete(key);
                    return { ...doc };
                }
            }
            return null;
        },
        find(filter = {}) {
            let results = [...store.values()].filter(doc => matchesFilter(doc, filter)).map(d => ({ ...d }));
            return {
                sort(spec = {}) {
                    const [[field, dir]] = Object.entries(spec);
                    if (field) {
                        results.sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (dir < 0 ? -1 : 1));
                    }
                    return this;
                },
                limit(n) {
                    results = results.slice(0, n);
                    return this;
                },
                async toArray() { return results; }
            };
        },
        async insertOne(doc) {
            const id = doc._id ?? doc.orderReference ?? doc.qrCodeToken ?? String(Date.now() + Math.random());
            store.set(id, { ...doc, _id: id });
            return { acknowledged: true, insertedId: id };
        },
        async insertMany(docs = []) {
            for (const doc of docs) await this.insertOne(doc);
            return { acknowledged: true, insertedCount: docs.length };
        },
        async replaceOne(filter, replacement, options = {}) {
            for (const [key, doc] of store.entries()) {
                if (matchesFilter(doc, filter)) {
                    store.set(key, { ...replacement, _id: key });
                    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
                }
            }
            if (options.upsert) {
                const id = filter._id ?? replacement._id ?? replacement.orderReference ?? String(Date.now());
                store.set(id, { ...replacement, _id: id });
                return { acknowledged: true, matchedCount: 1, upsertedCount: 1 };
            }
            return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
        },
        async updateOne(filter, update, options = {}) {
            let targetKey = null;
            let targetDoc = null;
            for (const [key, doc] of store.entries()) {
                if (matchesFilter(doc, filter)) {
                    targetKey = key;
                    targetDoc = { ...doc };
                    break;
                }
            }
            if (!targetDoc) {
                if (!options.upsert) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
                targetKey = filter._id ?? String(Date.now());
                targetDoc = { _id: targetKey, ...(update.$setOnInsert || {}) };
            }
            if (update.$set) Object.assign(targetDoc, update.$set);
            if (update.$inc) {
                for (const [k, delta] of Object.entries(update.$inc)) {
                    targetDoc[k] = (Number(targetDoc[k]) || 0) + Number(delta);
                }
            }
            if (update.$unset) {
                for (const k of Object.keys(update.$unset)) delete targetDoc[k];
            }
            store.set(targetKey, targetDoc);
            return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
        },
        async updateMany(filter, update) {
            let matchedCount = 0;
            for (const [key, doc] of store.entries()) {
                if (matchesFilter(doc, filter)) {
                    matchedCount++;
                    const updated = { ...doc };
                    if (update.$set) Object.assign(updated, update.$set);
                    if (update.$unset) {
                        for (const k of Object.keys(update.$unset)) delete updated[k];
                    }
                    store.set(key, updated);
                }
            }
            return { acknowledged: true, matchedCount, modifiedCount: matchedCount };
        },
        async deleteOne(filter = {}) {
            for (const [key, doc] of store.entries()) {
                if (matchesFilter(doc, filter)) {
                    store.delete(key);
                    return { acknowledged: true, deletedCount: 1 };
                }
            }
            return { acknowledged: true, deletedCount: 0 };
        },
        async deleteMany(filter = {}) {
            let deletedCount = 0;
            for (const [key, doc] of store.entries()) {
                if (matchesFilter(doc, filter)) {
                    store.delete(key);
                    deletedCount++;
                }
            }
            return { acknowledged: true, deletedCount };
        },
        aggregate(pipeline = []) {
            const matchStage = pipeline.find(s => s.$match)?.$match || {};
            const matched = [...store.values()].filter(doc => matchesFilter(doc, matchStage));
            const totalQty = matched.reduce((sum, doc) => sum + (Number(doc.quantity) || 0), 0);
            return {
                async toArray() {
                    return matched.length ? [{ _id: null, quantity: totalQty }] : [];
                }
            };
        }
    };
}

function collection(name) {
    if (isConnected() && mongoose.connection?.db) {
        return mongoose.connection.db.collection(name);
    }
    return fallbackCollection(name);
}

async function createIndexes() {
    if (!isConnected()) return;
    await Promise.all([
        collection('commerce_orders').createIndex({ provider: 1, checkoutRequestId: 1 }),
        collection('commerce_holds').createIndex({ product: 1, expiresAt: 1 }),
        collection('commerce_holds').createIndex({ orderReference: 1 }),
        collection('commerce_holds').createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
        collection('commerce_passes').createIndex({ orderReference: 1 }),
        collection('commerce_passes').createIndex({ passReference: 1 }, { unique: true }),
        collection('event_sync_runs').createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
        collection('event_sync_runs').createIndex({ startedAt: -1 })
    ]);
}

async function transaction(work) {
    if (isConnected() && typeof mongoose.connection?.transaction === 'function') {
        try {
            return await mongoose.connection.transaction(work);
        } catch (err) {
            if (err.status) throw err;
        }
    }
    return await work(undefined);
}

function demoEnabled() {
    return process.env.NODE_ENV !== 'production' && process.env.PAYMENT_MODE === 'demo';
}

function checkoutMode() {
    if (!isConnected() && !demoEnabled()) return 'unavailable';
    if (demoEnabled()) return 'demo';
    return process.env.PAYMENT_MODE === 'live' && createPaymentGateways().available().some(gateway => gateway.configured) ? 'live' : 'unavailable';
}

function stockKey(product, mode = demoEnabled() ? 'demo' : 'live') {
    return mode + ':' + product;
}

async function lockStock(keys, session) {
    for (const key of [...new Set(keys)].sort()) {
        await collection('commerce_stock').updateOne({ _id: stockKey(key) },
            { $inc: { revision: 1 }, $setOnInsert: { sold: 0 } }, { session, upsert: true });
    }
}

async function availability(product, capacity, session, exceptOrder = '') {
    const key = stockKey(product);
    const stock = await collection('commerce_stock').findOne({ _id: key }, { session });
    const [holds] = await collection('commerce_holds').aggregate([
        { $match: { product: key, expiresAt: { $gt: Date.now() }, orderReference: { $ne: exceptOrder } } },
        { $group: { _id: null, quantity: { $sum: '$quantity' } } }
    ], { session }).toArray();
    return Math.max(0, capacity - (stock?.sold ?? 0) - (holds?.quantity ?? 0));
}

async function bulkAvailability(items) {
    if (!items.length) return new Map();
    const keys = items.map(item => stockKey(item.product));
    const now = Date.now();
    const [stockDocs, holdDocs] = await Promise.all([
        collection('commerce_stock').find({ _id: { $in: keys } }, { maxTimeMS: 6000 }).toArray(),
        isConnected()
            ? collection('commerce_holds').aggregate([
                { $match: { product: { $in: keys }, expiresAt: { $gt: now } } },
                { $group: { _id: '$product', quantity: { $sum: '$quantity' } } }
            ], { maxTimeMS: 6000 }).toArray()
            : Promise.resolve([])
    ]);
    const soldMap = new Map(stockDocs.map(doc => [doc._id, Number(doc.sold) || 0]));
    const heldMap = new Map(holdDocs.map(doc => [doc._id, Number(doc.quantity) || 0]));
    if (!isConnected()) {
        const allHolds = await collection('commerce_holds').find({ expiresAt: { $gt: now } }).toArray();
        for (const h of allHolds) {
            heldMap.set(h.product, (heldMap.get(h.product) || 0) + (Number(h.quantity) || 0));
        }
    }
    const result = new Map();
    for (const item of items) {
        const key = stockKey(item.product);
        const sold = soldMap.get(key) || 0;
        const held = heldMap.get(key) || 0;
        result.set(item.product, Math.max(0, (Number(item.capacity) || 0) - sold - held));
    }
    return result;
}

module.exports = { collection, createIndexes, transaction, stockKey, lockStock, availability, bulkAvailability, checkoutMode, demoEnabled };
