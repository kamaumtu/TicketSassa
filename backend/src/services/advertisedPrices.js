const supportedHosts = new Set([
    'soldoutafrica.com', 'www.soldoutafrica.com', 'quicket.co.ke', 'www.quicket.co.ke',
    'quicket.co.za', 'www.quicket.co.za'
]);

function priceSourceUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && supportedHosts.has(url.hostname) && !url.port &&
            !url.username && !url.password ? url.href : null;
    } catch { return null; }
}

function advertisedOffers(offers, now = Date.now(), parentCurrency) {
    return (Array.isArray(offers) ? offers : [offers]).flatMap(offer => {
        if (!offer) return [];
        const currency = offer.priceCurrency ?? parentCurrency;
        const availability = String(offer.availability ?? '').split('/').at(-1);
        if (currency && currency !== 'KES' || availability && availability !== 'InStock' ||
            (offer.validFrom && !(Date.parse(offer.validFrom) <= now)) ||
            (offer.priceValidUntil && !(Date.parse(offer.priceValidUntil) >= now))) return [];
        if (Array.isArray(offer.offers) && offer.offers.length) return advertisedOffers(offer.offers, now, currency);
        if (currency !== 'KES' || !/^\d+(?:\.\d{1,2})?$/.test(String(offer.price ?? offer.lowPrice))) return [];
        const amount = Number(offer.price ?? offer.lowPrice);
        if (amount > 1000000) return [];
        return [{ amount, title: typeof offer.name === 'string' ? offer.name.trim().slice(0, 100) : '' }];
    });
}

function priceFromOffers(offers, url, now) {
    if (!offers.length) return null;
    const sorted = offers.sort((a, b) => a.amount - b.amount);
    const unique = new Map(sorted.map(offer => [JSON.stringify(offer), offer]));
    return { amount: sorted[0].amount, currency: 'KES', sourceUrl: url, checkedAt: new Date(now).toISOString(),
        offers: [...unique.values()].slice(0, 20) };
}

function eventNodes(value) {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap(eventNodes);
    return [value, ...eventNodes(value['@graph'])];
}

function normalizedTitle(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function readEventPrice(html, event, sourceUrl, now) {
    for (const [, content] of html.matchAll(/<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        let nodes;
        try { nodes = eventNodes(JSON.parse(content)); } catch { continue; }
        for (const node of nodes) {
            const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
            if (!types.some(type => /Event$/.test(type)) || normalizedTitle(node.name) !== normalizedTitle(event.title) ||
                !(Math.abs(Date.parse(node.startDate) - Date.parse(event.startsAt)) <= 3 * 3600000) ||
                !Object.hasOwn(node, 'offers')) continue;
            return priceFromOffers(advertisedOffers(node.offers, now), sourceUrl, now);
        }
    }
    return undefined;
}

async function refreshAdvertisedPrices(events, fetchPage, now = Date.now(), previousEvents = []) {
    const candidates = events.filter(event => event.status !== 'cancelled' && Date.parse(event.startsAt) > now &&
        (!event.price || event.source === 'Quicket') && (event.pricePageUrls ?? [event.sourceUrl]).some(priceSourceUrl));
    const batchSize = 24;
    const batchCount = Math.ceil(candidates.length / batchSize);
    const offset = batchCount ? (Math.floor(now / (15 * 60000)) % batchCount) * batchSize : 0;
    const batch = candidates.slice(offset, offset + batchSize);
    const budget = AbortSignal.timeout(9000);
    async function worker() {
        while (batch.length && !budget.aborted) {
            const event = batch.shift();
            const urls = (event.pricePageUrls ?? [event.sourceUrl]).map(priceSourceUrl).filter(Boolean).slice(0, 2);
            for (const url of urls) {
                try {
                    const response = await fetchPage(url, { redirect: 'error', headers: { Accept: 'text/html' },
                        signal: AbortSignal.any([budget, AbortSignal.timeout(3500)]) });
                    if (!response.ok) continue;
                    const price = readEventPrice(await response.text(), event, url, now);
                    if (price === undefined) continue;
                    event.price = price;
                    event.advertisedPriceChecked = true;
                    break;
                } catch { /* Other public sources may still have a price. */ }
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(batch.length, 5) }, worker));
    const previousPrices = new Map(previousEvents.map(event => [event.id, event]));
    for (const event of candidates) {
        if (event.advertisedPriceChecked || event.price) continue;
        const prior = previousPrices.get(event.id);
        if (prior?.startsAt === event.startsAt && Date.parse(prior.price?.checkedAt) >= now - 3600000 &&
            (event.pricePageUrls ?? [event.sourceUrl]).map(priceSourceUrl).includes(prior.price.sourceUrl)) event.price = prior.price;
    }
}

module.exports = { priceSourceUrl, advertisedOffers, priceFromOffers, refreshAdvertisedPrices };
