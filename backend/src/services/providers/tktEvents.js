const { normalizeProviderEvent } = require('./baseProvider');

const DEFAULT_BASE_URL = 'https://api.tkt.co.ke/v1';

async function fetchTktEvents({ key, baseUrl = process.env.TKT_API_BASE_URL || DEFAULT_BASE_URL, fetchPage = fetch, now = Date.now() }) {
    if (!key) return [];
    const base = String(baseUrl).replace(/\/+$/, '');
    const url = new URL(`${base}/events`);
    url.searchParams.set('country', 'KE');
    url.searchParams.set('status', 'published,cancelled');

    let response;
    try {
        response = await fetchPage(url, {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${key}`
            },
            redirect: 'error',
            signal: AbortSignal.timeout(15000)
        });
    } catch {
        throw new Error('TKT API request failed');
    }
    if (!response.ok) throw new Error('TKT API HTTP ' + response.status);
    const body = await response.json().catch(() => null);
    const rows = Array.isArray(body?.events) ? body.events : Array.isArray(body?.data) ? body.data : null;
    if (!rows) throw new Error('Invalid TKT API response');

    const results = [];
    for (const ev of rows) {
        const startsAt = Date.parse(ev?.startsAt || ev?.startDate);
        if (!(startsAt > now)) continue;
        const normalized = normalizeProviderEvent({
            id: `tkt:${ev.id}`,
            source: 'TKT',
            title: ev.title || ev.name,
            description: ev.description,
            startsAt: new Date(startsAt).toISOString(),
            venue: ev.venue?.name || ev.venue || '',
            city: ev.venue?.city || ev.city || 'Nairobi',
            imageUrl: ev.posterUrl || ev.imageUrl,
            sourceUrl: ev.url || ev.sourceUrl,
            status: ev.status === 'cancelled' ? 'cancelled' : 'published',
            tiers: Array.isArray(ev.tiers) ? ev.tiers : [],
            authorizedCheckout: Boolean(ev.authorizedCheckout ?? ev.sellable)
        });
        if (normalized) results.push(normalized);
    }
    return results;
}

module.exports = {
    id: 'tkt',
    label: 'TKT API',
    endpointKey: 'provider:tkt',
    isEnabled: (env = process.env) => Boolean(env.TKT_API_KEY?.trim()),
    fetchEvents: ({ env = process.env, fetchPage = fetch, now = Date.now() }) =>
        fetchTktEvents({ key: env.TKT_API_KEY?.trim(), baseUrl: env.TKT_API_BASE_URL || DEFAULT_BASE_URL, fetchPage, now })
};
