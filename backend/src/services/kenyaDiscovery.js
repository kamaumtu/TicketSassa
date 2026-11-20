const travelCatalog = require('./travelCatalog');

const KENYA_REGIONS = [
    { name: 'Nairobi', pattern: /nairobi|westlands|karen|kilimani|kasarani|uhuru|masshouse|koda|carnivore|village market|ngong|parklands|industrial area|social house/i },
    { name: 'Mombasa', pattern: /mombasa|nyali|mamba village|butterfly pavilion|coast gym|pwani|bamburi|shanzu/i },
    { name: 'Kilifi', pattern: /kilifi|baobabs|distant relatives/i },
    { name: 'Diani', pattern: /diani|ukunda|kwale/i },
    { name: 'Watamu', pattern: /watamu|malindi/i },
    { name: 'Lamu', pattern: /lamu|shela|manda/i },
    { name: 'Kisumu', pattern: /kisumu|nyakach/i },
    { name: 'Naivasha', pattern: /naivasha|sawela|hell'?s gate/i },
    { name: 'Nakuru', pattern: /nakuru/i },
    { name: 'Eldoret', pattern: /eldoret/i },
    { name: 'Kitengela', pattern: /kitengela/i },
    { name: 'Kitui', pattern: /kitui/i },
    { name: 'Maasai Mara', pattern: /mara|narok/i },
    { name: 'Amboseli', pattern: /amboseli/i }
];

const LOGICAL_EVENT_IMAGES = [
    { pattern: /motorsport|rally|drift|race|lap|sport|boxing|padel|tennis|run|walk|fitness/i, image: '/assets/real/SzYy0XWlBI-1792688119.png' },
    { pattern: /beach|coast|pool|pwani|kilifi|diani|mombasa|watamu|lamu|swim|baobab/i, image: '/assets/real/GAzVjovyNO-1794384397.jpg' },
    { pattern: /rock|live|concert|fest|festival|rave|house|amapiano|dancehall|dj|music|strings|candlelight|karaoke|latin|party/i, image: '/assets/real/QZGqWDTxBF-1791963807.jpg' },
    { pattern: /fashion|art|culture|gala|miss|food|wine|social|strings/i, image: '/assets/real/61JOc0e8b5-1793268189.jpg' }
];

function detectRegion(text) {
    const haystack = String(text || '');
    for (const region of KENYA_REGIONS) {
        if (region.pattern.test(haystack)) return region.name;
    }
    return 'Kenya';
}

function logicalEventImage(event) {
    if (typeof event.imageUrl === 'string' && event.imageUrl.trim()) return event.imageUrl.trim();
    if (typeof event.remoteImageUrl === 'string' && event.remoteImageUrl.trim()) return event.remoteImageUrl.trim();
    const text = [event.title, event.category, event.venue, event.city, event.description].join(' ');
    for (const rule of LOGICAL_EVENT_IMAGES) {
        if (rule.pattern.test(text)) return rule.image;
    }
    return '/assets/real/DzLV4G9UWo-1790859483.jpg';
}

function estimateEventTickets(event) {
    if (Array.isArray(event.tiers) && event.tiers.length) {
        return {
            pricingMode: 'live',
            tickets: event.tiers.map(t => ({
                name: t.title,
                priceKes: Number(t.priceKes),
                gate: t.designatedGate || 'Gate A',
                note: `${t.remainingAllocation ?? 0} available`
            }))
        };
    }
    if (Array.isArray(event.price?.offers) && event.price.offers.length) {
        return {
            pricingMode: 'advertised',
            tickets: event.price.offers.slice(0, 6).map((o, idx) => ({
                name: o.title || (idx === 0 ? 'General Admission' : `Tier ${idx + 1}`),
                priceKes: Math.round(Number(o.amount)),
                gate: `Gate ${['A', 'B', 'C', 'D'][idx % 4]}`,
                note: 'Source advertised price'
            }))
        };
    }
    const base = event.startingPrice != null && Number(event.startingPrice) > 0
        ? Math.round(Number(event.startingPrice))
        : (event.price?.amount != null && Number(event.price.amount) > 0 ? Math.round(Number(event.price.amount)) : 1500);
    return {
        pricingMode: 'estimated',
        tickets: [
            { name: 'Early Bird (Est.)', priceKes: Math.max(500, Math.round(base * 0.8 / 50) * 50), gate: 'Gate A', note: 'Estimated tier' },
            { name: 'Regular Admission (Est.)', priceKes: base, gate: 'Gate B', note: 'Estimated tier' },
            { name: 'VIP Experience (Est.)', priceKes: Math.round(base * 2.2 / 100) * 100, gate: 'Gate C', note: 'Estimated tier' }
        ]
    };
}

const KENYA_FLIGHT_ROUTES = [
    {
        id: 'route:nbo-mba-kq',
        title: 'Nairobi (JKIA) → Mombasa (Moi Intl)',
        airline: 'Kenya Airways',
        flightCode: 'KQ 604',
        region: 'Mombasa',
        route: 'NBO → MBA',
        duration: '1h 00m Non-Stop',
        imageUrl: '/assets/airlines/kenya-airways.svg',
        destinationImage: '/assets/real/GAzVjovyNO-1794384397.jpg',
        economyKes: 7800,
        businessKes: 19500
    },
    {
        id: 'route:nbo-mba-jm',
        title: 'Nairobi (JKIA) → Mombasa (Moi Intl)',
        airline: 'Jambojet',
        flightCode: 'JM 8602',
        region: 'Mombasa',
        route: 'NBO → MBA',
        duration: '1h 00m Non-Stop',
        imageUrl: '/assets/airlines/jambojet.svg',
        destinationImage: '/assets/real/GAzVjovyNO-1794384397.jpg',
        economyKes: 5900,
        businessKes: 11500
    },
    {
        id: 'route:wil-uka-ow',
        title: 'Nairobi (Wilson) → Diani Beach (Ukunda)',
        airline: 'Skyward Express',
        flightCode: 'OW 402',
        region: 'Diani',
        route: 'WIL → UKA',
        duration: '1h 05m Non-Stop',
        imageUrl: '/assets/airlines/skyward.svg',
        destinationImage: '/assets/real/lheAq1Zpc0-1794303741.jpg',
        economyKes: 7200,
        businessKes: 13800
    },
    {
        id: 'route:nbo-kis-kq',
        title: 'Nairobi (JKIA) → Kisumu International',
        airline: 'Kenya Airways',
        flightCode: 'KQ 654',
        region: 'Kisumu',
        route: 'NBO → KIS',
        duration: '0h 50m Non-Stop',
        imageUrl: '/assets/airlines/kenya-airways.svg',
        destinationImage: '/assets/real/aeIvhrxstM-1793471602.jpg',
        economyKes: 6500,
        businessKes: 16200
    },
    {
        id: 'route:nbo-edl-jm',
        title: 'Nairobi (JKIA) → Eldoret International',
        airline: 'Jambojet',
        flightCode: 'JM 8642',
        region: 'Eldoret',
        route: 'NBO → EDL',
        duration: '0h 50m Non-Stop',
        imageUrl: '/assets/airlines/jambojet.svg',
        destinationImage: '/assets/real/DzLV4G9UWo-1790859483.jpg',
        economyKes: 6300,
        businessKes: 11900
    },
    {
        id: 'route:nbo-myd-jm',
        title: 'Nairobi (JKIA) → Malindi & Watamu',
        airline: 'Jambojet',
        flightCode: 'JM 8680',
        region: 'Watamu',
        route: 'NBO → MYD',
        duration: '1h 10m Non-Stop',
        imageUrl: '/assets/airlines/jambojet.svg',
        destinationImage: '/assets/real/GAzVjovyNO-1794384397.jpg',
        economyKes: 6900,
        businessKes: 12900
    },
    {
        id: 'route:wil-lau-ow',
        title: 'Nairobi (Wilson) → Lamu (Manda Airport)',
        airline: 'Skyward Express',
        flightCode: 'OW 504',
        region: 'Lamu',
        route: 'WIL → LAU',
        duration: '1h 30m Non-Stop',
        imageUrl: '/assets/airlines/skyward.svg',
        destinationImage: '/assets/real/g4Gi3xRTDO-1793174308.jpg',
        economyKes: 8900,
        businessKes: 16500
    }
];

const KENYA_HOLIDAY_PACKAGES = [
    {
        id: 'holiday-est:diani-coastal',
        title: 'Diani Beach All-Inclusive Resort Escape (3 Nights)',
        supplier: 'South Coast Hospitality',
        region: 'Diani',
        location: 'Diani Beach, Kwale County',
        imageUrl: '/assets/real/lheAq1Zpc0-1794303741.jpg',
        standardKes: 28500,
        vipKes: 48000
    },
    {
        id: 'holiday-est:maasai-mara',
        title: 'Maasai Mara Big Five Luxury Tented Safari (3 Days)',
        supplier: 'Mara Safari Lodges',
        region: 'Maasai Mara',
        location: 'Maasai Mara National Reserve, Narok',
        imageUrl: '/assets/real/aeIvhrxstM-1793471602.jpg',
        standardKes: 38000,
        vipKes: 69500
    },
    {
        id: 'holiday-est:mombasa-nyali',
        title: 'Mombasa North Coast & Nyali Beachfront Getaway (2 Nights)',
        supplier: 'Mombasa Coastal Resorts',
        region: 'Mombasa',
        location: 'Nyali Beach, Mombasa',
        imageUrl: '/assets/real/GAzVjovyNO-1794384397.jpg',
        standardKes: 21500,
        vipKes: 36000
    },
    {
        id: 'holiday-est:naivasha-lake',
        title: 'Lake Naivasha Weekend Retreat & Boat Safari (2 Nights)',
        supplier: 'Rift Valley Resorts',
        region: 'Naivasha',
        location: 'Moi South Lake Road, Naivasha',
        imageUrl: '/assets/real/g4Gi3xRTDO-1793174308.jpg',
        standardKes: 16800,
        vipKes: 29500
    },
    {
        id: 'holiday-est:watamu-marine',
        title: 'Watamu Marine Park & Reef Villa Package (3 Nights)',
        supplier: 'Kilifi Coast Escapes',
        region: 'Watamu',
        location: 'Watamu Bay, Kilifi County',
        imageUrl: '/assets/real/DzLV4G9UWo-1790859483.jpg',
        standardKes: 31000,
        vipKes: 54000
    },
    {
        id: 'holiday-est:lamu-heritage',
        title: 'Lamu Old Town & Shela Beach Dhow Experience (3 Nights)',
        supplier: 'Lamu Archipelago Retreats',
        region: 'Lamu',
        location: 'Shela Beach, Lamu Island',
        imageUrl: '/assets/real/61JOc0e8b5-1793268189.jpg',
        standardKes: 34500,
        vipKes: 58000
    }
];

async function buildKenyaDiscovery(eventCatalog) {
    const [catalog, liveFlights, liveHolidays] = await Promise.all([
        eventCatalog.get(),
        travelCatalog.offers('flight').catch(() => []),
        travelCatalog.offers('holiday').catch(() => [])
    ]);

    const events = (catalog.events || []).map(ev => {
        const region = detectRegion([ev.city, ev.venue, ev.locationFull, ev.title].join(' '));
        const { pricingMode, tickets } = estimateEventTickets(ev);
        return {
            id: ev.id,
            kind: 'event',
            title: ev.title,
            venue: ev.locationFull || ev.venue || ev.city || 'Kenya',
            region,
            startsAt: ev.startsAt,
            source: ev.source || 'Ticketsasa',
            imageUrl: logicalEventImage(ev),
            pricingMode,
            startingPriceKes: tickets.length ? Math.min(...tickets.map(t => t.priceKes)) : null,
            tickets
        };
    });

    const nextDepartureIso = new Date(Date.now() + 3 * 86400000).toISOString();
    const flights = liveFlights.length
        ? liveFlights.map(f => ({
            id: f.id,
            kind: 'flight',
            title: f.title,
            venue: [f.origin, f.destination].filter(Boolean).join(' → ') || 'Kenya Domestic',
            region: detectRegion([f.destination, f.title].join(' ')),
            startsAt: f.startsAt,
            source: f.supplier || 'Live Flight Supplier',
            imageUrl: '/assets/airlines/kenya-airways.svg',
            pricingMode: 'live',
            startingPriceKes: f.priceKes,
            tickets: [{ name: f.priceBasis || 'Confirmed Fare', priceKes: f.priceKes, gate: 'Departure Terminal', note: `${f.available} seats left` }]
        }))
        : KENYA_FLIGHT_ROUTES.map(r => ({
            id: r.id,
            kind: 'flight',
            title: `${r.airline} ${r.flightCode} · ${r.title}`,
            venue: `${r.route} · ${r.duration}`,
            region: r.region,
            startsAt: nextDepartureIso,
            source: r.airline,
            imageUrl: r.imageUrl,
            coverImageUrl: r.destinationImage,
            pricingMode: 'estimated',
            startingPriceKes: r.economyKes,
            tickets: [
                { name: 'Economy One-Way (Est.)', priceKes: r.economyKes, gate: 'Domestic Terminal', note: '10kg–23kg baggage' },
                { name: 'Flex / Business (Est.)', priceKes: r.businessKes, gate: 'Priority Boarding', note: 'Flexible date change' }
            ]
        }));

    const nextCheckinIso = new Date(Date.now() + 7 * 86400000).toISOString();
    const holidays = liveHolidays.length
        ? liveHolidays.map(h => ({
            id: h.id,
            kind: 'holiday',
            title: h.title,
            venue: h.destination || 'Kenya',
            region: detectRegion([h.destination, h.title].join(' ')),
            startsAt: h.startsAt,
            source: h.supplier || 'Live Holiday Supplier',
            imageUrl: '/assets/real/lheAq1Zpc0-1794303741.jpg',
            pricingMode: 'live',
            startingPriceKes: h.priceKes,
            tickets: [{ name: h.priceBasis || 'Confirmed Package', priceKes: h.priceKes, gate: 'Resort Check-In', note: `${h.available} rooms left` }]
        }))
        : KENYA_HOLIDAY_PACKAGES.map(h => ({
            id: h.id,
            kind: 'holiday',
            title: h.title,
            venue: h.location,
            region: h.region,
            startsAt: nextCheckinIso,
            source: h.supplier,
            imageUrl: h.imageUrl,
            pricingMode: 'estimated',
            startingPriceKes: h.standardKes,
            tickets: [
                { name: 'Standard Sharing (Est.)', priceKes: h.standardKes, gate: 'Resort Reception', note: 'Per person sharing' },
                { name: 'Deluxe / VIP Suite (Est.)', priceKes: h.vipKes, gate: 'VIP Concierge', note: 'Full board + transfers' }
            ]
        }));

    const regions = [...new Set([...events, ...flights, ...holidays].map(item => item.region))].sort();
    return {
        scannedAt: new Date().toISOString(),
        providerStatuses: catalog.providerStatuses,
        regions,
        summary: {
            eventsCount: events.length,
            flightsCount: flights.length,
            holidaysCount: holidays.length,
            regionsCovered: regions.length
        },
        events,
        flights,
        holidays
    };
}

module.exports = { buildKenyaDiscovery };
