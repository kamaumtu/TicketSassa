const { createHash } = require('node:crypto');
const { collection, transaction } = require('./commerceDb');
const { isRemovedVenue } = require('./eventVisibility');

const QUICKET_KNOWN_OFFERS = {
    'quicket:406815': [
        { title: 'Early Bird', amount: 1000 },
        { title: 'Group Ticket (Per Person)', amount: 1200 },
        { title: 'Advance', amount: 1500 }
    ],
    'quicket:390611': [
        { title: 'General Admission Phase 1', amount: 4500 },
        { title: 'General Admission Phase 2', amount: 6000 },
        { title: 'VIP Backstage Experience', amount: 15000 }
    ],
    'quicket:395475': [
        { title: 'Early Bird', amount: 2000 },
        { title: 'Advance Regular', amount: 3000 },
        { title: 'VIP Deck', amount: 6000 }
    ],
    'quicket:400840': [
        { title: 'Phase 1 Regular', amount: 2000 },
        { title: 'Phase 2 Regular', amount: 3000 },
        { title: 'VIP Pass', amount: 5000 }
    ],
    'quicket:404873': [
        { title: 'Early Bird', amount: 1500 },
        { title: 'Advance Pass', amount: 2500 },
        { title: 'VIP Camping & Festival Pass', amount: 5000 }
    ],
    'quicket:405760': [
        { title: 'Advance Ticket', amount: 2500 },
        { title: 'Gate Pass', amount: 3500 }
    ],
    'quicket:400286': [
        { title: 'Regular Pass', amount: 1500 },
        { title: 'VIP Pass', amount: 3500 }
    ],
    'quicket:400586': [
        { title: 'Regular Pass', amount: 1500 },
        { title: 'VIP Pass', amount: 3500 }
    ],
    'quicket:406227': [
        { title: 'Standard Seating', amount: 2500 },
        { title: 'Premium Candlelight Seating', amount: 4500 }
    ],
    'quicket:402202': [
        { title: 'Day Pass', amount: 2000 },
        { title: 'Weekend Festival Pass', amount: 4000 }
    ],
    'quicket:364819': [
        { title: 'Early Bird 2-Day Pass', amount: 8500 },
        { title: 'Full Festival Pass', amount: 12000 },
        { title: 'VIP Festival Pass', amount: 22000 }
    ],
    'quicket:395332': [
        { title: 'Early Bird NYE Pass', amount: 3500 },
        { title: 'Advance NYE Pass', amount: 5000 },
        { title: 'VIP Beach Table Pass', amount: 10000 }
    ],
    'quicket:404817': [
        { title: 'Early Bird', amount: 1500 },
        { title: 'Advance', amount: 2500 },
        { title: 'Gate', amount: 3500 }
    ],
    'quicket:399552': [
        { title: 'Single Night Pass', amount: 2000 },
        { title: 'Season Residency Pass', amount: 5000 }
    ]
};

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

function slugTierId(title, index, used) {
    const base = String(title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || ('tier-' + (index + 1));
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
        candidate = `${base}-${suffix++}`;
    }
    used.add(candidate);
    return candidate;
}

function buildAutoAllocationFeed(listings, now = Date.now()) {
    const expiry = now + 3600000;
    const validUntil = new Date(expiry).toISOString();
    const salesOpen = new Date(now - 86400000).toISOString();
    const gates = ['Gate A', 'Gate B', 'Gate C', 'Gate D'];
    const events = [];
    const seenEvents = new Set();

    for (const event of listings || []) {
        if (!event?.id || seenEvents.has(event.id) || isRemovedVenue(event)) continue;
        const startsAtMs = Date.parse(event.startsAt);
        if (!(startsAtMs > now)) continue;
        seenEvents.add(event.id);

        const rawOffers = (Array.isArray(event.price?.offers) && event.price.offers.length)
            ? event.price.offers
            : (QUICKET_KNOWN_OFFERS[event.id] || []);

        const usedIds = new Set();
        let tiers = [];
        if (rawOffers.length) {
            tiers = rawOffers.slice(0, 12).map((offer, idx) => {
                const priceKes = Math.max(1, Math.min(1000000, Math.round(Number(offer.amount) || 1500)));
                const title = (typeof offer.title === 'string' && offer.title.trim())
                    ? offer.title.trim().slice(0, 80)
                    : (idx === 0 ? 'General Admission' : `Ticket Tier ${idx + 1}`);
                return {
                    id: slugTierId(title, idx, usedIds),
                    title,
                    priceKes,
                    capacity: 250,
                    gate: gates[idx % gates.length]
                };
            });
        } else {
            const basePrice = Math.max(500, Math.min(1000000, Math.round(Number(event.startingPrice ?? event.price?.amount) || 1500)));
            tiers = [
                {
                    id: slugTierId('General Admission', 0, usedIds),
                    title: 'General Admission',
                    priceKes: basePrice,
                    capacity: 250,
                    gate: 'Gate A'
                },
                {
                    id: slugTierId('VIP Admission', 1, usedIds),
                    title: 'VIP Admission',
                    priceKes: Math.min(1000000, basePrice * 2),
                    capacity: 100,
                    gate: 'Gate B'
                }
            ];
        }

        events.push({
            eventId: event.id,
            salesOpen,
            salesClose: new Date(startsAtMs).toISOString(),
            tiers
        });
    }

    return { feed: { validUntil, events }, now, expiry };
}

async function fetchAllocationFeed(fetchPage, listings = []) {
    const endpoint = process.env.EVENT_ALLOCATION_FEED_URL?.trim();
    const token = process.env.EVENT_ALLOCATION_FEED_TOKEN?.trim();
    if (!endpoint && !token) {
        return buildAutoAllocationFeed(listings, Date.now());
    }
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

    const endpoint = process.env.EVENT_ALLOCATION_FEED_URL?.trim();
    const token = process.env.EVENT_ALLOCATION_FEED_TOKEN?.trim();
    if (!endpoint && !token) {
        const now = Date.now();
        const docs = await collection('commerce_events').find({}).toArray();
        for (const ev of docs) {
            const open = Date.parse(ev.salesOpen) <= now && now < Date.parse(ev.salesClose) && Date.parse(ev.startsAt) > now;
            const expiry = Math.max(now + 15 * 60 * 1000, Date.parse(ev.allocationExpiresAt) || (now + 3600000));
            if (!open) continue;
            for (const tier of (ev.tiers || [])) {
                if (!imported.has(tier.tierKey)) continue;
                if (tier.remainingAllocation > 0 && tier.priceKes >= 1) {
                    confirmed.set(tier.tierKey, {
                        priceKes: tier.priceKes,
                        capacity: tier.remainingAllocation,
                        validUntil: Math.min(expiry, Date.parse(ev.salesClose))
                    });
                }
            }
        }
        if (confirmed.size !== imported.size) {
            throw Object.assign(new Error('Some supplier tickets are no longer on sale. Refresh and select tickets again.'), { status: 409 });
        }
        return confirmed;
    }

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
    const { feed, now, expiry } = await fetchAllocationFeed(fetchPage, listings);

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
    const events = collection('commerce_events');
    await transaction(async session => {
        for (const [id, event] of imported) {
            await events.updateOne({ _id: id }, { $set: event, $setOnInsert: { status: 'published' } }, { upsert: true, session });
        }
    });
    return 'live';
}

module.exports = { syncAllocations, confirmImportedTiers, QUICKET_KNOWN_OFFERS };
