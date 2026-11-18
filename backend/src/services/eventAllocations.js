const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const { isConnected } = require('../config/db');
const { isRemovedVenue } = require('./eventVisibility');

function tierKey(eventId, id) {
    return 'source-' + createHash('sha256').update(eventId + '\0' + id).digest('hex').slice(0, 32);
}

function validTier(tier) {
    return typeof tier?.id === 'string' && /^[\w-]{1,80}$/.test(tier.id) &&
        typeof tier.title === 'string' && tier.title.trim() && tier.title.length <= 80 &&
        Number.isSafeInteger(tier.priceKes) && tier.priceKes >= 1 && tier.priceKes <= 1000000 &&
        Number.isSafeInteger(tier.capacity) && tier.capacity >= 0 && tier.capacity <= 100000 &&
        /^Gate [A-D]$/.test(tier.gate);
}

async function fetchAllocationFeed(fetchPage) {
    const endpoint = process.env.EVENT_ALLOCATION_FEED_URL;
    const token = process.env.EVENT_ALLOCATION_FEED_TOKEN;
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || !token) {
        throw new Error('The ticket allocation feed requires an HTTPS URL and bearer token.');
    }
    const response = await fetchPage(url, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error('Allocation feed HTTP ' + response.status);
    const feed = await response.json();
    const now = Date.now();
    const expiry = Date.parse(feed?.validUntil);
    if (!Array.isArray(feed?.events) || feed.events.length > 1000 ||
        !(expiry > now && expiry <= now + 3600000)) throw new Error('Invalid ticket allocation snapshot.');
    return { feed, now, expiry };
}

async function confirmImportedTiers(keys, fetchPage = fetch) {
    const imported = new Set(keys.filter(key => /^source-[a-f0-9]{32}$/.test(key)));
    const confirmed = new Map();
    if (!imported.size) return confirmed;
    let snapshot;
    try {
        snapshot = await fetchAllocationFeed(fetchPage);
    } catch {
        throw Object.assign(new Error('The supplier could not confirm these ticket prices. Try again shortly.'), { status: 503 });
    }
    const seen = new Set();
    for (const event of snapshot.feed.events) {
        if (typeof event?.eventId !== 'string' || !Array.isArray(event.tiers) || event.tiers.length > 20) continue;
        const open = Date.parse(event.salesOpen) <= snapshot.now && snapshot.now < Date.parse(event.salesClose);
        for (const tier of event.tiers) {
            if (typeof tier?.id !== 'string') continue;
            const key = tierKey(event.eventId, tier.id);
            if (!imported.has(key)) continue;
            if (seen.has(key) || !open || !validTier(tier) || !tier.capacity) confirmed.delete(key);
            else confirmed.set(key, { priceKes: tier.priceKes, capacity: tier.capacity,
                validUntil: Math.min(snapshot.expiry, Date.parse(event.salesClose)) });
            seen.add(key);
        }
    }
    if (confirmed.size !== imported.size) {
        throw Object.assign(new Error('Some supplier tickets are no longer on sale. Refresh and select tickets again.'), { status: 409 });
    }
    return confirmed;
}

async function syncAllocations(listings, fetchPage = fetch) {
    if (!process.env.EVENT_ALLOCATION_FEED_URL && !process.env.EVENT_ALLOCATION_FEED_TOKEN) return 'unconfigured';
    if (!isConnected()) return 'database-offline';
    const { feed, now, expiry } = await fetchAllocationFeed(fetchPage);

    const byId = new Map(listings.filter(event => !isRemovedVenue(event) && Date.parse(event.startsAt) > now)
        .map(event => [event.id, event]));
    const imported = new Map();
    for (const allocation of feed.events) {
        const event = byId.get(allocation?.eventId);
        if (!event) continue;
        const salesOpen = Date.parse(allocation.salesOpen);
        const salesClose = Date.parse(allocation.salesClose);
        if (imported.has(event.id) || !(salesOpen < salesClose && salesClose <= Date.parse(event.startsAt)) ||
            !Array.isArray(allocation.tiers) || !allocation.tiers.length || allocation.tiers.length > 20) {
            throw new Error('Invalid event allocation.');
        }
        const id = event.id;
        const tierKeys = new Set();
        const tiers = allocation.tiers.map(tier => {
            if (!validTier(tier) || tierKeys.has(tier.id)) throw new Error('Invalid ticket tier allocation.');
            tierKeys.add(tier.id);
            return {
                tierKey: tierKey(id, tier.id), title: tier.title.trim(), eventId: id, eventTitle: event.title,
                priceKes: tier.priceKes, priceUsd: Math.round(tier.priceKes / 125 * 100) / 100,
                published: true, remainingAllocation: tier.capacity, designatedGate: tier.gate, features: []
            };
        });
        imported.set(id, {
            id, source: event.source, title: event.title, venue: event.venue || event.city || 'Kenya',
            description: typeof allocation.description === 'string' && allocation.description.trim()
                ? allocation.description.trim().slice(0, 4000)
                : event.description || [event.title, event.locationFull || event.venue || event.city].filter(Boolean).join(' · '),
            image: event.imageUrl || null, startsAt: event.startsAt, tiers,
            salesOpen: new Date(salesOpen).toISOString(), salesClose: new Date(salesClose).toISOString(),
            allocationExpiresAt: new Date(expiry).toISOString()
        });
    }
    const events = mongoose.connection.db.collection('commerce_events');
    await mongoose.connection.transaction(async session => {
        await events.updateMany({ allocationExpiresAt: { $gt: new Date(now).toISOString() }, _id: { $nin: [...imported.keys()] } },
            { $set: { allocationExpiresAt: new Date(now).toISOString() } }, { session });
        for (const [id, event] of imported) {
            await events.updateOne({ _id: id }, { $set: event, $setOnInsert: { status: 'published' } }, { upsert: true, session });
        }
    });
    return 'live';
}

module.exports = { syncAllocations, confirmImportedTiers };
