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

function guessMimeType(pathname) {
    const clean = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
    const dot = clean.lastIndexOf('.');
    if (dot === -1) return 'text/html; charset=utf-8';
    return MIME_TYPES[clean.slice(dot).toLowerCase()] || null;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const backendOrigin = (env.BACKEND_ORIGIN || DEFAULT_BACKEND).replace(/\/+$/, '');

        if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
            return Response.redirect(backendOrigin + url.pathname + url.search, 302);
        }

        if (url.pathname.startsWith('/api/')) {
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

        const assetRes = await env.ASSETS.fetch(request);
        const headers = new Headers(assetRes.headers);
        if (!headers.get('content-type') || headers.get('content-type') === 'application/octet-stream') {
            const guessed = guessMimeType(url.pathname);
            if (guessed) headers.set('content-type', guessed);
        }
        if (url.pathname.startsWith('/assets/') && !headers.get('cache-control')) {
            headers.set('cache-control', 'public, max-age=31536000, immutable');
        }
        return new Response(assetRes.body, {
            status: assetRes.status,
            statusText: assetRes.statusText,
            headers
        });
    }
};
