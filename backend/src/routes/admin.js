const express = require('express');
const { collection, transaction } = require('../services/commerceDb');
const router = express.Router();
const { route } = require('../services/http');
const { getPaymentSettings, setPaymentProvider } = require('../services/paymentSettings');
const { getSupportSettings, setSupportSettings } = require('../services/supportSettings');
const { revenueSummary, realCompletedOrder, isLiveTicket } = require('../services/ticketRevenue');
const { publishEvent } = require('./publishedEvents');
const { isConnected } = require('../config/db');
const { buildKenyaDiscovery } = require('../services/kenyaDiscovery');
const { depositBus, getRecentDeposits } = require('../services/depositAlerts');
const { createSocketToken } = require('../services/automation/socketHub');
router.get('/travel/lobby', route(async (req, res) => res.set('Cache-Control', 'no-store').json(await require('../services/travelCatalog').lobby())));
router.post('/travel/sync', route(async (req, res) => res.json(await require('../services/travelCatalog').sync('admin'))));

router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('X-Admin-Action') !== 'dashboard') {
        return res.status(403).json({ message: 'Admin action header required.' });
    }
    next();
});

router.post('/orders/:reference/check-payment', require('../controllers/commerceController').adminCheckPayment);
router.post('/events', route(publishEvent));

router.get('/payments/settings', route(async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await getPaymentSettings());
}));

router.put('/payments/settings', route(async (req, res) => {
    const { provider } = req.body ?? {};
    try {
        res.json(await setPaymentProvider(provider, req.organizerId));
    } catch (error) {
        if (error.status !== 400) throw error;
        res.status(400).json({ success: false, message: error.message });
    }
}));

router.get('/support/contact', route(async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await getSupportSettings(true));
}));

router.put('/support/contact', route(async (req, res) => {
    try {
        res.json(await setSupportSettings(req.body ?? {}, req.organizerId));
    } catch (error) {
        if (![400, 503].includes(error.status)) throw error;
        res.status(error.status).json({ success: false, message: error.message });
    }
}));

let overviewCache = { events: [], liveOrders: [], audit: [], at: 0 };
depositBus.on('deposit_event', () => {
    overviewCache.at = 0;
});

router.get('/overview', async (req, res, next) => {
    try {
        const payments = await getPaymentSettings();
        const storageAvailable = isConnected();
        let events = overviewCache.events;
        let liveOrders = overviewCache.liveOrders;
        const forceFresh = req.query?.fresh === '1';
        if (storageAvailable && (forceFresh || Date.now() - overviewCache.at > 1500)) {
            const [evRes, ordRes] = await Promise.all([
                collection('commerce_events').find({}, { projection: { _id: 0 }, maxTimeMS: 6000 }).sort({ startsAt: -1 }).toArray().catch(() => null),
                collection('commerce_orders').find({ mode: 'live' }, { maxTimeMS: 6000 }).sort({ createdAt: -1 }).toArray().catch(() => null)
            ]);
            if (evRes) events = evRes;
            if (ordRes) liveOrders = ordRes;
            overviewCache = { ...overviewCache, events, liveOrders, at: Date.now() };
        }
        const orders = liveOrders
            .filter(order => order.provider !== 'demo' && !/^DEMO-/i.test(order.receipt ?? ''))
            .map(({ orderReference, customer, items, totalKes, paymentStatus, provider, receipt, paidAt, createdAt, failureReason, failureCode, failedAt }) => ({
                orderReference, customer: { name: customer?.name, email: customer?.email, phone: customer?.phone }, items,
                totalTickets: (items ?? []).filter(isLiveTicket).reduce((sum, item) => sum + item.quantity, 0),
                totalKes, paymentStatus, provider, receipt, paidAt, createdAt,
                ...(failureReason ? { failureReason, failureCode, failedAt } : {})
            }));

        const sold = new Map();
        for (const order of liveOrders.filter(realCompletedOrder)) {
            for (const item of order.items ?? []) {
                if (isLiveTicket(item)) sold.set(item.tierKey, (sold.get(item.tierKey) ?? 0) + item.quantity);
            }
        }
        const eventsWithSold = events.map(event => ({
            ...event,
            tiers: (event.tiers || []).map(tier => ({ ...tier, sold: sold.get(tier.tierKey) ?? 0 }))
        }));

        const imports = discoveryStatus(await req.app.locals.eventCatalog.get());
        const storefrontUrl = process.env.PUBLIC_APP_URL || process.env.CLIENT_URL || 'https://ticketsassa.ticketsassa.workers.dev';
        res.json({ storageAvailable, storefrontUrl, events: eventsWithSold, orders, imports, payments, ticketRevenue: revenueSummary(liveOrders) });
    } catch (error) {
        next(error);
    }
});

router.patch('/events/:id', route(async (req, res) => {
    if (!isConnected()) return res.status(503).json({ message: 'Event changes require the database connection.' });
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
    const data = await collection('commerce_audit').find({}, { projection: { _id: 0 }, maxTimeMS: 6000 })
        .sort({ timestamp: -1 }).limit(100).toArray().catch(() => overviewCache.audit);
    overviewCache.audit = data;
    res.json({ data });
}));

function discoveryStatus(catalog) {
    const { events, updatedAt, providerStatuses, allocationStatus } = catalog;
    return { events: events.filter(event => event.ticketStatus).map(({ id, title, venue, startsAt, source, ticketStatus, startingPrice, price }) =>
        ({ id, title, venue, startsAt, source, ticketStatus, startingPrice, priceSource: price?.sourceUrl, priceCheckedAt: price?.checkedAt })),
    updatedAt, providerStatuses, allocationStatus };
}

async function publishingLobby(req, res) {
    const catalog = req.app.locals.eventCatalog;
    const [data, activity] = await Promise.all([catalog.get(), catalog.activity()]);
    res.set('Cache-Control', 'no-store').json({ ...discoveryStatus(data), ...activity });
}

router.get('/imports/lobby', route(publishingLobby));
router.post('/imports/sync', route(async (req, res) => {
    await req.app.locals.eventCatalog.refresh('manual');
    await publishingLobby(req, res);
}));

router.get('/discovery', route(async (req, res) => {
    const payload = await buildKenyaDiscovery(req.app.locals.eventCatalog);
    res.set('Cache-Control', 'no-store').json(payload);
}));

router.post('/discovery/scan', route(async (req, res) => {
    await Promise.allSettled([
        req.app.locals.eventCatalog.refresh('manual'),
        require('../services/travelCatalog').sync('manual')
    ]);
    const payload = await buildKenyaDiscovery(req.app.locals.eventCatalog);
    res.set('Cache-Control', 'no-store').json(payload);
}));

router.get('/socket-token', (req, res) => {
    res.set('Cache-Control', 'no-store').json({
        token: createSocketToken(req.organizerId || 'admin'),
        expiresInSeconds: 43200
    });
});

router.get('/deposits/recent', route(async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ data: getRecentDeposits(25) });
}));

router.get('/deposits/stream', (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, recent: getRecentDeposits(5) })}\n\n`);

    const onDeposit = (entry) => {
        res.write(`event: deposit_initiated\ndata: ${JSON.stringify(entry)}\n\n`);
    };
    const onDepositEvent = (envelope) => {
        res.write(`event: deposit_event\ndata: ${JSON.stringify(envelope)}\n\n`);
    };
    depositBus.on('deposit', onDeposit);
    depositBus.on('deposit_event', onDepositEvent);
    const keepalive = setInterval(() => {
        res.write(': keepalive\n\n');
    }, 20000);
    req.on('close', () => {
        clearInterval(keepalive);
        depositBus.off('deposit', onDeposit);
        depositBus.off('deposit_event', onDepositEvent);
    });
});

module.exports = router;
