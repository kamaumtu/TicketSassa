const { createHash, randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const { isConnected } = require('../config/db');
const { collection, transaction, stockKey, checkoutMode } = require('./commerceDb');
const { HolidayPackage, AutomationBooking } = require('../models/automation');
const { getTravelPricing, applyTravelMarkup } = require('./travelPricing');
const { getPromo } = require('./promos');

const BUNDLE_FLIGHT_ROUTES = [
    { pattern: /diani|ukunda|south coast/i, originCode: 'WIL', destinationCode: 'UKA', airline: 'Skyward Express / Safarilink', returnFareKes: 14000, label: 'Nairobi (WIL) ⇄ Diani Ukunda (UKA)' },
    { pattern: /mombasa|nyali|bamburi|shanzu|north coast/i, originCode: 'NBO', destinationCode: 'MBA', airline: 'Kenya Airways / Jambojet', returnFareKes: 12800, label: 'Nairobi (NBO) ⇄ Mombasa (MBA)' },
    { pattern: /watamu|malindi/i, originCode: 'NBO', destinationCode: 'MYD', airline: 'Jambojet / Skyward', returnFareKes: 13500, label: 'Nairobi (NBO) ⇄ Malindi/Watamu (MYD)' },
    { pattern: /lamu|shela/i, originCode: 'WIL', destinationCode: 'LAU', airline: 'Skyward Express', returnFareKes: 17200, label: 'Nairobi (WIL) ⇄ Lamu Manda (LAU)' },
    { pattern: /mara|maasai mara|masai mara/i, originCode: 'WIL', destinationCode: 'MRE', airline: 'Safarilink Aviation', returnFareKes: 28000, label: 'Nairobi (WIL) ⇄ Maasai Mara Airstrip' },
    { pattern: /kisumu/i, originCode: 'NBO', destinationCode: 'KIS', airline: 'Kenya Airways / Jambojet', returnFareKes: 12200, label: 'Nairobi (NBO) ⇄ Kisumu (KIS)' },
    { pattern: /zanzibar|stone town|nungwi/i, originCode: 'NBO', destinationCode: 'ZNZ', airline: 'Kenya Airways / Precision Air', returnFareKes: 38000, label: 'Nairobi (NBO) ⇄ Zanzibar (ZNZ)' },
    { pattern: /dubai|abu dhabi/i, originCode: 'NBO', destinationCode: 'DXB', airline: 'Kenya Airways / Emirates', returnFareKes: 72000, label: 'Nairobi (NBO) ⇄ Dubai (DXB)' },
    { pattern: /cape town|south africa|johannesburg/i, originCode: 'NBO', destinationCode: 'JNB', airline: 'Kenya Airways', returnFareKes: 64000, label: 'Nairobi (NBO) ⇄ South Africa (JNB/CPT)' }
];

function matchBundleFlight(destination = '', title = '') {
    const combined = `${destination} ${title}`;
    for (const r of BUNDLE_FLIGHT_ROUTES) {
        if (r.pattern.test(combined)) return r;
    }
    return {
        originCode: 'NBO',
        destinationCode: 'MBA',
        airline: 'Kenya Airways / Jambojet',
        returnFareKes: 14500,
        label: 'Nairobi (NBO) ⇄ Regional Return Flight'
    };
}

const CURATED_HOLIDAY_ITINERARIES = {
    'neptune-village': {
        key: 'neptune-village',
        title: '5 Days 4 Nights At Neptune Village Beach Resort & Spa',
        resortName: 'Neptune Village Beach Resort & Spa',
        destination: 'Diani Beach, South Coast, Kenya',
        duration: '5D / 4N',
        nights: 4,
        image: 'assets/holidays/neptune-village.jpg',
        rate: 67760,
        originalRate: 240000,
        discount: '72% OFF',
        mealPlan: 'All-Inclusive (Breakfast, Lunch, Dinner, Afternoon Tea & Selected Drinks)',
        inclusions: [
            '5 Days 4 Nights in a superior Makuti-roof garden room',
            'Unlimited selected house alcoholic & non-alcoholic beverages',
            'Full buffet breakfast, lunch, and themed international dinners',
            'Free return transfers from Ukunda Airstrip or SGR Diani Terminal',
            'Access to 2 large freshwater swimming pools & private beach direct access',
            'Daily animations: beach volleyball, water polo & evening cultural Swahili shows'
        ],
        roomTypes: [
            { name: 'Deluxe Garden Room', surcharge: 0 },
            { name: 'Ocean View Suite', surcharge: 6000 },
            { name: 'Presidential Beachfront Villa', surcharge: 14000 }
        ],
        provider: 'Ticketsasa Holidays'
    },
    'medina-palms': {
        key: 'medina-palms',
        title: '5 Days 4 Nights At Medina Palms Luxury Resort',
        resortName: 'Medina Palms Luxury Resort',
        destination: 'Watamu Marine Reserve, Kenya',
        duration: '5D / 4N',
        nights: 4,
        image: 'assets/holidays/medina-palms.jpg',
        rate: 60460,
        originalRate: 308000,
        discount: '80% OFF',
        mealPlan: 'Half Board (Breakfast & 4-Course Fine Dining Dinner)',
        inclusions: [
            '5 Days 4 Nights in a luxury Medina Palms suite',
            'Gourmet breakfast & dinner prepared by executive chefs',
            'Complimentary access to Sakina Oceanfront Spa & Fitness gym',
            'Direct access to Watamu protected Marine National Reserve',
            'High-speed Starlink WiFi & 24/7 dedicated butler service'
        ],
        roomTypes: [
            { name: 'Medina 1-Bedroom Suite', surcharge: 0 },
            { name: 'Penthouse Oceanview Suite', surcharge: 8000 },
            { name: 'Oceanfront Luxury Villa', surcharge: 18000 }
        ],
        provider: 'Ticketsasa Holidays'
    },
    'baobab-beach': {
        key: 'baobab-beach',
        title: '5 Days 4 Nights At Baobab Beach Resort & Spa',
        resortName: 'Baobab Beach Resort & Spa',
        destination: 'Diani Beach, South Coast',
        duration: '5D / 4N',
        nights: 4,
        image: 'assets/holidays/baobab-beach-resort.jpg',
        rate: 40220,
        originalRate: 145000,
        discount: '72% OFF',
        mealPlan: 'All-Inclusive Dining & Cocktails',
        inclusions: [
            'Accommodation across 80 acres of indigenous coastal forest',
            '3 sparkling cascading swimming pools with ocean lookouts',
            'All meals, soft drinks, local beers and spirits included',
            'Tennis courts, table tennis & archery activities'
        ],
        roomTypes: [
            { name: 'Standard Forest Room', surcharge: 0 },
            { name: 'Superior Sea Facing Room', surcharge: 5000 },
            { name: 'Deluxe Bungalow', surcharge: 10000 }
        ],
        provider: 'Ticketsasa Holidays'
    },
    'leopard-beach': {
        key: 'leopard-beach',
        title: '5 Days 4 Nights At Leopard Beach Resort & Spa',
        resortName: 'Leopard Beach Resort & Spa',
        destination: 'Diani Beach, South Coast',
        duration: '5D / 4N',
        nights: 4,
        image: 'assets/holidays/leopard-beach-resort.jpg',
        rate: 59600,
        originalRate: 190000,
        discount: '68% OFF',
        mealPlan: 'Half Board Dining',
        inclusions: [
            'Half board buffet dining at Horizon Restaurant',
            'Access to Uzuri Spa & Wellness forest sanctuaries',
            'Private beach cove with coral reef snorkeling'
        ],
        roomTypes: [
            { name: 'Superior Balcony Room', surcharge: 0 },
            { name: 'Chui Ocean Front Cottage', surcharge: 7000 }
        ],
        provider: 'Ticketsasa Holidays'
    },
    'serena-beach': {
        key: 'serena-beach',
        title: '3 Days 2 Nights At Serena Beach Resort & Spa',
        resortName: 'Serena Beach Resort & Spa',
        destination: 'Shanzu Beach, Mombasa North Coast',
        duration: '3D / 2N',
        nights: 2,
        image: 'assets/holidays/serena-beach-resort.jpg',
        rate: 18475,
        originalRate: 48000,
        discount: '61% OFF',
        mealPlan: 'Half Board Dining',
        inclusions: [
            'Authentic Swahili village architectural setting',
            'Half board dining at the historic Jahazi Marine Restaurant',
            'Butterfly sanctuary guided tour & nature trail walk'
        ],
        roomTypes: [
            { name: 'Village Room', surcharge: 0 },
            { name: 'Garden Superior Room', surcharge: 4000 }
        ],
        provider: 'Ticketsasa Holidays'
    },
    'swahili-beach': {
        key: 'swahili-beach',
        title: '3 Days 2 Nights At Swahili Beach Resort Diani',
        resortName: 'Swahili Beach Resort Diani',
        destination: 'Diani Beach, South Coast',
        duration: '3D / 2N',
        nights: 2,
        image: 'assets/holidays/swahili-beach-resort.jpg',
        rate: 40100,
        originalRate: 85000,
        discount: '53% OFF',
        mealPlan: 'Half Board Dining',
        inclusions: [
            'Iconic 8-tier cascading swimming pool spanning 200 meters',
            'Majilis dining experience & Indian-Arabic fusion cuisine',
            'Prime beach location with white sand views'
        ],
        roomTypes: [
            { name: 'Standard Deluxe', surcharge: 0 },
            { name: 'Executive Suite', surcharge: 8000 }
        ],
        provider: 'Ticketsasa Holidays'
    },
    'masai-mara': {
        key: 'masai-mara',
        title: '3 Days 2 Nights Mara Sopa Migration Safari Package',
        resortName: 'Masai Mara Sopa Lodge',
        destination: 'Masai Mara Game Reserve, Kenya',
        duration: '3D / 2N',
        nights: 2,
        image: 'assets/holidays/masai-mara-sopa-lodge.jpg',
        rate: 13350,
        originalRate: 32000,
        discount: '58% OFF',
        mealPlan: 'Full Board Bush Dining (All meals included)',
        inclusions: [
            'Comprehensive safari package with 4x4 Land Cruiser game drives',
            'Full board breakfast, bush picnic lunch & evening buffet dinner',
            'Scenic vistas of Oloolaimutia Hills & Big Five tracking with licensed guide',
            'Evening Maasai cultural moran warrior dance around the bonfire'
        ],
        roomTypes: [
            { name: 'Standard Safari Rondavel', surcharge: 0 },
            { name: 'Panoramic Hillside Suite', surcharge: 6000 }
        ],
        provider: 'Ticketsasa Holidays'
    },
    'sarova-whitesands': {
        key: 'sarova-whitesands',
        title: '4 Days 3 Nights At Sarova Whitesands Beach Resort',
        resortName: 'Sarova Whitesands Beach Resort & Spa',
        destination: 'Bamburi Beach, Mombasa North Coast',
        duration: '4D / 3N',
        nights: 3,
        image: 'assets/holidays/sarova-whitesands.jpg',
        rate: 52800,
        originalRate: 110000,
        discount: '52% OFF',
        mealPlan: 'Half Board Dining',
        inclusions: [
            '5 resort swimming pools with water slide & dive board',
            'Breakfast & dinner at Pavilions & Minazi oceanfront restaurants',
            'Tulia Spa and Ozone Kids Club complimentary access'
        ],
        roomTypes: [
            { name: 'Standard Garden View', surcharge: 0 },
            { name: 'Sea Facing Palm Room', surcharge: 5000 }
        ],
        provider: 'Ticketsasa Holidays'
    },
    'neptune-village-3d': {
        key: 'neptune-village-3d',
        title: '3 Days 2 Nights At Neptune Village Beach Resort & Spa',
        resortName: 'Neptune Village Beach Resort & Spa',
        destination: 'Diani, South Coast, Kenya',
        duration: '3D / 2N',
        nights: 2,
        image: 'assets/holidays/karamu-village.jpg',
        rate: 37620,
        originalRate: 66000,
        discount: '43% OFF',
        mealPlan: 'All-Inclusive Package (Meals, Drinks & Resort Activities)',
        inclusions: [
            '3 Days 2 Nights in a Makuti-thatched superior room',
            'All meals and selected house beverages included',
            'Access to freshwater pools, water sports & evening entertainment'
        ],
        roomTypes: [
            { name: 'Superior Garden Room', surcharge: 0 },
            { name: 'Ocean View Room', surcharge: 4500 }
        ],
        provider: 'Ticketsasa Holidays'
    },
    'jambo-mutara-camp': {
        key: 'jambo-mutara-camp',
        title: 'Jambo Mutara Camp',
        resortName: 'Jambo Mutara Camp Laikipia',
        destination: 'Nanyuki / Ol Pejeta & Mutara Conservancy, Kenya',
        duration: '2D / 1N',
        nights: 1,
        image: 'assets/holidays/safari-holidays.jpg',
        rate: 21200,
        originalRate: 32000,
        discount: '34% OFF',
        mealPlan: 'Full Board Luxury Safari Dining',
        inclusions: [
            'Luxury tented accommodation overlooking Mount Kenya & Aberdares',
            'Full board gourmet bush dining (Breakfast, Lunch & Dinner)',
            'Guided nature walks & wildlife viewing in Mutara Conservancy'
        ],
        roomTypes: [
            { name: 'Luxury Panoramic Tent', surcharge: 0 },
            { name: 'Family Safari Suite Tent', surcharge: 6500 }
        ],
        provider: 'Ticketsasa Holidays'
    },
    'medina-palms-3d': {
        key: 'medina-palms-3d',
        title: '3 Days 2 Nights At Medina Palms',
        resortName: 'Medina Palms Luxury Resort',
        destination: 'Watamu Marine Reserve, Kenya',
        duration: '3D / 2N',
        nights: 2,
        image: 'assets/holidays/medina-palms.jpg',
        rate: 45000,
        originalRate: 90000,
        discount: '50% OFF',
        mealPlan: 'Half Board Luxury Dining',
        inclusions: [
            '3 Days 2 Nights in a Swahili-Moroccan luxury suite',
            'Daily breakfast & dinner at Amandina Restaurant',
            'Direct private beach access to Watamu Marine National Park'
        ],
        roomTypes: [
            { name: 'Medina 1-Bedroom Suite', surcharge: 0 },
            { name: 'Oceanfront Penthouse', surcharge: 7500 }
        ],
        provider: 'Ticketsasa Holidays'
    },
    'leopard-beach-3d': {
        key: 'leopard-beach-3d',
        title: '3 Days 2 Nights At Leopard Beach Resort and Spa',
        resortName: 'Leopard Beach Resort & Spa',
        destination: 'Diani Beach, South Coast, Kenya',
        duration: '3D / 2N',
        nights: 2,
        image: 'assets/holidays/leopard-beach-restaurant.jpg',
        rate: 33300,
        originalRate: 70200,
        discount: '53% OFF',
        mealPlan: 'Half Board Buffet & Chui Grill Dining',
        inclusions: [
            '3 Days 2 Nights accommodation at Diani\'s premier resort',
            'Daily buffet breakfast and themed dinner',
            'Access to Uzuri Spa & Fitness Forest Sanctuary'
        ],
        roomTypes: [
            { name: 'Superior Balcony Room', surcharge: 0 },
            { name: 'Chui Seaview Cottage', surcharge: 6000 }
        ],
        provider: 'Ticketsasa Holidays'
    },
    'voyager-beach-resort': {
        key: 'voyager-beach-resort',
        title: '3 Days 2 Nights At Voyager Beach Resort Mombasa',
        resortName: 'Voyager Beach Resort',
        destination: 'Nyali Beach, Mombasa North Coast, Kenya',
        duration: '3D / 2N',
        nights: 2,
        image: 'assets/holidays/voyager-beach-resort.jpg',
        rate: 19800,
        originalRate: 38000,
        discount: '48% OFF',
        mealPlan: 'All-Inclusive Cruise-Themed Dining',
        inclusions: [
            '3 Days 2 Nights in a cabin-styled garden or sea-view room',
            'All-inclusive meals, snacks, and local beverages',
            '3 swimming pools including whirlpool & watersports centre'
        ],
        roomTypes: [
            { name: 'Garden View Cabin', surcharge: 0 },
            { name: 'Superior Sea View Cabin', surcharge: 4500 }
        ],
        provider: 'Ticketsasa Holidays'
    }
};

const HOLIDAY_ADDONS = {
    sgr: { code: 'sgr', label: 'SGR Madaraka Express Return Tickets', priceKesPerAdult: 4500 },
    excursion: { code: 'excursion', label: 'Dolphin Safari & Coral Reef Snorkeling', priceKesPerAdult: 6500 }
};

function fail(status, message) {
    throw Object.assign(new Error(message), { status });
}

function nairobiTodayIso() {
    const eatNow = new Date(Date.now() + 3 * 3600000);
    return eatNow.toISOString().slice(0, 10);
}

function parseIsoDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
    const trimmed = value.trim();
    const ms = Date.parse(trimmed + 'T00:00:00Z');
    if (!Number.isFinite(ms)) return null;
    if (new Date(ms).toISOString().slice(0, 10) !== trimmed) return null;
    return { iso: trimmed, ms };
}

function listHolidayItineraries() {
    return {
        itineraries: Object.values(CURATED_HOLIDAY_ITINERARIES),
        addons: Object.values(HOLIDAY_ADDONS)
    };
}

function resolveHolidayPriceKes(doc) {
    if (doc?.priceKes != null && Number(doc.priceKes) > 0) {
        return Math.round(Number(doc.priceKes));
    }
    const category = String(doc?.category || '');
    const country = String(doc?.country || 'Kenya');
    if (country.toLowerCase() !== 'kenya' || /international/i.test(category)) {
        return 65000;
    }
    if (/safari/i.test(category)) {
        return 24500;
    }
    return 18500;
}

async function resolveHolidayPackage(packageKey) {
    const key = typeof packageKey === 'string' ? packageKey.trim() : '';
    if (!key) fail(404, 'Holiday itinerary package not found.');
    if (CURATED_HOLIDAY_ITINERARIES[key]) {
        return CURATED_HOLIDAY_ITINERARIES[key];
    }

    if (key.startsWith('db:')) {
        if (!isConnected()) {
            fail(503, 'Custom holiday packages require an active database connection.');
        }
        const idPart = key.slice(3).trim();
        const clauses = [{ externalId: idPart }];
        if (mongoose.Types.ObjectId.isValid(idPart)) {
            clauses.unshift({ _id: idPart });
        }
        const doc = await HolidayPackage.findOne({ $or: clauses }).lean();
        if (!doc) fail(404, 'Holiday package not found.');
        if (doc.approvalStatus !== 'approved' || doc.availability === 'sold_out') {
            fail(409, 'This holiday package is not currently available for ticket checkout.');
        }
        const nights = Math.max(1, Number(doc.nights) || 2);
        return {
            key: 'db:' + String(doc._id),
            title: doc.title,
            resortName: doc.accommodation || doc.title,
            destination: doc.destination,
            duration: doc.duration || `${nights + 1}D / ${nights}N`,
            nights,
            image: doc.images?.[0]?.url || '/assets/holidays/beach-holidays.jpg',
            rate: resolveHolidayPriceKes(doc),
            originalRate: null,
            discount: '',
            mealPlan: doc.meals || 'As per package itinerary',
            inclusions: Array.isArray(doc.activities) && doc.activities.length
                ? doc.activities
                : [doc.description || doc.title],
            roomTypes: [{ name: 'Standard Sharing Room', surcharge: 0 }],
            provider: doc.provider || 'Ticketsasa Holidays'
        };
    }

    fail(404, 'Holiday itinerary package not found.');
}

async function quoteHolidayItinerary({
    packageKey,
    checkin,
    checkout,
    adults,
    roomTypeIndex = 0,
    addons = [],
    bundleReturnFlight = false,
    promoCode = ''
} = {}) {
    const pkg = await resolveHolidayPackage(packageKey);
    const parsedIn = parseIsoDay(checkin);
    const parsedOut = parseIsoDay(checkout);
    if (!parsedIn || !parsedOut) {
        fail(400, 'Choose valid check-in and check-out dates (YYYY-MM-DD).');
    }
    if (parsedIn.iso < nairobiTodayIso()) {
        fail(400, 'Check-in date cannot be in the past.');
    }
    if (parsedOut.ms <= parsedIn.ms) {
        fail(400, 'Check-out date must be after check-in.');
    }
    const selectedNights = Math.round((parsedOut.ms - parsedIn.ms) / 86400000);
    if (!Number.isSafeInteger(selectedNights) || selectedNights < 1 || selectedNights > 30) {
        fail(400, 'Holiday stay length must be between 1 and 30 nights.');
    }

    const partyAdults = Number(adults);
    if (!Number.isSafeInteger(partyAdults) || partyAdults < 1 || partyAdults > 20) {
        fail(400, 'Select between 1 and 20 adult travellers.');
    }

    const idx = Number.isSafeInteger(Number(roomTypeIndex)) ? Number(roomTypeIndex) : 0;
    const clampedIdx = Math.max(0, Math.min(pkg.roomTypes.length - 1, idx));
    const roomType = pkg.roomTypes[clampedIdx] || { name: 'Standard Sharing Room', surcharge: 0 };

    const addonCodes = Array.isArray(addons) ? [...new Set(addons.map(a => String(a || '').trim().toLowerCase()))] : [];
    const selectedAddons = addonCodes.map(code => HOLIDAY_ADDONS[code]).filter(Boolean);

    const pricing = await getTravelPricing();
    const markedRate = applyTravelMarkup(pkg.rate, 'holiday', pricing).totalWithMarkupKes;
    const basePerAdultKes = selectedNights === pkg.nights
        ? markedRate
        : Math.round((markedRate / pkg.nights) * selectedNights);
    const baseCostKes = basePerAdultKes * partyAdults;
    const roomSurchargeKes = Math.round((Number(roomType.surcharge) || 0) * selectedNights);
    const extrasKes = selectedAddons.reduce((sum, a) => sum + a.priceKesPerAdult * partyAdults, 0);

    const hasFlightBundle = Boolean(bundleReturnFlight);
    const matchedFlight = hasFlightBundle ? matchBundleFlight(pkg.destination, pkg.title) : null;
    const bundledFlightKes = matchedFlight ? matchedFlight.returnFareKes * partyAdults : 0;

    const levyKes = Math.round((baseCostKes + roomSurchargeKes) * 0.02);
    const subtotalBeforePromoKes = Math.round(baseCostKes + roomSurchargeKes + extrasKes + bundledFlightKes + levyKes);

    let promo = null;
    if (promoCode) {
        promo = hasFlightBundle
            ? (getPromo(promoCode, 'bundle') || getPromo(promoCode, 'holiday'))
            : getPromo(promoCode, 'holiday');
        if (!promo) {
            fail(400, 'Invalid or expired holiday promo code.');
        }
    }
    const discountKes = promo ? Math.round(subtotalBeforePromoKes * (promo.discountPercent / 100)) : 0;
    const totalKes = Math.max(1, Math.round(subtotalBeforePromoKes - discountKes));
    const totalUsd = Math.round((totalKes / 125) * 100) / 100;

    return {
        pkg,
        checkin: parsedIn.iso,
        checkout: parsedOut.iso,
        selectedNights,
        adults: partyAdults,
        roomType,
        selectedAddons,
        bundledFlight: matchedFlight ? {
            ...matchedFlight,
            passengers: partyAdults,
            totalFlightKes: bundledFlightKes
        } : null,
        bundledFlightKes,
        promo,
        discountKes,
        baseCostKes,
        roomSurchargeKes,
        extrasKes,
        levyKes,
        totalKes,
        totalUsd
    };
}

function normalizePhone(value) {
    const digits = typeof value === 'string' ? value.trim().replace(/[\s()+-]/g, '') : '';
    const local = digits.replace(/^(254|0)/, '');
    if (!/^[17]\d{8}$/.test(local)) {
        fail(400, 'Enter a valid Kenyan mobile number.');
    }
    return '254' + local;
}

async function createHolidayItineraryBooking(body = {}) {
    const mode = checkoutMode();
    if (mode === 'unavailable') {
        fail(503, 'Holiday ticket checkout is currently unavailable.');
    }

    const { packageKey, checkin, checkout, adults, roomTypeIndex = 0, addons = [], bundleReturnFlight = false, promoCode = '', customer = {}, requestId } = body || {};
    const name = typeof customer?.name === 'string' ? customer.name.trim() : '';
    const email = typeof customer?.email === 'string' ? customer.email.trim().toLowerCase() : '';
    if (!name || name.length > 120 || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        fail(400, 'Enter a guest name and valid email address.');
    }
    const phone = normalizePhone(customer?.phone);

    const quote = await quoteHolidayItinerary({ packageKey, checkin, checkout, adults, roomTypeIndex, addons, bundleReturnFlight, promoCode });

    const validRequestId = typeof requestId === 'string' && /^[\w-]{16,80}$/.test(requestId.trim()) ? requestId.trim() : '';
    const orderReference = validRequestId
        ? 'ORD-' + createHash('sha256').update(`itinerary:${email}:${validRequestId}`).digest('hex').slice(0, 32).toUpperCase()
        : 'ORD-' + randomBytes(16).toString('hex').toUpperCase();

    const existing = await collection('commerce_orders').findOne({ _id: orderReference });
    if (existing) {
        if (existing.customer?.email !== email || existing.items?.[0]?.packageKey !== quote.pkg.key) {
            fail(409, 'Start a new booking request for another holiday package or guest email.');
        }
        const existingRes = await collection('commerce_travel_reservations').findOne({ orderReference }).catch(() => null);
        return {
            orderReference,
            reservationRef: existingRes?.reservationRef || existing.orderReference,
            totalKes: existing.totalKes,
            totalUsd: existing.totalUsd,
            expiresAt: existing.expiresAt,
            mode: existing.mode,
            breakdown: {
                baseCostKes: quote.baseCostKes,
                roomSurchargeKes: quote.roomSurchargeKes,
                extrasKes: quote.extrasKes,
                levyKes: quote.levyKes,
                selectedNights: quote.selectedNights,
                adults: quote.adults,
                roomType: quote.roomType.name,
                addons: quote.selectedAddons
            }
        };
    }

    const reservationRef = 'HOL-' + randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const lineKey = 'itinerary:' + quote.pkg.key;
    const perGuestKes = Math.round(quote.totalKes / quote.adults);
    const itineraryMeta = {
        packageKey: quote.pkg.key,
        resortName: quote.pkg.resortName,
        destination: quote.pkg.destination,
        image: quote.pkg.image,
        checkin: quote.checkin,
        checkout: quote.checkout,
        nights: quote.selectedNights,
        adults: quote.adults,
        roomType: quote.roomType.name,
        mealPlan: quote.pkg.mealPlan,
        addons: quote.selectedAddons.map(a => a.label),
        bundledFlight: quote.bundledFlight,
        promoCode: quote.promo?.code || null,
        discountKes: quote.discountKes,
        baseCostKes: quote.baseCostKes,
        roomSurchargeKes: quote.roomSurchargeKes,
        extrasKes: quote.extrasKes,
        bundledFlightKes: quote.bundledFlightKes,
        levyKes: quote.levyKes
    };

    const lineItem = {
        key: lineKey,
        kind: 'itinerary_holiday',
        packageKey: quote.pkg.key,
        title: `${quote.pkg.resortName} (${quote.selectedNights}N · ${quote.roomType.name})`,
        eventTitle: quote.pkg.title,
        quantity: quote.adults,
        designatedGate: `Travel Desk · ${quote.pkg.destination}`,
        unitPriceKes: perGuestKes,
        unitPriceUsd: Math.round((perGuestKes / 125) * 100) / 100,
        subtotalKes: quote.totalKes,
        subtotalUsd: quote.totalUsd,
        itinerary: itineraryMeta
    };

    const orderDoc = {
        _id: orderReference,
        orderReference,
        customer: { name, email, phone },
        items: [lineItem],
        totalTickets: quote.adults,
        totalKes: quote.totalKes,
        totalUsd: quote.totalUsd,
        currency: 'KES',
        paymentMethod: 'MPESA',
        paymentStatus: 'PENDING',
        mode,
        tipKes: 0,
        createdAt: new Date(),
        expiresAt
    };

    const holdDoc = {
        _id: orderReference + ':' + lineKey,
        orderReference,
        product: stockKey(lineKey, mode),
        quantity: quote.adults,
        expiresAt,
        purgeAt: new Date(expiresAt)
    };

    const reservationDoc = {
        _id: orderReference,
        reservationRef,
        orderReference,
        kind: 'holiday',
        bookingType: 'itinerary_holiday',
        supplierManaged: false,
        status: 'PENDING_PAYMENT',
        supplier: quote.pkg.resortName,
        title: quote.pkg.title,
        packageKey: quote.pkg.key,
        destination: quote.pkg.destination,
        startsAt: quote.checkin,
        endsAt: quote.checkout,
        checkin: quote.checkin,
        checkout: quote.checkout,
        nights: quote.selectedNights,
        adults: quote.adults,
        roomType: quote.roomType.name,
        mealPlan: quote.pkg.mealPlan,
        addons: quote.selectedAddons.map(a => a.label),
        bundledFlight: quote.bundledFlight,
        promoCode: quote.promo?.code || null,
        fulfillmentStatus: 'PENDING',
        guest: { name, email, phone },
        totalKes: quote.totalKes,
        expiresAt,
        createdAt: new Date().toISOString()
    };

    await transaction(async session => {
        await collection('commerce_orders').insertOne(orderDoc, { session });
        await collection('commerce_holds').insertOne(holdDoc, { session });
        await collection('commerce_travel_reservations').insertOne(reservationDoc, { session });
    });

    if (isConnected()) {
        await AutomationBooking.findOneAndUpdate(
            { bookingRef: orderReference },
            {
                $setOnInsert: {
                    bookingRef: orderReference,
                    kind: 'holiday',
                    itemId: quote.pkg.key,
                    itemTitle: quote.pkg.title,
                    customerName: name,
                    customerEmail: email,
                    customerPhone: phone,
                    quantity: quote.adults,
                    totalKes: quote.totalKes,
                    currency: 'KES',
                    status: 'PENDING'
                }
            },
            { upsert: true, new: true }
        ).catch(() => { });
    }

    return {
        orderReference,
        reservationRef,
        totalKes: quote.totalKes,
        totalUsd: quote.totalUsd,
        expiresAt,
        mode,
        breakdown: {
            baseCostKes: quote.baseCostKes,
            roomSurchargeKes: quote.roomSurchargeKes,
            extrasKes: quote.extrasKes,
            levyKes: quote.levyKes,
            selectedNights: quote.selectedNights,
            adults: quote.adults,
            roomType: quote.roomType.name,
            addons: quote.selectedAddons
        }
    };
}

module.exports = {
    CURATED_HOLIDAY_ITINERARIES,
    HOLIDAY_ADDONS,
    matchBundleFlight,
    resolveHolidayPriceKes,
    listHolidayItineraries,
    resolveHolidayPackage,
    quoteHolidayItinerary,
    createHolidayItineraryBooking
};
