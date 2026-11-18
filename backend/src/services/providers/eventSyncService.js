const { collection } = require('../commerceDb');
const { dedupeKey } = require('./baseProvider');
const { refreshAdvertisedPrices } = require('../advertisedPrices');
const tktProvider = require('./tktEvents');
const egoticketsProvider = require('./egoticketsEvents');
const { ENDPOINT: QUICKET_ENDPOINT, fetchQuicketEvents } = require('../quicketEvents');
const { ENDPOINT: TICKETS_DEV_ENDPOINT, fetchTicketsDevEvents } = require('../ticketsDevEvents');

const quicketProvider = {
    id: 'quicket',
    label: 'Quicket Kenya',
    endpointKey: QUICKET_ENDPOINT,
    isEnabled: (env = process.env) => String(env.QUICKET_ENABLED || '').toLowerCase() === 'true' && Boolean(env.QUICKET_API_KEY?.trim()),
    fetchEvents: ({ env = process.env, fetchPage = fetch, now = Date.now() }) => {
        const eventIds = (env.QUICKET_EVENT_IDS || '').split(',').map(id => id.trim()).filter(Boolean).slice(0, 20);
        return fetchQuicketEvents({ key: env.QUICKET_API_KEY?.trim(), eventIds, fetchPage, now });
    }
};

const ticketsDevProvider = {
    id: 'ticketsdev',
    label: 'Tickets.dev',
    endpointKey: TICKETS_DEV_ENDPOINT,
    isEnabled: (env = process.env) => Boolean(env.TICKETS_DEV_KEY?.trim()),
    fetchEvents: ({ env = process.env, fetchPage = fetch }) => {
        const queries = (env.TICKETS_DEV_QUERIES || 'Nairobi')
            .split(',').map(q => q.trim()).filter(Boolean).slice(0, 5);
        return fetchTicketsDevEvents({ key: env.TICKETS_DEV_KEY?.trim(), queries, fetchPage });
    }
};

const defaultProviders = [
  tktProvider,
  egoticketsProvider,
  quicketProvider,
  ticketsDevProvider
];

async function syncSingleProvider(provider, { env = process.env, fetchPage = fetch, now = Date.now() } = {}) {
    if (!provider.isEnabled(env)) {
        return { id: provider.id, status: 'unconfigured', events: [], cancelledIds: [] };
    }
    try {
        const previousDoc = await collection('event_catalogs').findOne({ _id: provider.endpointKey }).catch(() => null);
        const previousEvents = Array.isArray(previousDoc?.events) ? previousDoc.events : [];
        const incoming = await provider.fetchEvents({ env, fetchPage, now });
        await refreshAdvertisedPrices(incoming, fetchPage, now, previousEvents);

        const incomingIds = new Set(incoming.map(ev => ev.id));
        const activeEvents = [];
        const cancelledIds = [];

        for (const ev of incoming) {
            if (ev.status === 'cancelled') {
                cancelledIds.push(ev.id);
            } else {
                activeEvents.push(ev);
            }
        }
        // Detect previously synced future events that vanished from a full provider feed as cancelled
        for (const prev of previousEvents) {
            if (Date.parse(prev.startsAt) > now && !incomingIds.has(prev.id)) {
                cancelledIds.push(prev.id);
            }
        }

        await collection('event_catalogs').replaceOne(
            { _id: provider.endpointKey },
            {
                provider: provider.id,
                events: activeEvents,
                cancelledIds: [...new Set(cancelledIds)],
                updatedAt: new Date(now).toISOString(),
                stale: false
            },
            { upsert: true }
        );
        return {
            id: provider.id,
            status: 'live',
            importedCount: activeEvents.length,
            cancelledCount: cancelledIds.length,
            events: activeEvents,
            cancelledIds
        };
    } catch (error) {
        const fallbackDoc = await collection('event_catalogs').findOne({ _id: provider.endpointKey }).catch(() => null);
        const fallbackEvents = Array.isArray(fallbackDoc?.events) ? fallbackDoc.events : [];
        await collection('event_catalogs').updateOne(
            { _id: provider.endpointKey },
            { $set: { stale: true, lastError: error.message } }
        ).catch(() => {});
        console.warn(`${provider.label} sync failed:`, error.message);
        return { id: provider.id, status: 'stale', error: error.message, events: fallbackEvents, cancelledIds: [] };
    }
}

function mergeDeduplicatedEvents(eventGroups = [], cancelledIdSet = new Set()) {
    const byId = new Map();
    const bySignature = new Map();
    for (const group of eventGroups) {
        for (const event of group || []) {
            if (!event || event.status === 'cancelled' || cancelledIdSet.has(event.id)) continue;
            const sig = dedupeKey(event);
            const existingById = byId.get(event.id);
            if (existingById) {
                // Automatic update: refresh poster, description, venue, and authorized tier prices
                byId.set(event.id, {
                    ...existingById,
                    ...event,
                    imageUrl: event.imageUrl || existingById.imageUrl,
                    description: event.description || existingById.description,
                    tiers: event.tiers?.length ? event.tiers : existingById.tiers
                });
                continue;
            }
            if (sig && bySignature.has(sig)) {
                // Duplicate event detected across providers: keep higher-priority source, enrich missing fields
                const primaryId = bySignature.get(sig);
                const primary = byId.get(primaryId);
                if (primary) {
                    const preferred = !primary.checkout && event.checkout ? event : primary;
                    const secondary = preferred === event ? primary : event;
                    const price = preferred.price ?? secondary.price;
                    byId.delete(primaryId);
                    bySignature.set(sig, preferred.id);
                    byId.set(preferred.id, {
                        ...preferred,
                        imageUrl: preferred.imageUrl || secondary.imageUrl,
                        description: preferred.description || secondary.description,
                        price,
                        startingPrice: preferred.startingPrice ?? price?.amount
                    });
                }
                continue;
            }
            byId.set(event.id, event);
            if (sig) bySignature.set(sig, event.id);
        }
    }
    return [...byId.values()];
}

module.exports = {
    defaultProviders,
    syncSingleProvider,
    mergeDeduplicatedEvents
};
