const { createHash } = require('node:crypto');
const { detectCounty, classifyEventCategory } = require('../automation/kenyaCounties');
const { cleanDescription, cleanTitle } = require('./DescriptionProcessor');
const { extractImage, resolveUrl } = require('./ImageExtractor');
const { extractJsonLdOffers, normalizeListingPrice } = require('./PriceExtractor');

function stableId(prefix, uniqueKey) {
    return prefix + ':' + createHash('sha1').update(String(uniqueKey)).digest('hex').slice(0, 20);
}

function parseDateSafe(raw) {
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms) : null;
}

async function extractEventsFromPage(crawlResult, source) {
    if (!crawlResult?.ok) return [];
    const { $, jsonLd = [], openGraph = {}, finalUrl } = crawlResult;
    const nowMs = Date.now();
    const candidates = [];
    const seenUrls = new Set();

    // 1. JSON-LD Schema.org Event nodes
    for (const node of jsonLd) {
        const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
        if (!types.some(t => /Event$/i.test(String(t || '')))) continue;

        const name = cleanTitle(node.name);
        if (!name || name.length < 3) continue;

        const startsAt = parseDateSafe(node.startDate);
        if (!startsAt || startsAt.getTime() <= nowMs) continue;
        const endsAt = parseDateSafe(node.endDate);

        if (/EventCancelled|EventPostponed/i.test(String(node.eventStatus || ''))) continue;

        const origUrl = resolveUrl(node.url || finalUrl, finalUrl) || finalUrl;
        seenUrls.add(origUrl);

        const venue = cleanTitle(node.location?.name || node.location?.address?.streetAddress || '');
        const town = cleanTitle(node.location?.address?.addressLocality || '');
        const addressCountry = String(node.location?.address?.addressCountry || '').toUpperCase();
        const combinedGeo = [name, venue, town, node.location?.address?.addressRegion].join(' ');
        if (addressCountry && !['KE', 'KENYA'].includes(addressCountry) && !/kenya|nairobi|mombasa|kilifi|kisumu|nakuru|eldoret|diani/i.test(combinedGeo)) {
            continue;
        }

        const county = detectCounty(combinedGeo);
        const category = classifyEventCategory([node['@type'], name, node.description, venue].join(' '));
        const organizer = cleanTitle(node.organizer?.name || source.name || 'Event Organizer');
        const description = cleanDescription(node.description || openGraph['og:description'], `${name} in ${venue || county}`);

        const rawOffers = extractJsonLdOffers(node.offers);
        const priceInfo = await normalizeListingPrice({ offers: rawOffers, rawText: node.description || '' });

        const image = extractImage({
            jsonLdImages: node.image,
            ogImage: origUrl === finalUrl ? openGraph['og:image'] : ''
        }, { category, baseUrl: origUrl, sourceName: source.name, attribution: organizer });

        const ticketCategories = priceInfo.offers.map(o => ({
            name: o.name,
            priceKes: o.priceKes,
            priceType: o.priceKes != null ? 'verified' : 'unavailable',
            capacity: 0
        }));

        candidates.push({
            externalId: stableId('web-ev', origUrl + '|' + name + '|' + startsAt.toISOString().slice(0, 10)),
            name,
            description,
            category,
            startsAt,
            endsAt,
            county,
            town: town || county,
            venue: venue || town || county,
            organizer,
            originalUrl: origUrl,
            ticketPurchaseUrl: origUrl,
            ticketCategories,
            confirmedPriceKes: priceInfo.priceKes,
            estimatedPriceKes: null,
            priceType: priceInfo.priceKes != null ? 'verified' : 'unavailable',
            image,
            discoverySource: source.name,
            authorizedToSell: false
        });
    }

    // 2. HTML Event Cards (Cheerio fallback when JSON-LD is not present on the listing page)
    if ($ && candidates.length === 0) {
        const selectors = [
            'article',
            '.event-card',
            '.event-item',
            '[class*="event"]',
            '.card'
        ].join(', ');

        const blocks = $(selectors).slice(0, 40).toArray();
        for (const el of blocks) {
            const card = $(el);
            const heading = cleanTitle(card.find('h1, h2, h3, h4, .title, [class*="title"]').first().text());
            if (!heading || heading.length < 4 || heading.length > 140) continue;

            const cardText = card.text().replace(/\s+/g, ' ').trim();
            if (cardText.length < 15) continue;

            // Only accept cards that contain a parseable future date or time element
            const timeAttr = card.find('time').first().attr('datetime') || card.find('time').first().text();
            const dateMatch = cardText.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*(?:202[6-9])?/i);
            let startsAt = parseDateSafe(timeAttr);
            if (!startsAt && dateMatch) {
                const candidateStr = /202\d/.test(dateMatch[0]) ? dateMatch[0] : `${dateMatch[0]} ${new Date().getFullYear()}`;
                startsAt = parseDateSafe(candidateStr);
                if (startsAt && startsAt.getTime() < nowMs - 86400000) {
                    startsAt.setFullYear(startsAt.getFullYear() + 1);
                }
            }
            if (!startsAt || startsAt.getTime() <= nowMs) continue;

            const href = card.find('a[href]').first().attr('href') || finalUrl;
            const origUrl = resolveUrl(href, finalUrl) || finalUrl;
            if (seenUrls.has(origUrl + '|' + heading)) continue;
            seenUrls.add(origUrl + '|' + heading);

            const county = detectCounty(cardText);
            const category = classifyEventCategory(heading + ' ' + cardText);
            const priceInfo = await normalizeListingPrice({ rawText: cardText });

            const imgSrc = card.find('img').first().attr('src') || card.find('img').first().attr('data-src') || '';
            const image = extractImage({
                domImages: imgSrc ? [imgSrc] : []
            }, { category, baseUrl: finalUrl, sourceName: source.name });

            candidates.push({
                externalId: stableId('web-ev', origUrl + '|' + heading),
                name: heading,
                description: cleanDescription(cardText, heading, 350),
                category,
                startsAt,
                endsAt: null,
                county,
                town: county,
                venue: county,
                organizer: source.name,
                originalUrl: origUrl,
                ticketPurchaseUrl: origUrl,
                ticketCategories: priceInfo.offers.map(o => ({ name: o.name, priceKes: o.priceKes, priceType: 'verified', capacity: 0 })),
                confirmedPriceKes: priceInfo.priceKes,
                estimatedPriceKes: null,
                priceType: priceInfo.priceKes != null ? 'verified' : 'unavailable',
                image,
                discoverySource: source.name,
                authorizedToSell: false
            });
        }
    }

    return candidates;
}

async function extractEventsFromRss(rssItems = [], source) {
    const out = [];
    const nowMs = Date.now();
    for (const item of rssItems.slice(0, 20)) {
        const name = cleanTitle(item.title).replace(/\s+-\s+[^-]+$/, '').trim();
        if (!name || name.length < 6) continue;
        const pubMs = Date.parse(item.pubDate || '');
        // Only treat RSS news/announcement items published recently (within last 21 days) about upcoming Kenyan events
        if (!Number.isFinite(pubMs) || nowMs - pubMs > 21 * 86400000) continue;

        const text = `${name} ${item.content || ''}`;
        if (!/event|concert|festival|marathon|show|summit|conference|match|tournament|cup|gala|party|tickets/i.test(text)) continue;

        // Try extracting an explicit future event date from title/snippet; if none, schedule verification 7 days ahead so admin can verify exact date
        const dateMatch = text.match(/\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*,?\s*(?:202[6-9])?/i);
        let startsAt = null;
        let hasExactDate = false;
        if (dateMatch) {
            const candidateStr = /202\d/.test(dateMatch[0]) ? dateMatch[0] : `${dateMatch[0]} ${new Date().getFullYear()}`;
            const parsed = parseDateSafe(candidateStr);
            if (parsed && parsed.getTime() > nowMs) {
                startsAt = parsed;
                hasExactDate = true;
            }
        }
        if (!startsAt) startsAt = new Date(nowMs + 7 * 86400000);

        const county = detectCounty(text);
        const category = classifyEventCategory(text);
        const priceInfo = await normalizeListingPrice({ rawText: text });
        const origUrl = resolveUrl(item.link, 'https://news.google.com') || item.link;

        out.push({
            externalId: stableId('rss-ev', origUrl || name),
            name,
            description: cleanDescription(item.content || name, name),
            category,
            startsAt,
            endsAt: null,
            county,
            town: county,
            venue: hasExactDate ? county : `${county} (Verify exact venue/date on source)`,
            organizer: item.creator || source.name,
            originalUrl: origUrl,
            ticketPurchaseUrl: origUrl,
            ticketCategories: [],
            confirmedPriceKes: priceInfo.priceKes,
            estimatedPriceKes: null,
            priceType: priceInfo.priceKes != null ? 'verified' : 'unavailable',
            image: extractImage({ posterUrl: item.enclosureUrl }, { category, sourceName: source.name }),
            discoverySource: source.name,
            authorizedToSell: false,
            _missingExactDate: !hasExactDate
        });
    }
    return out;
}

module.exports = {
    extractEventsFromPage,
    extractEventsFromRss
};
