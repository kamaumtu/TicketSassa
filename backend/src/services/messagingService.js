const { collection } = require('./commerceDb');

function formatKenyanPhone(phone) {
    const digits = String(phone || '').replace(/[\s()+-]/g, '');
    if (/^0[17]\d{8}$/.test(digits)) return '254' + digits.slice(1);
    if (/^[17]\d{8}$/.test(digits)) return '254' + digits;
    return digits;
}

function messagingConfig() {
    const whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() || '';
    const whatsappPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '';
    const atApiKey = process.env.AT_API_KEY?.trim() || '';
    const atUsername = process.env.AT_USERNAME?.trim() || '';
    return {
        whatsappConfigured: Boolean(whatsappToken && whatsappPhoneId),
        smsConfigured: Boolean(atApiKey && atUsername),
        whatsappToken,
        whatsappPhoneId,
        atApiKey,
        atUsername,
        atSenderId: process.env.AT_SENDER_ID?.trim() || ''
    };
}

async function logNotification(entry) {
    try {
        await collection('commerce_notifications').insertOne({
            ...entry,
            createdAt: new Date()
        });
    } catch {}
}

async function sendWhatsAppMessage(phone, message, meta = {}) {
    const to = formatKenyanPhone(phone);
    const cfg = messagingConfig();
    if (!to) return { sent: false, channel: 'whatsapp', status: 'skipped', reason: 'Missing phone number' };

    if (!cfg.whatsappConfigured) {
        await logNotification({
            channel: 'whatsapp',
            to,
            message,
            status: 'queued_unconfigured',
            orderReference: meta.orderReference || '',
            kind: meta.kind || 'booking'
        });
        return { sent: false, channel: 'whatsapp', status: 'queued_unconfigured' };
    }

    try {
        const res = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.whatsappPhoneId)}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${cfg.whatsappToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body: message }
            }),
            signal: AbortSignal.timeout(12000)
        });
        const ok = res.ok;
        await logNotification({
            channel: 'whatsapp',
            to,
            message,
            status: ok ? 'sent' : 'failed',
            httpStatus: res.status,
            orderReference: meta.orderReference || '',
            kind: meta.kind || 'booking'
        });
        return { sent: ok, channel: 'whatsapp', status: ok ? 'sent' : 'failed' };
    } catch (err) {
        await logNotification({
            channel: 'whatsapp',
            to,
            message,
            status: 'failed',
            error: err.message,
            orderReference: meta.orderReference || '',
            kind: meta.kind || 'booking'
        });
        return { sent: false, channel: 'whatsapp', status: 'failed', error: err.message };
    }
}

async function sendSmsMessage(phone, message, meta = {}) {
    const to = formatKenyanPhone(phone);
    const cfg = messagingConfig();
    if (!to) return { sent: false, channel: 'sms', status: 'skipped', reason: 'Missing phone number' };

    if (!cfg.smsConfigured) {
        await logNotification({
            channel: 'sms',
            to: '+' + to,
            message,
            status: 'queued_unconfigured',
            orderReference: meta.orderReference || '',
            kind: meta.kind || 'booking'
        });
        return { sent: false, channel: 'sms', status: 'queued_unconfigured' };
    }

    try {
        const params = new URLSearchParams({
            username: cfg.atUsername,
            to: '+' + to,
            message,
            ...(cfg.atSenderId ? { from: cfg.atSenderId } : {})
        });
        const endpoint = cfg.atUsername === 'sandbox'
            ? 'https://api.sandbox.africastalking.com/version1/messaging'
            : 'https://api.africastalking.com/version1/messaging';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                apiKey: cfg.atApiKey,
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString(),
            signal: AbortSignal.timeout(12000)
        });
        const ok = res.ok;
        await logNotification({
            channel: 'sms',
            to: '+' + to,
            message,
            status: ok ? 'sent' : 'failed',
            httpStatus: res.status,
            orderReference: meta.orderReference || '',
            kind: meta.kind || 'booking'
        });
        return { sent: ok, channel: 'sms', status: ok ? 'sent' : 'failed' };
    } catch (err) {
        await logNotification({
            channel: 'sms',
            to: '+' + to,
            message,
            status: 'failed',
            error: err.message,
            orderReference: meta.orderReference || '',
            kind: meta.kind || 'booking'
        });
        return { sent: false, channel: 'sms', status: 'failed', error: err.message };
    }
}

async function sendBookingAlerts(order, passes = [], reservation = null) {
    const phone = order?.customer?.phone;
    if (!phone) return { whatsapp: null, sms: null };

    const siteUrl = (process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:8000').replace(/\/+$/, '');
    const firstPass = passes[0];
    const title = firstPass?.eventTitle || order.items?.[0]?.eventTitle || order.items?.[0]?.title || 'Ticketsasa Booking';
    const pdfLink = firstPass?.qrCodeToken
        ? `${siteUrl}/api/passes/${encodeURIComponent(firstPass.qrCodeToken)}/pdf?email=${encodeURIComponent(order.customer.email)}`
        : `${siteUrl}/?view=checkticket`;
    const pnrLine = reservation?.confirmationCode ? `Confirmation: ${reservation.confirmationCode}\n` : '';

    const text = [
        `Ticketsasa Booking Confirmed!`,
        `${title}`,
        `Order: ${order.orderReference}`,
        pnrLine ? pnrLine.trim() : null,
        `Total Paid: KES ${Number(order.totalKes || 0).toLocaleString('en-KE')}`,
        `Passes: ${passes.length || order.totalTickets || 1}`,
        `Download PDF / QR Pass: ${pdfLink}`
    ].filter(Boolean).join('\n');

    const [whatsapp, sms] = await Promise.all([
        sendWhatsAppMessage(phone, text, { orderReference: order.orderReference, kind: 'booking_confirmed' }),
        sendSmsMessage(phone, text, { orderReference: order.orderReference, kind: 'booking_confirmed' })
    ]);
    return { whatsapp, sms };
}

async function sendFulfillmentConfirmation({ orderReference, phone, customerName, title, supplierPnr, notes }) {
    if (!phone) return { whatsapp: null, sms: null };
    const text = [
        `Hello ${customerName || 'Traveller'}, your Ticketsasa travel confirmation is ready!`,
        `${title}`,
        `Order: ${orderReference}`,
        `Airline PNR / Hotel Confirmation: ${supplierPnr}`,
        notes ? `Note: ${notes}` : null
    ].filter(Boolean).join('\n');

    const [whatsapp, sms] = await Promise.all([
        sendWhatsAppMessage(phone, text, { orderReference, kind: 'fulfillment_pnr' }),
        sendSmsMessage(phone, text, { orderReference, kind: 'fulfillment_pnr' })
    ]);
    return { whatsapp, sms };
}

module.exports = {
    messagingConfig,
    sendWhatsAppMessage,
    sendSmsMessage,
    sendBookingAlerts,
    sendFulfillmentConfirmation
};
