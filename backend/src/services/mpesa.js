const origin = 'https://api.safaricom.co.ke';

function config() {
    const { MPESA_CONSUMER_KEY: key, MPESA_CONSUMER_SECRET: secret, MPESA_SHORTCODE: shortcode,
        MPESA_PASSKEY: passkey, MPESA_CALLBACK_URL: callback, MPESA_TILL_NUMBER: till } = process.env;
    if (process.env.PAYMENT_MODE !== 'live' || !key || !secret || !passkey ||
        !/^\d{5,10}$/.test(shortcode ?? '') || shortcode === '174379' ||
        (till && !/^\d{5,10}$/.test(till))) return null;
    try {
        const url = new URL(callback);
        if (url.protocol !== 'https:' || url.username || url.password ||
            url.pathname !== '/api/payments/mpesa/callback' ||
            url.hostname === 'localhost' || !url.hostname.includes('.') ||
            /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null;
    } catch {
        return null;
    }
    return { key, secret, shortcode, passkey, callback, till };
}

async function request(path, options) {
    const response = await fetch(origin + path, { ...options, signal: AbortSignal.timeout(12000) });
    const body = await response.json();
    if (!response.ok || !body) {
        const error = new Error('Daraja request failed');
        error.definitelyRejected = response.status === 400 && typeof body?.errorCode === 'string';
        throw error;
    }
    return body;
}

async function expressRequest(path, payload) {
    const settings = config();
    if (!settings) throw new Error('Daraja configuration is incomplete');
    const basic = Buffer.from(settings.key + ':' + settings.secret).toString('base64');
    let auth;
    try {
        auth = await request('/oauth/v1/generate?grant_type=client_credentials', {
            headers: { Authorization: 'Basic ' + basic }
        });
        if (!auth.access_token) throw new Error('Daraja OAuth token missing');
    } catch {
        throw Object.assign(new Error('Daraja authorization failed'), { definitelyRejected: true });
    }
    const timestamp = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 19).replace(/\D/g, '');
    const password = Buffer.from(settings.shortcode + settings.passkey + timestamp).toString('base64');
    return request('/mpesa/stkpush' + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + auth.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ BusinessShortCode: settings.shortcode, Password: password,
            Timestamp: timestamp, ...payload(settings) })
    });
}

function initiate(order) {
    return expressRequest('/v1/processrequest', settings => ({
        TransactionType: settings.till ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
        Amount: order.totalKes,
        PartyA: order.customer.phone,
        PartyB: settings.till || settings.shortcode,
        PhoneNumber: order.customer.phone,
        CallBackURL: settings.callback,
        AccountReference: order.orderReference.slice(-12),
        TransactionDesc: 'Event tickets'
    }));
}

function query(checkoutRequestId) {
    return expressRequest('query/v1/query', () => ({ CheckoutRequestID: checkoutRequestId }));
}

module.exports = { config, initiate, query };
