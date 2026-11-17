const { isRemovedVenue } = require('../services/eventVisibility');
const { randomUUID } = require('node:crypto');
const { isConnected } = require('./db');
const { collection } = require('../services/commerceDb');
const { syncAllocations } = require('../services/eventAllocations');
const { ticketsasaEvents, ticketsasaSliders } = require('./ticketsasaEvents');
const { defaultProviders, syncSingleProvider, mergeDeduplicatedEvents } = require('../services/providers/eventSyncService');
const { onSale } = require('../routes/publishedEvents');

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
                description: typeof event.description === 'string'
                    ? event.description.replace(/<[^>]*>/g, '').trim().slice(0, 4000) : '',
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
    let allocationStatus = 'pending';
    let activeRun = null;
    let nextRunAt = null;

    function refresh(trigger = 'startup') {
        if (pending) return pending;
        const run = { id: randomUUID(), trigger, startedAt: new Date().toISOString(), stage: 'Reading event sources', sources: {} };
        activeRun = run;
        async function track(id, work) {
            run.sources[id] = { status: 'checking', count: 0, removed: 0 };
            const result = await work();
            run.sources[id] = { status: result.status, count: result.events?.length ?? 0, removed: result.cancelledIds?.length ?? 0 };
            return result;
        }
        pending = Promise.all([
            ...providers.map(provider => track(provider.id, () => syncSingleProvider(provider, { fetchPage }))),
            track('soldoutafrica', async () => {
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
                    return { status: 'live', events };
                } catch (error) {
                    await collection('event_catalogs').updateOne({ _id: SOURCE }, { $set: { stale: true } }).catch(() => {});
                    console.warn('SoldOut Africa refresh failed:', error.message);
                    return { status: 'unavailable' };
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
                .sort({ startedAt: -1 }).limit(20).toArray() : [];
            return { activeRun, nextRunAt, history };
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
            const allocated = await collection('commerce_events').find({
                allocationExpiresAt: { $exists: true }, startsAt: { $gt: now }
            }).toArray();
            const allocations = new Map(allocated.map(event => [event.id, event]));
            function importedEvent(event) {
                const allocation = allocations.get(event.id);
                const tiers = allocation && onSale(allocation)
                    ? allocation.tiers.filter(tier => tier.remainingAllocation > 0) : [];
                const startingPrice = tiers.length ? Math.min(...tiers.map(tier => tier.priceKes)) : event.price?.amount ?? null;
                let ticketStatus = 'on-sale';
                if (!allocation) ticketStatus = 'awaiting-allocation';
                else if (allocation.status && allocation.status !== 'published') ticketStatus = 'paused';
                else if (allocation.allocationExpiresAt <= now) ticketStatus = 'allocation-expired';
                else if (allocation.salesOpen > now) ticketStatus = 'scheduled';
                else if (allocation.salesClose <= now) ticketStatus = 'sales-closed';
                else if (!tiers.length) ticketStatus = 'no-allocation-left';
                return {
                    ...event, description: allocation?.description || event.description ||
                        [event.title, event.locationFull || event.venue || event.city].filter(Boolean).join(' · '),
                    checkout: tiers.length > 0, onSale: tiers.length > 0, tiers, startingPrice,
                    price: tiers.length ? { amount: startingPrice, currency: 'KES' } : event.price,
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

            const mergedEvents = mergeDeduplicatedEvents(
                [ticketsasaEvents.map(event => ({ ...event, checkout: Boolean(event.tiers?.length) })), remoteEvents, ...providerEvents],
                cancelledSet
            ).filter(event => !isRemovedVenue(event));

            return {
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
        },
        refresh
    };
}

module.exports = { createEventCatalog, parseListings };
