const ENTITY_MAP = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&ndash;': '–',
    '&mdash;': '—',
    '&rsquo;': '’',
    '&lsquo;': '‘',
    '&rdquo;': '”',
    '&ldquo;': '“'
};

function decodeEntities(str) {
    return String(str || '')
        .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|ndash|mdash|rsquo|lsquo|rdquo|ldquo);/gi, m => ENTITY_MAP[m.toLowerCase()] || m)
        .replace(/&#(\d+);/g, (_, code) => {
            const n = Number(code);
            return Number.isFinite(n) && n >= 32 && n <= 126 ? String.fromCharCode(n) : ' ';
        });
}

function cleanDescription(rawText, fallbackTitle = '', maxLen = 500) {
    let text = decodeEntities(rawText)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, '. ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/\b(?:click here|buy tickets now|read more|learn more|book now|view details|subscribe to our newsletter)\b[!.:]*/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/\.\s*\./g, '.')
        .trim();

    if (!text || text.length < 12) {
        return fallbackTitle ? `${cleanTitle(fallbackTitle)}.` : '';
    }

    if (text.length <= maxLen) return text;
    const sliced = text.slice(0, maxLen - 1);
    const lastSentence = sliced.lastIndexOf('. ');
    if (lastSentence > maxLen * 0.55) {
        return sliced.slice(0, lastSentence + 1).trim();
    }
    const lastSpace = sliced.lastIndexOf(' ');
    return (lastSpace > 40 ? sliced.slice(0, lastSpace) : sliced).trim() + '…';
}

function cleanTitle(rawTitle) {
    return decodeEntities(rawTitle)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\u200d\ufe0f\u20e3]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

module.exports = {
    decodeEntities,
    cleanDescription,
    cleanTitle
};
