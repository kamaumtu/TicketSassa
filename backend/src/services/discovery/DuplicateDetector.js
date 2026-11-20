const { createHash } = require('node:crypto');
const { DiscoveredEvent, FlightListing, HolidayPackage } = require('../../models/automation');

function normalizeText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function computeEventDedupeKey(ev) {
    const day = ev?.startsAt ? new Date(ev.startsAt).toISOString().slice(0, 10) : '';
    const title = normalizeText(ev?.name || ev?.title);
    const county = normalizeText(ev?.county || ev?.city || 'kenya');
    if (!title || !day) return '';
    return createHash('sha1').update(`event|${title}|${day}|${county}`).digest('hex');
}

function computeFlightDedupeKey(fl) {
    const airline = normalizeText(fl?.airline);
    const orig = normalizeText(fl?.originCode);
    const dest = normalizeText(fl?.destinationCode);
    const fn = normalizeText(fl?.flightNumber).replace(/\s+/g, '');
    return createHash('sha1').update(`flight|${airline}|${orig}|${dest}|${fn}`).digest('hex');
}

function computeHolidayDedupeKey(hl) {
    const title = normalizeText(hl?.title);
    const dest = normalizeText(hl?.destination);
    return createHash('sha1').update(`holiday|${title}|${dest}`).digest('hex');
}

async function findExistingDuplicate(Model, externalId, dedupeKey) {
    const clauses = [];
    if (externalId) clauses.push({ externalId });
    if (dedupeKey) clauses.push({ dedupeKey });
    if (!clauses.length) return null;
    return Model.findOne({ $or: clauses });
}

async function cleanupModelDuplicates(Model, keyFn) {
    const docs = await Model.find({}).sort({ updatedAt: -1 }).lean();
    const seen = new Set();
    const toDelete = [];
    for (const doc of docs) {
        const key = doc.dedupeKey || keyFn(doc);
        if (!key) continue;
        if (seen.has(key)) {
            toDelete.push(doc._id);
        } else {
            seen.add(key);
        }
    }
    if (toDelete.length) {
        await Model.deleteMany({ _id: { $in: toDelete } });
    }
    return toDelete.length;
}

async function cleanupAllDuplicates() {
    const [eventsRemoved, flightsRemoved, holidaysRemoved] = await Promise.all([
        cleanupModelDuplicates(DiscoveredEvent, computeEventDedupeKey),
        cleanupModelDuplicates(FlightListing, computeFlightDedupeKey),
        cleanupModelDuplicates(HolidayPackage, computeHolidayDedupeKey)
    ]);
    return {
        eventsRemoved,
        flightsRemoved,
        holidaysRemoved,
        totalRemoved: eventsRemoved + flightsRemoved + holidaysRemoved
    };
}

module.exports = {
    computeEventDedupeKey,
    computeFlightDedupeKey,
    computeHolidayDedupeKey,
    findExistingDuplicate,
    cleanupAllDuplicates
};
