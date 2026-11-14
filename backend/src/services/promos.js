const promos = {
    TALANTA10: { discountPercent: 10, label: '10% Inaugural Talanta Discount' },
    HUSTLESASA: { discountPercent: 15, label: '15% HustleSasa Creator Perk' },
    DMSC2026: { discountPercent: 12, label: '12% Delta Motorsport Club Member Pass' }
};

function getPromo(code) {
    const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
    return Object.hasOwn(promos, normalized) ? { code: normalized, ...promos[normalized] } : null;
}

module.exports = { getPromo };
