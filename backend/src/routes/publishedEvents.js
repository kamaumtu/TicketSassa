const express = require('express');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const { commerceDb } = require('../services/commerceDb');
const router = express.Router();

function events() {
    return commerceDb().prepare('SELECT data FROM published_events ORDER BY starts_at').all()
        .map(row => JSON.parse(row.data));
}

function visible(event) {
    return !event.status || event.status === 'published';
}

function onSale(event, now = Date.now()) {
    return visible(event) && withinSalesWindow(event, now);
}

function withinSalesWindow(event, now) {
    return Date.parse(event.salesOpen) <= now && now < Date.parse(event.salesClose);
}

router.get('/', (req, res) => {
    res.json({ data: events().filter(event => visible(event) && Date.parse(event.startsAt) > Date.now())
        .map(event => ({ ...event, onSale: onSale(event) })) });
});

router.post('/', express.json({ limit: '2mb' }), (req, res) => {
    const secret = process.env.ORGANIZER_KEY;
    if (!secret) return res.status(503).json({ message: 'Organizer access is unconfigured.' });
    const expected = Buffer.from('Bearer ' + secret);
    const supplied = Buffer.from(req.get('Authorization') || '');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
        return res.status(403).json({ message: 'Organizer authorization required.' });
    }
    const { title, venue, description, startsAt, salesOpen, salesClose, tiers, image } = req.body;
    const validText = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
    const dates = [salesOpen, salesClose, startsAt].map(value => Date.parse(value));
    if (!validText(title, 120) || !validText(venue, 160) || !validText(description, 4000) ||
        !(dates[0] < dates[1] && dates[1] <= dates[2] && dates[2] > Date.now()) ||
        !Array.isArray(tiers) || !tiers.length || tiers.length > 20 ||
        tiers.some(tier => !validText(tier?.title, 80) || !Number.isSafeInteger(tier.priceKes) ||
            tier.priceKes < 1 || tier.priceKes > 1000000 || !Number.isSafeInteger(tier.capacity) ||
            tier.capacity < 1 || tier.capacity > 100000 || !/^Gate [A-D]$/.test(tier.gate))) {
        return res.status(400).json({ message: 'Check event details, sales dates, prices and capacities.' });
    }
    if (image && (typeof image !== 'string' || image.length > 1400000 ||
        !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))) {
        return res.status(400).json({ message: 'Choose a JPEG, PNG or WebP image under 1 MB.' });
    }
    const id = randomUUID();
    const event = {
        id, title: title.trim(), venue: venue.trim(), description: description.trim(),
        salesOpen: new Date(dates[0]).toISOString(), salesClose: new Date(dates[1]).toISOString(),
        startsAt: new Date(dates[2]).toISOString(), image: image || null,
        tiers: tiers.map((tier, index) => ({
            tierKey: id + '-' + (index + 1), title: tier.title.trim(), eventId: id, eventTitle: title.trim(),
            priceKes: tier.priceKes, priceUsd: Math.round(tier.priceKes / 125 * 100) / 100,
            published: true, remainingAllocation: tier.capacity, designatedGate: tier.gate, features: []
        }))
    };
    commerceDb().prepare('INSERT INTO published_events (id, starts_at, data) VALUES (?, ?, ?)')
        .run(id, dates[2], JSON.stringify(event));
    res.status(201).json({ data: event });
});

function publishedTiers() {
    return events().filter(event => onSale(event)).flatMap(event => event.tiers);
}

function reservedTiers() {
    return events().flatMap(event => event.tiers);
}

module.exports = { router, publishedTiers, reservedTiers };
