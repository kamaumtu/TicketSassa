function isRemovedVenue(event) {
    const venue = [event?.venue?.name ?? event?.venue, event?.locationFull]
        .filter(value => typeof value === 'string').join(' ');
    return /\btalanta\b|\braila\s+odinga(?:\s+international)?\s+stadium\b/i.test(venue);
}

module.exports = { isRemovedVenue };
