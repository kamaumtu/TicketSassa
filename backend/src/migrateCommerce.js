require('dotenv').config();
const { resolve } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const mongoose = require('mongoose');
const { collection, createIndexes, transaction } = require('./services/commerceDb');
const { connectDB, isConnected } = require('./config/db');

async function migrate() {
    await connectDB();
    if (!isConnected()) throw new Error('Set MONGODB_URI to your MongoDB replica set or Atlas cluster.');
    const file = process.argv[2] || resolve(__dirname, '../data/commerce.sqlite');
    const source = new DatabaseSync(file, { readOnly: true });
    try {
        await createIndexes();
        const events = source.prepare('SELECT data FROM published_events').all().map(row => JSON.parse(row.data));
        const orders = source.prepare('SELECT data FROM orders').all().map(row => JSON.parse(row.data));
        const passes = source.prepare('SELECT data FROM passes').all().map(row => JSON.parse(row.data));
        const audit = source.prepare('SELECT rowid AS sequence, action, target, timestamp, actor FROM admin_audit').all();
        const holds = source.prepare('SELECT * FROM holds WHERE expires_at > ?').all(Date.now());
        const sales = source.prepare('SELECT * FROM sales').all();
        const key = product => product.startsWith('live:') ? product : 'demo:' + product;

        await transaction(async session => {
            const marker = collection('commerce_migrations');
            if (await marker.findOne({ _id: 'legacy-sqlite' }, { session })) {
                throw new Error('The SQLite snapshot was already migrated.');
            }
            const groups = [
                ['commerce_events', events.map(event => ({ ...event, _id: event.id }))],
                ['commerce_orders', orders.map(order => ({ ...order, _id: order.orderReference }))],
                ['commerce_passes', passes.map(pass => ({ ...pass, _id: pass.qrCodeToken }))],
                ['commerce_audit', audit.map(({ sequence, ...entry }) => ({ ...entry, _id: 'legacy:' + sequence }))],
                ['commerce_holds', holds.map(row => ({
                    _id: row.order_reference + ':' + row.product, orderReference: row.order_reference,
                    product: key(row.product), quantity: row.quantity, expiresAt: row.expires_at,
                    ...(row.expires_at < Number.MAX_SAFE_INTEGER ? { purgeAt: new Date(row.expires_at) } : {})
                }))],
                ['commerce_stock', sales.map(row => ({ _id: key(row.product), sold: row.quantity, revision: 0 }))]
            ];
            for (const [name, documents] of groups) {
                if (documents.length) await collection(name).insertMany(documents, { session });
            }
            await marker.insertOne({ _id: 'legacy-sqlite', migratedAt: new Date() }, { session });
        });
        console.log('Migrated %d events, %d orders and %d passes.', events.length, orders.length, passes.length);
    } finally {
        source.close();
    }
}

migrate().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
}).finally(() => mongoose.disconnect());
