const { createHash } = require('node:crypto');
const { collection, transaction } = require('./commerceDb');

async function syncAllocations(listings, fetchPage = fetch) {
    const endpoint = process.env.EVENT_ALLOCATION_FEED_URL;
    const token = process.env.EVENT_ALLOCATION_FEED_TOKEN;
    if (!endpoint && !token) return;
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || !token) {
        throw new Error('The ticket allocation feed requires an HTTPS URL and bearer token.');
    }
    const response = await fetchPage(url, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('Allocation feed HTTP ' + response.status);
    const feed = await response.json();
    const now = Date.now();
    const expiry = Date.parse(feed.validUntil);
    if (!Array.isArray(feed.events) || feed.events.length > 1000 ||
        !(expiry > now && expiry <= now + 3600000)) throw new Error('Invalid ticket allocation snapshot.');

    const byId = new Map(listings.map(event => [event.id, event]));
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
            if (typeof tier?.id !== 'string' || !/^[\w-]{1,80}$/.test(tier.id) || tierKeys.has(tier.id) ||
                typeof tier.title !== 'string' || !tier.title.trim() || tier.title.length > 80 ||
                !Number.isSafeInteger(tier.priceKes) || tier.priceKes < 1 || tier.priceKes > 1000000 ||
                !Number.isSafeInteger(tier.capacity) || tier.capacity < 0 || tier.capacity > 100000 ||
                !/^Gate [A-D]$/.test(tier.gate)) throw new Error('Invalid ticket tier allocation.');
            tierKeys.add(tier.id);
            const hash = createHash('sha256').update(id + '\0' + tier.id).digest('hex').slice(0, 32);
            return {
                tierKey: 'source-' + hash, title: tier.title.trim(), eventId: id, eventTitle: event.title,
                priceKes: tier.priceKes, priceUsd: Math.round(tier.priceKes / 125 * 100) / 100,
                published: true, remainingAllocation: tier.capacity, designatedGate: tier.gate, features: []
            };
        });
        imported.set(id, {
            id, source: event.source, title: event.title, venue: event.venue || event.city || 'Kenya',
            description: '', image: event.imageUrl, startsAt: event.startsAt, tiers,
            salesOpen: new Date(salesOpen).toISOString(), salesClose: new Date(salesClose).toISOString(),
            allocationExpiresAt: new Date(expiry).toISOString()
        });
    }
    await transaction(async session => {
        const events = collection('commerce_events');
        await events.updateMany({ source: 'SoldOut Africa', _id: { $nin: [...imported.keys()] } },
            { $set: { allocationExpiresAt: new Date(now).toISOString() } }, { session });
        for (const [id, event] of imported) {
            await events.updateOne({ _id: id }, { $set: event }, { upsert: true, session });
        }
    });
}

module.exports = { syncAllocations };
