const { isRemovedVenue } = require('../services/eventVisibility');
const express = require('express');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const { organizerIdentity } = require('../services/organizerAccess');
const { collection, transaction } = require('../services/commerceDb');
const router = express.Router();
const { isConnected } = require('../config/db');
const { route } = require('../services/http');
const { ticketsasaEvents } = require('../config/ticketsasaEvents');

async function events() {
    const dbEvents = isConnected()
        ? await collection('commerce_events').find({}, { projection: { _id: 0 } }).sort({ startsAt: 1 }).toArray()
        : [];
    const defaultPublished = ticketsasaEvents.map(ev => ({
        id: ev.id,
        title: ev.title,
        venue: ev.locationFull || ev.venue,
        description: ev.description,
        salesOpen: '2026-01-01T00:00:00.000Z',
        salesClose: '2027-12-31T23:59:59.000Z',
        startsAt: ev.startsAt,
        formattedDate: ev.formattedDate,
        startAtLabel: ev.startAtLabel,
        image: ev.imageUrl,
        imageUrl: ev.imageUrl,
        remoteImageUrl: ev.remoteImageUrl,
        category: ev.category,
        host: ev.host,
        startingPrice: ev.startingPrice,
        isFree: ev.isFree,
        status: 'published',
        discoveryOnly: false,
        tiers: (ev.tiers || []).map(t => ({ ...t, published: true }))
    }));
    const byId = new Map(defaultPublished.map(e => [e.id, e]));
    for (const ev of dbEvents) byId.set(ev.id, ev);
    return [...byId.values()].filter(event => !isRemovedVenue(event));
}

function visible(event) {
    return !event.status || event.status === 'published';
}

function onSale(event, now = Date.now()) {
    return !event.discoveryOnly && visible(event) && withinSalesWindow(event, now) &&
        (!event.source || Date.parse(event.allocationExpiresAt) > now);
}

function withinSalesWindow(event, now) {
    return Date.parse(event.salesOpen) <= now && now < Date.parse(event.salesClose);
}

router.get('/', route(async (req, res) => {
    res.json({ data: (await events()).filter(event => visible(event) && Date.parse(event.startsAt) > Date.now())
        .map(event => ({ ...event, onSale: onSale(event) })) });
}));

router.post('/', express.json({ limit: '2mb' }), route(async (req, res) => {
    const authorization = req.get('Authorization') || '';
    const secret = process.env.ORGANIZER_KEY;
    const expected = Buffer.from('Bearer ' + secret);
    const supplied = Buffer.from(authorization);
    const legacy = !process.env.ORGANIZER_ACCOUNTS && secret &&
        expected.length === supplied.length && timingSafeEqual(expected, supplied);
    const actor = req.get('X-Admin-Action') === 'dashboard'
        ? organizerIdentity(authorization) : null;
    if (!legacy && !actor) return res.status(403).json({ message: 'Organizer authorization required.' });
    const { title, venue, description, startsAt, salesOpen, salesClose, tiers, image } = req.body;
    if (isRemovedVenue({ venue })) return res.status(400).json({ message: 'This venue is unavailable.' });
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
    await transaction(async session => {
        await collection('commerce_events').insertOne({ ...event, _id: id }, { session });
        await collection('commerce_audit').insertOne({
            action: 'publish', target: id, timestamp: new Date().toISOString(), actor: actor || 'shared-admin'
        }, { session });
    });
    res.status(201).json({ data: event });
}));

async function publishedTiers() {
    return (await events()).filter(event => onSale(event)).flatMap(event => event.tiers);
}

async function reservedTiers() {
    return (await events()).flatMap(event => event.tiers);
}

module.exports = { router, publishedTiers, reservedTiers, events, visible, onSale };
