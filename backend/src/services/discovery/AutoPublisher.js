const {
    DiscoveredEvent,
    FlightListing,
    HolidayPackage,
    PriceHistory,
    DiscoveryLog
} = require('../../models/automation');
const {
    computeEventDedupeKey,
    computeFlightDedupeKey,
    computeHolidayDedupeKey,
    findExistingDuplicate
} = require('./DuplicateDetector');
const {
    validateEvent,
    validateFlight,
    validateHoliday
} = require('./ListingValidator');
const { emitToAdmins } = require('../automation/socketHub');

async function writeLog({ kind, sourceName = '', url = '', entityType = 'system', entityId = '', message, details = {} }) {
    await DiscoveryLog.create({
        kind, sourceName, url, entityType, entityId, message, details, createdAt: new Date()
    }).catch(() => {});
}

async function estimateComparableEventPrice(category, county) {
    const comparable = await DiscoveredEvent.find({
        category,
        confirmedPriceKes: { $gt: 0 }
    }).select('confirmedPriceKes county').limit(25).lean().catch(() => []);
    const sameCounty = comparable.filter(c => c.county === county);
    const pool = sameCounty.length >= 2 ? sameCounty : comparable;
    if (!pool.length) return null; // Only compute estimate when comparable verified events exist!
    const avg = pool.reduce((sum, item) => sum + item.confirmedPriceKes, 0) / pool.length;
    return Math.max(300, Math.round(avg / 100) * 100);
}

async function publishEvents(candidates = [], sourceName, settings = {}) {
    const rules = settings.autoPublish || { events: true };
    let createdCount = 0;
    let updatedCount = 0;
    let duplicatesDetected = 0;
    let publishedCount = 0;
    let queuedForReviewCount = 0;

    for (const raw of candidates) {
        const dedupeKey = computeEventDedupeKey(raw);
        const existing = await findExistingDuplicate(DiscoveredEvent, raw.externalId, dedupeKey);
        if (existing && existing.externalId !== raw.externalId) {
            duplicatesDetected++;
        }

        const item = { ...raw, dedupeKey };
        if (item.confirmedPriceKes == null && item.estimatedPriceKes == null) {
            const est = await estimateComparableEventPrice(item.category, item.county);
            item.estimatedPriceKes = est != null ? est : 1000;
            item.priceType = 'estimated';
        }

        const check = validateEvent(item, rules);
        if (!check.valid) continue;

        const approvalStatus = existing?.approvalStatus === 'rejected'
            ? 'rejected'
            : 'approved';

        if (approvalStatus === 'approved') publishedCount++;
        else if (approvalStatus === 'pending') queuedForReviewCount++;

        const preservedImage = (item.image?.kind === 'category_placeholder' && existing?.image?.url && existing.image.kind !== 'category_placeholder')
            ? existing.image
            : item.image;

        const effectiveConfirmed = item.confirmedPriceKes ?? existing?.confirmedPriceKes ?? null;
        const effectiveEstimated = effectiveConfirmed != null ? null : (item.estimatedPriceKes ?? existing?.estimatedPriceKes ?? 1000);
        const basePriceKes = Math.max(1, Math.round(Number(effectiveConfirmed ?? effectiveEstimated ?? 1000)));
        const rawCategories = item.ticketCategories?.length ? item.ticketCategories : (existing?.ticketCategories || []);
        const normalizedCategories = rawCategories.length
            ? rawCategories.map(c => ({
                name: c.name || 'Regular',
                priceKes: Math.max(1, Math.round(Number(c.priceKes) || basePriceKes)),
                priceType: c.priceType || (effectiveConfirmed != null ? 'verified' : 'estimated'),
                capacity: Math.max(100, Number(c.capacity) || 1000)
            }))
            : [
                { name: 'General Admission', priceKes: basePriceKes, priceType: effectiveConfirmed != null ? 'verified' : 'estimated', capacity: 1000 },
                { name: 'VIP Pass', priceKes: Math.min(1000000, Math.max(basePriceKes + 1000, basePriceKes * 2)), priceType: effectiveConfirmed != null ? 'verified' : 'estimated', capacity: 500 }
            ];

        const payload = {
            externalId: existing?.externalId || item.externalId,
            dedupeKey,
            name: item.name,
            description: item.description || existing?.description || '',
            category: item.category,
            startsAt: item.startsAt,
            endsAt: item.endsAt || existing?.endsAt || null,
            county: item.county,
            town: item.town || item.county,
            venue: item.venue || existing?.venue || item.county,
            organizer: item.organizer || existing?.organizer || sourceName,
            originalUrl: item.originalUrl || existing?.originalUrl || '',
            ticketPurchaseUrl: item.ticketPurchaseUrl || item.originalUrl || existing?.ticketPurchaseUrl || '',
            ticketCategories: normalizedCategories,
            confirmedPriceKes: effectiveConfirmed,
            estimatedPriceKes: effectiveEstimated,
            priceType: effectiveConfirmed != null ? 'verified' : 'estimated',
            image: preservedImage,
            discoverySource: existing?.discoverySource || sourceName,
            approvalStatus,
            authorizedToSell: true,
            availabilityStatus: 'available',
            autoPublished: approvalStatus === 'approved' && existing?.approvalStatus !== 'approved',
            publishedAt: approvalStatus === 'approved' ? (existing?.publishedAt || new Date()) : existing?.publishedAt || null,
            missingFields: check.missingFields,
            validationIssues: check.issues,
            lastVerifiedAt: new Date(),
            expired: false
        };

        delete payload._missingExactDate;

        if (existing) {
            await DiscoveredEvent.updateOne({ _id: existing._id }, { $set: payload });
            updatedCount++;
        } else {
            await DiscoveredEvent.create(payload);
            createdCount++;
            await writeLog({
                kind: 'image',
                sourceName,
                url: payload.originalUrl,
                entityType: 'event',
                entityId: payload.externalId,
                message: `Collected ${payload.image?.kind || 'image'} for "${payload.name}"`,
                details: { imageUrl: payload.image?.url, license: payload.image?.license }
            });
            await writeLog({
                kind: approvalStatus === 'approved' ? 'publish' : 'extraction',
                sourceName,
                url: payload.originalUrl,
                entityType: 'event',
                entityId: payload.externalId,
                message: approvalStatus === 'approved'
                    ? `Auto-published event "${payload.name}" (${payload.county})`
                    : `Queued "${payload.name}" for verification: ${check.issues.join(', ') || check.missingFields.join(', ')}`
            });
        }

        const priceTrack = payload.confirmedPriceKes ?? payload.estimatedPriceKes;
        if (priceTrack) {
            await PriceHistory.create({
                entityType: 'event',
                entityId: payload.externalId,
                category: payload.category,
                priceKes: priceTrack,
                currency: 'KES',
                priceType: payload.confirmedPriceKes != null ? 'verified' : 'estimated',
                recordedAt: new Date()
            }).catch(() => {});
        }
    }

    return { createdCount, updatedCount, duplicatesDetected, publishedCount, queuedForReviewCount };
}

async function publishFlights(candidates = [], sourceName, settings = {}) {
    const rules = settings.autoPublish || { flights: true };
    let createdCount = 0;
    let updatedCount = 0;
    let duplicatesDetected = 0;
    let publishedCount = 0;
    let queuedForReviewCount = 0;

    for (const raw of candidates) {
        const dedupeKey = computeFlightDedupeKey(raw);
        const existing = await findExistingDuplicate(FlightListing, raw.externalId, dedupeKey);
        if (existing && existing.externalId !== raw.externalId) duplicatesDetected++;

        const check = validateFlight(raw, rules);
        if (!check.valid) continue;

        const approvalStatus = existing?.approvalStatus === 'rejected'
            ? 'rejected'
            : 'approved';

        if (approvalStatus === 'approved') publishedCount++;
        else if (approvalStatus === 'pending') queuedForReviewCount++;

        const { resolveFlightPriceKes } = require('../flightCatalog');
        const mergedPrice = raw.priceKes ?? existing?.priceKes ?? resolveFlightPriceKes({ ...existing, ...raw });
        const rawBag = raw.baggageAllowance || existing?.baggageAllowance || '';
        const cleanBaggage = (rawBag && !/booking link/i.test(rawBag)) ? rawBag : '23kg Checked + 7kg Cabin Included';
        const payload = {
            externalId: existing?.externalId || raw.externalId,
            dedupeKey,
            airline: raw.airline || existing?.airline,
            airlineLogo: raw.airlineLogo || existing?.airlineLogo || '/assets/airlines/kenya-airways.svg',
            flightNumber: raw.flightNumber || existing?.flightNumber || '',
            originCode: raw.originCode,
            originName: raw.originName || existing?.originName || raw.originCode,
            destinationCode: raw.destinationCode,
            destinationName: raw.destinationName || existing?.destinationName || raw.destinationCode,
            routeSummary: raw.routeSummary || existing?.routeSummary || `${raw.originCode} → ${raw.destinationCode}`,
            isRouteOnly: (raw.departureTime || existing?.departureTime) ? false : Boolean(raw.isRouteOnly ?? true),
            departureTime: raw.departureTime || existing?.departureTime || null,
            arrivalTime: raw.arrivalTime || existing?.arrivalTime || null,
            duration: raw.duration || existing?.duration || '',
            priceKes: mergedPrice,
            currency: raw.currency || existing?.currency || 'KES',
            priceType: 'verified',
            priceStatus: 'verified',
            baggageAllowance: cleanBaggage,
            bookingUrl: raw.bookingUrl || existing?.bookingUrl || '',
            source: existing?.source || sourceName,
            dataMode: raw.dataMode || existing?.dataMode || 'public_web',
            approvalStatus,
            autoPublished: approvalStatus === 'approved' && existing?.approvalStatus !== 'approved',
            publishedAt: approvalStatus === 'approved' ? (existing?.publishedAt || new Date()) : existing?.publishedAt || null,
            validationIssues: check.issues,
            lastVerifiedAt: new Date()
        };

        if (existing) {
            await FlightListing.updateOne({ _id: existing._id }, { $set: payload });
            updatedCount++;
        } else {
            await FlightListing.create(payload);
            createdCount++;
            await writeLog({
                kind: approvalStatus === 'approved' ? 'publish' : 'extraction',
                sourceName,
                url: payload.bookingUrl,
                entityType: 'flight',
                entityId: payload.externalId,
                message: `Discovered & ${approvalStatus === 'approved' ? 'auto-published' : 'queued'} flight route ${payload.airline} (${payload.originCode} → ${payload.destinationCode})`
            });
        }
    }

    return { createdCount, updatedCount, duplicatesDetected, publishedCount, queuedForReviewCount };
}

async function publishHolidays(candidates = [], sourceName, settings = {}) {
    const rules = settings.autoPublish || { holidays: true };
    let createdCount = 0;
    let updatedCount = 0;
    let duplicatesDetected = 0;
    let publishedCount = 0;
    let queuedForReviewCount = 0;

    for (const raw of candidates) {
        const dedupeKey = computeHolidayDedupeKey(raw);
        const existing = await findExistingDuplicate(HolidayPackage, raw.externalId, dedupeKey);
        if (existing && existing.externalId !== raw.externalId) duplicatesDetected++;

        const check = validateHoliday(raw, rules);
        if (!check.valid) continue;

        const approvalStatus = existing?.approvalStatus === 'rejected'
            ? 'rejected'
            : 'approved';

        if (approvalStatus === 'approved') publishedCount++;
        else if (approvalStatus === 'pending') queuedForReviewCount++;

        const { resolveHolidayPriceKes } = require('../holidayCatalog');
        const mergedPriceKes = raw.priceKes ?? existing?.priceKes ?? resolveHolidayPriceKes({ ...existing, ...raw });
        const mergedPricePerPerson = raw.pricePerPerson ?? existing?.pricePerPerson ?? mergedPriceKes;
        const nights = Math.max(1, Number(raw.nights ?? existing?.nights) || 2);
        const incomingImg = raw.images?.[0];
        const existingImg = existing?.images?.[0];
        const mergedImages = (incomingImg?.kind === 'category_placeholder' && existingImg?.url && existingImg.kind !== 'category_placeholder')
            ? existing.images
            : (raw.images?.length ? raw.images : (existing?.images || []));

        const payload = {
            externalId: existing?.externalId || raw.externalId,
            dedupeKey,
            title: raw.title,
            description: raw.description || existing?.description || '',
            category: raw.category || existing?.category || 'Safari Packages',
            destination: raw.destination || existing?.destination || 'Kenya',
            country: raw.country || existing?.country || 'Kenya',
            images: mergedImages,
            accommodation: raw.accommodation || existing?.accommodation || '',
            duration: raw.duration || existing?.duration || `${nights + 1}D / ${nights}N`,
            nights,
            activities: raw.activities?.length ? raw.activities : (existing?.activities || []),
            transport: raw.transport || existing?.transport || 'Return Transfers Included',
            meals: raw.meals || existing?.meals || 'Half Board Dining Included',
            pricePerPerson: mergedPricePerPerson,
            currency: raw.currency || existing?.currency || 'KES',
            priceKes: mergedPriceKes,
            exchangeRateUsed: raw.exchangeRateUsed || existing?.exchangeRateUsed || 1,
            exchangeRateTimestamp: raw.exchangeRateTimestamp || existing?.exchangeRateTimestamp || new Date(),
            priceType: 'verified',
            priceStatus: 'verified',
            availability: (raw.availability === 'sold_out' || existing?.availability === 'sold_out') ? 'sold_out' : 'available',
            travelDates: raw.travelDates || existing?.travelDates || 'Flexible Dates',
            provider: existing?.provider || sourceName,
            bookingUrl: raw.bookingUrl || existing?.bookingUrl || '',
            approvalStatus,
            autoPublished: approvalStatus === 'approved' && existing?.approvalStatus !== 'approved',
            publishedAt: approvalStatus === 'approved' ? (existing?.publishedAt || new Date()) : existing?.publishedAt || null,
            validationIssues: check.issues,
            lastVerifiedAt: new Date()
        };

        if (existing) {
            await HolidayPackage.updateOne({ _id: existing._id }, { $set: payload });
            updatedCount++;
        } else {
            await HolidayPackage.create(payload);
            createdCount++;
            await writeLog({
                kind: 'image',
                sourceName,
                url: payload.bookingUrl,
                entityType: 'holiday',
                entityId: payload.externalId,
                message: `Collected ${mergedImages[0]?.kind || 'image'} for holiday package "${payload.title}"`,
                details: { imageUrl: mergedImages[0]?.url }
            });
            await writeLog({
                kind: approvalStatus === 'approved' ? 'publish' : 'extraction',
                sourceName,
                url: payload.bookingUrl,
                entityType: 'holiday',
                entityId: payload.externalId,
                message: `Discovered & ${approvalStatus === 'approved' ? 'auto-published' : 'queued'} holiday "${payload.title}" (${payload.destination})`
            });
        }

        if (mergedPriceKes != null) {
            await PriceHistory.create({
                entityType: 'holiday',
                entityId: payload.externalId,
                category: payload.category,
                priceKes: mergedPriceKes,
                currency: 'KES',
                priceType: 'verified',
                recordedAt: new Date()
            }).catch(() => {});
        }
    }

    return { createdCount, updatedCount, duplicatesDetected, publishedCount, queuedForReviewCount };
}

async function unpublishExpiredListings() {
    const now = new Date();
    const evRes = await DiscoveredEvent.updateMany(
        { startsAt: { $lte: now }, expired: false },
        { $set: { expired: true } }
    );
    const flRes = await FlightListing.deleteMany({
        departureTime: { $ne: null, $lte: now }
    });
    const expiredEvents = evRes.modifiedCount || 0;
    const expiredFlights = flRes.deletedCount || 0;
    if (expiredEvents + expiredFlights > 0) {
        await writeLog({
            kind: 'publish',
            sourceName: 'AutoPublisher',
            entityType: 'system',
            message: `Unpublished ${expiredEvents} expired event(s) and removed ${expiredFlights} past flight(s).`
        });
        emitToAdmins('discovery:updated', { kind: 'expiration', expiredEvents, expiredFlights });
    }
    return { expiredRemovedCount: expiredEvents + expiredFlights };
}

module.exports = {
    writeLog,
    publishEvents,
    publishFlights,
    publishHolidays,
    unpublishExpiredListings
};
