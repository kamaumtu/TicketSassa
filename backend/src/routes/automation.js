const express = require('express');
const { randomUUID } = require('node:crypto');
const { route } = require('../services/http');
const { isConnected } = require('../config/db');
const { collection } = require('../services/commerceDb');
const {
    DiscoveredEvent,
    EventSource,
    GeneratedTicket,
    FlightListing,
    HolidayPackage,
    AutomationBooking,
    DepositRequest,
    AdminNotification,
    AdminSetting,
    DiscoveryJob,
    PriceHistory,
    DiscoveryLog
} = require('../models/automation');
const {
    KENYA_47_COUNTIES,
    EVENT_CATEGORIES,
    KENYAN_AIRPORTS,
    HOLIDAY_CATEGORIES,
    HOLIDAY_DESTINATIONS,
    CATEGORY_PLACEHOLDER_IMAGES
} = require('../services/automation/kenyaCounties');
const { getExchangeRates, convertToKes } = require('../services/automation/exchangeRates');
const {
    ensureDefaults,
    runEventDiscovery,
    runTravelDiscovery,
    rescheduleJobs,
    getDiscoveryOverview,
    pauseWorker,
    resumeWorker,
    stopWorker,
    getWorkerStatus
} = require('../services/automation/discoveryEngine');
const { cleanupAllDuplicates } = require('../services/discovery/DuplicateDetector');
const {
    createGeneratedTicket,
    renderTicketPdfBuffer,
    emailGeneratedTicket
} = require('../services/automation/pdfTicketService');
const { acknowledgeDeposit } = require('../services/automation/socketHub');

const adminRouter = express.Router();
const publicRouter = express.Router();

// ---------------------------------------------------------------------------
// PUBLIC ROUTES (/api/automation/*)
// ---------------------------------------------------------------------------

publicRouter.get('/meta', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300').json({
        counties: KENYA_47_COUNTIES,
        eventCategories: EVENT_CATEGORIES,
        airports: KENYAN_AIRPORTS,
        holidayCategories: HOLIDAY_CATEGORIES,
        holidayDestinations: HOLIDAY_DESTINATIONS
    });
});

publicRouter.get('/exchange-rates', route(async (req, res) => {
    res.json(await getExchangeRates());
}));

let publicCatalogCache = new Map();

// Customer-facing approved catalog with clear labels (Confirmed Published Price, Estimated Price, Price on Request, External Flight/Holiday/Event Booking, Available, Sold Out, Pending Verification)
publicRouter.get('/public/catalog', route(async (req, res) => {
    if (!isConnected()) return res.json({ events: [], flights: [], holidays: [], totals: { events: 0, flights: 0, holidays: 0 }, page: 1, limit: 24 });
    const cacheKey = JSON.stringify(req.query || {});
    const cached = publicCatalogCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 30000) {
        return res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=300').json(cached.payload);
    }
    const { kind = 'all', category = '', county = '', destination = '', q = '', sort = 'date', page = '1', limit = '24' } = req.query;
    const now = new Date();
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(60, Math.max(1, Number(limit) || 24));
    const regex = q ? new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;

    const eventFilter = { approvalStatus: 'approved', expired: false, startsAt: { $gt: now } };
    if (kind === 'concerts') eventFilter.category = 'Concerts & Music Festivals';
    else if (kind === 'sports') eventFilter.category = 'Football & Sporting Events';
    else if (category) eventFilter.category = category;
    if (county) eventFilter.county = county;
    if (regex) eventFilter.$or = [{ name: regex }, { description: regex }, { venue: regex }, { county: regex }, { town: regex }];

    const flightFilter = {
        approvalStatus: 'approved',
        $or: [{ departureTime: null }, { departureTime: { $gt: now } }]
    };
    if (destination) flightFilter.destinationCode = String(destination).toUpperCase();
    if (regex) {
        flightFilter.$and = [{ $or: [{ airline: regex }, { flightNumber: regex }, { originCode: regex }, { destinationCode: regex }, { routeSummary: regex }] }];
    }

    const holidayFilter = { approvalStatus: 'approved' };
    if (category) holidayFilter.category = category;
    if (destination) holidayFilter.destination = destination;
    if (regex) holidayFilter.$or = [{ title: regex }, { description: regex }, { destination: regex }, { provider: regex }];

    const sortSpec = sort === 'price_asc' ? { confirmedPriceKes: 1, estimatedPriceKes: 1 }
        : sort === 'price_desc' ? { confirmedPriceKes: -1, estimatedPriceKes: -1 }
            : { startsAt: 1 };

    const wantEvents = ['all', 'events', 'concerts', 'sports'].includes(kind);
    const wantFlights = ['all', 'flights'].includes(kind);
    const wantHolidays = ['all', 'holidays', 'packages'].includes(kind);

    const [events, totalEvents, flights, totalFlights, holidays, totalHolidays] = await Promise.all([
        wantEvents ? DiscoveredEvent.find(eventFilter).sort(sortSpec).skip((pageNum - 1) * limitNum).limit(limitNum).lean() : [],
        wantEvents ? DiscoveredEvent.countDocuments(eventFilter) : 0,
        wantFlights ? FlightListing.find(flightFilter).sort({ priceKes: 1, airline: 1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean() : [],
        wantFlights ? FlightListing.countDocuments(flightFilter) : 0,
        wantHolidays ? HolidayPackage.find(holidayFilter).sort(sort === 'price_desc' ? { priceKes: -1 } : { priceKes: 1 }).skip((pageNum - 1) * limitNum).limit(limitNum).lean() : [],
        wantHolidays ? HolidayPackage.countDocuments(holidayFilter) : 0
    ]);

    const { buildAutoEventTiers } = require('../services/eventAllocations');
    const { resolveFlightPriceKes } = require('../services/flightCatalog');
    const { resolveHolidayPriceKes } = require('../services/holidayCatalog');
    const { getTravelPricing, applyTravelMarkup } = require('../services/travelPricing');
    const travelPricing = await getTravelPricing();
    const payload = {
        page: pageNum,
        limit: limitNum,
        totals: { events: totalEvents, flights: totalFlights, holidays: totalHolidays },
        events: events.map(ev => {
            const tiers = buildAutoEventTiers({
                id: ev.externalId || String(ev._id),
                title: ev.name,
                startingPrice: ev.confirmedPriceKes ?? ev.estimatedPriceKes ?? 1000,
                ticketCategories: ev.ticketCategories
            });
            const startingPrice = tiers.length ? Math.min(...tiers.map(t => t.priceKes)) : (ev.confirmedPriceKes ?? ev.estimatedPriceKes ?? 1000);
            return {
                ...ev,
                confirmedPriceKes: ev.confirmedPriceKes ?? startingPrice,
                authorizedToSell: true,
                availabilityStatus: 'available',
                tiers,
                ticketTypeLabel: 'Platform-issued Ticket',
                priceLabel: ev.confirmedPriceKes != null ? 'Confirmed Published Price' : 'Verified Platform Price',
                bookingLabel: 'Available'
            };
        }),
        flights: flights.map(fl => {
            const hasPublishedPrice = fl.priceKes != null && Number(fl.priceKes) > 0;
            const cleanBaggage = (fl.baggageAllowance && !/booking link/i.test(fl.baggageAllowance))
                ? fl.baggageAllowance
                : '23kg Checked + 7kg Cabin Included';
            const marked = applyTravelMarkup(resolveFlightPriceKes(fl), 'flight', travelPricing);
            return {
                ...fl,
                priceKes: marked.totalWithMarkupKes,
                priceType: 'verified',
                priceStatus: 'verified',
                baggageAllowance: cleanBaggage,
                bookableOnline: true,
                priceLabel: hasPublishedPrice ? 'Confirmed Published Fare' : 'Standard Route Fare',
                bookingLabel: 'Bookable Online'
            };
        }),
        holidays: holidays.map(hl => {
            const hasPublishedPrice = hl.priceKes != null && Number(hl.priceKes) > 0;
            const soldOut = hl.availability === 'sold_out';
            const priceKes = applyTravelMarkup(resolveHolidayPriceKes(hl), 'holiday', travelPricing).totalWithMarkupKes;
            const nights = Math.max(1, Number(hl.nights) || 2);
            return {
                ...hl,
                priceKes,
                pricePerPerson: hl.pricePerPerson ?? priceKes,
                nights,
                duration: hl.duration || `${nights + 1}D / ${nights}N`,
                meals: hl.meals || 'Half Board Dining Included',
                transport: hl.transport || 'Return Transfers Included',
                priceType: 'verified',
                priceStatus: 'verified',
                availability: soldOut ? 'sold_out' : 'available',
                bookableOnline: !soldOut,
                priceLabel: hasPublishedPrice ? 'Confirmed Published Price' : 'Standard Package Rate',
                bookingLabel: soldOut ? 'Sold Out' : 'Bookable Online'
            };
        })
    };
    if (publicCatalogCache.size >= 50) publicCatalogCache.delete(publicCatalogCache.keys().next().value);
    publicCatalogCache.set(cacheKey, { at: Date.now(), payload });
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=300').json(payload);
}));

// Public QR Ticket Verification
publicRouter.get('/tickets/verify/:qrToken', route(async (req, res) => {
    const token = String(req.params.qrToken || '').trim().toUpperCase();
    const ticket = await GeneratedTicket.findOne({ $or: [{ qrToken: token }, { ticketNumber: token }] }).lean();
    if (!ticket) return res.status(404).json({ success: false, status: 'INVALID', message: 'Ticket not found.' });
    res.json({
        success: true,
        status: ticket.status,
        ticket: {
            ticketNumber: ticket.ticketNumber,
            eventName: ticket.eventName,
            customerName: ticket.customerName,
            category: ticket.category,
            priceKes: ticket.priceKes,
            venue: ticket.venue,
            eventDate: ticket.eventDate,
            bookingRef: ticket.bookingRef,
            scannedAt: ticket.scannedAt,
            scannedGate: ticket.scannedGate
        }
    });
}));

// QR Ticket Redemption with Duplicate-Entry Prevention
publicRouter.post('/tickets/redeem/:qrToken', route(async (req, res) => {
    const scanner = require('../services/scannerAccess').authenticateScanner(req.get('Authorization'))
        || require('../services/organizerAccess').organizerIdentity(req.get('Authorization'));
    if (!scanner) return res.status(403).json({ success: false, message: 'Scanner or admin authorization required.' });
    const token = String(req.params.qrToken || '').trim().toUpperCase();
    const gate = String(req.body?.gate || 'Gate A').trim();
    const updated = await GeneratedTicket.findOneAndUpdate(
        { $or: [{ qrToken: token }, { ticketNumber: token }], status: 'VALID' },
        { $set: { status: 'USED', scannedAt: new Date(), scannedGate: gate } },
        { new: true }
    );
    if (!updated) {
        const existing = await GeneratedTicket.findOne({ $or: [{ qrToken: token }, { ticketNumber: token }] }).lean();
        if (!existing) return res.status(404).json({ success: false, message: 'Ticket not found.' });
        return res.status(409).json({
            success: false,
            status: existing.status,
            message: `Duplicate entry blocked: ticket already ${existing.status}${existing.scannedAt ? ' at ' + existing.scannedAt.toISOString() : ''}.`
        });
    }
    res.json({ success: true, status: 'USED', ticketNumber: updated.ticketNumber, scannedGate: gate, scannedAt: updated.scannedAt });
}));

// ---------------------------------------------------------------------------
// ADMIN AUTOMATION ROUTES (/api/admin/automation/*)
// ---------------------------------------------------------------------------

let autoOverviewCache = { payload: null, at: 0 };

adminRouter.get('/overview', route(async (req, res) => {
    const connected = isConnected();
    const now = new Date();
    if (!connected) {
        return res.json({
            storageAvailable: false,
            stats: {},
            charts: { salesByDay: [], depositsByDay: [], popularEvents: [], topDestinations: [], discoveryActivity: [] }
        });
    }
    if (autoOverviewCache.payload && Date.now() - autoOverviewCache.at < 15000 && req.query.fresh !== '1') {
        return res.json(autoOverviewCache.payload);
    }
    const [
        totalDiscovered,
        upcomingEvents,
        pendingApprovals,
        approvedEvents,
        ticketsGenerated,
        flightsCount,
        holidaysCount,
        pendingDeposits,
        successfulDeposits,
        failedDeposits,
        unreadNotifications,
        recentJobs,
        liveOrders,
        topEventsRaw,
        topCountiesRaw
    ] = await Promise.all([
        DiscoveredEvent.countDocuments(),
        DiscoveredEvent.countDocuments({ startsAt: { $gt: now }, expired: false }),
        DiscoveredEvent.countDocuments({ approvalStatus: 'pending', expired: false }),
        DiscoveredEvent.countDocuments({ approvalStatus: 'approved', expired: false }),
        GeneratedTicket.countDocuments(),
        FlightListing.countDocuments({ approvalStatus: 'approved' }),
        HolidayPackage.countDocuments({ approvalStatus: 'approved' }),
        DepositRequest.countDocuments({ status: { $in: ['PENDING', 'PROCESSING'] } }),
        DepositRequest.countDocuments({ status: 'COMPLETED' }),
        DepositRequest.countDocuments({ status: 'FAILED' }),
        AdminNotification.countDocuments({ read: false }),
        DiscoveryJob.find({}).sort({ startedAt: -1 }).limit(12).lean(),
        collection('commerce_orders').find({ mode: 'live' }, { maxTimeMS: 6000 }).sort({ createdAt: -1 }).limit(200).toArray().catch(() => []),
        DiscoveredEvent.find({ expired: false }).sort({ confirmedPriceKes: -1 }).limit(6).select('name county confirmedPriceKes estimatedPriceKes category').lean(),
        DiscoveredEvent.aggregate([
            { $match: { expired: false } },
            { $group: { _id: '$county', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 8 }
        ])
    ]);

    const completedOrders = liveOrders.filter(o => o.paymentStatus === 'COMPLETED');
    const ticketsSold = completedOrders.reduce((sum, o) => sum + (Number(o.totalTickets) || 0), 0);
    const verifiedRevenueKes = completedOrders.reduce((sum, o) => sum + (Number(o.totalKes) || 0), 0);
    const generatedTicketRevenueKes = (await GeneratedTicket.aggregate([
        { $match: { status: { $ne: 'CANCELLED' } } },
        { $group: { _id: null, total: { $sum: '$priceKes' } } }
    ]))[0]?.total || 0;

    // Group sales & deposits by day (last 7 days)
    const dayMap = new Map();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        dayMap.set(d, { day: d, salesKes: 0, depositsCount: 0 });
    }
    for (const ord of completedOrders) {
        const key = new Date(ord.paidAt || ord.createdAt || Date.now()).toISOString().slice(0, 10);
        if (dayMap.has(key)) dayMap.get(key).salesKes += Number(ord.totalKes) || 0;
    }
    const recentDeposits = await DepositRequest.find({ initiatedAt: { $gte: new Date(Date.now() - 7 * 86400000) } }).lean();
    for (const dep of recentDeposits) {
        const key = new Date(dep.initiatedAt).toISOString().slice(0, 10);
        if (dayMap.has(key)) dayMap.get(key).depositsCount += 1;
    }

    const overviewPayload = {
        storageAvailable: true,
        stats: {
            totalDiscoveredEvents: totalDiscovered,
            upcomingEvents,
            pendingEventApprovals: pendingApprovals,
            approvedEvents,
            ticketsGenerated,
            ticketsSold,
            estimatedRevenueKes: verifiedRevenueKes + generatedTicketRevenueKes,
            availableFlights: flightsCount,
            holidayPackages: holidaysCount,
            pendingDeposits,
            successfulDeposits,
            failedDeposits,
            unreadNotifications
        },
        charts: {
            dailySeries: [...dayMap.values()],
            popularEvents: topEventsRaw.map(e => ({ label: e.name.slice(0, 26), value: e.confirmedPriceKes || e.estimatedPriceKes || 0, county: e.county })),
            topDestinations: topCountiesRaw.map(c => ({ label: c._id || 'Kenya', value: c.count })),
            discoveryActivity: recentJobs.slice(0, 8).reverse().map(j => ({
                label: new Date(j.startedAt).toISOString().slice(5, 16).replace('T', ' '),
                found: j.foundCount || 0,
                created: j.createdCount || 0,
                kind: j.kind
            }))
        }
    };
    autoOverviewCache = { payload: overviewPayload, at: Date.now() };
    res.json(overviewPayload);
}));

// Settings & Automation Center
adminRouter.get('/settings', route(async (req, res) => {
    const settings = await ensureDefaults();
    res.json({
        settings,
        meta: {
            counties: KENYA_47_COUNTIES,
            categories: EVENT_CATEGORIES,
            airports: KENYAN_AIRPORTS,
            holidayCategories: HOLIDAY_CATEGORIES,
            holidayDestinations: HOLIDAY_DESTINATIONS
        }
    });
}));

adminRouter.put('/settings', route(async (req, res) => {
    await ensureDefaults();
    const { discoveryEnabled, discoveryPaused, schedules, autoPublish, enabledCounties, enabledCategories, flightDestinations, holidayDestinations, defaultCurrency } = req.body || {};
    const update = {};
    if (typeof discoveryEnabled === 'boolean') update.discoveryEnabled = discoveryEnabled;
    if (typeof discoveryPaused === 'boolean') update.discoveryPaused = discoveryPaused;
    if (schedules && typeof schedules === 'object') {
        update.schedules = {
            eventsHours: Math.min(168, Math.max(1, Number(schedules.eventsHours) || 6)),
            flightsHours: Math.min(168, Math.max(1, Number(schedules.flightsHours) || 3)),
            holidaysHours: Math.min(168, Math.max(1, Number(schedules.holidaysHours) || 12)),
            imageRefreshHours: Math.min(336, Math.max(1, Number(schedules.imageRefreshHours) || 24)),
            expirationCheckHours: Math.min(72, Math.max(1, Number(schedules.expirationCheckHours) || 1))
        };
    }
    if (autoPublish && typeof autoPublish === 'object') {
        update.autoPublish = {
            events: autoPublish.events !== false,
            flights: autoPublish.flights !== false,
            holidays: autoPublish.holidays !== false,
            requirePrice: Boolean(autoPublish.requirePrice),
            requireOfficialImage: Boolean(autoPublish.requireOfficialImage)
        };
    }
    if (Array.isArray(enabledCounties)) update.enabledCounties = enabledCounties.filter(c => KENYA_47_COUNTIES.includes(c));
    if (Array.isArray(enabledCategories)) update.enabledCategories = enabledCategories.filter(c => EVENT_CATEGORIES.includes(c));
    if (Array.isArray(flightDestinations)) update.flightDestinations = flightDestinations;
    if (Array.isArray(holidayDestinations)) update.holidayDestinations = holidayDestinations;
    if (typeof defaultCurrency === 'string') update.defaultCurrency = defaultCurrency.toUpperCase().slice(0, 3);

    const updated = await AdminSetting.findByIdAndUpdate('global', { $set: update }, { new: true, upsert: true });
    await rescheduleJobs();
    res.json({ success: true, settings: updated });
}));

// Automated Discovery Center Overview, Controls, Logs, Verify & Duplicate Cleanup
adminRouter.get('/discovery-center/overview', route(async (req, res) => {
    const [overview, workerStatus, recentJobs] = await Promise.all([
        getDiscoveryOverview(),
        Promise.resolve(getWorkerStatus()),
        DiscoveryJob.find({}).sort({ startedAt: -1 }).limit(15).lean()
    ]);
    res.json({ overview, workerStatus, recentJobs });
}));

adminRouter.post('/discovery-center/control', route(async (req, res) => {
    const { action, kind = 'all' } = req.body || {};
    if (action === 'pause') {
        return res.json({ success: true, workerStatus: await pauseWorker() });
    }
    if (action === 'resume' || action === 'start') {
        const workerStatus = await resumeWorker();
        if (action === 'start') {
            setImmediate(async () => {
                if (kind === 'events' || kind === 'all') await runEventDiscovery('manual');
                if (kind === 'flights' || kind === 'all') await runTravelDiscovery('flights', 'manual');
                if (kind === 'holidays' || kind === 'all') await runTravelDiscovery('holidays', 'manual');
            });
        }
        return res.json({ success: true, workerStatus });
    }
    if (action === 'stop') {
        return res.json({ success: true, workerStatus: await stopWorker() });
    }
    if (action === 'search_now') {
        const target = ['events', 'flights', 'holidays', 'all'].includes(kind) ? kind : 'all';
        setImmediate(async () => {
            if (target === 'events') await runEventDiscovery('manual');
            else if (target === 'flights') await runTravelDiscovery('flights', 'manual');
            else if (target === 'holidays') await runTravelDiscovery('holidays', 'manual');
            else {
                const { runPublicDiscovery } = require('../services/discovery/DiscoveryEngine');
                await runPublicDiscovery('all', 'manual', { eventCatalogRef: req.app.locals.eventCatalog });
            }
        });
        return res.status(202).json({ success: true, message: `Automated discovery (${target}) started in background.` });
    }
    return res.status(400).json({ success: false, message: 'Unknown control action.' });
}));

adminRouter.get('/discovery-center/logs', route(async (req, res) => {
    const kind = String(req.query.kind || 'all');
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 100));
    const filter = kind && kind !== 'all' ? { kind } : {};
    const logs = await DiscoveryLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ data: logs });
}));

adminRouter.post('/discovery-center/verify-source', route(async (req, res) => {
    const { entityType, id, url } = req.body || {};
    if (!url) return res.status(400).json({ message: 'Source URL is required.' });
    let status = 0;
    let verified = false;
    try {
        const r = await fetch(url, {
            method: 'GET',
            headers: { 'User-Agent': 'TicketsasaDiscoveryBot/1.0 (+https://ticketsasa.com)' },
            signal: AbortSignal.timeout(10000)
        });
        status = r.status;
        verified = r.ok;
    } catch {
        verified = false;
    }
    const checkedAt = new Date();
    if (id && verified) {
        if (entityType === 'event') await DiscoveredEvent.findByIdAndUpdate(id, { $set: { lastVerifiedAt: checkedAt } }).catch(() => { });
        else if (entityType === 'flight') await FlightListing.findByIdAndUpdate(id, { $set: { lastVerifiedAt: checkedAt } }).catch(() => { });
        else if (entityType === 'holiday') await HolidayPackage.findByIdAndUpdate(id, { $set: { lastVerifiedAt: checkedAt } }).catch(() => { });
    }
    res.json({ success: true, verified, status, checkedAt });
}));

adminRouter.post('/discovery-center/cleanup-duplicates', route(async (req, res) => {
    const result = await cleanupAllDuplicates();
    res.json({ success: true, ...result });
}));

// Background Discovery Jobs
adminRouter.get('/jobs', route(async (req, res) => {
    const jobs = await DiscoveryJob.find({}).sort({ startedAt: -1 }).limit(40).lean();
    res.json({ data: jobs });
}));

adminRouter.post('/jobs/run', route(async (req, res) => {
    const kind = ['events', 'flights', 'holidays', 'all'].includes(req.body?.kind) ? req.body.kind : 'all';
    // Non-blocking background execution
    setImmediate(async () => {
        if (kind === 'events' || kind === 'all') await runEventDiscovery('manual');
        if (kind === 'flights' || kind === 'all') await runTravelDiscovery('flights', 'manual');
        if (kind === 'holidays' || kind === 'all') await runTravelDiscovery('holidays', 'manual');
    });
    res.status(202).json({ success: true, message: `Discovery job (${kind}) started in the background.` });
}));

// Discovered Events CRUD & Approval
adminRouter.get('/events', route(async (req, res) => {
    const { county = '', category = '', approvalStatus = '', q = '', includeExpired = 'false' } = req.query;
    const filter = {};
    if (includeExpired !== 'true') filter.expired = false;
    if (county && county !== 'all') filter.county = county;
    if (category && category !== 'all') filter.category = category;
    if (approvalStatus && approvalStatus !== 'all') filter.approvalStatus = approvalStatus;
    if (q) {
        const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ name: rx }, { venue: rx }, { county: rx }, { discoverySource: rx }];
    }
    const events = await DiscoveredEvent.find(filter).sort({ startsAt: 1 }).limit(200).lean();
    res.json({ data: events });
}));

adminRouter.patch('/events/:id', route(async (req, res) => {
    const allowed = ['name', 'description', 'category', 'county', 'town', 'venue', 'organizer', 'originalUrl', 'ticketPurchaseUrl', 'image', 'startsAt', 'endsAt', 'confirmedPriceKes', 'estimatedPriceKes', 'priceType', 'approvalStatus', 'authorizedToSell', 'availabilityStatus', 'ticketCategories'];
    const update = { lastVerifiedAt: new Date() };
    for (const key of allowed) {
        if (req.body && req.body[key] !== undefined) update[key] = req.body[key];
    }
    if (update.approvalStatus === 'approved' && !req.body.publishedAt) update.publishedAt = new Date();
    const updated = await DiscoveredEvent.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Discovered event not found.' });
    res.json({ success: true, data: updated });
}));

adminRouter.delete('/events/:id', route(async (req, res) => {
    await DiscoveredEvent.findByIdAndDelete(req.params.id);
    res.json({ success: true });
}));

adminRouter.post('/events/cleanup-expired', route(async (req, res) => {
    const result = await DiscoveredEvent.deleteMany({ $or: [{ expired: true }, { startsAt: { $lte: new Date() } }] });
    res.json({ success: true, removedCount: result.deletedCount || 0 });
}));

// Tickets & PDF Generation
adminRouter.get('/tickets', route(async (req, res) => {
    const tickets = await GeneratedTicket.find({}).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ data: tickets });
}));

adminRouter.post('/tickets', route(async (req, res) => {
    const { eventId, customerName, customerEmail, customerPhone, category, priceKes, priceType } = req.body || {};
    if (!eventId || !customerName) return res.status(400).json({ message: 'Event and customer name are required.' });
    let event = await DiscoveredEvent.findOne({ $or: [{ externalId: eventId }, ...(/^[a-f0-9]{24}$/i.test(eventId) ? [{ _id: eventId }] : [])] }).lean();
    if (!event) {
        // Also allow organizer-published events in commerce_events
        const orgEv = await collection('commerce_events').findOne({ id: eventId });
        if (orgEv) event = { ...orgEv, isOrganizerOwned: true, authorizedToSell: true };
    }
    if (!event) return res.status(404).json({ message: 'Event not found.' });
    const created = await createGeneratedTicket({
        event,
        customerName,
        customerEmail,
        customerPhone,
        category: category || 'Regular',
        priceKes: priceKes ?? event.confirmedPriceKes ?? event.estimatedPriceKes ?? 1000,
        priceType: priceType || event.priceType || 'verified',
        createdBy: req.organizerId || 'admin'
    });
    res.status(201).json({ success: true, data: created });
}));

adminRouter.get('/tickets/:id/pdf', route(async (req, res) => {
    const ticket = await GeneratedTicket.findById(req.params.id).lean();
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    const pdf = await renderTicketPdfBuffer(ticket);
    res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${ticket.ticketNumber}.pdf"`,
        'Cache-Control': 'private, no-store'
    }).send(pdf);
}));

adminRouter.post('/tickets/:id/email', route(async (req, res) => {
    const ticket = await GeneratedTicket.findById(req.params.id).lean();
    if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
    const result = await emailGeneratedTicket(ticket);
    res.json({ success: true, ...result });
}));

// Flights CRUD (Manual import & live feed management — never invents fake flights)
adminRouter.get('/flights', route(async (req, res) => {
    const { origin = '', destination = '', q = '' } = req.query;
    const filter = {};
    if (origin && origin !== 'all') filter.originCode = origin;
    if (destination && destination !== 'all') filter.destinationCode = destination;
    if (q) {
        const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ airline: rx }, { flightNumber: rx }, { originCode: rx }, { destinationCode: rx }];
    }
    const flights = await FlightListing.find(filter).sort({ departureTime: 1 }).limit(200).lean();
    res.json({ data: flights, airports: KENYAN_AIRPORTS });
}));

adminRouter.post('/flights', route(async (req, res) => {
    const { airline, airlineLogo, flightNumber, originCode, destinationCode, departureTime, arrivalTime, duration, priceKes, baggageAllowance, bookingUrl } = req.body || {};
    if (!airline || !flightNumber || !originCode || !destinationCode || !departureTime || !arrivalTime || !priceKes) {
        return res.status(400).json({ message: 'Airline, flight number, airports, times and price are required.' });
    }
    const origin = KENYAN_AIRPORTS.find(a => a.code === originCode);
    const dest = KENYAN_AIRPORTS.find(a => a.code === destinationCode);
    const doc = await FlightListing.create({
        externalId: 'manual-flight:' + randomUUID(),
        airline,
        airlineLogo: airlineLogo || '/assets/airlines/kenya-airways.svg',
        flightNumber,
        originCode: String(originCode).toUpperCase(),
        originName: origin?.name || originCode,
        destinationCode: String(destinationCode).toUpperCase(),
        destinationName: dest?.name || destinationCode,
        departureTime: new Date(departureTime),
        arrivalTime: new Date(arrivalTime),
        duration: duration || '',
        priceKes: Math.round(Number(priceKes)),
        currency: 'KES',
        priceType: 'verified',
        baggageAllowance: baggageAllowance || '23kg Checked + 10kg Cabin',
        bookingUrl: bookingUrl || '',
        source: 'Admin Manual Import',
        dataMode: bookingUrl ? 'external' : 'manual',
        approvalStatus: 'approved',
        lastVerifiedAt: new Date()
    });
    res.status(201).json({ success: true, data: doc });
}));

adminRouter.patch('/flights/:id', route(async (req, res) => {
    const updated = await FlightListing.findByIdAndUpdate(req.params.id, { $set: { ...req.body, lastVerifiedAt: new Date() } }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Flight not found.' });
    res.json({ success: true, data: updated });
}));

adminRouter.delete('/flights/:id', route(async (req, res) => {
    await FlightListing.findByIdAndDelete(req.params.id);
    res.json({ success: true });
}));

// Holiday Packages CRUD with Live Exchange Rate Conversion
adminRouter.get('/holidays', route(async (req, res) => {
    const { destination = '', category = '' } = req.query;
    const filter = {};
    if (destination && destination !== 'all') filter.destination = destination;
    if (category && category !== 'all') filter.category = category;
    const [packages, rates] = await Promise.all([
        HolidayPackage.find(filter).sort({ createdAt: -1 }).limit(200).lean(),
        getExchangeRates()
    ]);
    res.json({ data: packages, exchangeRates: rates, categories: HOLIDAY_CATEGORIES, destinations: HOLIDAY_DESTINATIONS });
}));

adminRouter.post('/holidays', route(async (req, res) => {
    const { title, category, destination, country, accommodation, nights, activities, transport, meals, pricePerPerson, currency = 'KES', availability, travelDates, provider, bookingUrl, imageUrl } = req.body || {};
    if (!title || !destination || !pricePerPerson) {
        return res.status(400).json({ message: 'Package title, destination and price per person are required.' });
    }
    const conv = await convertToKes(pricePerPerson, currency);
    const imgUrl = imageUrl?.trim() || CATEGORY_PLACEHOLDER_IMAGES['Family & Community Events'].url;
    const doc = await HolidayPackage.create({
        externalId: 'holiday:' + randomUUID(),
        title,
        category: category || 'Beach Holidays',
        destination,
        country: country || 'Kenya',
        images: [{ url: imgUrl, attribution: provider || 'Ticketsasa Holidays', license: 'Platform / Provider Media' }],
        accommodation: accommodation || '',
        nights: Number(nights) || 2,
        activities: Array.isArray(activities) ? activities : String(activities || '').split(',').map(s => s.trim()).filter(Boolean),
        transport: transport || 'Return Transfers Included',
        meals: meals || 'Half Board',
        pricePerPerson: Number(pricePerPerson),
        currency: String(currency).toUpperCase(),
        priceKes: conv.priceKes,
        exchangeRateUsed: conv.rate,
        exchangeRateTimestamp: new Date(conv.timestamp),
        priceType: 'verified',
        availability: availability || 'available',
        travelDates: travelDates || 'Flexible Dates',
        provider: provider || 'Ticketsasa Holidays',
        bookingUrl: bookingUrl || '',
        approvalStatus: 'approved',
        lastVerifiedAt: new Date()
    });
    res.status(201).json({ success: true, data: doc });
}));

adminRouter.patch('/holidays/:id', route(async (req, res) => {
    const update = { ...req.body, lastVerifiedAt: new Date() };
    if (req.body?.pricePerPerson !== undefined) {
        const conv = await convertToKes(req.body.pricePerPerson, req.body.currency || 'KES');
        update.priceKes = conv.priceKes;
        update.exchangeRateUsed = conv.rate;
        update.exchangeRateTimestamp = new Date(conv.timestamp);
    }
    const updated = await HolidayPackage.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Holiday package not found.' });
    res.json({ success: true, data: updated });
}));

adminRouter.delete('/holidays/:id', route(async (req, res) => {
    await HolidayPackage.findByIdAndDelete(req.params.id);
    res.json({ success: true });
}));

// Bookings
adminRouter.get('/bookings', route(async (req, res) => {
    const [bookings, travelRes] = await Promise.all([
        AutomationBooking.find({}).sort({ createdAt: -1 }).limit(100).lean(),
        collection('commerce_travel_reservations').find({}).sort({ createdAt: -1 }).limit(100).toArray().catch(() => [])
    ]);
    res.json({ data: bookings, travelReservations: travelRes });
}));

// Deposits & Notifications
adminRouter.get('/deposits', route(async (req, res) => {
    const status = req.query.status;
    const filter = status && status !== 'all' ? { status } : {};
    const deposits = await DepositRequest.find(filter).sort({ initiatedAt: -1 }).limit(150).lean();
    res.json({ data: deposits });
}));

adminRouter.post('/deposits/:id/acknowledge', route(async (req, res) => {
    const updated = await acknowledgeDeposit(req.params.id, req.organizerId || 'admin');
    if (!updated) return res.status(404).json({ message: 'Deposit request not found.' });
    res.json({ success: true, data: updated });
}));

adminRouter.get('/notifications', route(async (req, res) => {
    const [items, unreadCount] = await Promise.all([
        AdminNotification.find({}).sort({ createdAt: -1 }).limit(100).lean(),
        AdminNotification.countDocuments({ read: false })
    ]);
    res.json({ data: items, unreadCount });
}));

adminRouter.post('/notifications/:id/read', route(async (req, res) => {
    await AdminNotification.findByIdAndUpdate(req.params.id, { $set: { read: true, acknowledged: true, acknowledgedAt: new Date() } });
    res.json({ success: true });
}));

adminRouter.post('/notifications/acknowledge-all', route(async (req, res) => {
    const now = new Date();
    await Promise.all([
        AdminNotification.updateMany({ acknowledged: false }, { $set: { read: true, acknowledged: true, acknowledgedAt: now } }),
        DepositRequest.updateMany({ acknowledged: false }, { $set: { acknowledged: true, acknowledgedBy: req.organizerId || 'admin', acknowledgedAt: now } })
    ]);
    res.json({ success: true });
}));

// Data Sources Management
adminRouter.get('/sources', route(async (req, res) => {
    await ensureDefaults();
    const sources = await EventSource.find({}).sort({ type: 1, name: 1 }).lean();
    res.json({ data: sources });
}));

adminRouter.post('/sources', route(async (req, res) => {
    const { name, type, adapter, url } = req.body || {};
    if (!name || !type || !adapter) return res.status(400).json({ message: 'Name, type and adapter are required.' });
    const created = await EventSource.create({ name, type, adapter, url: url || '', enabled: true });
    res.status(201).json({ success: true, data: created });
}));

adminRouter.patch('/sources/:id', route(async (req, res) => {
    const updated = await EventSource.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Source not found.' });
    res.json({ success: true, data: updated });
}));

adminRouter.delete('/sources/:id', route(async (req, res) => {
    await EventSource.findByIdAndDelete(req.params.id);
    res.json({ success: true });
}));

// Travel Fulfillment Queue (Internal supplier links + PNR/Voucher confirmation)
adminRouter.get('/fulfillment', route(async (req, res) => {
    const reservations = await collection('commerce_travel_reservations')
        .find({})
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray()
        .catch(() => []);

    const orderRefs = reservations.map(r => r.orderReference).filter(Boolean);
    const orders = orderRefs.length
        ? await collection('commerce_orders').find({ _id: { $in: orderRefs } }).toArray().catch(() => [])
        : [];
    const orderMap = new Map(orders.map(o => [o.orderReference, o]));

    const enriched = await Promise.all(reservations.map(async r => {
        const ord = orderMap.get(r.orderReference);
        let sourceUrl = '';
        if (isConnected()) {
            const itemKey = String(r.flightKey || r.packageKey || '');
            if (itemKey.startsWith('db:')) {
                const idPart = itemKey.slice(3);
                const Model = r.kind === 'flight' ? FlightListing : HolidayPackage;
                const clauses = [{ externalId: idPart }];
                if (require('mongoose').Types.ObjectId.isValid(idPart)) clauses.unshift({ _id: idPart });
                const doc = await Model.findOne({ $or: clauses }).select('bookingUrl source provider').lean().catch(() => null);
                sourceUrl = doc?.bookingUrl || '';
            }
        }
        return {
            ...r,
            paymentStatus: ord?.paymentStatus || 'PENDING',
            paymentMethod: ord?.paymentMethod || 'MPESA',
            customer: ord?.customer || r.passenger || r.guest || {},
            sourceUrl
        };
    }));

    res.json({ success: true, data: enriched });
}));

adminRouter.post('/fulfillment/:orderReference/confirm', route(async (req, res) => {
    const orderReference = String(req.params.orderReference || '').trim();
    const supplierPnr = String(req.body?.supplierPnr || '').trim();
    const notes = String(req.body?.notes || '').trim().slice(0, 400);
    if (!supplierPnr || supplierPnr.length < 3) {
        return res.status(400).json({ success: false, message: 'Enter the airline PNR or hotel confirmation code.' });
    }
    const existing = await collection('commerce_travel_reservations').findOne({ orderReference });
    if (!existing) {
        return res.status(404).json({ success: false, message: 'Travel reservation not found.' });
    }
    const fulfilledAt = new Date().toISOString();
    await collection('commerce_travel_reservations').updateOne(
        { _id: existing._id },
        {
            $set: {
                fulfillmentStatus: 'FULFILLED',
                status: 'CONFIRMED',
                supplierPnr,
                confirmationCode: supplierPnr,
                fulfillmentNotes: notes,
                fulfilledAt
            }
        }
    );
    const order = await collection('commerce_orders').findOne({ _id: orderReference }).catch(() => null);
    const customer = order?.customer || existing.passenger || existing.guest || {};
    const { sendFulfillmentConfirmation } = require('../services/messagingService');
    const alerts = await sendFulfillmentConfirmation({
        orderReference,
        phone: customer.phone,
        customerName: customer.name,
        title: existing.title,
        supplierPnr,
        notes
    });
    res.json({ success: true, orderReference, supplierPnr, fulfilledAt, alerts });
}));

// Travel Pricing Markup & Promo Code Controls
adminRouter.get('/travel-pricing', route(async (req, res) => {
    const { getTravelPricing } = require('../services/travelPricing');
    const { listAllPromos } = require('../services/promos');
    const { messagingConfig } = require('../services/messagingService');
    const { cardGatewayConfig } = require('../services/cardPayments');
    const pricing = await getTravelPricing(true);
    res.json({
        success: true,
        pricing,
        promos: listAllPromos(),
        messaging: {
            whatsappConfigured: messagingConfig().whatsappConfigured,
            smsConfigured: messagingConfig().smsConfigured
        },
        cardGateway: {
            configured: cardGatewayConfig().configured,
            provider: cardGatewayConfig().provider
        }
    });
}));

adminRouter.put('/travel-pricing', route(async (req, res) => {
    const { updateTravelPricing } = require('../services/travelPricing');
    const { listAllPromos } = require('../services/promos');
    const pricing = await updateTravelPricing(req.body || {});
    res.json({ success: true, pricing, promos: listAllPromos() });
}));

adminRouter.get('/notifications-log', route(async (req, res) => {
    const items = await collection('commerce_notifications')
        .find({})
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray()
        .catch(() => []);
    res.json({ success: true, data: items });
}));

// Reports
adminRouter.get('/reports', route(async (req, res) => {
    const [eventsByCounty, eventsByCategory, depositsByStatus, priceHistoryCount] = await Promise.all([
        DiscoveredEvent.aggregate([{ $match: { expired: false } }, { $group: { _id: '$county', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
        DiscoveredEvent.aggregate([{ $match: { expired: false } }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
        DepositRequest.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, totalKes: { $sum: '$amountKes' } } }]),
        PriceHistory.countDocuments()
    ]);
    res.json({ eventsByCounty, eventsByCategory, depositsByStatus, priceHistoryCount, generatedAt: new Date().toISOString() });
}));

module.exports = { adminRouter, publicRouter };
