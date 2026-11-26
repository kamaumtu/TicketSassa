const { isRemovedVenue } = require('../services/eventVisibility');
const { randomUUID } = require('node:crypto');
const { isConnected } = require('./db');
const { collection } = require('../services/commerceDb');
const { syncAllocations, buildAutoEventTiers } = require('../services/eventAllocations');
const { ticketsasaEvents, ticketsasaSliders } = require('./ticketsasaEvents');
const { defaultProviders, syncSingleProvider, mergeDeduplicatedEvents } = require('../services/providers/eventSyncService');
const { onSale } = require('../routes/publishedEvents');
const { advertisedOffers, priceFromOffers, refreshAdvertisedPrices } = require('../services/advertisedPrices');

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
            const price = priceFromOffers(advertisedOffers(event.offers, now), url.href, now);
            const images = Array.isArray(event.image) ? event.image : [event.image];
            const image = images.map(secureUrl).find(Boolean);
            listings.set(url.pathname, {
                id: 'soldoutafrica:' + url.pathname,
                title,
                description: typeof event.description === 'string'
                    ? event.description.replace(/<[^>]*>/g, '').trim().slice(0, 4000) : '',
                startsAt: new Date(startsAt).toISOString(),
                venue: event.location.name?.trim(),
                city: address.addressLocality?.trim(),
                price,
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
    let allocationStatus = 'pending';
    let activeRun = null;
    let nextRunAt = null;
    let cachedResult = null;
    let cachedAt = 0;

    function refresh(trigger = 'startup') {
        if (pending) return pending;
        const run = { id: randomUUID(), trigger, startedAt: new Date().toISOString(), stage: 'Reading event sources', sources: {} };
        activeRun = run;
        async function track(id, work) {
            run.sources[id] = { status: 'checking', count: 0, removed: 0 };
            const result = await work();
            run.sources[id] = { status: result.status, count: result.events?.length ?? 0, removed: result.cancelledIds?.length ?? 0,
                priced: result.events?.filter(event => event.price != null).length ?? 0 };
            return result;
        }
        pending = Promise.all([
            ...providers.map(provider => track(provider.id, () => syncSingleProvider(provider, { fetchPage }))),
            track('soldoutafrica', async () => {
                try {
                    const fetchOpts = {
                        headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; TicketsasaCatalog/1.0)' },
                        signal: AbortSignal.timeout(30000)
                    };
                    let response;
                    try {
                        response = await fetchPage(SOURCE, fetchOpts);
                    } catch {
                        response = await fetchPage(SOURCE, { ...fetchOpts, signal: AbortSignal.timeout(30000) });
                    }
                    if (!response.ok) throw new Error('SoldOut Africa HTTP ' + response.status);
                    const events = parseListings(await response.text());
                    const previous = await collection('event_catalogs').findOne({ _id: SOURCE });
                    await refreshAdvertisedPrices(events, fetchPage, Date.now(), previous?.events);
                    await collection('event_catalogs').replaceOne({ _id: SOURCE }, {
                        events, updatedAt: new Date().toISOString(), stale: false
                    }, { upsert: true });
                    return { status: 'live', events };
                } catch (error) {
                    const fallbackDoc = await collection('event_catalogs').findOne({ _id: SOURCE }).catch(() => null);
                    let fallbackEvents = Array.isArray(fallbackDoc?.events) ? fallbackDoc.events : [];
                    if (!fallbackEvents.length) {
                        try {
                            const { readFileSync } = require('node:fs');
                            const { resolve } = require('node:path');
                            const diskSnap = JSON.parse(readFileSync(resolve(__dirname, '../../data/event-catalog.json'), 'utf8'));
                            if (Array.isArray(diskSnap?.events)) {
                                fallbackEvents = diskSnap.events;
                                await collection('event_catalogs').replaceOne({ _id: SOURCE }, {
                                    events: fallbackEvents, updatedAt: diskSnap.updatedAt || new Date().toISOString(), stale: true
                                }, { upsert: true }).catch(() => {});
                            }
                        } catch {}
                    } else {
                        await collection('event_catalogs').updateOne({ _id: SOURCE }, { $set: { stale: true } }).catch(() => {});
                    }
                    console.warn('SoldOut Africa refresh failed:', error.message);
                    return { status: fallbackEvents.length ? 'stale' : 'unavailable', events: fallbackEvents };
                }
            })
        ]).then(async results => {
            run.stage = 'Checking supplier inventory';
            try {
                allocationStatus = await syncAllocations(results.flatMap(result => result?.events ?? []), fetchPage);
            } catch (error) {
                allocationStatus = 'unavailable';
                console.warn('Ticket allocation sync failed:', error.message);
            }
        }).finally(async () => {
            run.finishedAt = new Date().toISOString();
            run.allocationStatus = allocationStatus;
            run.stage = 'Finished';
            if (isConnected()) {
                await collection('event_sync_runs').insertOne({ ...run, expireAt: new Date(Date.now() + 7 * 86400000) })
                    .catch(() => console.warn('Could not save event sync history.'));
            }
            activeRun = null;
            pending = null;
            cachedResult = null;
            cachedAt = 0;
        });
        return pending;
    }

    return {
        start() {
            nextRunAt = new Date(Date.now() + REFRESH_MS).toISOString();
            setInterval(() => {
                nextRunAt = new Date(Date.now() + REFRESH_MS).toISOString();
                void refresh('scheduled');
            }, REFRESH_MS).unref();
            return refresh();
        },
        async activity() {
            const history = isConnected() ? await collection('event_sync_runs').find({}, { projection: { _id: 0, expireAt: 0 } })
                .sort({ startedAt: -1 }).limit(20).toArray().catch(() => []) : [];
            return { activeRun, nextRunAt, history };
        },
        invalidateCache() {
            cachedResult = null;
            cachedAt = 0;
        },
        async get() {
            if (cachedResult && Date.now() - cachedAt < 15000) {
                return cachedResult;
            }
            const enabledProviders = providers.filter(provider => provider.isEnabled(process.env));
            const catalogKeys = [SOURCE, ...enabledProviders.map(p => p.endpointKey)];
            const now = new Date().toISOString();
            const [catalogDocs, commerceEvents, discoveredDocs] = await Promise.all([
                collection('event_catalogs').find({ _id: { $in: catalogKeys } }).toArray().catch(() => []),
                collection('commerce_events').find({
                    startsAt: { $gt: now }
                }).toArray().catch(() => []),
                isConnected()
                    ? require('../models/automation').DiscoveredEvent.find({
                        approvalStatus: { $ne: 'rejected' },
                        expired: false,
                        startsAt: { $gt: new Date(now) }
                    }).lean().catch(() => [])
                    : Promise.resolve([])
            ]);
            const allocated = commerceEvents.filter(ev => ev.allocationExpiresAt !== undefined);
            const organizerEvents = commerceEvents
                .filter(ev => ev.allocationExpiresAt === undefined && (!ev.status || ev.status === 'published'))
                .map(ev => {
                    const tiers = Array.isArray(ev.tiers) && ev.tiers.length ? ev.tiers : buildAutoEventTiers(ev);
                    const startingPrice = tiers.length
                        ? Math.min(...tiers.map(t => Number(t.priceKes) || 0))
                        : (ev.startingPrice ?? 1000);
                    const eventOnSale = onSale({ ...ev, tiers });
                    const img = ev.image || ev.imageUrl || '/assets/real/DzLV4G9UWo-1790859483.jpg';
                    return {
                        id: ev.id,
                        title: ev.title,
                        description: ev.description || `${ev.title} at ${ev.venue || 'Kenya'}`,
                        startsAt: ev.startsAt,
                        eventDate: ev.startsAt,
                        venue: ev.venue || 'Kenya',
                        city: ev.city || ev.venue || 'Kenya',
                        locationFull: ev.locationFull || ev.venue || 'Kenya',
                        category: ev.category || 'Featured Event',
                        host: ev.host || 'Ticketsasa Official Organizer',
                        imageUrl: img,
                        image: ev.image || null,
                        remoteImageUrl: img,
                        source: 'Organizer Published',
                        isOrganizerEvent: true,
                        status: ev.status || 'published',
                        salesOpen: ev.salesOpen,
                        salesClose: ev.salesClose,
                        startingPrice,
                        price: { amount: startingPrice, currency: 'KES', sourceUrl: null },
                        checkout: eventOnSale,
                        onSale: eventOnSale,
                        ticketStatus: eventOnSale ? 'on-sale' : 'scheduled',
                        tiers
                    };
                });
            const docsById = new Map(catalogDocs.map(doc => [doc._id, doc]));
            const snapshot = docsById.get(SOURCE) ?? null;
            const providerSnapshots = providers.map(provider => {
                const enabled = provider.isEnabled(process.env);
                return { provider, enabled, doc: enabled ? (docsById.get(provider.endpointKey) ?? null) : null };
            });
            const allocations = new Map(allocated.map(event => [event.id, event]));
            function importedEvent(event) {
                const allocation = allocations.get(event.id);
                const isExplicitlyPaused = Boolean(allocation?.status && allocation.status !== 'published');
                const tiers = isExplicitlyPaused
                    ? []
                    : buildAutoEventTiers(event, allocation && onSale(allocation) ? allocation : null);
                const advertisedPrice = event.price;
                const startingPrice = tiers.length
                    ? Math.min(...tiers.map(tier => tier.priceKes))
                    : (advertisedPrice?.amount ?? event.startingPrice ?? 1000);
                const ticketStatus = isExplicitlyPaused ? 'paused' : 'on-sale';
                return {
                    ...event,
                    description: allocation?.description || event.description ||
                        [event.title, event.locationFull || event.venue || event.city].filter(Boolean).join(' · '),
                    checkout: tiers.length > 0,
                    onSale: tiers.length > 0,
                    tiers,
                    startingPrice,
                    price: {
                        ...(advertisedPrice || {}),
                        amount: startingPrice,
                        currency: 'KES',
                        sourceUrl: advertisedPrice?.sourceUrl || event.sourceUrl || null
                    },
                    ticketStatus
                };
            }
            const remoteEvents = (snapshot?.events ?? []).filter(event => event.startsAt > now).map(importedEvent);

            const cancelledSet = new Set();
            const providerEvents = [];
            const providerStatuses = {};
            providerStatuses.soldoutafrica = !snapshot ? 'unavailable' : snapshot.stale ? 'stale' : 'live';
            const updatedAts = [snapshot?.updatedAt];

            for (const { provider, enabled, doc } of providerSnapshots) {
                providerStatuses[provider.id] = !enabled
                    ? 'unconfigured'
                    : !doc ? 'unavailable' : doc.stale ? 'stale' : 'live';
                if (doc?.updatedAt) updatedAts.push(doc.updatedAt);
                for (const cid of (doc?.cancelledIds || [])) cancelledSet.add(cid);
                const future = (doc?.events || []).filter(ev => ev.startsAt > now).map(importedEvent);
                providerEvents.push(future);
            }

            const discoveredEvents = (discoveredDocs || []).map(doc => importedEvent({
                id: doc.externalId || String(doc._id),
                title: doc.name,
                description: doc.description || `${doc.name} in ${doc.venue || doc.county || 'Kenya'}`,
                startsAt: new Date(doc.startsAt).toISOString(),
                venue: doc.venue || doc.town || doc.county || 'Kenya',
                city: doc.town || doc.county || 'Nairobi',
                locationFull: [doc.venue, doc.town || doc.county, 'Kenya'].filter(Boolean).join(', '),
                category: doc.category || 'Featured Event',
                host: doc.organizer || doc.discoverySource || 'Ticketsasa Official Organizer',
                imageUrl: doc.image?.url || '/assets/real/DzLV4G9UWo-1790859483.jpg',
                remoteImageUrl: doc.image?.url || null,
                sourceUrl: doc.ticketPurchaseUrl || doc.originalUrl || null,
                source: doc.discoverySource || 'Ticketsasa Discovery',
                startingPrice: doc.confirmedPriceKes ?? doc.estimatedPriceKes ?? 1000,
                ticketCategories: doc.ticketCategories || []
            }));

            const mergedEvents = mergeDeduplicatedEvents(
                [
                    organizerEvents,
                    ticketsasaEvents
                        .filter(event => Date.parse(event.startsAt) > Date.now())
                        .map(event => {
                            const tiers = buildAutoEventTiers(event);
                            const startingPrice = tiers.length ? Math.min(...tiers.map(t => t.priceKes)) : (event.startingPrice ?? 1000);
                            return { ...event, tiers, startingPrice, checkout: true, onSale: true, ticketStatus: 'on-sale' };
                        }),
                    remoteEvents,
                    ...providerEvents,
                    discoveredEvents
                ],
                cancelledSet
            ).filter(event => !isRemovedVenue(event));

            const result = {
                events: mergedEvents,
                sliders: ticketsasaSliders.filter(slider => !isRemovedVenue(slider)),
                updatedAt: updatedAts.filter(Boolean).sort().at(-1) ?? null,
                providerStatuses,
                allocationStatus,
                tktStatus: providerStatuses.tkt || 'unconfigured',
                egoticketsStatus: providerStatuses.egotickets || 'unconfigured',
                ticketsDevStatus: providerStatuses.ticketsdev || 'unconfigured',
                quicketStatus: providerStatuses.quicket || 'unconfigured',
                status: 'live'
            };
            cachedResult = result;
            cachedAt = Date.now();
            return result;
        },
        refresh
    };
}

module.exports = { createEventCatalog, parseListings };
