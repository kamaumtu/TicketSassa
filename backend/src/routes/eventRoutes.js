const express = require('express');
const router = express.Router();
const { events, visible, onSale } = require('./publishedEvents');

const { createEventCatalog } = require('../config/eventCatalog');
const { route } = require('../services/http');
const catalog = createEventCatalog();

router.catalog = catalog;
router.get('/kenya', route(async (req, res) => {
    if (req.query.fresh === '1') catalog.invalidateCache?.();
    res.set('Cache-Control', req.query.fresh === '1' ? 'no-store' : 'public, max-age=15, stale-while-revalidate=60')
        .json(await catalog.get());
}));

router.get('/quicket', route(async (req, res) => {
    const data = await catalog.get();
    const quicketEvents = data.events.filter(ev => ev.source === 'Quicket');
    res.set('Cache-Control', 'no-store').json({
        success: true,
        application: "ticketsasas's App",
        quicketStatus: data.quicketStatus,
        count: quicketEvents.length,
        events: quicketEvents
    });
}));

async function upcomingEvents() {
    const [catalogData, managed] = await Promise.all([catalog.get(), events()]);
    const entries = new Map(catalogData.events.map(event => [event.id,
        { ...event, eventDate: event.startsAt, bannerImageUrl: event.imageUrl }]));
    for (const event of managed) {
        if (event.source) continue;
        if (!visible(event) || Date.parse(event.startsAt) <= Date.now()) continue;
        entries.set(event.id, { ...entries.get(event.id), id: event.id, title: event.title,
            description: event.description, venue: event.venue, eventDate: event.startsAt,
            startsAt: event.startsAt, bannerImageUrl: event.image, checkout: onSale(event) });
    }
    return [...entries.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

router.get('/featured', route(async (req, res) => {
    const data = await upcomingEvents();
    res.json({ success: true, data: data.find(event => event.checkout) ?? data[0] ?? null });
}));
router.get('/', route(async (req, res) => {
    const data = await upcomingEvents();
    res.json({ success: true, count: data.length, data });
}));

module.exports = router;
