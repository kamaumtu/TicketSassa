const { createHash } = require('node:crypto');
const { KENYAN_AIRPORTS } = require('../automation/kenyaCounties');
const { cleanTitle } = require('./DescriptionProcessor');
const { normalizeListingPrice } = require('./PriceExtractor');
const { resolveUrl } = require('./ImageExtractor');

const AIRPORT_PATTERNS = [
    { code: 'NBO', name: 'Jomo Kenyatta International Airport (JKIA)', pattern: /\b(jkia|jomo kenyatta|nairobi|nbo)\b/i },
    { code: 'WIL', name: 'Wilson Airport', pattern: /\b(wilson|wil)\b/i },
    { code: 'MBA', name: 'Moi International Airport', pattern: /\b(mombasa|moi international|mba)\b/i },
    { code: 'KIS', name: 'Kisumu International Airport', pattern: /\b(kisumu|kis)\b/i },
    { code: 'EDL', name: 'Eldoret International Airport', pattern: /\b(eldoret|edl)\b/i },
    { code: 'MYD', name: 'Malindi Airport', pattern: /\b(malindi|watamu|myd)\b/i },
    { code: 'UKA', name: 'Ukunda Airport (Diani)', pattern: /\b(ukunda|diani|uka)\b/i },
    { code: 'LAU', name: 'Lamu Manda Airport', pattern: /\b(lamu|manda|lau)\b/i },
    { code: 'GAS', name: 'Garissa Airport', pattern: /\b(garissa|gas)\b/i },
    { code: 'DAR', name: 'Dar es Salaam (Julius Nyerere Intl)', pattern: /\b(dar es salaam|dar)\b/i },
    { code: 'EBB', name: 'Entebbe International Airport', pattern: /\b(entebbe|kampala|ebb)\b/i },
    { code: 'ZNZ', name: 'Zanzibar Abeid Amani Karume Intl', pattern: /\b(zanzibar|znz)\b/i },
    { code: 'DXB', name: 'Dubai International Airport', pattern: /\b(dubai|dxb)\b/i },
    { code: 'LHR', name: 'London Heathrow Airport', pattern: /\b(london|heathrow|lhr)\b/i },
    { code: 'JNB', name: 'Johannesburg O.R. Tambo', pattern: /\b(johannesburg|jnb)\b/i },
    { code: 'ADD', name: 'Addis Ababa Bole Intl', pattern: /\b(addis ababa|add)\b/i },
    { code: 'JRO', name: 'Kilimanjaro International Airport', pattern: /\b(kilimanjaro|jro)\b/i },
    { code: 'KGL', name: 'Kigali International Airport', pattern: /\b(kigali|kgl)\b/i }
];

const AIRLINE_BRANDS = [
    { pattern: /skyward/i, name: 'Skyward Express', logo: '/assets/airlines/skyward.svg' },
    { pattern: /safarilink/i, name: 'Safarilink Aviation', logo: '/assets/airlines/fly540.svg' },
    { pattern: /kenya-airways|kenya airways/i, name: 'Kenya Airways', logo: '/assets/airlines/kenya-airways.svg' },
    { pattern: /jambojet/i, name: 'Jambojet', logo: '/assets/airlines/jambojet.svg' },
    { pattern: /ethiopian/i, name: 'Ethiopian Airlines', logo: '/assets/airlines/ethiopian.svg' },
    { pattern: /emirates/i, name: 'Emirates', logo: '/assets/airlines/emirates.svg' },
    { pattern: /qatar/i, name: 'Qatar Airways', logo: '/assets/airlines/qatar.svg' },
    { pattern: /rwandair/i, name: 'RwandAir', logo: '/assets/airlines/rwandair.svg' },
    { pattern: /british/i, name: 'British Airways', logo: '/assets/airlines/british-airways.svg' },
    { pattern: /klm/i, name: 'KLM Royal Dutch Airlines', logo: '/assets/airlines/klm.svg' }
];

function detectAirline(sourceName, url, text = '') {
    const combined = `${sourceName} ${url} ${text}`;
    for (const b of AIRLINE_BRANDS) {
        if (b.pattern.test(combined)) return { airline: b.name, airlineLogo: b.logo };
    }
    return { airline: sourceName || 'Official Airline', airlineLogo: '/assets/airlines/kenya-airways.svg' };
}

function stableId(key) {
    return 'web-fl:' + createHash('sha1').update(String(key)).digest('hex').slice(0, 20);
}

/**
 * Extracts ONLY real published airline routes and explicitly published fares.
 * Never fabricates flight numbers, departure times, arrival times, or fares.
 */
async function extractFlightsFromPage(crawlResult, source) {
    if (!crawlResult?.ok || !crawlResult.$) return [];
    const { $, finalUrl, jsonLd = [] } = crawlResult;
    const { airline, airlineLogo } = detectAirline(source.name, finalUrl);
    const defaultOrigin = /wilson|safarilink|skyward/i.test(airline)
        ? KENYAN_AIRPORTS.find(a => a.code === 'WIL')
        : KENYAN_AIRPORTS.find(a => a.code === 'NBO');

    const candidates = new Map();

    // 1. JSON-LD Flight nodes if published
    for (const node of jsonLd) {
        if (node['@type'] !== 'Flight') continue;
        const dep = node.departureAirport?.iataCode || node.departureAirport?.name;
        const arr = node.arrivalAirport?.iataCode || node.arrivalAirport?.name;
        if (!dep || !arr) continue;
        const priceInfo = await normalizeListingPrice({ offers: node.offers ? [node.offers] : [] });
        const depCode = String(dep).slice(0, 3).toUpperCase();
        const arrCode = String(arr).slice(0, 3).toUpperCase();
        const key = `${airline}|${depCode}|${arrCode}|${node.flightNumber || ''}`;
        candidates.set(key, {
            externalId: stableId(key),
            airline,
            airlineLogo,
            flightNumber: node.flightNumber ? String(node.flightNumber).trim() : '',
            originCode: depCode,
            originName: node.departureAirport?.name || depCode,
            destinationCode: arrCode,
            destinationName: node.arrivalAirport?.name || arrCode,
            routeSummary: `${depCode} → ${arrCode}`,
            isRouteOnly: !node.departureTime,
            departureTime: node.departureTime ? new Date(node.departureTime) : null,
            arrivalTime: node.arrivalTime ? new Date(node.arrivalTime) : null,
            duration: node.estimatedFlightDuration || '',
            priceKes: priceInfo.priceKes,
            currency: priceInfo.currency || 'KES',
            priceType: priceInfo.priceKes != null ? 'verified' : 'unavailable',
            priceStatus: priceInfo.priceKes != null ? 'verified' : 'price_on_request',
            baggageAllowance: 'Verify baggage allowance on airline site',
            bookingUrl: finalUrl,
            source: source.name,
            dataMode: 'public_web'
        });
    }

    // 2. HTML Route & Deal Blocks (headings, cards, links matching airport destinations)
    const nodes = $('h2, h3, h4, .card, article, .route-card, [class*="flight"], [class*="destination"], a[href*="flight"], a[href*="destination"]').slice(0, 80).toArray();
    for (const el of nodes) {
        const node = $(el);
        const heading = cleanTitle(node.is('h2,h3,h4,a') ? node.text() : node.find('h2,h3,h4').first().text());
        if (!heading || heading.length < 4 || heading.length > 100) continue;
        if (/newsletter|contact|about us|cookie|privacy|subscribe/i.test(heading)) continue;

        const scopedCard = node.is('.card, article, .route-card, li')
            ? node
            : node.closest('article, .card, .route-card, li');
        const blockText = (
            scopedCard.length
                ? scopedCard.text()
                : `${node.text()} ${node.next('p, span').text()}`
        ).replace(/\s+/g, ' ').trim().slice(0, 500);
        const matchedAirports = AIRPORT_PATTERNS.filter(ap => ap.pattern.test(heading) || ap.pattern.test(blockText));
        if (!matchedAirports.length) continue;

        // If heading specifies destination ("Fly to Ukunda", "Flights to Garissa"), origin defaults to airline hub unless two airports appear
        let origin = defaultOrigin;
        let dest = matchedAirports[0];
        if (matchedAirports.length >= 2) {
            const firstMatch = matchedAirports.find(a => heading.toLowerCase().includes(a.code.toLowerCase()) || heading.toLowerCase().includes(a.name.split(' ')[0].toLowerCase()));
            const other = matchedAirports.find(a => a.code !== (firstMatch?.code || matchedAirports[0].code));
            if (other && firstMatch) {
                // Keep Nairobi/Wilson as origin when heading says "Flights to X"
                if (/^flights?\s+to|^fly\s+(?:easy\s+)?to/i.test(heading)) {
                    dest = firstMatch;
                    origin = other;
                } else {
                    origin = firstMatch;
                    dest = other;
                }
            }
        }
        if (!dest || origin.code === dest.code) continue;

        // Only attach a published price if it appears explicitly within this route's scoped card
        const localPriceText = blockText.slice(0, 320);
        const priceInfo = await normalizeListingPrice({ rawText: localPriceText });

        const flightNumMatch = localPriceText.match(/\b(?:KQ|JM|OW|SA|ET|EK|QR)\s?\d{2,4}\b/i);
        const linkHref = node.is('a') ? node.attr('href') : node.find('a[href]').first().attr('href');
        const bookingUrl = resolveUrl(linkHref || finalUrl, finalUrl) || finalUrl;

        const key = `${airline}|${origin.code}|${dest.code}`;
        const existing = candidates.get(key);
        if (existing && existing.priceKes != null) continue;

        candidates.set(key, {
            externalId: stableId(key),
            airline,
            airlineLogo,
            flightNumber: flightNumMatch ? flightNumMatch[0].toUpperCase() : '',
            originCode: origin.code,
            originName: origin.name,
            destinationCode: dest.code,
            destinationName: dest.name,
            routeSummary: `${origin.code} (${origin.name.split(' ')[0]}) → ${dest.code} (${dest.name.split(' ')[0]}) · ${heading}`,
            isRouteOnly: true,
            departureTime: null,
            arrivalTime: null,
            duration: '',
            priceKes: priceInfo.priceKes,
            currency: priceInfo.currency || 'KES',
            priceType: priceInfo.priceKes != null ? 'verified' : 'unavailable',
            priceStatus: priceInfo.priceKes != null ? 'verified' : 'price_on_request',
            baggageAllowance: 'Check airline baggage policy on booking link',
            bookingUrl,
            source: source.name,
            dataMode: 'public_web'
        });
    }

    return [...candidates.values()];
}

module.exports = {
    extractFlightsFromPage
};
