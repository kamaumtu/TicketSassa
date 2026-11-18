function publicOrigin() {
    try {
        const url = new URL(process.env.AUTH_PUBLIC_ORIGIN || 'http://localhost:' + (process.env.PORT || 8000));
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
            (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && process.env.NODE_ENV !== 'production'))) {
            return null;
        }
        return url.origin;
    } catch {
        return null;
    }
}

function googleConfig() {
    const origin = publicOrigin();
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    return origin && clientId && secret
        ? { clientId, secret, redirectUri: origin + '/api/auth/google/callback' } : null;
}

function emailConfig() {
    const origin = publicOrigin();
    const key = process.env.RESEND_API_KEY?.trim();
    const from = process.env.AUTH_EMAIL_FROM?.trim();
    return origin && key && from ? { origin, key, from } : null;
}

async function sendConfirmation(config, email, token) {
    const link = new URL('/api/auth/confirm', config.origin);
    link.searchParams.set('token', token);
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
            headers: { Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: config.from, to: [email], subject: 'Confirm your Ticketsasa email',
                text: 'Confirm your email using this link, then enter the password you chose: ' + link.href +
                    '\n\nThe link expires in 30 minutes. If you did not create an account, ignore this email.'
            })
        });
        if (!response.ok) throw new Error('Email provider rejected delivery');
    } catch {
        throw Object.assign(new Error('Confirmation email could not be sent. Try sending a new link.'), { status: 503 });
    }
}

async function sendOrderTicketsEmail(order, passes = [], travelReservation = null) {
    const config = emailConfig();
    if (!config || !order?.customer?.email) return { delivered: false };
    const passLines = passes.map((p, idx) =>
        `${idx + 1}. ${p.eventTitle || 'Ticketsasa Pass'} — ${p.tierName} | Pass Ref: ${p.passReference} | QR Token: ${p.qrCodeToken} | Gate: ${p.designatedGate}`
    ).join('\n');
    const travelLine = travelReservation?.confirmationCode
        ? `\nTravel Confirmation: ${travelReservation.confirmationCode} (${travelReservation.status})`
        : '';
    const text = [
        `Hello ${order.customer.name || 'Customer'},`,
        '',
        `Your payment for order ${order.orderReference} (KES ${Number(order.totalKes || 0).toLocaleString('en-KE')}) is confirmed.`,
        `M-Pesa Receipt: ${order.receipt || 'CONFIRMED'}`,
        travelLine,
        '',
        'Issued Digital Passes:',
        passLines || 'No individual passes attached.',
        '',
        `Retrieve & print your QR passes anytime at: ${config.origin}/?view=check-ticket`,
        `Order Reference: ${order.orderReference}`,
        `Checkout Email: ${order.customer.email}`
    ].filter(Boolean).join('\n');

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { Authorization: 'Bearer ' + config.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: config.from,
            to: [order.customer.email],
            subject: `Your Ticketsasa Order & Digital Passes (${order.orderReference})`,
            text
        })
    });
    return { delivered: response.ok };
}

module.exports = { publicOrigin, googleConfig, emailConfig, sendConfirmation, sendOrderTicketsEmail };
