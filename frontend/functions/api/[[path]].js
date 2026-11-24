const DEFAULT_BACKEND = 'https://ticketsasa-live.onrender.com';

export async function onRequest(context) {
    const { request, env } = context;
    const backendOrigin = (env.BACKEND_ORIGIN || DEFAULT_BACKEND).replace(/\/+$/, '');
    const incomingUrl = new URL(request.url);
    const targetUrl = backendOrigin + incomingUrl.pathname + incomingUrl.search;

    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-Host', incomingUrl.host);
    headers.set('X-Forwarded-Proto', incomingUrl.protocol.replace(':', ''));
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
    responseHeaders.set('X-Proxied-By', 'Cloudflare-Pages');

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders
    });
}
