const { isConnected } = require('../config/db');
const { collection } = require('./commerceDb');

const DEFAULT_PRICING = {
    flightMarkupPercent: 0,
    flightFlatFeeKes: 0,
    holidayMarkupPercent: 0,
    holidayFlatFeeKes: 0,
    customPromos: []
};

let cachedPricing = { ...DEFAULT_PRICING };
let lastLoadedAt = 0;

function sanitizePricing(raw = {}) {
    const num = (v, min, max) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
    };
    const customPromos = Array.isArray(raw.customPromos)
        ? raw.customPromos
            .map(p => ({
                code: String(p?.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ''),
                discountPercent: num(p?.discountPercent, 1, 50),
                appliesTo: ['all', 'flight', 'holiday', 'bundle', 'event'].includes(p?.appliesTo) ? p.appliesTo : 'all',
                label: String(p?.label || '').trim().slice(0, 80) || 'Travel Promo Discount',
                active: p?.active !== false
            }))
            .filter(p => p.code.length >= 3 && p.code.length <= 24)
        : [];
    return {
        flightMarkupPercent: num(raw.flightMarkupPercent, 0, 50),
        flightFlatFeeKes: Math.round(num(raw.flightFlatFeeKes, 0, 50000)),
        holidayMarkupPercent: num(raw.holidayMarkupPercent, 0, 50),
        holidayFlatFeeKes: Math.round(num(raw.holidayFlatFeeKes, 0, 100000)),
        customPromos
    };
}

async function getTravelPricing(force = false) {
    if (!force && Date.now() - lastLoadedAt < 15000) {
        return cachedPricing;
    }
    try {
        if (isConnected()) {
            const doc = await collection('travel_pricing_settings').findOne({ _id: 'global' });
            if (doc) {
                cachedPricing = sanitizePricing(doc);
                lastLoadedAt = Date.now();
                return cachedPricing;
            }
        }
    } catch {}
    lastLoadedAt = Date.now();
    return cachedPricing;
}

async function updateTravelPricing(input = {}) {
    const next = sanitizePricing({ ...cachedPricing, ...input });
    cachedPricing = next;
    lastLoadedAt = Date.now();
    try {
        if (isConnected()) {
            await collection('travel_pricing_settings').updateOne(
                { _id: 'global' },
                { $set: { ...next, updatedAt: new Date() } },
                { upsert: true }
            );
        }
    } catch {}
    return cachedPricing;
}

function applyTravelMarkup(baseKes, kind = 'flight', pricing = cachedPricing) {
    const base = Math.max(0, Math.round(Number(baseKes) || 0));
    const pct = kind === 'holiday' ? (pricing.holidayMarkupPercent || 0) : (pricing.flightMarkupPercent || 0);
    const flat = kind === 'holiday' ? (pricing.holidayFlatFeeKes || 0) : (pricing.flightFlatFeeKes || 0);
    const serviceFeeKes = Math.round(base * (pct / 100)) + Math.round(flat);
    return {
        baseKes: base,
        serviceFeeKes,
        totalWithMarkupKes: base + serviceFeeKes
    };
}

function getCachedPricing() {
    return cachedPricing;
}

module.exports = {
    DEFAULT_PRICING,
    sanitizePricing,
    getTravelPricing,
    updateTravelPricing,
    applyTravelMarkup,
    getCachedPricing
};
