const express = require('express');
const { commerceDb, transaction } = require('../services/commerceDb');
const router = express.Router();

router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('X-Admin-Action') !== 'dashboard') {
        return res.status(403).json({ message: 'Admin action header required.' });
    }
    next();
});

router.get('/overview', async (req, res, next) => {
    try {
        const db = commerceDb();
        const events = db.prepare('SELECT data FROM published_events ORDER BY starts_at DESC').all()
            .map(row => JSON.parse(row.data));
        const orders = db.prepare("SELECT data FROM orders WHERE json_extract(data, '$.mode') = 'live' ORDER BY rowid DESC").all()
            .map(row => JSON.parse(row.data))
            .map(({ orderReference, customer, items, totalTickets, totalKes, paymentStatus }) => ({
                orderReference, customer: { name: customer.name, email: customer.email }, items, totalTickets, totalKes, paymentStatus
            }));

        const sold = new Map();
        for (const order of orders) {
            if (order.paymentStatus !== 'COMPLETED') continue;
            for (const item of order.items) {
                if (item.kind === 'ticket') sold.set(item.tierKey, (sold.get(item.tierKey) ?? 0) + item.quantity);
            }
        }
        for (const event of events) {
            for (const tier of event.tiers) tier.sold = sold.get(tier.tierKey) ?? 0;
        }

        const imports = discoveryStatus(req.app.locals.eventCatalog.get());
        res.json({ events, orders, imports });
    } catch (error) {
        next(error);
    }
});

router.patch('/events/:id', (req, res) => {
    const { status } = req.body;
    if (!['published', 'unpublished', 'archived'].includes(status)) {
        return res.status(400).json({ message: 'Invalid event status.' });
    }
    const updated = transaction(db => {
        const row = db.prepare('SELECT data FROM published_events WHERE id = ?').get(req.params.id);
        if (!row) return false;
        const event = JSON.parse(row.data);
        event.status = status;
        db.prepare('UPDATE published_events SET data = ? WHERE id = ?').run(JSON.stringify(event), event.id);
        db.prepare('INSERT INTO admin_audit (action, target, timestamp) VALUES (?, ?, ?)')
            .run(status, event.id, new Date().toISOString());
        return true;
    });
    if (!updated) return res.status(404).json({ message: 'Event not found.' });
    res.json({ success: true });
});

router.get('/audit', (req, res) => {
    res.json({ data: commerceDb().prepare('SELECT * FROM admin_audit ORDER BY rowid DESC LIMIT 100').all() });
});

function discoveryStatus(catalog) {
    return catalog.status === 'local' ? { ...catalog, events: [] } : catalog;
}

router.post('/imports/sync', async (req, res, next) => {
    try {
        const catalog = req.app.locals.eventCatalog;
        await catalog.refresh();
        res.json(discoveryStatus(catalog.get()));
    } catch (error) {
        next(error);
    }
});

module.exports = router;
