const Parser = require('rss-parser');
const { crawlPage } = require('./WebsiteCrawler');

const rssParser = new Parser({
    timeout: 15000,
    headers: { 'User-Agent': 'TicketsasaDiscoveryBot/1.0 (+https://ticketsasa.com)' }
});

const DEFAULT_PUBLIC_SOURCES = [
    {
        name: 'SoldOut Africa Public Events',
        type: 'event',
        adapter: 'public_events_html',
        url: 'https://soldoutafrica.com/events',
        enabled: true,
        rateLimitMs: 1500,
        discoveredFrom: 'seed'
    },
    {
        name: 'Ticketsasa Public Events',
        type: 'event',
        adapter: 'public_events_html',
        url: 'https://ticketsasa.com/events',
        enabled: true,
        rateLimitMs: 2000,
        discoveredFrom: 'seed'
    },
    {
        name: 'KenyaBuzz Public Events',
        type: 'event',
        adapter: 'public_events_html',
        url: 'https://kenyabuzz.com/events',
        enabled: true,
        rateLimitMs: 2000,
        discoveredFrom: 'seed'
    },
    {
        name: 'Google News Kenya Events RSS',
        type: 'event',
        adapter: 'rss_events',
        url: 'https://news.google.com/rss/search?q=upcoming+events+Kenya&hl=en-KE&gl=KE&ceid=KE:en',
        enabled: true,
        rateLimitMs: 1500,
        discoveredFrom: 'seed'
    },
    {
        name: 'Google News Kenya Concerts & Festivals RSS',
        type: 'event',
        adapter: 'rss_events',
        url: 'https://news.google.com/rss/search?q=concert+OR+festival+Nairobi+OR+Mombasa+Kenya&hl=en-KE&gl=KE&ceid=KE:en',
        enabled: true,
        rateLimitMs: 1500,
        discoveredFrom: 'seed'
    },
    {
        name: 'Google News Kenya Sports & Marathons RSS',
        type: 'event',
        adapter: 'rss_events',
        url: 'https://news.google.com/rss/search?q=football+OR+marathon+OR+rugby+Kenya+tickets&hl=en-KE&gl=KE&ceid=KE:en',
        enabled: true,
        rateLimitMs: 1500,
        discoveredFrom: 'seed'
    },
    {
        name: 'Skyward Express Kenya',
        type: 'flight',
        adapter: 'public_flights_html',
        url: 'https://www.skywardexpress.co.ke/',
        enabled: true,
        rateLimitMs: 2000,
        discoveredFrom: 'seed'
    },
    {
        name: 'Safarilink Aviation Destinations',
        type: 'flight',
        adapter: 'public_flights_html',
        url: 'https://www.flysafarilink.com/destinations',
        enabled: true,
        rateLimitMs: 2000,
        discoveredFrom: 'seed'
    },
    {
        name: 'Kenya Airways Official',
        type: 'flight',
        adapter: 'public_flights_html',
        url: 'https://www.kenya-airways.com/en-ke/',
        enabled: true,
        rateLimitMs: 2000,
        discoveredFrom: 'seed'
    },
    {
        name: 'Bonfire Adventures Packages',
        type: 'holiday',
        adapter: 'public_holidays_html',
        url: 'https://www.bonfireadventures.com/',
        enabled: true,
        rateLimitMs: 2000,
        discoveredFrom: 'seed'
    },
    {
        name: 'Expeditions Maasai Safaris',
        type: 'holiday',
        adapter: 'public_holidays_html',
        url: 'https://expeditions.co.ke/',
        enabled: true,
        rateLimitMs: 2000,
        discoveredFrom: 'seed'
    },
    {
        name: 'Ticketsasa Public Holidays',
        type: 'holiday',
        adapter: 'public_holidays_html',
        url: 'https://ticketsasa.com/holidays',
        enabled: true,
        rateLimitMs: 2000,
        discoveredFrom: 'seed'
    }
];

async function fetchRssItems(feedUrl) {
    const feed = await rssParser.parseURL(feedUrl);
    return (feed?.items || []).map(item => ({
        title: item.title || '',
        link: item.link || '',
        pubDate: item.isoDate || item.pubDate || '',
        content: item.contentSnippet || item.content || '',
        creator: item.creator || feed?.title || 'RSS Feed',
        enclosureUrl: item.enclosure?.url || ''
    }));
}

function buildCountyRssQueries(counties = []) {
    // Public RSS search queries for specific counties without any API keys
    return counties.slice(0, 6).map(county => ({
        name: `RSS Discovery: ${county} Events`,
        type: 'event',
        adapter: 'rss_events',
        url: `https://news.google.com/rss/search?q=${encodeURIComponent(`events "${county}" Kenya`)}&hl=en-KE&gl=KE&ceid=KE:en`,
        enabled: true,
        rateLimitMs: 1500,
        discoveredFrom: 'county_search'
    }));
}

async function discoverCandidateLinksFromPage(url, keywordPattern = /event|concert|festival|holiday|safari|flight/i) {
    const crawled = await crawlPage(url);
    if (!crawled.ok || !crawled.$) return [];
    const found = new Set();
    crawled.$('a[href]').each((_, el) => {
        const href = crawled.$(el).attr('href');
        if (!href) return;
        try {
            const abs = new URL(href, crawled.finalUrl).href;
            if (abs.startsWith('http') && keywordPattern.test(abs)) found.add(abs);
        } catch {}
    });
    return [...found].slice(0, 20);
}

module.exports = {
    DEFAULT_PUBLIC_SOURCES,
    fetchRssItems,
    buildCountyRssQueries,
    discoverCandidateLinksFromPage
};
