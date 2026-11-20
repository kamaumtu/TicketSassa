const { createHash } = require('node:crypto');
const { HOLIDAY_DESTINATIONS } = require('../automation/kenyaCounties');
const { cleanDescription, cleanTitle } = require('./DescriptionProcessor');
const { extractImage, resolveUrl } = require('./ImageExtractor');
const { extractJsonLdOffers, normalizeListingPrice } = require('./PriceExtractor');

const DESTINATION_RULES = [
    { name: 'Diani', country: 'Kenya', category: 'Beach Holidays', pattern: /diani|south coast|ukunda/i },
    { name: 'Mombasa', country: 'Kenya', category: 'Beach Holidays', pattern: /mombasa|nyali|bamburi|shanzu|north coast/i },
    { name: 'Watamu', country: 'Kenya', category: 'Beach Holidays', pattern: /watamu|malindi/i },
    { name: 'Lamu', country: 'Kenya', category: 'Beach Holidays', pattern: /lamu|shela/i },
    { name: 'Maasai Mara', country: 'Kenya', category: 'Safari Packages', pattern: /mara|maasai mara|wildebeest/i },
    { name: 'Amboseli', country: 'Kenya', category: 'Safari Packages', pattern: /amboseli|kilimanjaro view/i },
    { name: 'Naivasha', country: 'Kenya', category: 'Weekend Getaways', pattern: /naivasha|hell'?s gate/i },
    { name: 'Nakuru', country: 'Kenya', category: 'Safari Packages', pattern: /nakuru|elementaita/i },
    { name: 'Nanyuki', country: 'Kenya', category: 'Safari Packages', pattern: /nanyuki|mt\.?\s*kenya|ol pejeta|samburu|tsavo/i },
    { name: 'Zanzibar', country: 'Tanzania', category: 'International Travel Packages', pattern: /zanzibar|stone town|nungwi/i },
    { name: 'Dubai', country: 'UAE', category: 'International Travel Packages', pattern: /dubai|abu dhabi/i },
    { name: 'Cape Town', country: 'South Africa', category: 'International Travel Packages', pattern: /cape town|johannesburg|south africa/i },
    { name: 'Egypt', country: 'Egypt', category: 'International Travel Packages', pattern: /egypt|cairo|sharm/i },
    { name: 'Thailand', country: 'Thailand', category: 'International Travel Packages', pattern: /thailand|phuket|bangkok/i }
];

function classifyHoliday(title, text = '') {
    const s = `${title} ${text}`;
    let destination = 'Kenya';
    let country = 'Kenya';
    let category = 'Safari Packages';

    for (const rule of DESTINATION_RULES) {
        if (rule.pattern.test(s)) {
            destination = rule.name;
            country = rule.country;
            category = rule.category;
            break;
        }
    }

    if (/honeymoon|romantic/i.test(s)) category = 'Honeymoon Packages';
    else if (/family/i.test(s)) category = 'Family Vacations';
    else if (/weekend|staycation|escape|getaway/i.test(s)) category = 'Weekend Getaways';
    else if (/group|joining/i.test(s)) category = 'Group Tours';
    else if (/adventure|hiking|trek|rafting/i.test(s)) category = 'Adventure Holidays';
    else if (/hotel|resort|lodge|villa/i.test(s) && category === 'Safari Packages' && destination === 'Kenya') category = 'Hotel Accommodation';

    if (destination === 'Kenya') {
        const extra = HOLIDAY_DESTINATIONS.find(d => new RegExp(d, 'i').test(s));
        if (extra) destination = extra;
    }

    return { destination, country, category };
}

function parseNightsAndDuration(text) {
    const s = String(text || '');
    const nightsMatch = s.match(/(\d{1,2})\s*(?:nights?|n\b)/i);
    const daysMatch = s.match(/(\d{1,2})\s*(?:days?|d\b)/i);
    if (nightsMatch) {
        const nights = Number(nightsMatch[1]);
        return { nights, duration: daysMatch ? `${daysMatch[1]} Days / ${nights} Nights` : `${nights} Nights` };
    }
    if (daysMatch) {
        const days = Number(daysMatch[1]);
        const nights = Math.max(1, days - 1);
        return { nights, duration: `${days} Days / ${nights} Nights` };
    }
    return { nights: null, duration: '' };
}

function stableId(key) {
    return 'web-hol:' + createHash('sha1').update(String(key)).digest('hex').slice(0, 20);
}

async function extractHolidaysFromPage(crawlResult, source) {
    if (!crawlResult?.ok || !crawlResult.$) return [];
    const { $, finalUrl, jsonLd = [], openGraph = {} } = crawlResult;
    const candidates = new Map();

    // 1. JSON-LD Product / TouristTrip / Offer blocks
    for (const node of jsonLd) {
        const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
        if (!types.some(t => /Product|TouristTrip|Hotel|LodgingBusiness|TravelAction/i.test(String(t || '')))) continue;
        const title = cleanTitle(node.name);
        if (!title || title.length < 5) continue;

        const desc = cleanDescription(node.description || '', title);
        const { destination, country, category } = classifyHoliday(title, desc);
        const { nights, duration } = parseNightsAndDuration(`${title} ${desc}`);
        const priceInfo = await normalizeListingPrice({ offers: extractJsonLdOffers(node.offers), rawText: `${title} ${desc}` });
        const bookingUrl = resolveUrl(node.url || finalUrl, finalUrl) || finalUrl;
        const image = extractImage({ jsonLdImages: node.image, ogImage: openGraph['og:image'] }, {
            category: 'Family & Community Events',
            baseUrl: finalUrl,
            sourceName: source.name
        });

        const key = `${source.name}|${title}`;
        candidates.set(key, {
            externalId: stableId(key),
            title,
            description: desc,
            category,
            destination,
            country,
            images: [image],
            accommodation: /hotel|resort|lodge/i.test(title) ? title : '',
            duration,
            nights,
            activities: /safari|game drive|beach|snorkeling|flight|transfer/i.test(desc) ? [category] : [],
            transport: /sgr|fly-?in|flight|cruiser|transfer/i.test(title + ' ' + desc) ? 'As stated in package' : '',
            meals: /all[- ]inclusive|full board|half board|bed & breakfast|b&b/i.exec(title + ' ' + desc)?.[0] || '',
            pricePerPerson: priceInfo.amount,
            currency: priceInfo.currency || 'KES',
            priceKes: priceInfo.priceKes,
            exchangeRateUsed: priceInfo.exchangeRateUsed,
            exchangeRateTimestamp: priceInfo.exchangeRateTimestamp,
            priceType: priceInfo.priceKes != null ? 'verified' : 'unavailable',
            priceStatus: priceInfo.priceKes != null ? 'verified' : 'price_on_request',
            availability: 'external_booking',
            travelDates: 'Check provider availability',
            provider: source.name,
            bookingUrl
        });
    }

    // 2. HTML Package / Safari Cards
    const headings = $('article h2, article h3, .card h2, .card h3, .product h2, .package h3, h2, h3').slice(0, 60).toArray();
    for (const el of headings) {
        const heading = $(el);
        const title = cleanTitle(heading.text());
        if (!title || title.length < 6 || title.length > 130) continue;
        if (/^(?:about us|trusted tour|sustainable|conservation|contact|newsletter|beach holidays|safari|stay cations|international|seasonal)/i.test(title)) continue;
        if (!/(?:day|night|safari|diani|mombasa|mara|amboseli|naivasha|nakuru|watamu|lamu|zanzibar|dubai|cape town|escape|package|holiday|getaway|honeymoon|tour|resort)/i.test(title)) {
            continue;
        }

        const container = heading.closest('article, .card, .product, .elementor-widget-container, .wp-block-group, section, li, div');
        const containerText = container.text().replace(/\s+/g, ' ').trim().slice(0, 700);
        const { destination, country, category } = classifyHoliday(title, containerText);
        const { nights, duration } = parseNightsAndDuration(`${title} ${containerText}`);
        const priceInfo = await normalizeListingPrice({ rawText: containerText });

        const linkHref = heading.find('a[href]').first().attr('href')
            || heading.parent('a[href]').attr('href')
            || container.find('a[href]').first().attr('href')
            || finalUrl;
        const bookingUrl = resolveUrl(linkHref, finalUrl) || finalUrl;

        const domImgs = [];
        container.find('img').each((_, img) => {
            const src = $(img).attr('src') || $(img).attr('data-src');
            if (src) domImgs.push(src);
        });
        const image = extractImage({ domImages: domImgs, ogImage: openGraph['og:image'] }, {
            category: 'Family & Community Events',
            baseUrl: finalUrl,
            sourceName: source.name
        });

        const key = `${source.name}|${title}`;
        if (candidates.has(key)) continue;

        candidates.set(key, {
            externalId: stableId(key),
            title,
            description: cleanDescription(containerText, title, 420),
            category,
            destination,
            country,
            images: [image],
            accommodation: '',
            duration,
            nights,
            activities: [category],
            transport: /fly|flight|sgr|van|land cruiser|transfer/i.test(containerText) ? 'Transfers / Transport noted' : '',
            meals: /all[- ]inclusive|full board|half board|bed & breakfast/i.exec(containerText)?.[0] || '',
            pricePerPerson: priceInfo.amount,
            currency: priceInfo.currency || 'KES',
            priceKes: priceInfo.priceKes,
            exchangeRateUsed: priceInfo.exchangeRateUsed,
            exchangeRateTimestamp: priceInfo.exchangeRateTimestamp,
            priceType: priceInfo.priceKes != null ? 'verified' : 'unavailable',
            priceStatus: priceInfo.priceKes != null ? 'verified' : 'price_on_request',
            availability: 'external_booking',
            travelDates: 'Check provider calendar',
            provider: source.name,
            bookingUrl
        });
    }

    return [...candidates.values()];
}

module.exports = {
    extractHolidaysFromPage
};
