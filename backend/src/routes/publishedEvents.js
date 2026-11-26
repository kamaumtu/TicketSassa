const { isRemovedVenue } = require('../services/eventVisibility');
const express = require('express');
const { createHash, randomUUID, timingSafeEqual } = require('node:crypto');
const mongoose = require('mongoose');
const { organizerIdentity } = require('../services/organizerAccess');
const { collection } = require('../services/commerceDb');
const router = express.Router();
const { isConnected } = require('../config/db');
const { route } = require('../services/http');
const { ticketsasaEvents } = require('../config/ticketsasaEvents');
const { buildAutoEventTiers } = require('../services/eventAllocations');

function toPublishedEvent(ev) {
    const tiers = buildAutoEventTiers(ev);
    const startingPrice = tiers.length
        ? Math.min(...tiers.map(t => t.priceKes))
        : (ev.startingPrice ?? ev.price?.amount ?? 1000);
    return {
        ...ev,
        id: ev.id,
        title: ev.title,
        venue: ev.locationFull || ev.venue || ev.city || 'Kenya',
        description: ev.description || [ev.title, ev.locationFull || ev.venue || ev.city].filter(Boolean).join(' · '),
        salesOpen: ev.salesOpen && Date.parse(ev.salesOpen) <= Date.now() ? ev.salesOpen : '2026-01-01T00:00:00.000Z',
        salesClose: ev.startsAt,
        startsAt: ev.startsAt,
        formattedDate: ev.formattedDate,
        startAtLabel: ev.startAtLabel,
        image: ev.image || ev.imageUrl || null,
        imageUrl: ev.imageUrl || ev.image || null,
        remoteImageUrl: ev.remoteImageUrl || ev.imageUrl || ev.image || null,
        category: ev.category || 'Featured Event',
        host: ev.host || ev.source || 'Ticketsasa Official Organizer',
        startingPrice,
        isFree: Boolean(ev.isFree),
        status: ev.status || 'published',
        discoveryOnly: false,
        checkout: tiers.length > 0,
        tiers
    };
}

async function events() {
    const [dbEvents, catalogData] = await Promise.all([
        collection('commerce_events').find({}, { projection: { _id: 0 }, maxTimeMS: 6000 }).sort({ startsAt: 1 }).toArray().catch(() => []),
        Promise.resolve().then(() => require('./eventRoutes').catalog?.get()).catch(() => null)
    ]);
    const byId = new Map();
    for (const ev of ticketsasaEvents) {
        byId.set(ev.id, toPublishedEvent(ev));
    }
    for (const ev of (catalogData?.events || [])) {
        if (ev?.id) byId.set(ev.id, toPublishedEvent({ ...byId.get(ev.id), ...ev }));
    }
    for (const ev of dbEvents) {
        if (ev?.id) {
            const existing = byId.get(ev.id);
            byId.set(ev.id, toPublishedEvent({
                ...existing,
                ...ev,
                tiers: ev.tiers?.length ? ev.tiers : existing?.tiers
            }));
        }
    }
    return [...byId.values()]
        .filter(event => !isRemovedVenue(event))
        .sort((a, b) => String(a.startsAt || '').localeCompare(String(b.startsAt || '')));
}

function visible(event) {
    return !event.status || event.status === 'published';
}

function onSale(event, now = Date.now()) {
    return !event.discoveryOnly && visible(event) && Date.parse(event.startsAt) > now && withinSalesWindow(event, now) &&
        Array.isArray(event.tiers) && event.tiers.some(tier => tier.remainingAllocation > 0);
}

function withinSalesWindow(event, now) {
    const open = event.salesOpen ? Date.parse(event.salesOpen) : 0;
    const close = event.salesClose ? Date.parse(event.salesClose) : Date.parse(event.startsAt);
    return (!Number.isFinite(open) || open <= now) && (!Number.isFinite(close) || now < close);
}

router.get('/', route(async (req, res) => {
    if (req.query.fresh === '1') {
        try { require('./eventRoutes').catalog?.invalidateCache?.(); } catch {}
    }
    const now = Date.now();
    res.set('Cache-Control', 'no-cache').json({ data: (await events()).filter(event => visible(event) && Date.parse(event.startsAt) > now)
        .map(event => ({ ...event, onSale: onSale(event) })) });
}));

async function publishEvent(req, res) {
    const authorization = req.get('Authorization') || '';
    const secret = process.env.ORGANIZER_KEY;
    const expected = Buffer.from('Bearer ' + secret);
    const supplied = Buffer.from(authorization);
    const legacy = !process.env.ORGANIZER_ACCOUNTS && secret &&
        expected.length === supplied.length && timingSafeEqual(expected, supplied);
    const actor = req.organizerId || (req.get('X-Admin-Action') === 'dashboard'
        ? organizerIdentity(authorization) : null);
    if (!legacy && !actor) return res.status(403).json({ message: 'Organizer authorization required.' });
    if (!isConnected()) return res.status(503).json({ message: 'Publishing is temporarily unavailable because the database is offline.' });
    const { title, venue, description, startsAt, image, quickTicket, requestId } = req.body ?? {};
    let { salesOpen, salesClose, tiers } = req.body ?? {};
    const now = Date.now();
    if (quickTicket !== undefined) {
        if (!/^[a-f0-9-]{36}$/i.test(requestId ?? '') || !quickTicket || tiers !== undefined) {
            return res.status(400).json({ message: 'Enter one ticket price, capacity and entrance for quick publishing.' });
        }
        salesOpen = new Date(now).toISOString();
        salesClose = startsAt;
        tiers = [{ ...quickTicket, title: 'General Admission' }];
    }
    if (isRemovedVenue({ venue })) return res.status(400).json({ message: 'This venue is unavailable.' });
    const validText = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
    const dates = [salesOpen, salesClose, startsAt].map(value => Date.parse(value));
    if (!validText(title, 120) || !validText(venue, 160) || !validText(description, 4000)) {
        return res.status(400).json({ message: 'Enter an event name, venue and description.' });
    }
    if (!(dates[0] < dates[1] && dates[1] <= dates[2] && dates[2] > now)) {
        return res.status(400).json({ message: 'Set a future event start. Sales must open before closing, and close by the event start.' });
    }
    if (!Array.isArray(tiers) || !tiers.length || tiers.length > 20 ||
        tiers.some(tier => !validText(tier?.title, 80) || !Number.isSafeInteger(tier.priceKes) ||
            tier.priceKes < 1 || tier.priceKes > 1000000 || !Number.isSafeInteger(tier.capacity) ||
            tier.capacity < 1 || tier.capacity > 100000 || !/^Gate [A-D]$/.test(tier.gate))) {
        return res.status(400).json({ message: 'Each ticket tier needs a name, a whole-KES price, a capacity and a gate.' });
    }
    if (image && (typeof image !== 'string' || image.length > 1400000 ||
        !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))) {
        return res.status(400).json({ message: 'Choose a JPEG, PNG or WebP image under 1 MB.' });
    }
    const id = quickTicket
        ? createHash('sha256').update(JSON.stringify([actor || 'shared-admin', requestId])).digest('hex')
        : randomUUID();
    const event = {
        id, title: title.trim(), venue: venue.trim(), description: description.trim(), status: 'published',
        salesOpen: new Date(dates[0]).toISOString(), salesClose: new Date(dates[1]).toISOString(),
        startsAt: new Date(dates[2]).toISOString(), image: image || null,
        tiers: tiers.map((tier, index) => ({
            tierKey: id + '-' + (index + 1), title: tier.title.trim(), eventId: id, eventTitle: title.trim(),
            priceKes: tier.priceKes, priceUsd: Math.round(tier.priceKes / 125 * 100) / 100,
            published: true, remainingAllocation: tier.capacity, designatedGate: tier.gate, features: []
        }))
    };
    const db = mongoose.connection.db;
    const eventCollection = db.collection('commerce_events');
    try {
        await mongoose.connection.transaction(async session => {
            await eventCollection.insertOne({ ...event, _id: id }, { session });
            await db.collection('commerce_audit').insertOne({
                action: 'publish', target: id, timestamp: new Date(now).toISOString(), actor: actor || 'shared-admin'
            }, { session });
        });
    } catch (error) {
        if (!quickTicket || error.code !== 11000) throw error;
        const existing = await eventCollection.findOne({ _id: id }, { projection: { _id: 0 } });
        if (!existing) throw error;
        return res.json({ data: existing });
    }
    try { req.app?.locals?.eventCatalog?.invalidateCache?.(); } catch {}
    try { require('./eventRoutes').catalog?.invalidateCache?.(); } catch {}
    res.status(201).json({ data: event });
}

router.post('/', express.json({ limit: '2mb' }), route(publishEvent));

async function publishedTiers() {
    return (await events()).filter(event => onSale(event)).flatMap(event => event.tiers.filter(tier => tier.remainingAllocation > 0));
}

async function reservedTiers() {
    return (await events()).flatMap(event => event.tiers);
}

module.exports = { router, publishEvent, publishedTiers, reservedTiers, events, visible, onSale };
