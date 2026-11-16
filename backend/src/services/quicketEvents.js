const ENDPOINT = 'https://api.quicket.co.za/api/events';
const DAY = 86400000;

function kenyaListing(event, now) {
    if (!Number.isSafeInteger(event?.id) || event.id < 1 ||
        typeof event.name !== 'string' || !event.name.trim() ||
        typeof event.startDate !== 'string') return null;
    let url;
    try {
        url = new URL(event.url);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const kenyaHost = ['quicket.co.ke', 'www.quicket.co.ke'].includes(url.hostname);
    const kenyaCountry = ['KE', 'KENYA'].includes(String(event.locality?.countryCode ?? event.locality?.country).toUpperCase());
    if (!kenyaHost && !kenyaCountry) return null;
    const date = event.startDate;
    const startsAt = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(date) ? date : date + '+03:00');
    if (!(startsAt > now)) return null;
    return {
        id: 'quicket:' + event.id, title: event.name.trim().slice(0, 200), startsAt: new Date(startsAt).toISOString(),
        venue: typeof event.venue?.name === 'string' ? event.venue.name : '',
        city: typeof event.locality?.city === 'string' ? event.locality.city : '',
        source: 'Quicket', price: null, checkout: false
    };
}

async function request(url, fetchPage, signal) {
    let response;
    try {
        response = await fetchPage(url, { redirect: 'error', signal });
    } catch {
        throw new Error('Quicket request failed');
    }
    if (!response.ok) throw new Error('Quicket HTTP ' + response.status);
    const body = await response.json().catch(() => null);
    if (!body) throw new Error('Invalid Quicket events response');
    return body;
}

async function fetchQuicketEvents({ key, eventIds = [], fetchPage = fetch, now = Date.now() }) {
    const listings = new Map();
    const deadline = AbortSignal.timeout(20000);
    if (eventIds.length) {
        for (const id of eventIds) {
            if (!/^\d{1,12}$/.test(id)) throw new Error('Quicket event IDs must be numeric');
            const url = new URL(ENDPOINT + '/' + id);
            url.searchParams.set('api_key', key);
            const body = await request(url, fetchPage, deadline);
            const event = body.result ?? body;
            const listing = kenyaListing(event, now);
            if (listing) listings.set(listing.id, listing);
        }
        return [...listings.values()];
    }
    for (let page = 1; page <= 3; page++) {
        const url = new URL(ENDPOINT);
        url.search = new URLSearchParams({
            api_key: key, page: String(page), pageSize: '25',
            lastModified: new Date(now - 30 * DAY).toISOString()
        });
        const body = await request(url, fetchPage, deadline);
        if (!Array.isArray(body.results)) throw new Error('Invalid Quicket events response');
        for (const event of body.results) {
            const listing = kenyaListing(event, now);
            if (listing) listings.set(listing.id, listing);
        }
        if (!(page < body.pages)) break;
    }
    return [...listings.values()];
}

module.exports = { ENDPOINT, fetchQuicketEvents };
