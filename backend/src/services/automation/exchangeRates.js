const ENDPOINT = 'https://open.er-api.com/v6/latest/KES';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cached = null;

async function getExchangeRates() {
    if (cached && Date.now() - cached.fetchedAtMs < CACHE_TTL_MS) {
        return cached;
    }
    try {
        const res = await fetch(ENDPOINT, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(12000)
        });
        if (!res.ok) throw new Error('Exchange rate HTTP ' + res.status);
        const body = await res.json();
        if (body?.result !== 'success' || !body.rates?.USD || !body.rates?.EUR) {
            throw new Error('Invalid exchange rate response');
        }
        cached = {
            base: 'KES',
            provider: 'Open Exchange Rates API (open.er-api.com)',
            rates: {
                KES: 1,
                USD: Number(body.rates.USD),
                EUR: Number(body.rates.EUR),
                GBP: Number(body.rates.GBP || 0.0061),
                UGX: Number(body.rates.UGX || 28.5),
                TZS: Number(body.rates.TZS || 20.5),
                ZAR: Number(body.rates.ZAR || 0.14)
            },
            updatedAt: body.time_last_update_utc ? new Date(body.time_last_update_utc).toISOString() : new Date().toISOString(),
            fetchedAtMs: Date.now(),
            status: 'live'
        };
        return cached;
    } catch {
        if (cached) return { ...cached, status: 'stale' };
        return {
            base: 'KES',
            provider: 'Unavailable (configure network access)',
            rates: { KES: 1 },
            updatedAt: new Date().toISOString(),
            fetchedAtMs: 0,
            status: 'unavailable'
        };
    }
}

async function convertToKes(amount, currency = 'KES') {
    const code = String(currency || 'KES').toUpperCase();
    const numeric = Number(amount) || 0;
    if (code === 'KES') {
        return { priceKes: Math.round(numeric), rate: 1, timestamp: new Date().toISOString(), status: 'live' };
    }
    const data = await getExchangeRates();
    const perKes = data.rates[code];
    if (!perKes || perKes <= 0) {
        throw Object.assign(new Error(`Exchange rate for ${code} is currently unavailable.`), { status: 503 });
    }
    const kesPerUnit = 1 / perKes;
    return {
        priceKes: Math.round(numeric * kesPerUnit),
        rate: Number(kesPerUnit.toFixed(4)),
        timestamp: data.updatedAt,
        status: data.status
    };
}

module.exports = { getExchangeRates, convertToKes };
