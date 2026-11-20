const robotsCache = new Map();
const hostLastHit = new Map();
const ROBOTS_TTL_MS = 12 * 60 * 60 * 1000;

function parseRobotsTxt(text, userAgent = 'TicketsasaDiscoveryBot') {
    const lines = String(text || '').split(/\r?\n/);
    const uaLower = userAgent.toLowerCase();
    let currentAgents = [];
    const specific = { allow: [], disallow: [], crawlDelayMs: 0 };
    const wildcard = { allow: [], disallow: [], crawlDelayMs: 0 };
    let matchedSpecific = false;

    for (const rawLine of lines) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) {
            currentAgents = [];
            continue;
        }
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const field = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();

        if (field === 'user-agent') {
            currentAgents.push(value.toLowerCase());
            continue;
        }
        if (!currentAgents.length) continue;

        const isSpecific = currentAgents.some(a => a !== '*' && uaLower.includes(a));
        const isWildcard = currentAgents.includes('*');
        if (!isSpecific && !isWildcard) continue;

        const target = isSpecific ? specific : wildcard;
        if (isSpecific) matchedSpecific = true;

        if (field === 'disallow' && value) target.disallow.push(value);
        else if (field === 'allow' && value) target.allow.push(value);
        else if (field === 'crawl-delay') {
            const secs = Number(value);
            if (Number.isFinite(secs) && secs > 0) {
                target.crawlDelayMs = Math.min(30000, Math.round(secs * 1000));
            }
        }
    }

    return matchedSpecific ? specific : wildcard;
}

function ruleMatches(pathname, rule) {
    if (!rule) return false;
    if (rule === '/') return true;
    const escaped = rule
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    try {
        return new RegExp('^' + escaped).test(pathname);
    } catch {
        return pathname.startsWith(rule.replace(/\*.*$/, ''));
    }
}

async function checkRobotsAllowed(targetUrl, { userAgent = 'TicketsasaDiscoveryBot', fetchImpl = fetch } = {}) {
    let parsed;
    try {
        parsed = new URL(targetUrl);
    } catch {
        return { allowed: false, crawlDelayMs: 0, reason: 'Invalid URL' };
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { allowed: false, crawlDelayMs: 0, reason: 'Unsupported protocol' };
    }

    const cached = robotsCache.get(parsed.origin);
    let rules;
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) {
        rules = cached.rules;
    } else {
        try {
            const res = await fetchImpl(parsed.origin + '/robots.txt', {
                headers: { 'User-Agent': `${userAgent}/1.0` },
                signal: AbortSignal.timeout(6000)
            });
            rules = res.ok ? parseRobotsTxt(await res.text(), userAgent) : { allow: [], disallow: [], crawlDelayMs: 0 };
        } catch {
            rules = { allow: [], disallow: [], crawlDelayMs: 0 };
        }
        robotsCache.set(parsed.origin, { rules, fetchedAt: Date.now() });
    }

    const pathname = parsed.pathname + (parsed.search || '');
    let longestAllow = 0;
    for (const allow of rules.allow) {
        if (ruleMatches(pathname, allow) && allow.length > longestAllow) longestAllow = allow.length;
    }
    let longestDisallow = 0;
    for (const disallow of rules.disallow) {
        if (ruleMatches(pathname, disallow) && disallow.length > longestDisallow) longestDisallow = disallow.length;
    }

    const allowed = longestDisallow === 0 || longestAllow >= longestDisallow;
    return {
        allowed,
        crawlDelayMs: rules.crawlDelayMs || 0,
        reason: allowed ? 'Allowed by robots.txt' : `Disallowed by robots.txt rule on ${parsed.origin}`
    };
}

async function waitForHostSlot(hostname, minDelayMs = 1500) {
    if (!hostname) return;
    const prev = hostLastHit.get(hostname) || 0;
    const waitMs = Math.max(0, prev + minDelayMs - Date.now());
    if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    hostLastHit.set(hostname, Date.now());
}

function isBlockedResponse(status, html = '') {
    if ([403, 429].includes(status)) return { blocked: true, reason: `HTTP ${status} access restricted` };
    const snippet = String(html || '').slice(0, 12000).toLowerCase();
    if (status === 202 && /challenge-platform|captcha|bot/.test(snippet)) {
        return { blocked: true, reason: 'Anti-bot challenge detected (HTTP 202)' };
    }
    if (/cf-chl-|cf-browser-verification|verify you are human|attention required! \| cloudflare|g-recaptcha|hcaptcha/i.test(snippet)) {
        return { blocked: true, reason: 'CAPTCHA or anti-bot gate detected' };
    }
    if (/^<\!doctype html>.*access denied/i.test(snippet) && snippet.length < 5000) {
        return { blocked: true, reason: 'Access denied by target website' };
    }
    return { blocked: false, reason: '' };
}

module.exports = {
    parseRobotsTxt,
    checkRobotsAllowed,
    waitForHostSlot,
    isBlockedResponse
};
