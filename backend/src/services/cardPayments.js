const { randomBytes } = require('node:crypto');

function isDemoCardAllowed() {
    return process.env.NODE_ENV !== 'production' && process.env.PAYMENT_MODE !== 'live';
}

function cardGatewayConfig() {
    const paystackKey = process.env.PAYSTACK_SECRET_KEY?.trim() || '';
    const flutterwaveKey = process.env.FLUTTERWAVE_SECRET_KEY?.trim() || '';
    if (paystackKey) {
        return { configured: true, enabled: true, provider: 'paystack', secretKey: paystackKey };
    }
    if (flutterwaveKey) {
        return { configured: true, enabled: true, provider: 'flutterwave', secretKey: flutterwaveKey };
    }
    const demoOk = isDemoCardAllowed();
    return { configured: false, enabled: demoOk, provider: demoOk ? 'demo_card' : null, secretKey: '' };
}

async function initiateCardCheckout({ order, callbackUrl }) {
    const cfg = cardGatewayConfig();
    const reference = `CARD-${order.orderReference}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const amountKes = Math.max(1, Math.round(Number(order.totalKes) || 0));

    if (!cfg.configured) {
        if (!isDemoCardAllowed()) {
            throw Object.assign(new Error('Card payments are not configured yet. Please pay via M-Pesa STK Push.'), { status: 503 });
        }
        return {
            provider: 'demo_card',
            mode: 'demo',
            reference,
            authorizationUrl: null,
            amountKes,
            currency: 'KES',
            message: 'Demo card checkout ready (configure PAYSTACK_SECRET_KEY or FLUTTERWAVE_SECRET_KEY for live Visa/Mastercard).'
        };
    }

    if (cfg.provider === 'paystack') {
        const res = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${cfg.secretKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: order.customer.email,
                amount: amountKes * 100,
                currency: 'KES',
                reference,
                callback_url: callbackUrl,
                metadata: {
                    orderReference: order.orderReference,
                    customerName: order.customer.name
                }
            }),
            signal: AbortSignal.timeout(15000)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.status || !data?.data?.authorization_url) {
            throw Object.assign(new Error(data?.message || 'Could not start Paystack card checkout.'), { status: 502 });
        }
        return {
            provider: 'paystack',
            mode: 'live',
            reference,
            authorizationUrl: data.data.authorization_url,
            accessCode: data.data.access_code,
            amountKes,
            currency: 'KES'
        };
    }

    // Flutterwave
    const res = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${cfg.secretKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            tx_ref: reference,
            amount: amountKes,
            currency: 'KES',
            redirect_url: callbackUrl,
            customer: {
                email: order.customer.email,
                phonenumber: order.customer.phone,
                name: order.customer.name
            },
            customizations: {
                title: 'Ticketsasa Kenya',
                description: `Order ${order.orderReference}`
            }
        }),
        signal: AbortSignal.timeout(15000)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.status !== 'success' || !data?.data?.link) {
        throw Object.assign(new Error(data?.message || 'Could not start Flutterwave card checkout.'), { status: 502 });
    }
    return {
        provider: 'flutterwave',
        mode: 'live',
        reference,
        authorizationUrl: data.data.link,
        amountKes,
        currency: 'KES'
    };
}

async function verifyCardCheckout({ provider, reference, transactionId, expectedAmountKes }) {
    const cfg = cardGatewayConfig();
    if (provider === 'demo_card' || !cfg.configured) {
        if (!isDemoCardAllowed()) {
            return {
                verified: false,
                provider: cfg.provider || 'unconfigured',
                receipt: null,
                reason: 'Card payments are not enabled in live mode. Please pay via M-Pesa.'
            };
        }
        return {
            verified: true,
            provider: 'demo_card',
            receipt: `CARD-${randomBytes(4).toString('hex').toUpperCase()}`
        };
    }

    if (cfg.provider === 'paystack') {
        const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
            headers: { Authorization: `Bearer ${cfg.secretKey}` },
            signal: AbortSignal.timeout(15000)
        });
        const data = await res.json().catch(() => ({}));
        const paid = res.ok && data?.status && data?.data?.status === 'success'
            && Math.round((Number(data.data.amount) || 0) / 100) >= Math.round(expectedAmountKes);
        return {
            verified: paid,
            provider: 'paystack',
            receipt: String(data?.data?.reference || reference).toUpperCase(),
            reason: paid ? null : (data?.data?.gateway_response || data?.message || 'Card payment not completed.')
        };
    }

    // Flutterwave
    const verifyId = transactionId || reference;
    const res = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(verifyId)}/verify`, {
        headers: { Authorization: `Bearer ${cfg.secretKey}` },
        signal: AbortSignal.timeout(15000)
    });
    const data = await res.json().catch(() => ({}));
    const paid = res.ok && data?.status === 'success' && data?.data?.status === 'successful'
        && Number(data?.data?.amount) >= Number(expectedAmountKes);
    return {
        verified: paid,
        provider: 'flutterwave',
        receipt: String(data?.data?.flw_ref || reference).toUpperCase(),
        reason: paid ? null : (data?.message || 'Card payment not completed.')
    };
}

module.exports = {
    cardGatewayConfig,
    initiateCardCheckout,
    verifyCardCheckout
};
