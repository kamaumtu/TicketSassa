const { createHash } = require('node:crypto');
const { isConnected } = require('../../config/db');
const travelCatalog = require('../travelCatalog');
const {
    DiscoveredEvent,
    EventSource,
    FlightListing,
    HolidayPackage,
    AdminSetting,
    DiscoveryJob,
    PriceHistory,
    AdminNotification
} = require('../../models/automation');
const {
    KENYA_47_COUNTIES,
    EVENT_CATEGORIES,
    HOLIDAY_DESTINATIONS,
    detectCounty,
    classifyEventCategory,
    resolveEventImage
} = require('./kenyaCounties');
const { emitToAdmins } = require('./socketHub');

const DEFAULT_SOURCES = [
    { name: 'SoldOut Africa Kenya', type: 'event', adapter: 'soldoutafrica', url: 'https://soldoutafrica.com/events', enabled: true },
    { name: 'Quicket Kenya API', type: 'event', adapter: 'quicket', url: 'https://api.quicket.co.za/api/events', enabled: true },
    { name: 'Tickets.dev Kenya Discovery', type: 'event', adapter: 'ticketsdev', url: 'https://api.tickets.dev/v1/events', enabled: true },
    { name: 'TKT Kenya Partner API', type: 'event', adapter: 'tkt', url: process.env.TKT_API_BASE_URL || 'https://api.tkt.co.ke/v1', enabled: Boolean(process.env.TKT_API_KEY) },
    { name: 'eGotickets East Africa API', type: 'event', adapter: 'egotickets', url: process.env.EGOTICKETS_BASE_URL || 'https://api.egotickets.com/v1', enabled: Boolean(process.env.EGOTICKETS_API_KEY) },
    { name: 'Live Flight Offers Feed', type: 'flight', adapter: 'travel_flight_feed', url: process.env.FLIGHT_OFFERS_URL || '', enabled: Boolean(process.env.FLIGHT_OFFERS_URL) },
    { name: 'Live Holiday Offers Feed', type: 'holiday', adapter: 'travel_holiday_feed', url: process.env.HOLIDAY_OFFERS_URL || '', enabled: Boolean(process.env.HOLIDAY_OFFERS_URL) }
];

let schedulerTimers = [];
let eventCatalogRef = null;
let runningJobs = new Set();

async function ensureDefaults() {
    if (!isConnected()) return null;
    let settings = await AdminSetting.findById('global');
    if (!settings) {
        settings = await AdminSetting.create({
            _id: 'global',
            discoveryEnabled: true,
            schedules: { eventsHours: 6, flightsHours: 3, holidaysHours: 12 },
            enabledCounties: [...KENYA_47_COUNTIES],
            enabledCategories: [...EVENT_CATEGORIES],
            flightDestinations: ['NBO', 'WIL', 'MBA', 'KIS', 'EDL', 'MYD', 'UKA'],
            holidayDestinations: [...HOLIDAY_DESTINATIONS]
        });
    }
    for (const src of DEFAULT_SOURCES) {
        await EventSource.updateOne({ name: src.name }, { $setOnInsert: src }, { upsert: true });
    }
    return settings;
}

function makeDedupeKey(name, startsAt, county) {
    const day = new Date(startsAt).toISOString().slice(0, 10);
    const norm = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return createHash('sha1').update(`${norm}|${day}|${county}`).digest('hex');
}

async function estimateComparablePrice(category, county) {
    // Calculate estimated price from comparable verified events in the same category/county
    const comparable = await DiscoveredEvent.find({
        category,
        confirmedPriceKes: { $gt: 0 }
    }).select('confirmedPriceKes county').limit(30).lean();
    const sameCounty = comparable.filter(c => c.county === county);
    const pool = sameCounty.length >= 2 ? sameCounty : comparable;
    if (pool.length) {
        const avg = pool.reduce((sum, item) => sum + item.confirmedPriceKes, 0) / pool.length;
        return Math.max(500, Math.round(avg / 100) * 100);
    }
    const categoryBenchmarks = {
        'Concerts & Music Festivals': 2000,
        'Football & Sporting Events': 1000,
        'University & Campus Events': 500,
        'Conferences & Exhibitions': 3500,
        'Comedy Shows': 1500,
        'Cultural Festivals': 1000,
        'Church Events': 500,
        'Nightlife & Entertainment': 1500,
        'Business Events': 3000,
        'Workshops & Seminars': 2500,
        'Family & Community Events': 1000
    };
    return categoryBenchmarks[category] || 1500;
}

async function runEventDiscovery(trigger = 'manual') {
    if (!isConnected() || runningJobs.has('events')) return null;
    runningJobs.add('events');
    const job = await DiscoveryJob.create({ kind: 'events', trigger, status: 'running', startedAt: new Date() });
    const errors = [];
    let foundCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    let expiredRemovedCount = 0;

    try {
        const settings = await ensureDefaults();
        if (eventCatalogRef) {
            await eventCatalogRef.refresh(trigger === 'scheduled' ? 'scheduled' : 'manual').catch(err => {
                errors.push('Catalog refresh: ' + err.message);
            });
        }
        const catalog = eventCatalogRef ? await eventCatalogRef.get() : { events: [], providerStatuses: {} };
        const enabledCounties = new Set(settings?.enabledCounties || KENYA_47_COUNTIES);
        const enabledCategories = new Set(settings?.enabledCategories || EVENT_CATEGORIES);
        const now = Date.now();

        for (const ev of (catalog.events || [])) {
            const startsAtMs = Date.parse(ev.startsAt);
            if (!Number.isFinite(startsAtMs) || startsAtMs <= now) continue;
            const county = detectCounty([ev.city, ev.venue, ev.locationFull, ev.title].join(' '));
            const category = classifyEventCategory([ev.category, ev.title, ev.description, ev.venue].join(' '));
            if (enabledCounties.size && !enabledCounties.has(county)) continue;
            if (enabledCategories.size && !enabledCategories.has(category)) continue;

            foundCount++;
            const image = resolveEventImage(ev, category);
            const hasVerifiedTiers = Array.isArray(ev.tiers) && ev.tiers.length > 0;
            const hasAdvertisedOffers = Array.isArray(ev.price?.offers) && ev.price.offers.length > 0;
            let confirmedPriceKes = null;
            let estimatedPriceKes = null;
            let priceType = 'estimated';
            let ticketCategories = [];

            if (hasVerifiedTiers) {
                confirmedPriceKes = Math.min(...ev.tiers.map(t => Number(t.priceKes)).filter(n => n > 0));
                priceType = 'verified';
                ticketCategories = ev.tiers.map(t => ({
                    name: t.title, priceKes: Number(t.priceKes), priceType: 'verified', capacity: Number(t.remainingAllocation) || 0
                }));
            } else if (hasAdvertisedOffers) {
                confirmedPriceKes = Math.min(...ev.price.offers.map(o => Number(o.amount)).filter(n => n > 0));
                priceType = 'verified';
                ticketCategories = ev.price.offers.slice(0, 8).map((o, idx) => ({
                    name: o.title || (idx === 0 ? 'Regular' : `Tier ${idx + 1}`),
                    priceKes: Math.round(Number(o.amount)),
                    priceType: 'verified',
                    capacity: 0
                }));
            } else if (ev.startingPrice != null && Number(ev.startingPrice) > 0) {
                confirmedPriceKes = Math.round(Number(ev.startingPrice));
                priceType = 'verified';
                ticketCategories = [{ name: 'Regular', priceKes: confirmedPriceKes, priceType: 'verified', capacity: 0 }];
            } else {
                estimatedPriceKes = await estimateComparablePrice(category, county);
                priceType = 'estimated';
                ticketCategories = [
                    { name: 'Early Bird', priceKes: Math.max(500, Math.round(estimatedPriceKes * 0.8 / 50) * 50), priceType: 'estimated', capacity: 0 },
                    { name: 'Regular', priceKes: estimatedPriceKes, priceType: 'estimated', capacity: 0 },
                    { name: 'VIP', priceKes: Math.round(estimatedPriceKes * 2 / 100) * 100, priceType: 'estimated', capacity: 0 }
                ];
            }

            const dedupeKey = makeDedupeKey(ev.title, startsAtMs, county);
            const existing = await DiscoveredEvent.findOne({ $or: [{ externalId: ev.id }, { dedupeKey }] });
            const authorizedToSell = Boolean(ev.checkout && hasVerifiedTiers);
            const payload = {
                externalId: existing?.externalId || ev.id,
                dedupeKey,
                name: ev.title,
                description: ev.description || '',
                category,
                startsAt: new Date(startsAtMs),
                county,
                town: ev.city || county,
                venue: ev.venue || ev.locationFull || county,
                organizer: ev.host || ev.source || 'Event Organizer',
                originalUrl: ev.sourceUrl || '',
                ticketPurchaseUrl: ev.sourceUrl || '',
                ticketCategories,
                confirmedPriceKes,
                estimatedPriceKes,
                priceType,
                image,
                discoverySource: ev.source || 'Ticketsasa',
                authorizedToSell,
                availabilityStatus: authorizedToSell ? 'available' : (ev.sourceUrl ? 'external_booking' : 'pending_verification'),
                lastVerifiedAt: new Date(),
                expired: false
            };

            if (existing) {
                await DiscoveredEvent.updateOne({ _id: existing._id }, { $set: payload });
                updatedCount++;
            } else {
                await DiscoveredEvent.create({
                    ...payload,
                    approvalStatus: authorizedToSell ? 'approved' : 'pending'
                });
                createdCount++;
            }

            const priceToTrack = confirmedPriceKes ?? estimatedPriceKes;
            if (priceToTrack) {
                await PriceHistory.create({
                    entityType: 'event',
                    entityId: payload.externalId,
                    category,
                    priceKes: priceToTrack,
                    currency: 'KES',
                    priceType,
                    recordedAt: new Date()
                }).catch(() => {});
            }
        }

        // Update EventSource statuses
        for (const [adapter, status] of Object.entries(catalog.providerStatuses || {})) {
            await EventSource.updateOne(
                { adapter },
                { $set: { lastRunAt: new Date(), lastStatus: status === 'live' ? 'live' : (status === 'unconfigured' ? 'unconfigured' : 'stale') } }
            ).catch(() => {});
        }

        // Mark expired listings
        const expiredRes = await DiscoveredEvent.updateMany(
            { startsAt: { $lte: new Date() }, expired: false },
            { $set: { expired: true } }
        );
        expiredRemovedCount = expiredRes.modifiedCount || 0;

        job.status = 'completed';
        job.foundCount = foundCount;
        job.createdCount = createdCount;
        job.updatedCount = updatedCount;
        job.expiredRemovedCount = expiredRemovedCount;
        job.errors = errors;
        job.finishedAt = new Date();
        await job.save();

        emitToAdmins('discovery:updated', { kind: 'events', job: job.toObject() });
        return job.toObject();
    } catch (error) {
        job.status = 'failed';
        job.errors = [...errors, error.message];
        job.finishedAt = new Date();
        await job.save().catch(() => {});
        return job.toObject();
    } finally {
        runningJobs.delete('events');
    }
}

async function runTravelDiscovery(kind = 'flights', trigger = 'manual') {
    if (!isConnected() || runningJobs.has(kind)) return null;
    runningJobs.add(kind);
    const job = await DiscoveryJob.create({ kind, trigger, status: 'running', startedAt: new Date() });
    let foundCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    const errors = [];

    try {
        await travelCatalog.sync(trigger).catch(err => errors.push(err.message));
        const travelKind = kind === 'flights' ? 'flight' : 'holiday';
        const offers = await travelCatalog.offers(travelKind, false);
        foundCount = offers.length;

        for (const offer of offers) {
            if (travelKind === 'flight') {
                const res = await FlightListing.updateOne(
                    { externalId: offer.id },
                    {
                        $set: {
                            externalId: offer.id,
                            airline: offer.supplier || 'Airline Partner',
                            flightNumber: offer.supplierId || offer.id,
                            originCode: offer.origin || 'NBO',
                            destinationCode: offer.destination || 'MBA',
                            departureTime: new Date(offer.startsAt),
                            arrivalTime: new Date(offer.endsAt),
                            priceKes: offer.priceKes,
                            currency: 'KES',
                            priceType: 'verified',
                            source: offer.supplier || 'Live Flight Feed',
                            dataMode: 'live',
                            lastVerifiedAt: new Date()
                        },
                        $setOnInsert: { approvalStatus: 'approved' }
                    },
                    { upsert: true }
                );
                if (res.upsertedCount) createdCount++; else updatedCount++;
            } else {
                const res = await HolidayPackage.updateOne(
                    { externalId: offer.id },
                    {
                        $set: {
                            externalId: offer.id,
                            title: offer.title,
                            destination: offer.destination || 'Kenya',
                            pricePerPerson: offer.priceKes,
                            currency: 'KES',
                            priceKes: offer.priceKes,
                            priceType: 'verified',
                            availability: offer.available > 0 ? 'available' : 'sold_out',
                            provider: offer.supplier || 'Live Holiday Feed',
                            lastVerifiedAt: new Date()
                        },
                        $setOnInsert: { approvalStatus: 'approved' }
                    },
                    { upsert: true }
                );
                if (res.upsertedCount) createdCount++; else updatedCount++;
            }
        }

        const adapter = travelKind === 'flight' ? 'travel_flight_feed' : 'travel_holiday_feed';
        const cfg = travelCatalog.config(travelKind);
        await EventSource.updateOne(
            { adapter },
            { $set: { lastRunAt: new Date(), lastStatus: cfg.url ? 'live' : 'unconfigured', itemCount: foundCount } }
        ).catch(() => {});

        job.status = 'completed';
        job.foundCount = foundCount;
        job.createdCount = createdCount;
        job.updatedCount = updatedCount;
        job.errors = errors;
        job.finishedAt = new Date();
        await job.save();
        emitToAdmins('discovery:updated', { kind, job: job.toObject() });
        return job.toObject();
    } catch (error) {
        job.status = 'failed';
        job.errors = [...errors, error.message];
        job.finishedAt = new Date();
        await job.save().catch(() => {});
        return job.toObject();
    } finally {
        runningJobs.delete(kind);
    }
}

async function rescheduleJobs() {
    for (const timer of schedulerTimers) clearInterval(timer);
    schedulerTimers = [];
    const settings = await ensureDefaults();
    if (!settings || !settings.discoveryEnabled) return;

    const evMs = Math.max(1, settings.schedules?.eventsHours || 6) * 3600000;
    const flMs = Math.max(1, settings.schedules?.flightsHours || 3) * 3600000;
    const hoMs = Math.max(1, settings.schedules?.holidaysHours || 12) * 3600000;

    schedulerTimers.push(
        setInterval(() => { void runEventDiscovery('scheduled'); }, evMs).unref(),
        setInterval(() => { void runTravelDiscovery('flights', 'scheduled'); }, flMs).unref(),
        setInterval(() => { void runTravelDiscovery('holidays', 'scheduled'); }, hoMs).unref()
    );
}

function startAutomationEngine(eventCatalog) {
    eventCatalogRef = eventCatalog;
    setTimeout(async () => {
        if (!isConnected()) return;
        await ensureDefaults().catch(() => {});
        await rescheduleJobs().catch(() => {});
        const existingCount = await DiscoveredEvent.countDocuments().catch(() => 0);
        if (existingCount === 0) {
            void runEventDiscovery('scheduled');
        }
    }, 8000).unref();
}

module.exports = {
    ensureDefaults,
    runEventDiscovery,
    runTravelDiscovery,
    rescheduleJobs,
    startAutomationEngine
};
