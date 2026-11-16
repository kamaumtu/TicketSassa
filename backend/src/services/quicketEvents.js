const ENDPOINT = 'https://api.quicket.co.za/api/events';
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
    const validTickets = rawTickets.filter(t => t && typeof t.name === 'string' && !t.soldOut);
    const tiers = (validTickets.length ? validTickets : rawTickets).map((t, idx) => {
        const rawPrice = Number(t.price);
        const priceKes = Number.isFinite(rawPrice) && rawPrice > 0 ? Math.round(rawPrice) : 1500;
        return {
            tierKey: `quicket-${event.id}-${t.id || idx + 1}`,
            id: t.id || idx + 1,
            title: t.name.trim(),
            eventId: 'quicket:' + event.id,
            eventTitle: event.name.trim().slice(0, 200),
            priceKes,
            priceUsd: Math.max(1, Math.round((priceKes / 125) * 100) / 100),
            remainingAllocation: t.soldOut ? 0 : 250,
            designatedGate: idx === 0 ? 'Gate A' : 'Gate B',
            formattedSaleEnd: t.salesEnd ? new Date(t.salesEnd).toDateString() : 'Event Day',
            published: true
        };
    });

    const minPrice = tiers.length
        ? Math.min(...tiers.map(t => t.priceKes).filter(p => p > 0))
        : 1500;
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
        description: stripHtml(event.description) || `${event.name.trim()} at ${locationFull}. Book official Quicket Kenya tickets with instant M-Pesa confirmation.`,
        host: event.organiser?.name || 'Quicket Kenya Official Organizer',
        category: event.categories?.[0]?.name || 'Quicket Live Event',
        imageUrl,
        remoteImageUrl: imageUrl,
        sourceUrl: url.href,
        source: 'Quicket',
        startingPrice: Number.isFinite(minPrice) ? minPrice : 1500,
        price: { amount: Number.isFinite(minPrice) ? minPrice : 1500, currency: 'KES' },
        checkout: true,
        onSale: true,
        tiers
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
    const deadline = AbortSignal.timeout(25000);
    const idsToFetch = eventIds.length
        ? [...new Set([...eventIds, ...DEFAULT_KENYA_EVENT_IDS])]
        : DEFAULT_KENYA_EVENT_IDS;

    if (idsToFetch.length) {
        const results = await Promise.allSettled(idsToFetch.map(async id => {
            if (!/^\d{1,12}$/.test(String(id).trim())) return null;
            const url = new URL(ENDPOINT + '/' + String(id).trim());
            url.searchParams.set('api_key', key);
            const body = await request(url, fetchPage, deadline);
            const event = body.result ?? body;
            return kenyaListing(event, now);
        }));
        for (const res of results) {
            if (res.status === 'fulfilled' && res.value) {
                listings.set(res.value.id, res.value);
            }
        }
        if (listings.size > 0) return [...listings.values()];
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
