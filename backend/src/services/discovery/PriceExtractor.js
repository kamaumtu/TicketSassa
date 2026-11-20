const { convertToKes } = require('../automation/exchangeRates');

const CURRENCY_REGEX = /(KES|Ksh\.?|USD|\$|EUR|€|GBP|£)\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,7})(?:\.([0-9]{1,2}))?/gi;

function normalizeCurrencyCode(rawSymbol) {
    const s = String(rawSymbol || '').toUpperCase().replace(/\./g, '').trim();
    if (s === 'KSH' || s === 'KES') return 'KES';
    if (s === '$' || s === 'USD') return 'USD';
    if (s === '€' || s === 'EUR') return 'EUR';
    if (s === '£' || s === 'GBP') return 'GBP';
    return 'KES';
}

function extractPricesFromText(text) {
    const results = [];
    const s = String(text || '');
    for (const match of s.matchAll(CURRENCY_REGEX)) {
        const currency = normalizeCurrencyCode(match[1]);
        const whole = match[2].replace(/,/g, '');
        const dec = match[3] ? '.' + match[3] : '';
        const amount = Number(whole + dec);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 5000000) continue;
        // Skip likely phone fragments (e.g., 2547... or 07...) or years
        if (/^2547\d{4,}$/.test(whole)) continue;
        if (currency === 'KES' && amount < 100) continue;
        results.push({ amount, currency, raw: match[0].trim() });
    }
    return results;
}

function extractJsonLdOffers(offers, parentCurrency = 'KES') {
    if (!offers) return [];
    const list = Array.isArray(offers) ? offers : [offers];
    const parsed = [];
    for (const offer of list) {
        if (!offer || typeof offer !== 'object') continue;
        const currency = normalizeCurrencyCode(offer.priceCurrency || parentCurrency);
        if (Array.isArray(offer.offers) && offer.offers.length) {
            parsed.push(...extractJsonLdOffers(offer.offers, currency));
            continue;
        }
        const val = offer.price ?? offer.lowPrice;
        const amount = Number(String(val ?? '').replace(/,/g, ''));
        const availability = String(offer.availability || '');
        if (/SoldOut|OutOfStock/i.test(availability)) continue;
        if (Number.isFinite(amount) && amount > 0 && amount <= 5000000) {
            parsed.push({
                name: typeof offer.name === 'string' && offer.name.trim() ? offer.name.trim().slice(0, 80) : 'Regular',
                amount,
                currency
            });
        }
    }
    return parsed;
}

async function normalizeListingPrice({ offers = [], rawText = '', defaultCurrency = 'KES' } = {}) {
    const structured = Array.isArray(offers) && offers.length ? offers : [];
    const textPrices = !structured.length && rawText ? extractPricesFromText(rawText) : [];
    const chosen = structured.length ? structured : textPrices;

    if (!chosen.length) {
        return {
            amount: null,
            currency: defaultCurrency,
            priceKes: null,
            priceStatus: 'price_on_request',
            priceType: 'unavailable',
            exchangeRateUsed: 1,
            exchangeRateTimestamp: new Date(),
            offers: []
        };
    }

    const sorted = [...chosen].sort((a, b) => a.amount - b.amount);
    const primary = sorted[0];
    let priceKes = Math.round(primary.amount);
    let exchangeRateUsed = 1;
    let exchangeRateTimestamp = new Date();

    if (primary.currency !== 'KES') {
        try {
            const conv = await convertToKes(primary.amount, primary.currency);
            priceKes = conv.priceKes;
            exchangeRateUsed = conv.rate;
            exchangeRateTimestamp = new Date(conv.timestamp);
        } catch {
            // Foreign currency conversion temporarily unavailable; preserve original amount/currency
            priceKes = null;
        }
    }

    const convertedOffers = [];
    for (const o of sorted.slice(0, 8)) {
        let offerKes = Math.round(o.amount);
        if (o.currency !== 'KES' && exchangeRateUsed > 1) {
            offerKes = Math.round(o.amount * exchangeRateUsed);
        }
        convertedOffers.push({
            name: o.name || 'Standard',
            amount: o.amount,
            currency: o.currency,
            priceKes: offerKes
        });
    }

    return {
        amount: primary.amount,
        currency: primary.currency,
        priceKes,
        priceStatus: priceKes != null ? 'verified' : 'price_on_request',
        priceType: 'verified',
        exchangeRateUsed,
        exchangeRateTimestamp,
        offers: convertedOffers
    };
}

module.exports = {
    normalizeCurrencyCode,
    extractPricesFromText,
    extractJsonLdOffers,
    normalizeListingPrice
};
