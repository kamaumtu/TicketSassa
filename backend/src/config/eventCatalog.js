const localEvents = require('./localEvents.json');

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
                startsAt: new Date(startsAt).toISOString(),
                venue: event.location.name?.trim(),
                city: address.addressLocality?.trim(),
                price: prices.length ? { amount: Math.min(...prices), currency: 'KES' } : null,
                imageUrl: image?.href ?? null,
                source: 'SoldOut Africa'
            });
        }
        return [...listings.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    throw new Error('SoldOut Africa event list missing from source response.');
}

function createEventCatalog({ fetchPage = fetch } = {}) {
    let events = localEvents;
    let updatedAt = null;
    let stale = false;
    let pending;

    function refresh() {
        pending ??= (async () => {
            const response = await fetchPage(SOURCE, {
                headers: { Accept: 'text/html' },
                signal: AbortSignal.timeout(15000)
            });
            if (!response.ok) throw new Error('SoldOut Africa HTTP ' + response.status);
            events = parseListings(await response.text());
            updatedAt = new Date().toISOString();
            stale = false;
        })().catch(error => {
            stale = true;
            console.warn('SoldOut Africa refresh failed:', error.message);
        }).finally(() => { pending = null; });
        return pending;
    }

    return {
        start() {
            void refresh();
            setInterval(refresh, REFRESH_MS).unref();
        },
        get() {
            return {
                events: events.filter(event => Date.parse(event.startsAt) > Date.now()),
                updatedAt,
                status: !updatedAt ? 'local' : stale ? 'stale' : 'live'
            };
        },
        refresh
    };
}

module.exports = { createEventCatalog, parseListings };
