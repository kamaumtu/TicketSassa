const express = require('express');
const { collection, transaction } = require('../services/commerceDb');
const router = express.Router();
const { route } = require('../services/http');

router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('X-Admin-Action') !== 'dashboard') {
        return res.status(403).json({ message: 'Admin action header required.' });
    }
    next();
});

router.post('/orders/:reference/check-payment', require('../controllers/commerceController').adminCheckPayment);

router.get('/overview', async (req, res, next) => {
    try {
        const events = await collection('commerce_events').find({}, { projection: { _id: 0 } }).sort({ startsAt: -1 }).toArray();
        const liveOrders = await collection('commerce_orders').find({ mode: 'live' }).sort({ _id: -1 }).toArray();
        const orders = liveOrders
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

        const imports = discoveryStatus(await req.app.locals.eventCatalog.get());
        res.json({ events, orders, imports });
    } catch (error) {
        next(error);
    }
});

router.patch('/events/:id', route(async (req, res) => {
    const { status } = req.body;
    if (!['published', 'unpublished', 'archived'].includes(status)) {
        return res.status(400).json({ message: 'Invalid event status.' });
    }
    const updated = await transaction(async session => {
        const id = req.params.id;
        const result = await collection('commerce_events').updateOne({ _id: id }, { $set: { status } }, { session });
        if (!result.matchedCount) return false;
        await collection('commerce_audit').insertOne({
            action: status, target: id, timestamp: new Date().toISOString(), actor: req.organizerId
        }, { session });
        return true;
    });
    if (!updated) return res.status(404).json({ message: 'Event not found.' });
    res.json({ success: true });
}));

router.get('/audit', route(async (req, res) => {
    const data = await collection('commerce_audit').find({}, { projection: { _id: 0 } })
        .sort({ timestamp: -1 }).limit(100).toArray();
    res.json({ data });
}));

function discoveryStatus(catalog) {
    return catalog.status === 'local' ? { ...catalog, events: [] } : catalog;
}

router.post('/imports/sync', async (req, res, next) => {
    try {
        const catalog = req.app.locals.eventCatalog;
        await catalog.refresh();
        res.json(discoveryStatus(await catalog.get()));
    } catch (error) {
        next(error);
    }
});

module.exports = router;
