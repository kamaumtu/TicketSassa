function isValidHttpUrl(url) {
    try {
        const u = new URL(url);
        return ['http:', 'https:'].includes(u.protocol);
    } catch {
        return false;
    }
}

function validateEvent(ev, rules = {}) {
    const missingFields = [];
    const issues = [];
    const now = Date.now();

    if (!ev.name || ev.name.trim().length < 3) missingFields.push('title');
    if (!ev.startsAt || !Number.isFinite(new Date(ev.startsAt).getTime())) missingFields.push('startsAt');
    else if (new Date(ev.startsAt).getTime() <= now) issues.push('Event date is in the past');

    if (!ev.county && !ev.venue) missingFields.push('location');
    if (!isValidHttpUrl(ev.originalUrl)) missingFields.push('sourceUrl');
    if (!ev.image?.url) missingFields.push('image');

    if (ev._missingExactDate) issues.push('Exact event start time/date pending source verification');
    if (rules.requirePrice && ev.confirmedPriceKes == null && ev.estimatedPriceKes == null) {
        issues.push('Price missing and requirePrice rule enabled');
    }
    if (rules.requireOfficialImage && ev.image?.kind === 'category_placeholder') {
        issues.push('Official poster missing and requireOfficialImage rule enabled');
    }

    const valid = !missingFields.includes('title') && !missingFields.includes('startsAt') && !issues.includes('Event date is in the past');
    const autoPublishEligible = valid && missingFields.length === 0 && issues.length === 0 && (rules.events !== false);

    return { valid, autoPublishEligible, missingFields, issues };
}

function validateFlight(fl, rules = {}) {
    const missingFields = [];
    const issues = [];

    if (!fl.airline) missingFields.push('airline');
    if (!fl.originCode || !fl.destinationCode) missingFields.push('route');
    if (!isValidHttpUrl(fl.bookingUrl)) missingFields.push('bookingUrl');
    if (rules.requirePrice && fl.priceKes == null) {
        issues.push('Published fare missing and requirePrice rule enabled');
    }

    const valid = missingFields.length === 0;
    const autoPublishEligible = valid && issues.length === 0 && (rules.flights !== false);
    return { valid, autoPublishEligible, missingFields, issues };
}

function validateHoliday(hl, rules = {}) {
    const missingFields = [];
    const issues = [];

    if (!hl.title || hl.title.trim().length < 4) missingFields.push('title');
    if (!hl.destination) missingFields.push('destination');
    if (!isValidHttpUrl(hl.bookingUrl)) missingFields.push('bookingUrl');
    if (rules.requirePrice && hl.priceKes == null) {
        issues.push('Published package price missing and requirePrice rule enabled');
    }

    const valid = !missingFields.includes('title') && !missingFields.includes('destination');
    const autoPublishEligible = valid && missingFields.length === 0 && issues.length === 0 && (rules.holidays !== false);
    return { valid, autoPublishEligible, missingFields, issues };
}

module.exports = {
    isValidHttpUrl,
    validateEvent,
    validateFlight,
    validateHoliday
};
