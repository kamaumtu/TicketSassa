const ENDPOINT = 'https://api.quicket.co.za/api/events';
const { priceFromOffers, priceSourceUrl } = require('./advertisedPrices');
const DAY = 86400000;

const DEFAULT_KENYA_EVENT_IDS = [
    '406815', // Sweet November Special - KODA Nairobi
    '390611', // Keinemusik Nairobi - Uhuru Gardens Memorial Park
    '395475', // Komplex Presents DESCENDANTS - Nairobi
    '400840', // SONDELA NAIROBI 2026 - KODA Nairobi
    '404873', // UNTIL DAWN - Kitui eco Park resort
    '405760', // Between the Baobabs 5th December - Kilifi
    '400286', // Flava Meats Vibes - East Africa
    '400586', // Flava Meats Vibes Kenya
    '406227', // Christmas Candlelight Strings - The Social House Nairobi
    '402202', // Soundcheck & Afterburn - Distant Relatives Ecolodge Kilifi
    '364819', // Beneath the Baobabs Festival 2027 - Kilifi
    '395332', // KOMPLEX NYE 2027 - Sun Palm Beach Resort Watamu
    '404817', // DANCE AND GO HOME: NAIROBI AT MASSHOUSE
    '399552'  // ENOO NAPA: THIRTEEN RESIDENCY - KODA Nairobi
];

function stripHtml(html) {
    if (typeof html !== 'string') return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function normalizeQuicketImage(imageUrl) {
    if (typeof imageUrl !== 'string' || !imageUrl.trim()) return null;
    const raw = imageUrl.trim();
    if (raw.startsWith('//')) return 'https:' + raw;
    if (raw.startsWith('https://') || raw.startsWith('http://')) return raw;
    return null;
}

function kenyaListing(event, now) {
    if (!Number.isSafeInteger(event?.id) || event.id < 1 ||
        typeof event.name !== 'string' || !event.name.trim() ||
        typeof event.startDate !== 'string') return null;
    let url;
    try {
        url = new URL(event.url || `https://www.quicket.co.ke/events/${event.id}`);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password) return null;

    const levelOne = String(event.locality?.levelOne ?? event.locality?.countryCode ?? event.locality?.country ?? '').trim();
    const levelTwo = String(event.locality?.levelTwo ?? '').trim();
    const levelThree = String(event.locality?.levelThree ?? event.locality?.city ?? '').trim();
    const venueName = typeof event.venue?.name === 'string' ? event.venue.name.trim() : '';

    const kenyaHost = ['quicket.co.ke', 'www.quicket.co.ke'].includes(url.hostname);
    const kenyaCountry = ['KE', 'KENYA'].includes(levelOne.toUpperCase()) ||
        /kenya|nairobi|mombasa|kilifi|watamu|diani|kisumu|nakuru|naivasha|kitui/i.test([levelOne, levelTwo, levelThree, venueName, event.name].join(' '));
    if (!kenyaHost && !kenyaCountry) return null;

    const date = event.startDate;
    const endDate = event.endDate || event.startDate;
    const startsAtMs = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(date) ? date : date + '+03:00');
    const endsAtMs = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(endDate) ? endDate : endDate + '+03:00');
    const effectiveStartMs = startsAtMs > now ? startsAtMs : (endsAtMs > now ? endsAtMs : null);
    if (!effectiveStartMs) return null;

    const rawTickets = Array.isArray(event.tickets) ? event.tickets : [];
    const advertisedPrices = rawTickets.filter(ticket => ticket && !ticket.soldOut && !ticket.provisionallySoldOut &&
        String(ticket.currencyCode ?? ticket.currency ?? event.currencyCode ?? event.currency ?? 'KES').toUpperCase() === 'KES' &&
        /^\d+(?:\.\d+)?$/.test(String(ticket.price)))
        .map(ticket => ({ amount: Number(ticket.price), title: typeof ticket.name === 'string' ? ticket.name.trim().slice(0, 100) : '' }))
        .filter(ticket => Number.isFinite(ticket.amount) && ticket.amount > 0 && ticket.amount <= 1000000);
    const price = priceFromOffers(advertisedPrices, priceSourceUrl(url.href), now);
    const imageUrl = normalizeQuicketImage(event.imageUrl);
    const city = levelThree || levelTwo || 'Nairobi';
    const locationFull = [venueName, city, 'Kenya'].filter(Boolean).join(', ');

    return {
        id: 'quicket:' + event.id,
        numericId: event.id,
        title: event.name.trim().slice(0, 200),
        startsAt: new Date(effectiveStartMs).toISOString(),
        venue: venueName || city,
        city,
        locationFull,
        description: stripHtml(event.description) || `${event.name.trim()} at ${locationFull}.`,
        host: event.organiser?.name || 'Quicket Kenya Official Organizer',
        category: event.categories?.[0]?.name || 'Quicket Live Event',
        imageUrl,
        remoteImageUrl: imageUrl,
        sourceUrl: url.href,
        source: 'Quicket',
        startingPrice: price?.amount ?? null,
        price,
        checkout: false
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

async function fetchQuicketEvents({ key, userToken = process.env.QUICKET_USER_TOKEN?.trim(), eventIds = [], fetchPage = fetch, now = Date.now() }) {
    const listings = new Map();
    const deadline = AbortSignal.timeout(25000);
    const idsToFetch = eventIds.length
        ? [...new Set([...eventIds, ...DEFAULT_KENYA_EVENT_IDS])]
        : DEFAULT_KENYA_EVENT_IDS;

    // 1. If a Quicket usertoken is configured, also import the organizer's own events (/api/users/me/events)
    if (userToken) {
        try {
            const meUrl = new URL('https://api.quicket.co.za/api/users/me/events');
            meUrl.searchParams.set('api_key', key);
            meUrl.searchParams.set('usertoken', userToken);
            const meBody = await request(meUrl, fetchPage, deadline);
            for (const event of (meBody?.results || [])) {
                const listing = kenyaListing(event, now);
                if (listing) listings.set(listing.id, listing);
            }
        } catch {
            // Fall through to public event lookup
        }
    }

    // 2. Fetch configured/curated Kenyan Quicket event IDs with ?api_key=...
    if (idsToFetch.length) {
        const results = await Promise.allSettled(idsToFetch.map(async id => {
            if (!/^\d{1,12}$/.test(String(id).trim())) return null;
            const url = new URL(ENDPOINT + '/' + String(id).trim());
            url.searchParams.set('api_key', key);
            if (userToken) url.searchParams.set('usertoken', userToken);
            const body = await request(url, fetchPage, deadline);
            const event = body.result ?? body;
            return kenyaListing(event, now);
        }));
        for (const res of results) {
            if (res.status === 'fulfilled' && res.value) {
                listings.set(res.value.id, res.value);
            }
        }
    }

    // 3. Also scan recently modified public Quicket events for any new Kenyan events
    try {
        for (let page = 1; page <= 2; page++) {
            const url = new URL(ENDPOINT);
            url.search = new URLSearchParams({
                api_key: key, page: String(page), pageSize: '50',
                lastModified: new Date(now - 30 * DAY).toISOString()
            });
            const body = await request(url, fetchPage, deadline);
            if (!Array.isArray(body.results)) break;
            for (const event of body.results) {
                const listing = kenyaListing(event, now);
                if (listing) listings.set(listing.id, listing);
            }
            if (!(page < body.pages)) break;
        }
    } catch {
        if (listings.size === 0) throw new Error('Quicket events fetch failed');
    }

    return [...listings.values()];
}

module.exports = { ENDPOINT, fetchQuicketEvents };
