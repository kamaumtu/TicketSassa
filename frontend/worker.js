const DEFAULT_BACKEND = 'https://ticketsasa-live.onrender.com';

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf'
};

const EDGE_CACHEABLE_PREFIXES = [
    '/api/events/kenya',
    '/api/events/featured',
    '/api/events',
    '/api/published-events',
    '/api/tickets',
    '/api/automation/meta',
    '/api/automation/public/catalog'
];

const FALLBACK_POSTER = '/assets/real/DzLV4G9UWo-1790859483.jpg';
const FALLBACK_HOLIDAY = '/assets/holidays/beach-holidays.jpg';

function isPublicCacheableApi(method, pathname) {
    if (method !== 'GET') return false;
    return EDGE_CACHEABLE_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
}

function guessMimeType(pathname) {
    const clean = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
    const dot = clean.lastIndexOf('.');
    if (dot === -1) return 'text/html; charset=utf-8';
    return MIME_TYPES[clean.slice(dot).toLowerCase()] || null;
}

function isSafeExternalImageUrl(raw) {
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
        const host = parsed.hostname.toLowerCase();
        if (
            host === 'localhost' ||
            host === '::1' ||
            host.endsWith('.local') ||
            /^127\./.test(host) ||
            /^10\./.test(host) ||
            /^192\.168\./.test(host) ||
            /^169\.254\./.test(host) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host)
        ) {
            return null;
        }
        return parsed.href;
    } catch {
        return null;
    }
}

async function handleImageProxy(request, url, ctx) {
    const rawTarget = url.searchParams.get('url') || '';
    const fallbackType = url.searchParams.get('fallback') === 'holiday' ? FALLBACK_HOLIDAY : FALLBACK_POSTER;
    const targetUrl = isSafeExternalImageUrl(rawTarget);
    if (!targetUrl) {
        return Response.redirect(url.origin + fallbackType, 302);
    }

    const cacheKey = new Request(url.origin + '/img?url=' + encodeURIComponent(targetUrl), { method: 'GET' });
    if (typeof caches !== 'undefined' && caches.default) {
        const hit = await caches.default.match(cacheKey);
        if (hit) {
            const hitHeaders = new Headers(hit.headers);
            hitHeaders.set('X-Image-Edge-Cache', 'HIT');
            return new Response(hit.body, { status: hit.status, headers: hitHeaders });
        }
    }

    try {
        const upstream = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
                'User-Agent': 'TicketsassaEdgeImageProxy/1.0'
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(4500),
            cf: {
                cacheTtl: 604800,
                cacheEverything: true
            }
        });

        const ct = (upstream.headers.get('content-type') || '').toLowerCase();
        if (!upstream.ok || !ct.startsWith('image/')) {
            return Response.redirect(url.origin + fallbackType, 302);
        }

        const outHeaders = new Headers();
        outHeaders.set('Content-Type', ct.split(';')[0]);
        outHeaders.set('Cache-Control', 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=2592000');
        outHeaders.set('X-Content-Type-Options', 'nosniff');
        outHeaders.set('X-Image-Edge-Cache', 'MISS');

        const response = new Response(upstream.body, { status: 200, headers: outHeaders });
        if (typeof caches !== 'undefined' && caches.default && ctx?.waitUntil) {
            ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
        }
        return response;
    } catch {
        return Response.redirect(url.origin + fallbackType, 302);
    }
}

async function fetchUpstreamApi(request, url, backendOrigin) {
    const targetUrl = backendOrigin + url.pathname + url.search;
    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-Host', url.host);
    headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
    headers.delete('host');

    const init = {
        method: request.method,
        headers,
        redirect: 'manual'
    };

    if (!['GET', 'HEAD'].includes(request.method)) {
        init.body = request.body;
    }

    const upstream = await fetch(targetUrl, init);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set('X-Proxied-By', 'Cloudflare-Workers');
    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
    });
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const backendOrigin = (env.BACKEND_ORIGIN || DEFAULT_BACKEND).replace(/\/+$/, '');

        if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
            return Response.redirect(backendOrigin + url.pathname + url.search, 302);
        }

        if (url.pathname === '/img' && request.method === 'GET') {
            return handleImageProxy(request, url, ctx);
        }

        if (url.pathname.startsWith('/api/')) {
            if (isPublicCacheableApi(request.method, url.pathname) && typeof caches !== 'undefined' && caches.default) {
                const cacheKey = new Request(url.toString(), { method: 'GET' });
                const cached = await caches.default.match(cacheKey);
                if (cached) {
                    const cachedAt = Number(cached.headers.get('x-edge-cached-at') || 0);
                    if (Date.now() - cachedAt > 45000 && ctx?.waitUntil) {
                        ctx.waitUntil((async () => {
                            try {
                                const fresh = await fetchUpstreamApi(request, url, backendOrigin);
                                if (fresh.ok) {
                                    const toStoreHeaders = new Headers(fresh.headers);
                                    toStoreHeaders.set('Cache-Control', 'public, max-age=45, s-maxage=600');
                                    toStoreHeaders.set('x-edge-cached-at', String(Date.now()));
                                    await caches.default.put(cacheKey, new Response(fresh.clone().body, { status: 200, headers: toStoreHeaders }));
                                }
                            } catch {}
                        })());
                    }
                    const hitHeaders = new Headers(cached.headers);
                    hitHeaders.set('X-Edge-Cache', 'HIT');
                    return new Response(cached.body, { status: cached.status, headers: hitHeaders });
                }

                const fresh = await fetchUpstreamApi(request, url, backendOrigin);
                if (fresh.ok && ctx?.waitUntil) {
                    const toStoreHeaders = new Headers(fresh.headers);
                    toStoreHeaders.set('Cache-Control', 'public, max-age=45, s-maxage=600');
                    toStoreHeaders.set('x-edge-cached-at', String(Date.now()));
                    ctx.waitUntil(caches.default.put(cacheKey, new Response(fresh.clone().body, { status: 200, headers: toStoreHeaders })));
                }
                return fresh;
            }

            return fetchUpstreamApi(request, url, backendOrigin);
        }

        // Automatic Edge WebP delivery for local PNG/JPG assets when browser supports WebP
        const accept = request.headers.get('accept') || '';
        if (
            request.method === 'GET' &&
            accept.includes('image/webp') &&
            url.pathname.startsWith('/assets/') &&
            /\.(png|jpe?g)$/i.test(url.pathname)
        ) {
            const webpReq = new Request(url.origin + url.pathname + '.webp', { method: 'GET' });
            const webpRes = await env.ASSETS.fetch(webpReq);
            if (webpRes.ok) {
                const webpHeaders = new Headers(webpRes.headers);
                webpHeaders.set('content-type', 'image/webp');
                webpHeaders.set('cache-control', 'public, max-age=31536000, immutable');
                webpHeaders.set('vary', 'Accept');
                webpHeaders.set('x-image-opt', 'webp');
                return new Response(webpRes.body, { status: 200, headers: webpHeaders });
            }
        }

        const assetRes = await env.ASSETS.fetch(request);
        const headers = new Headers(assetRes.headers);
        if (!headers.get('content-type') || headers.get('content-type') === 'application/octet-stream') {
            const guessed = guessMimeType(url.pathname);
            if (guessed) headers.set('content-type', guessed);
        }
        if (url.pathname.startsWith('/assets/')) {
            headers.set('cache-control', 'public, max-age=31536000, immutable');
            if (/\.(png|jpe?g)$/i.test(url.pathname)) {
                headers.set('vary', 'Accept');
            }
        }
        return new Response(assetRes.body, {
            status: assetRes.status,
            statusText: assetRes.statusText,
            headers
        });
    }
};
