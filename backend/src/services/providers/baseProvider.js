function secureUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
    } catch {
        return null;
    }
}

function dedupeKey(event) {
    const title = String(event?.title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    const day = event?.startsAt ? String(event.startsAt).slice(0, 10) : '';
    const venue = String(event?.venue || event?.city || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .slice(0, 32);
    return `${title}|${day}|${venue}`;
}

function normalizeTier(raw, eventId, eventTitle, idx = 0) {
    if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) return null;
    const priceKes = Math.round(Number(raw.priceKes ?? raw.price));
    if (!Number.isSafeInteger(priceKes) || priceKes < 0) return null;
    const remaining = Math.max(0, Math.round(Number(raw.remainingAllocation ?? raw.available ?? raw.quantity ?? 0)));
    return {
        tierKey: String(raw.tierKey || `${eventId}-${raw.id || idx + 1}`).slice(0, 120),
        id: raw.id || idx + 1,
        title: raw.title.trim().slice(0, 100),
        eventId,
        eventTitle,
        priceKes,
        priceUsd: Math.max(0, Math.round((priceKes / 125) * 100) / 100),
        remainingAllocation: remaining,
        designatedGate: /^Gate [A-D]/.test(String(raw.designatedGate || '')) ? raw.designatedGate : (idx === 0 ? 'Gate A' : 'Gate B'),
        formattedSaleEnd: raw.formattedSaleEnd || 'Event Day',
        published: Boolean(raw.authorized ?? raw.published)
    };
}

function normalizeProviderEvent({
    id,
    source,
    title,
    description = '',
    startsAt,
    venue = '',
    city = '',
    imageUrl = null,
    sourceUrl = null,
    status = 'published',
    tiers = [],
    authorizedCheckout = false
}) {
    if (!id || typeof title !== 'string' || !title.trim()) return null;
    const parsedStart = Date.parse(startsAt);
    if (!Number.isFinite(parsedStart)) return null;
    const cleanTitle = title.trim().slice(0, 200);
    const normalizedTiers = authorizedCheckout
        ? (Array.isArray(tiers) ? tiers : []).map((t, i) => normalizeTier(t, id, cleanTitle, i)).filter(Boolean)
        : [];
    const prices = normalizedTiers.map(t => t.priceKes).filter(p => p >= 0);
    const startingPrice = prices.length ? Math.min(...prices) : null;

    return {
        id: String(id),
        source: String(source),
        title: cleanTitle,
        description: String(description || '').trim().slice(0, 4000),
        startsAt: new Date(parsedStart).toISOString(),
        venue: String(venue || '').trim().slice(0, 160),
        city: String(city || '').trim().slice(0, 100),
        locationFull: [venue, city, 'Kenya'].filter(Boolean).join(', '),
        imageUrl: secureUrl(imageUrl),
        remoteImageUrl: secureUrl(imageUrl),
        sourceUrl: secureUrl(sourceUrl),
        status: status === 'cancelled' ? 'cancelled' : 'published',
        tiers: normalizedTiers,
        startingPrice,
        price: startingPrice !== null ? { amount: startingPrice, currency: 'KES' } : null,
        checkout: authorizedCheckout && normalizedTiers.length > 0 && status !== 'cancelled',
        onSale: authorizedCheckout && normalizedTiers.length > 0 && status !== 'cancelled'
    };
}

module.exports = {
    secureUrl,
    dedupeKey,
    normalizeTier,
    normalizeProviderEvent
};
