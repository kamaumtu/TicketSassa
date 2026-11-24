const { getCachedPricing } = require('./travelPricing');

const promos = {
    TALANTA10: { discountPercent: 10, appliesTo: 'all', label: '10% Inaugural Talanta Discount' },
    HUSTLESASA: { discountPercent: 15, appliesTo: 'all', label: '15% HustleSasa Creator Perk' },
    DMSC2026: { discountPercent: 12, appliesTo: 'all', label: '12% Delta Motorsport Club Member Pass' },
    HOLIDAY10: { discountPercent: 10, appliesTo: 'holiday', label: '10% Off Kenya & International Holidays' },
    FLYKE5: { discountPercent: 5, appliesTo: 'flight', label: '5% Off Kenya & Regional Flights' },
    BUNDLE15: { discountPercent: 15, appliesTo: 'bundle', label: '15% Off Flight + Holiday Bundles' }
};

function getPromo(code, kind = 'all') {
    const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!normalized) return null;

    const customList = getCachedPricing()?.customPromos || [];
    const customMatch = customList.find(p => p.active !== false && p.code === normalized);
    const found = customMatch || (Object.hasOwn(promos, normalized) ? { code: normalized, ...promos[normalized] } : null);
    if (!found) return null;

    if (kind && kind !== 'all' && found.appliesTo && found.appliesTo !== 'all') {
        if (kind === 'bundle' && ['bundle', 'holiday', 'flight'].includes(found.appliesTo)) {
            return found;
        }
        if (found.appliesTo !== kind) return null;
    }
    return found;
}

function listAllPromos() {
    const builtIn = Object.entries(promos).map(([code, data]) => ({ code, ...data, builtIn: true, active: true }));
    const custom = (getCachedPricing()?.customPromos || []).map(p => ({ ...p, builtIn: false }));
    return [...builtIn, ...custom];
}

module.exports = { getPromo, listAllPromos };
