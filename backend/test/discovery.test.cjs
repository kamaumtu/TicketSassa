const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

const { parseRobotsTxt, checkRobotsAllowed, isBlockedResponse } = require('../src/services/discovery/robotsGuard');
const { cleanDescription, cleanTitle } = require('../src/services/discovery/DescriptionProcessor');
const { extractPricesFromText, extractJsonLdOffers, normalizeListingPrice } = require('../src/services/discovery/PriceExtractor');
const { extractImage } = require('../src/services/discovery/ImageExtractor');
const { computeEventDedupeKey, computeFlightDedupeKey, computeHolidayDedupeKey } = require('../src/services/discovery/DuplicateDetector');
const { validateEvent, validateFlight, validateHoliday } = require('../src/services/discovery/ListingValidator');
const { extractEventsFromPage, extractEventsFromRss } = require('../src/services/discovery/EventExtractor');
const { extractFlightsFromPage } = require('../src/services/discovery/FlightExtractor');
const { extractHolidaysFromPage } = require('../src/services/discovery/HolidayExtractor');

test('robotsGuard parses rules, enforces allow/disallow, and flags anti-bot blocks', async () => {
    const robotsTxt = [
        'User-agent: *',
        'Disallow: /admin/',
        'Crawl-delay: 2',
        '',
        'User-agent: TicketsasaDiscoveryBot',
        'Allow: /events/',
        'Disallow: /private/',
        'Crawl-delay: 3'
    ].join('\n');

    const specific = parseRobotsTxt(robotsTxt, 'TicketsasaDiscoveryBot');
    assert.deepEqual(specific.allow, ['/events/']);
    assert.deepEqual(specific.disallow, ['/private/']);
    assert.equal(specific.crawlDelayMs, 3000);

    const mockFetch = async () => ({
        ok: true,
        text: async () => robotsTxt
    });
    const allowedRes = await checkRobotsAllowed('https://unit-test-events.example/events/nairobi', { fetchImpl: mockFetch });
    assert.equal(allowedRes.allowed, true);

    const disallowedRes = await checkRobotsAllowed('https://unit-test-events.example/private/export', { fetchImpl: mockFetch });
    assert.equal(disallowedRes.allowed, false);

    assert.equal(isBlockedResponse(403, '').blocked, true);
    assert.equal(isBlockedResponse(429, '').blocked, true);
    assert.equal(isBlockedResponse(202, '<div>challenge-platform bot check</div>').blocked, true);
    assert.equal(isBlockedResponse(200, '<html><body>Verify you are human cf-chl-123</body></html>').blocked, true);
    assert.equal(isBlockedResponse(200, '<html><body><h1>Upcoming Concerts in Nairobi</h1></body></html>').blocked, false);
});

test('DescriptionProcessor cleans HTML entities, boilerplate CTAs, URLs, and emojis', () => {
    const raw = '<p>Sol Fest &amp; Friends &#39;26</p><script>alert(1)</script><p>Join us at Carnivore! https://spam.example/promo Buy tickets now.</p>';
    const cleaned = cleanDescription(raw, 'Sol Fest', 500);
    assert.ok(cleaned.includes("Sol Fest & Friends '26"));
    assert.ok(!cleaned.includes('alert(1)'));
    assert.ok(!cleaned.includes('https://spam.example'));
    assert.ok(!/buy tickets now/i.test(cleaned));

    const fallbackDesc = cleanDescription('<p>Hi</p>', '🔥 Rift Valley Marathon 🏃');
    assert.equal(fallbackDesc, 'Rift Valley Marathon.');

    const title = cleanTitle('🎉 Nanyuki Cultural Expo &amp; Fair 🎶');
    assert.equal(title, 'Nanyuki Cultural Expo & Fair');
});

test('PriceExtractor extracts valid currencies, ignores phone fragments, and skips SoldOut offers', async () => {
    const textPrices = extractPricesFromText('Early Bird Ksh. 1,500 | VIP KES 4,500 | Intl $120 | Call +254712345678 | Fee KES 50');
    assert.deepEqual(textPrices.map(p => [p.currency, p.amount]), [
        ['KES', 1500],
        ['KES', 4500],
        ['USD', 120]
    ]);

    const offers = extractJsonLdOffers([
        { name: 'Early Bird', price: '1,200', priceCurrency: 'KES', availability: 'https://schema.org/SoldOut' },
        { name: 'Regular', price: '2,500', priceCurrency: 'KES', availability: 'https://schema.org/InStock' },
        { name: 'VIP', price: 6000, priceCurrency: 'KES' }
    ]);
    assert.equal(offers.length, 2);
    assert.equal(offers[0].name, 'Regular');

    const normalized = await normalizeListingPrice({ offers });
    assert.equal(normalized.priceKes, 2500);
    assert.equal(normalized.priceStatus, 'verified');
    assert.equal(normalized.priceType, 'verified');

    const unavailable = await normalizeListingPrice({ rawText: 'Venue TBA' });
    assert.equal(unavailable.priceKes, null);
    assert.equal(unavailable.priceStatus, 'price_on_request');
    assert.equal(unavailable.priceType, 'unavailable');
});

test('ImageExtractor prioritizes official posters, rejects logos/SVGs, and labels category placeholders honestly', () => {
    const official = extractImage({
        jsonLdImages: ['https://cdn.example.com/site-logo.png', 'https://cdn.example.com/posters/savannah-fest.jpg'],
        ogImage: 'https://cdn.example.com/og.jpg'
    }, { category: 'Concerts & Music Festivals', sourceName: 'Official Site' });
    assert.equal(official.kind, 'official_poster');
    assert.equal(official.url, 'https://cdn.example.com/posters/savannah-fest.jpg');

    const ogOnly = extractImage({
        posterUrl: '/assets/icon.svg',
        ogImage: '/media/organizer-stage.jpg'
    }, { category: 'Comedy Shows', baseUrl: 'https://events.example.co.ke', sourceName: 'Organizer' });
    assert.equal(ogOnly.kind, 'organizer_photo');
    assert.equal(ogOnly.url, 'https://events.example.co.ke/media/organizer-stage.jpg');

    const placeholder = extractImage({
        posterUrl: 'data:image/png;base64,AAA',
        domImages: ['https://events.example.co.ke/static/favicon-32.png']
    }, { category: 'Football & Sports', sourceName: 'Test' });
    assert.equal(placeholder.kind, 'category_placeholder');
    assert.ok(placeholder.url);
});

test('DuplicateDetector generates stable normalized dedupe keys across events, flights, and holidays', () => {
    const k1 = computeEventDedupeKey({ name: 'Jazz Under The Stars!', startsAt: '2027-05-14T18:00:00Z', county: 'Nairobi' });
    const k2 = computeEventDedupeKey({ title: 'jazz under the stars', startsAt: '2027-05-14T20:00:00Z', county: 'NAIROBI' });
    const k3 = computeEventDedupeKey({ name: 'Jazz Under The Stars', startsAt: '2027-05-15T18:00:00Z', county: 'Nairobi' });
    assert.equal(k1, k2);
    assert.notEqual(k1, k3);

    const fk1 = computeFlightDedupeKey({ airline: 'Skyward Express', originCode: 'WIL', destinationCode: 'UKA', flightNumber: 'OW 401' });
    const fk2 = computeFlightDedupeKey({ airline: 'skyward-express', originCode: 'wil', destinationCode: 'uka', flightNumber: 'ow401' });
    assert.equal(fk1, fk2);

    const hk1 = computeHolidayDedupeKey({ title: '3 Days Maasai Mara Safari', destination: 'Maasai Mara' });
    const hk2 = computeHolidayDedupeKey({ title: '3 Days Maasai Mara Safari!', destination: 'maasai mara' });
    assert.equal(hk1, hk2);
});

test('ListingValidator enforces required fields and optional rules consistently', () => {
    const future = new Date(Date.now() + 14 * 86400000);
    const past = new Date(Date.now() - 86400000);

    const okEvent = validateEvent({
        name: 'Coast Cultural Gala',
        startsAt: future,
        county: 'Mombasa',
        originalUrl: 'https://events.example.co.ke/gala',
        image: { url: 'https://events.example.co.ke/poster.jpg', kind: 'official_poster' },
        confirmedPriceKes: 1500
    }, { events: true, requirePrice: true, requireOfficialImage: true });
    assert.equal(okEvent.valid, true);
    assert.equal(okEvent.autoPublishEligible, true);

    const blockedPlaceholderEvent = validateEvent({
        name: 'Coast Cultural Gala',
        startsAt: future,
        county: 'Mombasa',
        originalUrl: 'https://events.example.co.ke/gala',
        image: { url: 'https://unsplash.com/placeholder.jpg', kind: 'category_placeholder' },
        confirmedPriceKes: 1500
    }, { events: true, requireOfficialImage: true });
    assert.equal(blockedPlaceholderEvent.valid, true);
    assert.equal(blockedPlaceholderEvent.autoPublishEligible, false);

    const expiredEvent = validateEvent({
        name: 'Expired Show',
        startsAt: past,
        county: 'Kisumu',
        originalUrl: 'https://events.example.co.ke/old',
        image: { url: 'https://events.example.co.ke/old.jpg', kind: 'official_poster' }
    });
    assert.equal(expiredEvent.valid, false);

    const routeFlight = validateFlight({
        airline: 'Skyward Express',
        originCode: 'WIL',
        destinationCode: 'UKA',
        bookingUrl: 'https://www.skywardexpress.co.ke/',
        priceKes: null
    }, { flights: true, requirePrice: false });
    assert.equal(routeFlight.valid, true);
    assert.equal(routeFlight.autoPublishEligible, true);

    const priceRequiredFlight = validateFlight({
        airline: 'Skyward Express',
        originCode: 'WIL',
        destinationCode: 'UKA',
        bookingUrl: 'https://www.skywardexpress.co.ke/',
        priceKes: null
    }, { flights: true, requirePrice: true });
    assert.equal(priceRequiredFlight.autoPublishEligible, false);

    const validHoliday = validateHoliday({
        title: 'Diani 3 Nights Escape',
        destination: 'Diani',
        bookingUrl: 'https://travel.example.co.ke/diani',
        priceKes: 42000
    }, { holidays: true, requirePrice: true });
    assert.equal(validHoliday.valid, true);
    assert.equal(validHoliday.autoPublishEligible, true);
});

test('EventExtractor extracts JSON-LD future Kenyan events and recent RSS event announcements', async () => {
    const futureIso = new Date(Date.now() + 20 * 86400000).toISOString();
    const pastIso = new Date(Date.now() - 5 * 86400000).toISOString();
    const events = await extractEventsFromPage({
        ok: true,
        $: cheerio.load('<html></html>'),
        finalUrl: 'https://events.example.co.ke/mombasa-jazz',
        openGraph: { 'og:image': 'https://events.example.co.ke/og-jazz.jpg' },
        jsonLd: [
            {
                '@type': 'MusicEvent',
                name: 'Mombasa Coastal Jazz Festival',
                startDate: futureIso,
                description: 'Live coastal jazz concert at Mama Ngina Waterfront.',
                url: 'https://events.example.co.ke/mombasa-jazz',
                location: {
                    name: 'Mama Ngina Waterfront',
                    address: { addressLocality: 'Mombasa', addressCountry: 'KE' }
                },
                organizer: { name: 'Pwani Live' },
                image: 'https://events.example.co.ke/jazz-poster.jpg',
                offers: [
                    { name: 'Early Bird', price: 2000, priceCurrency: 'KES' },
                    { name: 'VIP', price: 5000, priceCurrency: 'KES' }
                ]
            },
            {
                '@type': 'MusicEvent',
                name: 'Past Event Should Skip',
                startDate: pastIso
            }
        ]
    }, { name: 'Test Source' });

    assert.equal(events.length, 1);
    assert.equal(events[0].county, 'Mombasa');
    assert.equal(events[0].confirmedPriceKes, 2000);
    assert.equal(events[0].priceType, 'verified');
    assert.equal(events[0].ticketCategories.length, 2);
    assert.equal(events[0].image.kind, 'official_poster');

    const rssEvents = await extractEventsFromRss([
        {
            title: 'Eldoret City Marathon Festival expects thousands in Uasin Gishu',
            link: 'https://news.google.com/rss/articles/eldoret-marathon',
            pubDate: new Date(Date.now() - 86400000).toUTCString(),
            content: 'Runners converge in Eldoret with entry KES 1,500.'
        }
    ], { name: 'Google News Kenya' });

    assert.equal(rssEvents.length, 1);
    assert.equal(rssEvents[0].county, 'Uasin Gishu');
    assert.equal(rssEvents[0].confirmedPriceKes, 1500);
    assert.equal(rssEvents[0]._missingExactDate, true);
});

test('FlightExtractor extracts route-only and published-fare routes without inventing flight numbers or times', async () => {
    const html = `
        <div class="route-card">
            <h3>Flights to Ukunda (Diani)</h3>
            <p>Daily connections from Wilson Airport to Diani. Fares from KES 9,800.</p>
            <a href="/book/ukunda">View route</a>
        </div>
        <div class="route-card">
            <h3>Flights to Eldoret</h3>
            <p>Direct route from Wilson Airport to Eldoret.</p>
            <a href="/book/eldoret">Route details</a>
        </div>
    `;
    const flights = await extractFlightsFromPage({
        ok: true,
        $: cheerio.load(html),
        finalUrl: 'https://www.skywardexpress.co.ke/destinations/',
        jsonLd: []
    }, { name: 'Skyward Express Official' });

    assert.equal(flights.length, 2);
    const dUkunda = flights.find(f => f.destinationCode === 'UKA');
    assert.ok(dUkunda);
    assert.equal(dUkunda.originCode, 'WIL');
    assert.equal(dUkunda.priceKes, 9800);
    assert.equal(dUkunda.priceStatus, 'verified');
    assert.equal(dUkunda.flightNumber, '');
    assert.equal(dUkunda.departureTime, null);
    assert.equal(dUkunda.isRouteOnly, true);

    const dEldoret = flights.find(f => f.destinationCode === 'EDL');
    assert.ok(dEldoret);
    assert.equal(dEldoret.priceKes, null);
    assert.equal(dEldoret.priceStatus, 'price_on_request');
    assert.equal(dEldoret.flightNumber, '');
});

test('HolidayExtractor extracts JSON-LD and Safari package cards with duration, meals, and prices', async () => {
    const html = `
        <article class="card">
            <h3>3 Days Maasai Mara Wildlife Safari Package</h3>
            <p>3 Days / 2 Nights full board safari departing Nairobi. Rate KES 34,500 per person.</p>
            <img src="https://safaris.example.co.ke/images/mara-lions.jpg" />
            <a href="/packages/mara-3-days">Explore Package</a>
        </article>
    `;
    const holidays = await extractHolidaysFromPage({
        ok: true,
        $: cheerio.load(html),
        finalUrl: 'https://safaris.example.co.ke/',
        openGraph: {},
        jsonLd: [
            {
                '@type': 'TouristTrip',
                name: '5 Nights Diani Beach Holiday Resort',
                description: '5 Nights all inclusive coastal resort stay in Diani South Coast.',
                url: 'https://safaris.example.co.ke/diani-5n',
                image: 'https://safaris.example.co.ke/images/diani-beach.jpg',
                offers: { price: 58000, priceCurrency: 'KES' }
            }
        ]
    }, { name: 'Kenya Safari Partner' });

    assert.equal(holidays.length, 2);
    const diani = holidays.find(h => h.destination === 'Diani');
    assert.ok(diani);
    assert.equal(diani.nights, 5);
    assert.equal(diani.priceKes, 58000);
    assert.equal(diani.category, 'Beach Holidays');

    const mara = holidays.find(h => h.destination === 'Maasai Mara');
    assert.ok(mara);
    assert.equal(mara.nights, 2);
    assert.equal(mara.priceKes, 34500);
    assert.equal(mara.meals.toLowerCase(), 'full board');
    assert.equal(mara.images[0].url, 'https://safaris.example.co.ke/images/mara-lions.jpg');
});
