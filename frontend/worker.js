const DEFAULT_BACKEND = 'https://ticketsasa-live.onrender.com';

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

        return env.ASSETS.fetch(request);
    }
};
