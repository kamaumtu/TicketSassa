const { normalizeProviderEvent } = require('./baseProvider');

const DEFAULT_BASE_URL = 'https://api.egotickets.com/v1';

async function fetchEgoticketsEvents({ key, baseUrl = process.env.EGOTICKETS_BASE_URL || DEFAULT_BASE_URL, fetchPage = fetch, now = Date.now() }) {
    if (!key) return [];
    const base = String(baseUrl).replace(/\/+$/, '');
    const url = new URL(`${base}/partner/events`);
    url.searchParams.set('country', 'KE');

    let response;
    try {
        response = await fetchPage(url, {
            headers: {
                Accept: 'application/json',
                'X-API-Key': key
            },
            redirect: 'error',
            signal: AbortSignal.timeout(15000)
        });
    } catch {
        throw new Error('eGotickets API request failed');
    }
    if (!response.ok) throw new Error('eGotickets API HTTP ' + response.status);
    const body = await response.json().catch(() => null);
    const rows = Array.isArray(body?.events) ? body.events : Array.isArray(body?.data) ? body.data : null;
    if (!rows) throw new Error('Invalid eGotickets API response');

    const results = [];
    for (const ev of rows) {
        const startsAt = Date.parse(ev?.startsAt || ev?.start_date);
        if (!(startsAt > now)) continue;
        const normalized = normalizeProviderEvent({
            id: `egotickets:${ev.id}`,
            source: 'eGotickets',
            title: ev.title || ev.name,
            description: ev.description,
            startsAt: new Date(startsAt).toISOString(),
            venue: ev.venue_name || ev.venue || '',
            city: ev.city || 'Nairobi',
            imageUrl: ev.image || ev.poster_url,
            sourceUrl: ev.url || ev.ticket_url,
            status: ['cancelled', 'canceled'].includes(String(ev.status || '').toLowerCase()) ? 'cancelled' : 'published',
            tiers: Array.isArray(ev.ticket_types) ? ev.ticket_types.map((t, i) => ({
                id: t.id || i + 1,
                title: t.name || t.title,
                priceKes: t.price_kes ?? t.price,
                remainingAllocation: t.available ?? t.quantity,
                authorized: Boolean(ev.authorizedCheckout ?? t.authorized)
            })) : [],
            authorizedCheckout: Boolean(ev.authorizedCheckout)
        });
        if (normalized) results.push(normalized);
    }
    return results;
}

module.exports = {
    id: 'egotickets',
    label: 'eGotickets Partner API',
    endpointKey: 'provider:egotickets',
    isEnabled: (env = process.env) => Boolean(env.EGOTICKETS_API_KEY?.trim()),
    fetchEvents: ({ env = process.env, fetchPage = fetch, now = Date.now() }) =>
        fetchEgoticketsEvents({ key: env.EGOTICKETS_API_KEY?.trim(), baseUrl: env.EGOTICKETS_BASE_URL || DEFAULT_BASE_URL, fetchPage, now })
};
