const { createHash } = require('node:crypto');
const mongoose = require('mongoose');
const { isConnected } = require('../config/db');
const { isRemovedVenue } = require('./eventVisibility');

function tierKey(eventId, id) {
    return 'source-' + createHash('sha256').update(eventId + '\0' + id).digest('hex').slice(0, 32);
}

function autoTierKey(eventId, index, title) {
    return 'auto-' + createHash('sha256').update(String(eventId) + '\0' + String(index) + '\0' + String(title || '')).digest('hex').slice(0, 24);
}

function buildAutoEventTiers(event = {}, allocation = null) {
    const eventId = String(event.id || event.externalId || 'event');
    const eventTitle = String(event.title || event.name || 'Ticketsasa Event').trim();
    const gates = ['Gate A', 'Gate B', 'Gate C', 'Gate D'];

    // 1. Prefer explicit live allocation tiers if present and in stock
    if (allocation && Array.isArray(allocation.tiers)) {
        const allocTiers = allocation.tiers.filter(tier => (Number(tier?.remainingAllocation) || 0) > 0);
        if (allocTiers.length > 0) {
            return allocTiers.map((tier, idx) => {
                const priceKes = Math.max(1, Math.round(Number(tier.priceKes) || 1000));
                return {
                    ...tier,
                    tierKey: tier.tierKey || autoTierKey(eventId, idx, tier.title),
                    title: String(tier.title || 'General Admission').trim(),
                    eventId,
                    eventTitle,
                    priceKes,
                    priceUsd: Math.max(1, Math.round((priceKes / 125) * 100) / 100),
                    published: true,
                    isActive: true,
                    totalAllocation: Math.max(100, Number(tier.totalAllocation || tier.remainingAllocation) || 1000),
                    remainingAllocation: Math.max(1, Number(tier.remainingAllocation) || 1000),
                    designatedGate: /^Gate [A-D]$/.test(tier.designatedGate) ? tier.designatedGate : gates[idx % gates.length],
                    features: Array.isArray(tier.features) ? tier.features : []
                };
            });
        }
    }

    // 2. Normalize existing tiers on the event object if present
    if (Array.isArray(event.tiers) && event.tiers.length > 0) {
        return event.tiers.map((tier, idx) => {
            const rawPrice = Number(tier.priceKes ?? tier.displayPriceKes ?? event.startingPrice ?? event.price?.amount ?? 1000);
            const priceKes = Math.max(1, Math.round(Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : 1000));
            const rem = Number(tier.remainingAllocation ?? tier.totalAllocation ?? tier.capacity ?? 1000);
            const remainingAllocation = Number.isFinite(rem) && rem > 0 ? Math.round(rem) : 1000;
            const title = String(tier.title || tier.name || (idx === 0 ? 'General Admission' : `Tier ${idx + 1}`)).trim();
            return {
                ...tier,
                tierKey: tier.tierKey || autoTierKey(eventId, idx, title),
                title,
                eventId,
                eventTitle,
                priceKes,
                priceUsd: Math.max(1, Math.round((priceKes / 125) * 100) / 100),
                published: true,
                isActive: true,
                totalAllocation: Math.max(remainingAllocation, Number(tier.totalAllocation) || 1000),
                remainingAllocation,
                designatedGate: /^Gate [A-D]$/.test(tier.designatedGate) ? tier.designatedGate : gates[idx % gates.length],
                features: Array.isArray(tier.features) ? tier.features : []
            };
        });
    }

    // 3. Build tiers from advertised offers (SoldOut Africa, Quicket, Tickets.dev, JSON-LD)
    const rawOffers = Array.isArray(event.price?.offers) && event.price.offers.length > 0
        ? event.price.offers
        : (Array.isArray(event.ticketCategories) && event.ticketCategories.length > 0
            ? event.ticketCategories.map(c => ({ title: c.name || c.title, amount: c.priceKes ?? c.amount, capacity: c.capacity }))
            : []);

    const validOffers = rawOffers
        .map((offer, idx) => ({
            title: String(offer?.title || offer?.name || (idx === 0 ? 'Regular / General Admission' : `VIP Tier ${idx + 1}`)).trim(),
            amount: Math.round(Number(offer?.amount ?? offer?.priceKes) || 0),
            capacity: Math.max(100, Number(offer?.capacity) || 1000)
        }))
        .filter(o => Number.isFinite(o.amount) && o.amount >= 1 && o.amount <= 1000000);

    if (validOffers.length > 0) {
        const tiers = validOffers.map((offer, idx) => ({
            tierKey: autoTierKey(eventId, idx, offer.title),
            title: offer.title,
            eventId,
            eventTitle,
            priceKes: offer.amount,
            priceUsd: Math.max(1, Math.round((offer.amount / 125) * 100) / 100),
            published: true,
            isActive: true,
            totalAllocation: offer.capacity,
            remainingAllocation: offer.capacity,
            designatedGate: gates[idx % gates.length],
            features: [`Official e-Ticket for ${eventTitle}`, 'Instant QR Pass & M-Pesa confirmation']
        }));
        if (tiers.length === 1) {
            const vipPrice = Math.min(1000000, Math.max(tiers[0].priceKes + 1000, Math.round(tiers[0].priceKes * 2)));
            const vipTitle = 'VIP Experience Pass';
            tiers.push({
                tierKey: autoTierKey(eventId, 1, vipTitle),
                title: vipTitle,
                eventId,
                eventTitle,
                priceKes: vipPrice,
                priceUsd: Math.max(1, Math.round((vipPrice / 125) * 100) / 100),
                published: true,
                isActive: true,
                totalAllocation: 500,
                remainingAllocation: 500,
                designatedGate: 'Gate B',
                features: [`VIP Priority Access for ${eventTitle}`, 'Instant QR Pass & M-Pesa confirmation']
            });
        }
        return tiers;
    }

    // 4. Fallback default tiers for any synced event with a starting price or no listed price yet
    const baseCandidate = Number(
        event.startingPrice ??
        event.price?.amount ??
        event.confirmedPriceKes ??
        event.estimatedPriceKes ??
        1000
    );
    const basePrice = Math.max(1, Math.min(1000000, Math.round(Number.isFinite(baseCandidate) && baseCandidate > 0 ? baseCandidate : 1000)));
    const vipPrice = Math.min(1000000, Math.max(basePrice + 1000, Math.round(basePrice * 2)));

    return [
        {
            tierKey: autoTierKey(eventId, 0, 'General Admission'),
            title: 'General Admission',
            eventId,
            eventTitle,
            priceKes: basePrice,
            priceUsd: Math.max(1, Math.round((basePrice / 125) * 100) / 100),
            published: true,
            isActive: true,
            totalAllocation: 1000,
            remainingAllocation: 1000,
            designatedGate: 'Gate A',
            features: [`Official e-Ticket for ${eventTitle}`, 'Instant QR Pass & M-Pesa confirmation']
        },
        {
            tierKey: autoTierKey(eventId, 1, 'VIP Pass'),
            title: 'VIP Pass',
            eventId,
            eventTitle,
            priceKes: vipPrice,
            priceUsd: Math.max(1, Math.round((vipPrice / 125) * 100) / 100),
            published: true,
            isActive: true,
            totalAllocation: 500,
            remainingAllocation: 500,
            designatedGate: 'Gate B',
            features: [`VIP Priority Access for ${eventTitle}`, 'Instant QR Pass & M-Pesa confirmation']
        }
    ];
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
    if (!imported.size || !process.env.EVENT_ALLOCATION_FEED_URL || !process.env.EVENT_ALLOCATION_FEED_TOKEN) return confirmed;
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

module.exports = { syncAllocations, confirmImportedTiers, buildAutoEventTiers, autoTierKey };
