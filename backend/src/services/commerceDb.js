const mongoose = require('mongoose');
const { isConnected } = require('../config/db');
const { createPaymentGateways } = require('./payment-gateways');

function collection(name) {
    if (!isConnected()) throw Object.assign(new Error('Booking storage is unavailable.'), { status: 503 });
    return mongoose.connection.db.collection(name);
}

async function createIndexes() {
    await Promise.all([
        collection('commerce_orders').createIndex({ provider: 1, checkoutRequestId: 1 }),
        collection('commerce_holds').createIndex({ product: 1, expiresAt: 1 }),
        collection('commerce_holds').createIndex({ orderReference: 1 }),
        collection('commerce_holds').createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
        collection('commerce_passes').createIndex({ orderReference: 1 }),
        collection('commerce_passes').createIndex({ passReference: 1 }, { unique: true })
    ]);
}

async function transaction(work) {
    collection('commerce_orders');
    return mongoose.connection.transaction(work);
}

function demoEnabled() {
    return process.env.NODE_ENV !== 'production' && process.env.PAYMENT_MODE === 'demo';
}

function checkoutMode() {
    if (!isConnected()) return 'unavailable';
    if (demoEnabled()) return 'demo';
    return process.env.PAYMENT_MODE === 'live' && (require('./mpesa').config() ||
        createPaymentGateways().available().some(gateway => gateway.configured)) ? 'live' : 'unavailable';
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

module.exports = { collection, createIndexes, transaction, stockKey, lockStock, availability, checkoutMode, demoEnabled };
