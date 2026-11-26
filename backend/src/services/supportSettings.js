const { collection } = require('./commerceDb');
const { isConnected } = require('../config/db');

const SETTINGS_KEY = 'support_contact';
let cachedStored = undefined;
let cachedAt = 0;

function cleanEmail(value) {
    const email = String(value ?? '').trim();
    if (!email) return null;
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw Object.assign(new Error('Enter a valid support email address (or leave blank).'), { status: 400 });
    }
    return email;
}

function cleanPhone(value, label = 'phone number') {
    const phone = String(value ?? '').trim();
    if (!phone) return null;
    if (!/^\+?[\d ()-]{7,25}$/.test(phone)) {
        throw Object.assign(new Error(`Enter a valid support ${label} (7–25 digits, or leave blank).`), { status: 400 });
    }
    return phone;
}

function cleanHours(value) {
    const hours = String(value ?? '').trim();
    if (!hours) return null;
    return hours.slice(0, 120);
}

function formatWhatsAppUrl(whatsapp) {
    if (!whatsapp) return null;
    let digits = String(whatsapp).replace(/\D/g, '');
    if (!digits) return null;
    if (/^0[17]\d{8}$/.test(digits)) {
        digits = '254' + digits.slice(1);
    } else if (/^[17]\d{8}$/.test(digits)) {
        digits = '254' + digits;
    }
    if (digits.length < 7 || digits.length > 15) return null;
    return `https://wa.me/${digits}`;
}

function envFallback() {
    const rawEmail = String(process.env.SUPPORT_EMAIL || '').trim();
    const rawPhone = String(process.env.SUPPORT_PHONE || '').trim();
    const rawWhatsapp = String(process.env.SUPPORT_WHATSAPP || '').trim();
    const rawHours = String(process.env.SUPPORT_HOURS || '').trim();
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) && rawEmail.length <= 254 ? rawEmail : null;
    const phone = /^\+?[\d ()-]{7,25}$/.test(rawPhone) ? rawPhone : null;
    const whatsapp = /^\+?[\d ()-]{7,25}$/.test(rawWhatsapp) ? rawWhatsapp : null;
    const hours = rawHours ? rawHours.slice(0, 120) : null;
    return { email, phone, whatsapp, whatsappUrl: formatWhatsAppUrl(whatsapp), hours, updatedAt: null };
}

function shapeResponse(doc, storageAvailable) {
    const base = doc
        ? {
            email: doc.email || null,
            phone: doc.phone || null,
            whatsapp: doc.whatsapp || null,
            whatsappUrl: formatWhatsAppUrl(doc.whatsapp),
            hours: doc.hours || null,
            updatedAt: doc.updatedAt || null
        }
        : envFallback();
    return { ...base, storageAvailable };
}

async function getSupportSettings(forceFresh = false) {
    const storageAvailable = isConnected();
    let stored = cachedStored;
    if (storageAvailable && (forceFresh || cachedStored === undefined || Date.now() - cachedAt > 15000)) {
        try {
            stored = await collection('commerce_settings').findOne({ _id: SETTINGS_KEY }, { maxTimeMS: 5000 });
            cachedStored = stored;
            cachedAt = Date.now();
        } catch {
            // Keep last known support contact during transient DB latency
        }
    }
    return shapeResponse(stored || null, storageAvailable);
}

async function setSupportSettings(input = {}, actor = 'admin') {
    if (!isConnected()) {
        throw Object.assign(new Error('Database is offline. Reconnect before saving support contact details.'), { status: 503 });
    }
    const email = cleanEmail(input.email);
    const phone = cleanPhone(input.phone, 'phone number');
    const whatsapp = cleanPhone(input.whatsapp, 'WhatsApp number');
    const hours = cleanHours(input.hours);
    const updatedAt = new Date();
    const doc = {
        _id: SETTINGS_KEY,
        email,
        phone,
        whatsapp,
        hours,
        updatedAt,
        updatedBy: actor || 'admin'
    };
    await collection('commerce_settings').updateOne(
        { _id: SETTINGS_KEY },
        { $set: doc },
        { upsert: true }
    );
    await collection('commerce_audit').insertOne({
        action: 'support_contact',
        target: [email, phone, whatsapp].filter(Boolean).join(' · ') || 'cleared',
        timestamp: updatedAt.toISOString(),
        actor: actor || 'admin'
    }).catch(() => null);
    cachedStored = doc;
    cachedAt = Date.now();
    return shapeResponse(doc, true);
}

function clearSupportSettingsCache() {
    cachedStored = undefined;
    cachedAt = 0;
}

module.exports = {
    getSupportSettings,
    setSupportSettings,
    formatWhatsAppUrl,
    cleanEmail,
    cleanPhone,
    cleanHours,
    clearSupportSettingsCache
};
