const ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';

async function fetchTicketmasterEvents({ key, fetchPage = fetch, now = Date.now() }) {
    const listings = new Map();
    for (let page = 0; page < 3; page++) {
        const url = new URL(ENDPOINT);
        url.search = new URLSearchParams({
            apikey: key, countryCode: 'KE', startDateTime: new Date(now).toISOString().replace(/\.\d{3}Z$/, 'Z'),
            sort: 'date,asc', size: '100', page: String(page)
        });
        let response;
        try {
            response = await fetchPage(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
        } catch {
            throw new Error('Ticketmaster request failed');
        }
        if (!response.ok) throw new Error('Ticketmaster HTTP ' + response.status);
        const body = await response.json().catch(() => null);
        const events = body?._embedded?.events ?? (body?.page?.totalElements === 0 ? [] : null);
        if (!Array.isArray(events)) throw new Error('Invalid Ticketmaster events response');
        for (const event of events) {
            const venue = event?._embedded?.venues?.find(item => item?.country?.countryCode === 'KE');
            const startsAt = Date.parse(event?.dates?.start?.dateTime);
            if (!venue || !(startsAt > now) || !['onsale', 'offsale'].includes(event?.dates?.status?.code) ||
                typeof event.id !== 'string' || !/^[\w-]{1,100}$/.test(event.id) ||
                typeof event.name !== 'string' || !event.name.trim()) continue;
            listings.set(event.id, {
                id: 'ticketmaster:' + event.id, title: event.name.trim().slice(0, 200),
                startsAt: new Date(startsAt).toISOString(), venue: venue.name ?? '', city: venue.city?.name ?? '',
                source: 'Ticketmaster', checkout: false, price: null
            });
        }
        if (!(page + 1 < body.page?.totalPages)) break;
    }
    return [...listings.values()];
}

module.exports = { ENDPOINT, fetchTicketmasterEvents };
