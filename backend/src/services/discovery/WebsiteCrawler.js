const cheerio = require('cheerio');
const { checkRobotsAllowed, waitForHostSlot, isBlockedResponse } = require('./robotsGuard');

const USER_AGENT = 'TicketsasaDiscoveryBot/1.0 (+https://ticketsasa.com)';

function flattenJsonLd(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
        for (const item of node) flattenJsonLd(item, out);
        return out;
    }
    out.push(node);
    if (Array.isArray(node['@graph'])) flattenJsonLd(node['@graph'], out);
    if (Array.isArray(node.itemListElement)) {
        for (const el of node.itemListElement) {
            if (el?.item) flattenJsonLd(el.item, out);
            else flattenJsonLd(el, out);
        }
    }
    return out;
}

function extractStructuredMetadata($, baseUrl) {
    const jsonLd = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text();
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            flattenJsonLd(parsed, jsonLd);
        } catch {
            // Skip malformed JSON-LD block
        }
    });

    const openGraph = {};
    $('meta[property^="og:"], meta[name^="og:"], meta[name="twitter:image"], meta[name="description"]').each((_, el) => {
        const key = $(el).attr('property') || $(el).attr('name');
        const content = $(el).attr('content');
        if (key && content) openGraph[key.toLowerCase()] = content.trim();
    });

    const canonical = $('link[rel="canonical"]').attr('href');
    let canonicalUrl = baseUrl;
    if (canonical) {
        try { canonicalUrl = new URL(canonical, baseUrl).href; } catch {}
    }

    return { jsonLd, openGraph, canonicalUrl };
}

async function fetchWithPlaywright(url) {
    // Optional browser automation when ENABLE_PLAYWRIGHT_CRAWLER=true and playwright is installed
    if (process.env.ENABLE_PLAYWRIGHT_CRAWLER !== 'true') return null;
    try {
        const { chromium } = require('playwright');
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage({ userAgent: USER_AGENT });
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await page.waitForTimeout(1500);
            const html = await page.content();
            const finalUrl = page.url();
            return { status: 200, html, finalUrl };
        } finally {
            await browser.close();
        }
    } catch {
        return null;
    }
}

async function crawlPage(targetUrl, { rateLimitMs = 1500, timeoutMs = 15000, fetchImpl = fetch, usePlaywright = false } = {}) {
    const startedAt = Date.now();
    let parsed;
    try {
        parsed = new URL(targetUrl);
    } catch {
        return { ok: false, blocked: false, skippedByRobots: false, status: 0, error: 'Invalid URL', durationMs: 0 };
    }

    const robots = await checkRobotsAllowed(targetUrl, { fetchImpl });
    if (!robots.allowed) {
        return {
            ok: false,
            blocked: false,
            skippedByRobots: true,
            status: 0,
            finalUrl: targetUrl,
            error: robots.reason,
            durationMs: Date.now() - startedAt
        };
    }

    const effectiveDelay = Math.max(rateLimitMs, robots.crawlDelayMs || 0);
    await waitForHostSlot(parsed.hostname, effectiveDelay);

    let responseStatus = 0;
    let html = '';
    let finalUrl = targetUrl;
    let lastError = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const res = await fetchImpl(targetUrl, {
                headers: {
                    'User-Agent': USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(timeoutMs)
            });
            responseStatus = res.status;
            finalUrl = res.url || targetUrl;
            html = await res.text();
            if (res.ok) {
                lastError = '';
                break;
            }
            if ([403, 404, 429].includes(res.status)) {
                lastError = `HTTP ${res.status}`;
                break;
            }
            lastError = `HTTP ${res.status}`;
        } catch (err) {
            lastError = err.message || 'Network request failed';
        }
        if (attempt === 1) await new Promise(r => setTimeout(r, 800));
    }

    const blockCheck = isBlockedResponse(responseStatus, html);
    if (blockCheck.blocked) {
        return {
            ok: false,
            blocked: true,
            skippedByRobots: false,
            status: responseStatus,
            finalUrl,
            error: blockCheck.reason,
            durationMs: Date.now() - startedAt
        };
    }

    if ((!html || lastError) && usePlaywright) {
        const pw = await fetchWithPlaywright(targetUrl);
        if (pw?.html) {
            html = pw.html;
            finalUrl = pw.finalUrl;
            responseStatus = pw.status;
            lastError = '';
        }
    }

    if (lastError || !html) {
        return {
            ok: false,
            blocked: false,
            skippedByRobots: false,
            status: responseStatus,
            finalUrl,
            error: lastError || 'Empty response body',
            durationMs: Date.now() - startedAt
        };
    }

    const $ = cheerio.load(html);
    const { jsonLd, openGraph, canonicalUrl } = extractStructuredMetadata($, finalUrl);

    return {
        ok: true,
        blocked: false,
        skippedByRobots: false,
        status: responseStatus,
        finalUrl,
        canonicalUrl,
        html,
        $,
        jsonLd,
        openGraph,
        durationMs: Date.now() - startedAt
    };
}

async function fetchSitemapUrls(sitemapUrl, { limit = 25, fetchImpl = fetch } = {}) {
    const crawled = await crawlPage(sitemapUrl, { fetchImpl });
    if (!crawled.ok || !crawled.html) return [];
    const locs = [...crawled.html.matchAll(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi)].map(m => m[1].trim());
    return [...new Set(locs)].slice(0, limit);
}

module.exports = {
    USER_AGENT,
    crawlPage,
    fetchSitemapUrls,
    extractStructuredMetadata
};
