const { isConnected } = require('../../config/db');
const {
    AdminSetting,
    EventSource,
    DiscoveryJob,
    DiscoveredEvent,
    FlightListing,
    HolidayPackage
} = require('../../models/automation');
const {
    KENYA_47_COUNTIES,
    EVENT_CATEGORIES,
    HOLIDAY_DESTINATIONS,
    detectCounty,
    classifyEventCategory,
    resolveEventImage
} = require('../automation/kenyaCounties');
const { DEFAULT_PUBLIC_SOURCES, fetchRssItems } = require('./SearchConnector');
const { crawlPage } = require('./WebsiteCrawler');
const { extractEventsFromPage, extractEventsFromRss } = require('./EventExtractor');
const { extractFlightsFromPage } = require('./FlightExtractor');
const { extractHolidaysFromPage } = require('./HolidayExtractor');
const {
    writeLog,
    publishEvents,
    publishFlights,
    publishHolidays,
    unpublishExpiredListings
} = require('./AutoPublisher');
const { emitToAdmins } = require('../automation/socketHub');

const activeRuns = new Set();

async function ensureDiscoveryDefaults() {
    if (!isConnected()) return null;
    let settings = await AdminSetting.findById('global');
    if (!settings) {
        settings = await AdminSetting.create({
            _id: 'global',
            discoveryEnabled: true,
            discoveryPaused: false,
            schedules: {
                eventsHours: 6,
                flightsHours: 3,
                holidaysHours: 12,
                imageRefreshHours: 24,
                expirationCheckHours: 1
            },
            autoPublish: {
                events: true,
                flights: true,
                holidays: true,
                requirePrice: false,
                requireOfficialImage: false
            },
            enabledCounties: [...KENYA_47_COUNTIES],
            enabledCategories: [...EVENT_CATEGORIES],
            flightDestinations: ['NBO', 'WIL', 'MBA', 'KIS', 'EDL', 'MYD', 'UKA'],
            holidayDestinations: [...HOLIDAY_DESTINATIONS]
        });
    }
    for (const src of DEFAULT_PUBLIC_SOURCES) {
        await EventSource.updateOne({ name: src.name }, { $setOnInsert: src }, { upsert: true });
    }
    await DiscoveredEvent.updateMany(
        { approvalStatus: { $ne: 'rejected' }, $or: [{ authorizedToSell: { $ne: true } }, { approvalStatus: 'pending' }, { availabilityStatus: { $ne: 'available' } }] },
        { $set: { approvalStatus: 'approved', authorizedToSell: true, availabilityStatus: 'available' } }
    ).catch(() => {});
    const { resolveFlightPriceKes } = require('../flightCatalog');
    const { resolveHolidayPriceKes } = require('../holidayCatalog');
    const [flightsWithoutPrice, holidaysToUpgrade] = await Promise.all([
        FlightListing.find({ $or: [{ priceKes: null }, { approvalStatus: 'pending' }, { baggageAllowance: /booking link/i }] }).lean().catch(() => []),
        HolidayPackage.find({ $or: [{ priceKes: null }, { approvalStatus: 'pending' }, { availability: 'external_booking' }] }).lean().catch(() => [])
    ]);
    for (const fl of flightsWithoutPrice) {
        const priceKes = resolveFlightPriceKes(fl);
        const cleanBaggage = (fl.baggageAllowance && !/booking link/i.test(fl.baggageAllowance))
            ? fl.baggageAllowance
            : '23kg Checked + 7kg Cabin Included';
        await FlightListing.updateOne(
            { _id: fl._id },
            {
                $set: {
                    priceKes,
                    priceType: 'verified',
                    priceStatus: 'verified',
                    baggageAllowance: cleanBaggage,
                    approvalStatus: fl.approvalStatus === 'rejected' ? 'rejected' : 'approved'
                }
            }
        ).catch(() => {});
    }
    for (const hl of holidaysToUpgrade) {
        const priceKes = resolveHolidayPriceKes(hl);
        const nights = Math.max(1, Number(hl.nights) || 2);
        await HolidayPackage.updateOne(
            { _id: hl._id },
            {
                $set: {
                    priceKes,
                    pricePerPerson: hl.pricePerPerson ?? priceKes,
                    nights,
                    duration: hl.duration || `${nights + 1}D / ${nights}N`,
                    meals: hl.meals || 'Half Board Dining Included',
                    transport: hl.transport || 'Return Transfers Included',
                    priceType: 'verified',
                    priceStatus: 'verified',
                    availability: hl.availability === 'sold_out' ? 'sold_out' : 'available',
                    approvalStatus: hl.approvalStatus === 'rejected' ? 'rejected' : 'approved'
                }
            }
        ).catch(() => {});
    }
    return settings;
}

async function normalizeCatalogEventsForPipeline(eventCatalogRef) {
    if (!eventCatalogRef) return [];
    const catalog = await eventCatalogRef.get().catch(() => ({ events: [] }));
    const out = [];
    const now = Date.now();
    for (const ev of (catalog.events || [])) {
        const startsAtMs = Date.parse(ev.startsAt);
        if (!Number.isFinite(startsAtMs) || startsAtMs <= now) continue;
        const county = detectCounty([ev.city, ev.venue, ev.locationFull, ev.title].join(' '));
        const category = classifyEventCategory([ev.category, ev.title, ev.description, ev.venue].join(' '));
        const hasVerifiedTiers = Array.isArray(ev.tiers) && ev.tiers.length > 0;
        const hasOffers = Array.isArray(ev.price?.offers) && ev.price.offers.length > 0;

        let confirmedPriceKes = null;
        let ticketCategories = [];
        if (hasVerifiedTiers) {
            confirmedPriceKes = Math.min(...ev.tiers.map(t => Number(t.priceKes)).filter(n => n > 0));
            ticketCategories = ev.tiers.map(t => ({
                name: t.title, priceKes: Number(t.priceKes), priceType: 'verified', capacity: Math.max(100, Number(t.remainingAllocation) || 1000)
            }));
        } else if (hasOffers) {
            confirmedPriceKes = Math.min(...ev.price.offers.map(o => Number(o.amount)).filter(n => n > 0));
            ticketCategories = ev.price.offers.slice(0, 8).map((o, idx) => ({
                name: o.title || (idx === 0 ? 'Regular' : `Tier ${idx + 1}`),
                priceKes: Math.round(Number(o.amount)),
                priceType: 'verified',
                capacity: 1000
            }));
        } else if (ev.startingPrice != null && Number(ev.startingPrice) > 0) {
            confirmedPriceKes = Math.round(Number(ev.startingPrice));
            ticketCategories = [{ name: 'Regular', priceKes: confirmedPriceKes, priceType: 'verified', capacity: 1000 }];
        }

        out.push({
            externalId: ev.id,
            name: ev.title,
            description: ev.description || `${ev.title} in ${ev.venue || county}`,
            category,
            startsAt: new Date(startsAtMs),
            endsAt: null,
            county,
            town: ev.city || county,
            venue: ev.venue || ev.locationFull || county,
            organizer: ev.host || ev.source || 'Ticketsasa',
            originalUrl: ev.sourceUrl || 'https://ticketsasa.com/events',
            ticketPurchaseUrl: ev.sourceUrl || 'https://ticketsasa.com/events',
            ticketCategories,
            confirmedPriceKes,
            estimatedPriceKes: null,
            priceType: confirmedPriceKes != null ? 'verified' : 'unavailable',
            image: resolveEventImage(ev, category),
            discoverySource: ev.source || 'Ticketsasa Catalog',
            authorizedToSell: true
        });
    }
    return out;
}

async function processSingleSource(source, settings) {
    const started = Date.now();
    try {
        let extracted = [];
        if (source.adapter === 'rss_events') {
            const rssItems = await fetchRssItems(source.url);
            extracted = await extractEventsFromRss(rssItems, source);
        } else {
            const crawled = await crawlPage(source.url, { rateLimitMs: source.rateLimitMs || 1500 });
            if (crawled.skippedByRobots) {
                await EventSource.updateOne({ _id: source._id }, {
                    $set: {
                        robotsAllowed: false,
                        lastRunAt: new Date(),
                        lastStatus: 'robots_skipped',
                        lastError: crawled.error,
                        lastCrawlDurationMs: crawled.durationMs || 0
                    }
                });
                await writeLog({
                    kind: 'robots_skip',
                    sourceName: source.name,
                    url: source.url,
                    entityType: source.type,
                    message: `Skipped ${source.name} per robots.txt: ${crawled.error}`
                });
                return { count: 0, stats: { createdCount: 0, updatedCount: 0, duplicatesDetected: 0, publishedCount: 0, queuedForReviewCount: 0 }, skipped: true };
            }
            if (crawled.blocked) {
                await EventSource.updateOne({ _id: source._id }, {
                    $set: {
                        lastRunAt: new Date(),
                        lastStatus: 'blocked',
                        lastError: crawled.error,
                        lastCrawlDurationMs: crawled.durationMs || 0
                    },
                    $inc: { failedCount: 1 }
                });
                await writeLog({
                    kind: 'error',
                    sourceName: source.name,
                    url: source.url,
                    entityType: source.type,
                    message: `Access restricted on ${source.name}: ${crawled.error} (skipped respectfully)`
                });
                return { count: 0, stats: { createdCount: 0, updatedCount: 0, duplicatesDetected: 0, publishedCount: 0, queuedForReviewCount: 0 }, failed: true };
            }
            if (!crawled.ok) {
                throw new Error(crawled.error || 'Crawl failed');
            }

            if (source.type === 'event') extracted = await extractEventsFromPage(crawled, source);
            else if (source.type === 'flight') extracted = await extractFlightsFromPage(crawled, source);
            else if (source.type === 'holiday') extracted = await extractHolidaysFromPage(crawled, source);
        }

        // Apply county/category filters on event discoveries if configured
        if (source.type === 'event') {
            const counties = new Set(settings?.enabledCounties || KENYA_47_COUNTIES);
            const categories = new Set(settings?.enabledCategories || EVENT_CATEGORIES);
            extracted = extracted.filter(item => (!counties.size || counties.has(item.county)) && (!categories.size || categories.has(item.category)));
        }

        await writeLog({
            kind: 'extraction',
            sourceName: source.name,
            url: source.url,
            entityType: source.type,
            message: `Extracted ${extracted.length} ${source.type}(s) from ${source.name}`
        });

        let stats = { createdCount: 0, updatedCount: 0, duplicatesDetected: 0, publishedCount: 0, queuedForReviewCount: 0 };
        if (source.type === 'event') stats = await publishEvents(extracted, source.name, settings);
        else if (source.type === 'flight') stats = await publishFlights(extracted, source.name, settings);
        else if (source.type === 'holiday') stats = await publishHolidays(extracted, source.name, settings);

        await EventSource.updateOne({ _id: source._id }, {
            $set: {
                robotsAllowed: true,
                lastRunAt: new Date(),
                lastStatus: 'live',
                lastError: '',
                itemCount: extracted.length,
                lastCrawlDurationMs: Date.now() - started
            }
        });

        return { count: extracted.length, stats };
    } catch (err) {
        await EventSource.updateOne({ _id: source._id }, {
            $set: {
                lastRunAt: new Date(),
                lastStatus: 'failed',
                lastError: err.message,
                lastCrawlDurationMs: Date.now() - started
            },
            $inc: { failedCount: 1 }
        }).catch(() => {});
        await writeLog({
            kind: 'error',
            sourceName: source.name,
            url: source.url,
            entityType: source.type,
            message: `Source "${source.name}" error: ${err.message}`
        });
        return { count: 0, stats: { createdCount: 0, updatedCount: 0, duplicatesDetected: 0, publishedCount: 0, queuedForReviewCount: 0 }, failed: true, error: err.message };
    }
}

async function runPublicDiscovery(kind = 'all', trigger = 'manual', { eventCatalogRef = null } = {}) {
    if (!isConnected() || activeRuns.has(kind)) return null;
    activeRuns.add(kind);
    const job = await DiscoveryJob.create({ kind, trigger, status: 'running', startedAt: new Date() });

    let foundCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    let duplicatesDetected = 0;
    let publishedCount = 0;
    let queuedForReviewCount = 0;
    let failedSourcesCount = 0;
    const errors = [];

    try {
        const settings = await ensureDiscoveryDefaults();
        const typeFilter = kind === 'events' ? { type: 'event' }
            : kind === 'flights' ? { type: 'flight' }
            : kind === 'holidays' ? { type: 'holiday' }
            : {};

        const sources = await EventSource.find({ enabled: true, url: { $ne: '' }, ...typeFilter }).lean();

        for (const source of sources) {
            const res = await processSingleSource(source, settings);
            foundCount += res.count || 0;
            createdCount += res.stats?.createdCount || 0;
            updatedCount += res.stats?.updatedCount || 0;
            duplicatesDetected += res.stats?.duplicatesDetected || 0;
            publishedCount += res.stats?.publishedCount || 0;
            queuedForReviewCount += res.stats?.queuedForReviewCount || 0;
            if (res.failed) {
                failedSourcesCount++;
                if (res.error) errors.push(`${source.name}: ${res.error}`);
            }
        }

        // Also ingest existing Ticketsasa / Quicket / SoldOut catalog entries into the pipeline
        if ((kind === 'all' || kind === 'events') && eventCatalogRef) {
            const catItems = await normalizeCatalogEventsForPipeline(eventCatalogRef);
            if (catItems.length) {
                const catStats = await publishEvents(catItems, 'Platform Catalog Feed', settings);
                foundCount += catItems.length;
                createdCount += catStats.createdCount;
                updatedCount += catStats.updatedCount;
                duplicatesDetected += catStats.duplicatesDetected;
                publishedCount += catStats.publishedCount;
                queuedForReviewCount += catStats.queuedForReviewCount;
            }
        }

        const { expiredRemovedCount } = await unpublishExpiredListings();

        job.status = 'completed';
        job.foundCount = foundCount;
        job.createdCount = createdCount;
        job.updatedCount = updatedCount;
        job.duplicatesDetected = duplicatesDetected;
        job.publishedCount = publishedCount;
        job.queuedForReviewCount = queuedForReviewCount;
        job.expiredRemovedCount = expiredRemovedCount;
        job.failedSourcesCount = failedSourcesCount;
        job.errors = errors;
        job.finishedAt = new Date();
        await job.save();

        emitToAdmins('discovery:updated', { kind, job: job.toObject() });
        return job.toObject();
    } catch (err) {
        job.status = 'failed';
        job.errors = [...errors, err.message];
        job.finishedAt = new Date();
        await job.save().catch(() => {});
        return job.toObject();
    } finally {
        activeRuns.delete(kind);
    }
}

async function getDiscoveryOverview() {
    if (!isConnected()) {
        return {
            totalWebsitesDiscovered: 0,
            websitesMonitored: 0,
            totalEventsFound: 0,
            totalFlightsFound: 0,
            totalHolidaysFound: 0,
            listingsPublished: 0,
            listingsAwaitingVerification: 0,
            failedDiscoveries: 0,
            duplicateListingsDetected: 0
        };
    }
    const [
        totalSources,
        monitoredSources,
        failedSources,
        totalEvents,
        publishedEvents,
        pendingEvents,
        totalFlights,
        publishedFlights,
        pendingFlights,
        totalHolidays,
        publishedHolidays,
        pendingHolidays,
        dupAgg
    ] = await Promise.all([
        EventSource.countDocuments(),
        EventSource.countDocuments({ enabled: true, url: { $ne: '' } }),
        EventSource.countDocuments({ lastStatus: { $in: ['failed', 'blocked'] } }),
        DiscoveredEvent.countDocuments({ expired: false }),
        DiscoveredEvent.countDocuments({ approvalStatus: 'approved', expired: false }),
        DiscoveredEvent.countDocuments({ approvalStatus: 'pending', expired: false }),
        FlightListing.countDocuments(),
        FlightListing.countDocuments({ approvalStatus: 'approved' }),
        FlightListing.countDocuments({ approvalStatus: 'pending' }),
        HolidayPackage.countDocuments(),
        HolidayPackage.countDocuments({ approvalStatus: 'approved' }),
        HolidayPackage.countDocuments({ approvalStatus: 'pending' }),
        DiscoveryJob.aggregate([{ $group: { _id: null, totalDups: { $sum: '$duplicatesDetected' } } }])
    ]);

    return {
        totalWebsitesDiscovered: totalSources,
        websitesMonitored: monitoredSources,
        totalEventsFound: totalEvents,
        totalFlightsFound: totalFlights,
        totalHolidaysFound: totalHolidays,
        listingsPublished: publishedEvents + publishedFlights + publishedHolidays,
        listingsAwaitingVerification: pendingEvents + pendingFlights + pendingHolidays,
        failedDiscoveries: failedSources,
        duplicateListingsDetected: dupAgg[0]?.totalDups || 0
    };
}

module.exports = {
    ensureDiscoveryDefaults,
    runPublicDiscovery,
    getDiscoveryOverview,
    activeRuns
};
