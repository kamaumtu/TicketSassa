const KENYA_47_COUNTIES = [
    'Mombasa', 'Kwale', 'Kilifi', 'Tana River', 'Lamu', 'Taita-Taveta',
    'Garissa', 'Wajir', 'Mandera', 'Marsabit', 'Isiolo', 'Meru',
    'Tharaka-Nithi', 'Embu', 'Kitui', 'Machakos', 'Makueni', 'Nyandarua',
    'Nyeri', 'Kirinyaga', 'Murang\'a', 'Kiambu', 'Turkana', 'West Pokot',
    'Samburu', 'Trans Nzoia', 'Uasin Gishu', 'Elgeyo-Marakwet', 'Nandi', 'Baringo',
    'Laikipia', 'Nakuru', 'Narok', 'Kajiado', 'Kericho', 'Bomet',
    'Kakamega', 'Vihiga', 'Bungoma', 'Busia', 'Siaya', 'Kisumu',
    'Homa Bay', 'Migori', 'Kisii', 'Nyamira', 'Nairobi'
];

const COUNTY_KEYWORDS = [
    { county: 'Nairobi', pattern: /\b(?:nairobi|westlands|karen|kilimani|kasarani|uhuru|masshouse|koda|carnivore|village market|ngong|parklands|industrial area|social house|kicc|bomas|langata|lavington|gigiri)\b/i },
    { county: 'Mombasa', pattern: /\b(?:mombasa|nyali|mamba village|butterfly pavilion|coast gym|pwani|bamburi|shanzu|likoni)\b/i },
    { county: 'Kwale', pattern: /\b(?:kwale|diani|ukunda|tiwi|shimba)\b/i },
    { county: 'Kilifi', pattern: /\b(?:kilifi|watamu|malindi|baobabs|distant relatives|vipingo|mtwapa)\b/i },
    { county: 'Lamu', pattern: /\b(?:lamu|shela|manda)\b/i },
    { county: 'Taita-Taveta', pattern: /\b(?:taita|taveta|voi|tsavo)\b/i },
    { county: 'Nakuru', pattern: /\b(?:nakuru|naivasha|sawela|hell'?s gate|gilgil|elementaita)\b/i },
    { county: 'Narok', pattern: /\b(?:narok|maasai mara|mara)\b/i },
    { county: 'Kajiado', pattern: /\b(?:kajiado|kitengela|rongai|amboseli|namanga|ngong hills)\b/i },
    { county: 'Uasin Gishu', pattern: /\b(?:uasin gishu|eldoret)\b/i },
    { county: 'Kisumu', pattern: /\b(?:kisumu|nyakach|kondele|milimani kisumu)\b/i },
    { county: 'Kiambu', pattern: /\b(?:kiambu|thika|ruiru|limuru|tigoni|kikuyu|juja)\b/i },
    { county: 'Machakos', pattern: /\b(?:machakos|athi river|mlolongo|syokimau|kangundo)\b/i },
    { county: 'Laikipia', pattern: /\b(?:laikipia|nanyuki|nyahururu|ol pejeta)\b/i },
    { county: 'Nyeri', pattern: /\b(?:nyeri|karatina|othaya)\b/i },
    { county: 'Meru', pattern: /\b(?:meru|maua|nkubu)\b/i },
    { county: 'Kitui', pattern: /\b(?:kitui|mwingi)\b/i },
    { county: 'Kakamega', pattern: /\b(?:kakamega|mumias)\b/i },
    { county: 'Kisii', pattern: /\b(?:kisii|ogembo)\b/i },
    { county: 'Kericho', pattern: /\b(?:kericho|litein)\b/i },
    { county: 'Trans Nzoia', pattern: /\b(?:trans nzoia|kitale)\b/i },
    { county: 'Bungoma', pattern: /\b(?:bungoma|webuye)\b/i },
    { county: 'Embu', pattern: /\b(?:embu|runyenjes)\b/i },
    { county: 'Garissa', pattern: /\b(?:garissa)\b/i },
    { county: 'Isiolo', pattern: /\b(?:isiolo)\b/i },
    { county: 'Samburu', pattern: /\b(?:samburu|maralal)\b/i },
    { county: 'Turkana', pattern: /\b(?:turkana|lodwar)\b/i },
    { county: 'Homa Bay', pattern: /\b(?:homa bay|mbita)\b/i },
    { county: 'Migori', pattern: /\b(?:migori|kehancha)\b/i },
    { county: 'Siaya', pattern: /\b(?:siaya|bondo)\b/i },
    { county: 'Busia', pattern: /\b(?:busia|malaba)\b/i },
    { county: 'Bomet', pattern: /\b(?:bomet)\b/i },
    { county: 'Nandi', pattern: /\b(?:nandi|kapsabet)\b/i },
    { county: 'Baringo', pattern: /\b(?:baringo|kabarnet|bogoria)\b/i },
    { county: 'Makueni', pattern: /\b(?:makueni|wote)\b/i },
    { county: 'Murang\'a', pattern: /\b(?:murang'?a|kenol)\b/i },
    { county: 'Kirinyaga', pattern: /\b(?:kirinyaga|kerugoya|sagana)\b/i },
    { county: 'Nyandarua', pattern: /\b(?:nyandarua|ol kalou)\b/i },
    { county: 'Tharaka-Nithi', pattern: /\b(?:tharaka|chuka)\b/i },
    { county: 'Tana River', pattern: /\b(?:tana river|hola)\b/i },
    { county: 'Wajir', pattern: /\b(?:wajir)\b/i },
    { county: 'Mandera', pattern: /\b(?:mandera)\b/i },
    { county: 'Marsabit', pattern: /\b(?:marsabit|moyale)\b/i },
    { county: 'West Pokot', pattern: /\b(?:west pokot|kapenguria)\b/i },
    { county: 'Elgeyo-Marakwet', pattern: /\b(?:elgeyo|marakwet|iten)\b/i },
    { county: 'Vihiga', pattern: /\b(?:vihiga|mbale)\b/i },
    { county: 'Nyamira', pattern: /\b(?:nyamira)\b/i }
];

const EVENT_CATEGORIES = [
    'Concerts & Music Festivals',
    'Football & Sporting Events',
    'University & Campus Events',
    'Conferences & Exhibitions',
    'Comedy Shows',
    'Cultural Festivals',
    'Church Events',
    'Nightlife & Entertainment',
    'Business Events',
    'Workshops & Seminars',
    'Family & Community Events'
];

const KENYAN_AIRPORTS = [
    { code: 'NBO', name: 'Jomo Kenyatta International Airport (JKIA)', city: 'Nairobi', county: 'Nairobi' },
    { code: 'WIL', name: 'Wilson Airport', city: 'Nairobi', county: 'Nairobi' },
    { code: 'MBA', name: 'Moi International Airport', city: 'Mombasa', county: 'Mombasa' },
    { code: 'KIS', name: 'Kisumu International Airport', city: 'Kisumu', county: 'Kisumu' },
    { code: 'EDL', name: 'Eldoret International Airport', city: 'Eldoret', county: 'Uasin Gishu' },
    { code: 'MYD', name: 'Malindi Airport', city: 'Malindi', county: 'Kilifi' },
    { code: 'UKA', name: 'Ukunda Airport (Diani)', city: 'Diani', county: 'Kwale' }
];

const HOLIDAY_CATEGORIES = [
    'Beach Holidays',
    'Safari Packages',
    'Hotel Accommodation',
    'Honeymoon Packages',
    'Family Vacations',
    'Weekend Getaways',
    'Group Tours',
    'Adventure Holidays',
    'International Travel Packages'
];

const HOLIDAY_DESTINATIONS = [
    'Diani', 'Mombasa', 'Watamu', 'Maasai Mara', 'Amboseli',
    'Naivasha', 'Nakuru', 'Nanyuki', 'Lamu', 'Zanzibar', 'Dubai', 'Cape Town'
];

const CATEGORY_PLACEHOLDER_IMAGES = {
    'Concerts & Music Festivals': { url: '/assets/real/QZGqWDTxBF-1791963807.jpg', source: 'Ticketsasa Media Library', attribution: 'Ticketsasa Category Placeholder', license: 'Platform Licensed Asset', kind: 'category_placeholder' },
    'Football & Sporting Events': { url: '/assets/real/SzYy0XWlBI-1792688119.png', source: 'Ticketsasa Media Library', attribution: 'Ticketsasa Category Placeholder', license: 'Platform Licensed Asset', kind: 'category_placeholder' },
    'University & Campus Events': { url: '/assets/real/61JOc0e8b5-1793268189.jpg', source: 'Ticketsasa Media Library', attribution: 'Ticketsasa Category Placeholder', license: 'Platform Licensed Asset', kind: 'category_placeholder' },
    'Conferences & Exhibitions': { url: '/assets/real/DzLV4G9UWo-1790859483.jpg', source: 'Ticketsasa Media Library', attribution: 'Ticketsasa Category Placeholder', license: 'Platform Licensed Asset', kind: 'category_placeholder' },
    'Comedy Shows': { url: '/assets/real/g4Gi3xRTDO-1793174308.jpg', source: 'Ticketsasa Media Library', attribution: 'Ticketsasa Category Placeholder', license: 'Platform Licensed Asset', kind: 'category_placeholder' },
    'Cultural Festivals': { url: '/assets/real/GAzVjovyNO-1794384397.jpg', source: 'Ticketsasa Media Library', attribution: 'Ticketsasa Category Placeholder', license: 'Platform Licensed Asset', kind: 'category_placeholder' },
    'Church Events': { url: '/assets/real/aeIvhrxstM-1793471602.jpg', source: 'Ticketsasa Media Library', attribution: 'Ticketsasa Category Placeholder', license: 'Platform Licensed Asset', kind: 'category_placeholder' },
    'Nightlife & Entertainment': { url: '/assets/real/back-and-forth-party.jpg', source: 'Ticketsasa Media Library', attribution: 'Ticketsasa Category Placeholder', license: 'Platform Licensed Asset', kind: 'category_placeholder' },
    'Business Events': { url: '/assets/real/DzLV4G9UWo-1790859483.jpg', source: 'Ticketsasa Media Library', attribution: 'Ticketsasa Category Placeholder', license: 'Platform Licensed Asset', kind: 'category_placeholder' },
    'Workshops & Seminars': { url: '/assets/real/DzLV4G9UWo-1790859483.jpg', source: 'Ticketsasa Media Library', attribution: 'Ticketsasa Category Placeholder', license: 'Platform Licensed Asset', kind: 'category_placeholder' },
    'Family & Community Events': { url: '/assets/real/lheAq1Zpc0-1794303741.jpg', source: 'Ticketsasa Media Library', attribution: 'Ticketsasa Category Placeholder', license: 'Platform Licensed Asset', kind: 'category_placeholder' }
};

function detectCounty(text) {
    const s = String(text || '');
    for (const rule of COUNTY_KEYWORDS) {
        if (rule.pattern.test(s)) return rule.county;
    }
    return 'Nairobi';
}

function classifyEventCategory(text) {
    const s = String(text || '');
    if (/football|soccer|boxing|rally|drift|padel|tennis|marathon|run|sport|rugby|athletics|golf/i.test(s)) return 'Football & Sporting Events';
    if (/university|campus|usiu|uon|ku |strathmore|jkuat|student|freshers/i.test(s)) return 'University & Campus Events';
    if (/conference|summit|expo|exhibition|forum|symposium/i.test(s)) return 'Conferences & Exhibitions';
    if (/comedy|stand-?up|laugh|comedian/i.test(s)) return 'Comedy Shows';
    if (/culture|cultural|heritage|food festival|art festival|fashion/i.test(s)) return 'Cultural Festivals';
    if (/church|gospel|worship|crusade|praise|ministry|fellowship/i.test(s)) return 'Church Events';
    if (/workshop|seminar|bootcamp|training|masterclass|clinic/i.test(s)) return 'Workshops & Seminars';
    if (/business|networking|founders|startup|corporate|investors/i.test(s)) return 'Business Events';
    if (/family|kids|community|charity|walk|pawsh|sunday/i.test(s)) return 'Family & Community Events';
    if (/club|rave|night|afterparty|dj|karaoke|latin|koda|masshouse|house|amapiano|reggae|dancehall/i.test(s)) return 'Nightlife & Entertainment';
    return 'Concerts & Music Festivals';
}

function resolveEventImage(event, category) {
    const url = (typeof event.imageUrl === 'string' && event.imageUrl.trim())
        ? event.imageUrl.trim()
        : (typeof event.remoteImageUrl === 'string' && event.remoteImageUrl.trim() ? event.remoteImageUrl.trim() : '');
    if (url) {
        return {
            url,
            source: event.source || 'Official Event Listing',
            attribution: event.host || event.source || 'Event Organizer',
            license: 'Official Event Poster / Organizer Media',
            kind: 'official_poster'
        };
    }
    return CATEGORY_PLACEHOLDER_IMAGES[category] || CATEGORY_PLACEHOLDER_IMAGES['Concerts & Music Festivals'];
}

module.exports = {
    KENYA_47_COUNTIES,
    EVENT_CATEGORIES,
    KENYAN_AIRPORTS,
    HOLIDAY_CATEGORIES,
    HOLIDAY_DESTINATIONS,
    CATEGORY_PLACEHOLDER_IMAGES,
    detectCounty,
    classifyEventCategory,
    resolveEventImage
};
