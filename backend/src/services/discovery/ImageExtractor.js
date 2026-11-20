const { CATEGORY_PLACEHOLDER_IMAGES } = require('../automation/kenyaCounties');

const IGNORED_IMAGE_PATTERN = /logo|favicon|sprite|pixel|spacer|placeholder|avatar|icon|badge|spinner|loading|\.svg(?:\?|$)|data:image/i;

function resolveUrl(rawUrl, baseUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '';
    let raw = rawUrl.trim();
    if (raw.startsWith('data:')) return '';
    if (raw.startsWith('//')) raw = 'https:' + raw;
    try {
        const u = new URL(raw, baseUrl || 'https://ticketsasa.com');
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return '';
        return u.href;
    } catch {
        return '';
    }
}

function isUsableImageUrl(url, allowSvg = false) {
    if (!url) return false;
    if (allowSvg && url.startsWith('/assets/airlines/')) return true;
    return !IGNORED_IMAGE_PATTERN.test(url);
}

/**
 * Prioritizes legitimate images strictly:
 * 1. Official event poster / JSON-LD image
 * 2. Open Graph / Organizer photograph
 * 3. Venue photograph / content image
 * 4. Explicitly labeled Category Placeholder (never misrepresented as an official poster)
 */
function extractImage(candidate = {}, { category = 'Concerts & Music Festivals', baseUrl = '', sourceName = 'Public Website', attribution = '' } = {}) {
    const posterCandidates = []
        .concat(Array.isArray(candidate.jsonLdImages) ? candidate.jsonLdImages : [candidate.jsonLdImages])
        .concat([candidate.posterUrl, candidate.imageUrl])
        .filter(Boolean);

    for (const raw of posterCandidates) {
        const resolved = resolveUrl(raw, baseUrl);
        if (isUsableImageUrl(resolved)) {
            return {
                url: resolved,
                source: sourceName,
                attribution: attribution || sourceName,
                license: 'Official Source Media',
                kind: 'official_poster'
            };
        }
    }

    if (candidate.ogImage) {
        const resolved = resolveUrl(candidate.ogImage, baseUrl);
        if (isUsableImageUrl(resolved)) {
            return {
                url: resolved,
                source: sourceName,
                attribution: attribution || sourceName,
                license: 'Open Graph Source Image',
                kind: 'organizer_photo'
            };
        }
    }

    const domImgs = Array.isArray(candidate.domImages) ? candidate.domImages : [];
    for (const raw of domImgs) {
        const resolved = resolveUrl(raw, baseUrl);
        if (isUsableImageUrl(resolved)) {
            return {
                url: resolved,
                source: sourceName,
                attribution: attribution || sourceName,
                license: 'Extracted Public Page Image',
                kind: 'venue_image'
            };
        }
    }

    const fallback = CATEGORY_PLACEHOLDER_IMAGES[category] || CATEGORY_PLACEHOLDER_IMAGES['Concerts & Music Festivals'];
    return { ...fallback };
}

module.exports = {
    resolveUrl,
    isUsableImageUrl,
    extractImage
};
