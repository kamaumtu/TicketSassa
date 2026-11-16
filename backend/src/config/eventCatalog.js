const { collection } = require('../services/commerceDb');
const { isConnected } = require('./db');
const { syncAllocations } = require('../services/eventAllocations');
const { ticketsasaEvents, ticketsasaSliders } = require('./ticketsasaEvents');
const { ENDPOINT: TICKETS_DEV, fetchTicketsDevEvents } = require('../services/ticketsDevEvents');
const { ENDPOINT: TICKETMASTER, fetchTicketmasterEvents } = require('../services/ticketmasterEvents');
const { ENDPOINT: QUICKET, fetchQuicketEvents } = require('../services/quicketEvents');

const SOURCE = 'https://soldoutafrica.com/events';
const REFRESH_MS = 15 * 60 * 1000;

function secureUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' ? url : null;
    } catch {
        return null;
    }
}

function parseListings(html, now = Date.now()) {
    const scripts = html.matchAll(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const [, content] of scripts) {
        let list;
        try {
            list = JSON.parse(content);
        } catch {
            continue;
        }
        if (list?.['@type'] !== 'ItemList' || !Array.isArray(list.itemListElement)) continue;
        const entries = list.itemListElement.map(entry => entry?.item);
        if (entries.length && !entries.some(entry => entry?.['@type'] === 'Event')) continue;
        const listings = new Map();
        for (const event of entries) {
            const url = secureUrl(event?.url);
            const address = event?.location?.address;
            const startsAt = Date.parse(event?.startDate);
            if (event?.['@type'] !== 'Event' || url?.origin !== new URL(SOURCE).origin ||
                address?.addressCountry !== 'KE' || !(startsAt > now) ||
                !['EventScheduled', 'EventRescheduled'].includes(event.eventStatus?.split('/').pop())) continue;

            const title = typeof event.name === 'string'
                ? event.name.replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\u200d\ufe0f\u20e3]/gu, '').trim()
                : '';
            if (!title) continue;
            const offers = Array.isArray(event.offers) ? event.offers : [event.offers];
            const prices = offers.filter(offer => offer?.priceCurrency === 'KES' &&
                offer.availability?.endsWith('/InStock') && /^(?:\d+)(?:\.\d+)?$/.test(String(offer.price)))
                .map(offer => Number(offer.price)).filter(Number.isFinite);
            const images = Array.isArray(event.image) ? event.image : [event.image];
            const image = images.map(secureUrl).find(Boolean);
            listings.set(url.pathname, {
                id: 'soldoutafrica:' + url.pathname,
                title,
                startsAt: new Date(startsAt).toISOString(),
                venue: event.location.name?.trim(),
                city: address.addressLocality?.trim(),
                price: prices.length ? { amount: Math.min(...prices), currency: 'KES' } : null,
                imageUrl: image?.href ?? null,
                sourceUrl: url.href,
                source: 'SoldOut Africa'
            });
        }
        return [...listings.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    throw new Error('SoldOut Africa event list missing from source response.');
}

function createEventCatalog({ fetchPage = fetch } = {}) {
    let pending;

    async function refreshDiscovery(endpoint, label, key, fetchEvents) {
        if (!key) return;
        try {
            const events = await fetchEvents({ key, fetchPage });
            await collection('event_catalogs').replaceOne({ _id: endpoint }, {
                events, updatedAt: new Date().toISOString(), stale: false
            }, { upsert: true });
        } catch (error) {
            await collection('event_catalogs').updateOne({ _id: endpoint }, { $set: { stale: true } }).catch(() => {});
            console.warn(label + ' discovery refresh failed:', error.message);
        }
    }

    function refresh() {
        if (!isConnected()) return Promise.resolve();
        const queries = (process.env.TICKETS_DEV_QUERIES || 'Nairobi,Talanta Sports City')
            .split(',').map(query => query.trim()).filter(Boolean).slice(0, 5);
        const eventIds = (process.env.QUICKET_EVENT_IDS || '').split(',').map(id => id.trim()).filter(Boolean).slice(0, 10);
        pending ??= Promise.all([
            refreshDiscovery(TICKETS_DEV, 'Tickets.dev', process.env.TICKETS_DEV_KEY?.trim(),
                options => fetchTicketsDevEvents({ ...options, queries })),
            refreshDiscovery(TICKETMASTER, 'Ticketmaster', process.env.TICKETMASTER_API_KEY?.trim(), fetchTicketmasterEvents),
            refreshDiscovery(QUICKET, 'Quicket', process.env.QUICKET_API_KEY?.trim(),
                options => fetchQuicketEvents({ ...options, eventIds })),
            (async () => {
            try {
                const response = await fetchPage(SOURCE, {
                    headers: { Accept: 'text/html' },
                    signal: AbortSignal.timeout(15000)
                });
                if (!response.ok) throw new Error('SoldOut Africa HTTP ' + response.status);
                const events = parseListings(await response.text());
                await collection('event_catalogs').replaceOne({ _id: SOURCE }, {
                    events, updatedAt: new Date().toISOString(), stale: false
                }, { upsert: true });
                try {
                    await syncAllocations(events, fetchPage);
                } catch (error) {
                    console.warn('Ticket allocation sync failed:', error.message);
                }
            } catch (error) {
                if (isConnected()) {
                    await collection('event_catalogs').updateOne({ _id: SOURCE }, { $set: { stale: true } }).catch(() => {});
                }
                console.warn('SoldOut Africa refresh failed:', error.message);
            }
        })()]).finally(() => { pending = null; });
        return pending;
    }

    return {
        start() {
            setInterval(refresh, REFRESH_MS).unref();
            return refresh();
        },
        async get() {
            const snapshot = isConnected() ? await collection('event_catalogs').findOne({ _id: SOURCE }) : null;
            const discovery = process.env.TICKETS_DEV_KEY?.trim() && isConnected()
                ? await collection('event_catalogs').findOne({ _id: TICKETS_DEV }) : null;
            const ticketmaster = process.env.TICKETMASTER_API_KEY?.trim() && isConnected()
                ? await collection('event_catalogs').findOne({ _id: TICKETMASTER }) : null;
            const quicket = process.env.QUICKET_API_KEY?.trim() && isConnected()
                ? await collection('event_catalogs').findOne({ _id: QUICKET }) : null;
            const now = new Date().toISOString();
            const allocated = snapshot ? await collection('commerce_events').find({
                source: 'SoldOut Africa', startsAt: { $gt: now }, allocationExpiresAt: { $gt: now },
                salesOpen: { $lte: now }, salesClose: { $gt: now },
                $or: [{ status: { $exists: false } }, { status: 'published' }]
            }, { projection: { _id: 1, tiers: 1 } }).toArray() : [];
            const sales = new Map(allocated.map(event => [event._id,
                Math.min(...event.tiers.map(tier => tier.priceKes))]));
            const remoteEvents = (snapshot?.events ?? []).filter(event => event.startsAt > now).map(event => ({
                ...event, checkout: sales.has(event.id),
                price: sales.has(event.id) ? { amount: sales.get(event.id), currency: 'KES' } : event.price
            }));
            function ensureEventTiers(ev) {
                const basePrice = Math.max(500, Math.round(Number(ev.startingPrice || ev.price?.amount || 1500)));
                const tiers = Array.isArray(ev.tiers) && ev.tiers.length ? ev.tiers : [
                    {
                        tierKey: `${ev.id}-regular`,
                        title: 'Regular Advance Ticket',
                        eventId: ev.id,
                        eventTitle: ev.title,
                        priceKes: basePrice,
                        priceUsd: Math.max(4, Math.round(basePrice / 125)),
                        remainingAllocation: 300,
                        designatedGate: 'Gate A',
                        published: true
                    },
                    {
                        tierKey: `${ev.id}-vip`,
                        title: 'VIP Pass',
                        eventId: ev.id,
                        eventTitle: ev.title,
                        priceKes: basePrice * 2,
                        priceUsd: Math.max(8, Math.round((basePrice * 2) / 125)),
                        remainingAllocation: 100,
                        designatedGate: 'Gate B',
                        published: true
                    }
                ];
                return { ...ev, checkout: true, onSale: true, startingPrice: ev.startingPrice || basePrice, tiers };
            }
            const mergedMap = new Map();
            for (const ev of ticketsasaEvents) {
                mergedMap.set(ev.id, ensureEventTiers(ev));
            }
            for (const ev of remoteEvents) {
                if (!mergedMap.has(ev.id)) mergedMap.set(ev.id, ensureEventTiers(ev));
            }
            for (const event of [...(discovery?.events ?? []), ...(ticketmaster?.events ?? []), ...(quicket?.events ?? [])]) {
                if (event.startsAt > now && !mergedMap.has(event.id)) mergedMap.set(event.id, ensureEventTiers(event));
            }
            return {
                events: [...mergedMap.values()],
                sliders: ticketsasaSliders,
                updatedAt: [snapshot?.updatedAt, discovery?.updatedAt, ticketmaster?.updatedAt, quicket?.updatedAt]
                    .filter(Boolean).sort().at(-1) ?? null,
                ticketsDevStatus: !process.env.TICKETS_DEV_KEY?.trim() ? 'unconfigured'
                    : !discovery ? 'unavailable' : discovery.stale ? 'stale' : 'live',
                ticketmasterStatus: !process.env.TICKETMASTER_API_KEY?.trim() ? 'unconfigured'
                    : !ticketmaster ? 'unavailable' : ticketmaster.stale ? 'stale' : 'live',
                quicketStatus: !process.env.QUICKET_API_KEY?.trim() ? 'unconfigured'
                    : !quicket ? 'unavailable' : quicket.stale ? 'stale' : 'live',
                status: 'live'
            };
        },
        refresh
    };
}

module.exports = { createEventCatalog, parseListings };
