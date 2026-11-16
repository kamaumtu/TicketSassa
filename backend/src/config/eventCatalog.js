const { isRemovedVenue } = require('../services/eventVisibility');
const { collection } = require('../services/commerceDb');
const { syncAllocations } = require('../services/eventAllocations');
const { ticketsasaEvents, ticketsasaSliders } = require('./ticketsasaEvents');
const { defaultProviders, syncSingleProvider, mergeDeduplicatedEvents } = require('../services/providers/eventSyncService');

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

function createEventCatalog({ fetchPage = fetch, providers = defaultProviders } = {}) {
    let pending;

    function refresh() {
        pending ??= Promise.all([
            ...providers.map(provider => syncSingleProvider(provider, { fetchPage })),
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
                    await collection('event_catalogs').updateOne({ _id: SOURCE }, { $set: { stale: true } }).catch(() => {});
                    console.warn('SoldOut Africa refresh failed:', error.message);
                }
            })()
        ]).finally(() => { pending = null; });
        return pending;
    }

    return {
        start() {
            setInterval(refresh, REFRESH_MS).unref();
            return refresh();
        },
        async get() {
            const snapshot = await collection('event_catalogs').findOne({ _id: SOURCE });
            const providerSnapshots = await Promise.all(
                providers.map(async provider => {
                    const enabled = provider.isEnabled(process.env);
                    const doc = enabled ? await collection('event_catalogs').findOne({ _id: provider.endpointKey }) : null;
                    return { provider, enabled, doc };
                })
            );

            const now = new Date().toISOString();
            const allocated = snapshot ? await collection('commerce_events').find({
                source: 'SoldOut Africa', startsAt: { $gt: now }, allocationExpiresAt: { $gt: now },
                salesOpen: { $lte: now }, salesClose: { $gt: now },
                $or: [{ status: { $exists: false } }, { status: 'published' }]
            }, { projection: { _id: 1, tiers: 1 } }).toArray() : [];
            const sales = new Map(allocated.map(event => [event._id, event.tiers]));
            const remoteEvents = (snapshot?.events ?? []).filter(event => event.startsAt > now).map(event => ({
                ...event,
                checkout: sales.has(event.id),
                price: sales.has(event.id) ? { amount: Math.min(...sales.get(event.id).map(tier => tier.priceKes)), currency: 'KES' } : event.price,
                tiers: sales.get(event.id) ?? []
            }));

            function eventWithTickets(event) {
                const tiers = Array.isArray(event.tiers) ? event.tiers : [];
                const onSale = tiers.length > 0 && event.status !== 'cancelled';
                return { ...event, tiers, checkout: onSale, onSale };
            }

            const cancelledSet = new Set();
            const providerEvents = [];
            const providerStatuses = {};
            const updatedAts = [snapshot?.updatedAt];

            for (const { provider, enabled, doc } of providerSnapshots) {
                providerStatuses[provider.id] = !enabled
                    ? 'unconfigured'
                    : !doc ? 'unavailable' : doc.stale ? 'stale' : 'live';
                if (doc?.updatedAt) updatedAts.push(doc.updatedAt);
                for (const cid of (doc?.cancelledIds || [])) cancelledSet.add(cid);
                const future = (doc?.events || []).filter(ev => ev.startsAt > now).map(eventWithTickets);
                providerEvents.push(future);
            }

            const mergedEvents = mergeDeduplicatedEvents(
                [ticketsasaEvents.map(eventWithTickets), remoteEvents.map(eventWithTickets), ...providerEvents],
                cancelledSet
            ).filter(event => !isRemovedVenue(event));

            return {
                events: mergedEvents,
                sliders: ticketsasaSliders.filter(slider => !isRemovedVenue(slider)),
                updatedAt: updatedAts.filter(Boolean).sort().at(-1) ?? null,
                providerStatuses,
                tktStatus: providerStatuses.tkt || 'unconfigured',
                egoticketsStatus: providerStatuses.egotickets || 'unconfigured',
                ticketsDevStatus: providerStatuses.ticketsdev || 'unconfigured',
                quicketStatus: providerStatuses.quicket || 'unconfigured',
                status: 'live'
            };
        },
        refresh
    };
}

module.exports = { createEventCatalog, parseListings };
