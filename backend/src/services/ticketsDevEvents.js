const ENDPOINT = 'https://api.tickets.dev/v1/events';

function listingsFromPage(body, now) {
    if (!Array.isArray(body?.events)) throw new Error('Invalid Tickets.dev events response');
    const listings = [];
    for (const event of body.events) {
        if (typeof event?.id !== 'string' || !/^[\w-]{1,100}$/.test(event.id) ||
            typeof event.name !== 'string' || !event.name.trim() ||
            !['KE', 'KENYA'].includes(String(event.venue?.country).trim().toUpperCase())) continue;
        const startsAt = Date.parse(event.eventDateUtc);
        if (!(startsAt > now)) continue;
        listings.push({
            id: 'ticketsdev:' + event.id,
            title: event.name.trim().slice(0, 200),
            startsAt: new Date(startsAt).toISOString(),
            venue: typeof event.venue.name === 'string' ? event.venue.name : '',
            city: typeof event.venue.city === 'string' ? event.venue.city : '',
            source: 'Tickets.dev',
            price: null,
            checkout: false
        });
    }
    return listings;
}

async function fetchTicketsDevEvents({ key, queries, fetchPage = fetch, now = Date.now() }) {
    const listings = new Map();
    const from = new Date(now).toISOString();
    for (const query of queries) {
        for (let page = 1; page <= 3; page++) {
            const url = new URL(ENDPOINT);
            url.search = new URLSearchParams({ query, from, page: String(page), pageSize: '100' });
            const response = await fetchPage(url, {
                headers: { 'x-api-key': key, Accept: 'application/json' },
                redirect: 'error',
                signal: AbortSignal.timeout(10000)
            });
            if (!response.ok) throw new Error('Tickets.dev HTTP ' + response.status);
            const body = await response.json();
            for (const event of listingsFromPage(body, now)) listings.set(event.id, event);
            if (body.hasMore !== true) break;
        }
    }
    return [...listings.values()];
}

module.exports = { ENDPOINT, fetchTicketsDevEvents };
