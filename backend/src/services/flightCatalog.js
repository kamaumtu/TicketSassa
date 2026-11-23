const { createHash, randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const { isConnected } = require('../config/db');
const { collection, transaction, stockKey, checkoutMode } = require('./commerceDb');
const { FlightListing, AutomationBooking } = require('../models/automation');
const { getTravelPricing, applyTravelMarkup } = require('./travelPricing');
const { getPromo } = require('./promos');

const DOMESTIC_AIRPORTS = new Set(['NBO', 'WIL', 'MBA', 'KIS', 'EDL', 'MYD', 'UKA', 'LAU', 'GAS']);
const REGIONAL_AIRPORTS = new Set(['DAR', 'EBB', 'ZNZ', 'JRO', 'KGL', 'ADD']);

const CURATED_FLIGHTS = {
    KQ604: {
        key: 'KQ604',
        airline: 'Kenya Airways',
        logo: '/assets/airlines/kenya-airways.svg',
        flightNumber: 'KQ 604',
        aircraft: 'Embraer E190',
        originCode: 'NBO',
        originName: 'Nairobi – Jomo Kenyatta',
        destinationCode: 'MBA',
        destinationName: 'Mombasa – Moi Intl',
        depTime: '08:00',
        arrTime: '09:00',
        durationText: '1h 00m',
        baggage: '23kg Check-in + 7kg Cabin',
        priceKes: 7850
    },
    JM8602: {
        key: 'JM8602',
        airline: 'Jambojet',
        logo: '/assets/airlines/jambojet.svg',
        flightNumber: 'JM 8602',
        aircraft: 'De Havilland Dash 8-Q400',
        originCode: 'NBO',
        originName: 'Nairobi – Jomo Kenyatta',
        destinationCode: 'MBA',
        destinationName: 'Mombasa – Moi Intl',
        depTime: '06:30',
        arrTime: '07:30',
        durationText: '1h 00m',
        baggage: '10kg Hand Luggage',
        priceKes: 5900
    },
    OW214: {
        key: 'OW214',
        airline: 'Skyward Express',
        logo: '/assets/airlines/skyward.svg',
        flightNumber: 'OW 214',
        aircraft: 'Fokker 50 / Dash 8-300',
        originCode: 'WIL',
        originName: 'Nairobi – Wilson Airport',
        destinationCode: 'MBA',
        destinationName: 'Mombasa – Moi Intl',
        depTime: '09:30',
        arrTime: '10:45',
        durationText: '1h 15m',
        baggage: '15kg Check-in + 5kg Cabin',
        priceKes: 6400
    },
    JM8608: {
        key: 'JM8608',
        airline: 'Jambojet',
        logo: '/assets/airlines/jambojet.svg',
        flightNumber: 'JM 8608',
        aircraft: 'De Havilland Dash 8-Q400',
        originCode: 'NBO',
        originName: 'Nairobi – Jomo Kenyatta',
        destinationCode: 'MBA',
        destinationName: 'Mombasa – Moi Intl',
        depTime: '13:45',
        arrTime: '14:45',
        durationText: '1h 00m',
        baggage: '10kg Hand Luggage',
        priceKes: 6200
    },
    KQ612: {
        key: 'KQ612',
        airline: 'Kenya Airways',
        logo: '/assets/airlines/kenya-airways.svg',
        flightNumber: 'KQ 612',
        aircraft: 'Boeing 737-800',
        originCode: 'NBO',
        originName: 'Nairobi – Jomo Kenyatta',
        destinationCode: 'MBA',
        destinationName: 'Mombasa – Moi Intl',
        depTime: '17:15',
        arrTime: '18:15',
        durationText: '1h 00m',
        baggage: '23kg Check-in + 7kg Cabin',
        priceKes: 8400
    },
    '5H402': {
        key: '5H402',
        airline: 'Fly540',
        logo: '/assets/airlines/fly540.svg',
        flightNumber: '5H 402',
        aircraft: 'Bombardier CRJ-200',
        originCode: 'NBO',
        originName: 'Nairobi – Jomo Kenyatta',
        destinationCode: 'MBA',
        destinationName: 'Mombasa – Moi Intl',
        depTime: '19:30',
        arrTime: '20:30',
        durationText: '1h 00m',
        baggage: '15kg Baggage Included',
        priceKes: 5400
    },
    KQ654: {
        key: 'KQ654',
        airline: 'Kenya Airways',
        logo: '/assets/airlines/kenya-airways.svg',
        flightNumber: 'KQ 654',
        aircraft: 'Embraer E190',
        originCode: 'NBO',
        originName: 'Nairobi – Jomo Kenyatta',
        destinationCode: 'KIS',
        destinationName: 'Kisumu – Kisumu Intl',
        depTime: '10:30',
        arrTime: '11:25',
        durationText: '0h 55m',
        baggage: '23kg Check-in + 7kg Cabin',
        priceKes: 7950
    },
    JM8640: {
        key: 'JM8640',
        airline: 'Jambojet',
        logo: '/assets/airlines/jambojet.svg',
        flightNumber: 'JM 8640',
        aircraft: 'Dash 8-Q400',
        originCode: 'NBO',
        originName: 'Nairobi – Jomo Kenyatta',
        destinationCode: 'KIS',
        destinationName: 'Kisumu – Kisumu Intl',
        depTime: '07:00',
        arrTime: '07:50',
        durationText: '0h 50m',
        baggage: '10kg Hand Luggage',
        priceKes: 6100
    },
    OW302: {
        key: 'OW302',
        airline: 'Skyward Express',
        logo: '/assets/airlines/skyward.svg',
        flightNumber: 'OW 302',
        aircraft: 'Dash 8-300',
        originCode: 'WIL',
        originName: 'Nairobi – Wilson Airport',
        destinationCode: 'UKA',
        destinationName: 'Diani – Ukunda Airstrip',
        depTime: '08:30',
        arrTime: '09:45',
        durationText: '1h 15m',
        baggage: '15kg Baggage Included',
        priceKes: 7200
    },
    JM8660: {
        key: 'JM8660',
        airline: 'Jambojet',
        logo: '/assets/airlines/jambojet.svg',
        flightNumber: 'JM 8660',
        aircraft: 'Dash 8-Q400',
        originCode: 'NBO',
        originName: 'Nairobi – Jomo Kenyatta',
        destinationCode: 'EDL',
        destinationName: 'Eldoret – Eldoret Intl',
        depTime: '08:15',
        arrTime: '09:05',
        durationText: '0h 50m',
        baggage: '10kg Hand Luggage',
        priceKes: 6300
    },
    JM8680: {
        key: 'JM8680',
        airline: 'Jambojet',
        logo: '/assets/airlines/jambojet.svg',
        flightNumber: 'JM 8680',
        aircraft: 'Dash 8-Q400',
        originCode: 'NBO',
        originName: 'Nairobi – Jomo Kenyatta',
        destinationCode: 'MYD',
        destinationName: 'Malindi – Malindi Airport',
        depTime: '11:00',
        arrTime: '12:10',
        durationText: '1h 10m',
        baggage: '10kg Hand Luggage',
        priceKes: 6900
    },
    OW504: {
        key: 'OW504',
        airline: 'Skyward Express',
        logo: '/assets/airlines/skyward.svg',
        flightNumber: 'OW 504',
        aircraft: 'Fokker 50',
        originCode: 'WIL',
        originName: 'Nairobi – Wilson Airport',
        destinationCode: 'LAU',
        destinationName: 'Lamu – Manda Airport',
        depTime: '12:30',
        arrTime: '14:00',
        durationText: '1h 30m',
        baggage: '15kg Baggage Included',
        priceKes: 8900
    }
};

const FLIGHT_ADDONS = {
    insurance: { code: 'insurance', label: 'Travel & Baggage Delay Protection', priceKes: 750 },
    baggage: { code: 'baggage', label: 'Extra 23kg Checked Luggage', priceKes: 2000 }
};

const SEAT_PREFS = {
    window: { code: 'window', label: 'Window Seat', surchargeKes: 0 },
    aisle: { code: 'aisle', label: 'Aisle Seat', surchargeKes: 0 },
    'extra-leg': { code: 'extra-leg', label: 'Extra Legroom Exit Row', surchargeKes: 1200 }
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

function normalizePhone(value) {
    const digits = typeof value === 'string' ? value.trim().replace(/[\s()+-]/g, '') : '';
    const local = digits.replace(/^(254|0)/, '');
    if (!/^[17]\d{8}$/.test(local)) {
        fail(400, 'Enter a valid Kenyan mobile number.');
    }
    return '254' + local;
}

function resolveFlightPriceKes(doc) {
    if (doc?.priceKes != null && Number(doc.priceKes) > 0) {
        return Math.round(Number(doc.priceKes));
    }
    const orig = String(doc?.originCode || doc?.origin || 'NBO').toUpperCase();
    const dest = String(doc?.destinationCode || doc?.dest || 'MBA').toUpperCase();
    if (DOMESTIC_AIRPORTS.has(orig) && DOMESTIC_AIRPORTS.has(dest)) {
        return 8500;
    }
    if (REGIONAL_AIRPORTS.has(dest) || REGIONAL_AIRPORTS.has(orig)) {
        return 22500;
    }
    return 58000;
}

function formatClockTime(value) {
    if (!value) return 'Scheduled';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'Scheduled';
    return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Africa/Nairobi'
    }).format(d);
}

function listCuratedFlights() {
    return {
        flights: Object.values(CURATED_FLIGHTS),
        addons: Object.values(FLIGHT_ADDONS),
        seatPrefs: Object.values(SEAT_PREFS)
    };
}

async function resolveFlightListing(flightKey) {
    const key = typeof flightKey === 'string' ? flightKey.trim() : '';
    if (!key) fail(404, 'Flight route not found.');
    if (CURATED_FLIGHTS[key]) {
        return CURATED_FLIGHTS[key];
    }

    if (key.startsWith('db:')) {
        if (!isConnected()) {
            fail(503, 'Synced flight bookings require an active database connection.');
        }
        const idPart = key.slice(3).trim();
        const clauses = [{ externalId: idPart }];
        if (mongoose.Types.ObjectId.isValid(idPart)) {
            clauses.unshift({ _id: idPart });
        }
        const doc = await FlightListing.findOne({ $or: clauses }).lean();
        if (!doc) fail(404, 'Flight route not found.');
        if (doc.approvalStatus !== 'approved') {
            fail(409, 'This flight route is not currently available for booking.');
        }
        return {
            key: 'db:' + String(doc._id),
            airline: doc.airline || 'Partner Airline',
            logo: doc.airlineLogo || '/assets/airlines/kenya-airways.svg',
            flightNumber: doc.flightNumber || `${doc.originCode}-${doc.destinationCode}`,
            aircraft: doc.source || 'Scheduled Carrier',
            originCode: doc.originCode,
            originName: doc.originName || doc.originCode,
            destinationCode: doc.destinationCode,
            destinationName: doc.destinationName || doc.destinationCode,
            depTime: formatClockTime(doc.departureTime),
            arrTime: formatClockTime(doc.arrivalTime),
            durationText: doc.duration || 'Direct / Scheduled',
            baggage: doc.baggageAllowance || 'Standard Airline Baggage',
            priceKes: resolveFlightPriceKes(doc),
            source: doc.source || 'Partner Airline'
        };
    }

    fail(404, 'Flight route not found.');
}

async function quoteFlightBooking({
    flightKey,
    departureDate,
    returnDate = '',
    tripType = 'oneway',
    cabinClass = 'economy',
    adults = 1,
    children = 0,
    infants = 0,
    seatPref = 'window',
    addons = [],
    promoCode = ''
} = {}) {
    const flight = await resolveFlightListing(flightKey);
    const parsedDep = parseIsoDay(departureDate);
    if (!parsedDep) {
        fail(400, 'Choose a valid departure date (YYYY-MM-DD).');
    }
    if (parsedDep.iso < nairobiTodayIso()) {
        fail(400, 'Departure date cannot be in the past.');
    }

    let parsedRet = null;
    const normalizedTrip = tripType === 'round' ? 'round' : 'oneway';
    if (normalizedTrip === 'round') {
        if (returnDate) {
            parsedRet = parseIsoDay(returnDate);
            if (!parsedRet || parsedRet.ms < parsedDep.ms) {
                fail(400, 'Return date must be on or after the departure date.');
            }
        }
    }

    const adultCount = Number(adults);
    const childCount = Number(children);
    const infantCount = Number(infants);
    if (!Number.isSafeInteger(adultCount) || adultCount < 1 || adultCount > 9) {
        fail(400, 'Select between 1 and 9 adult passengers.');
    }
    if (!Number.isSafeInteger(childCount) || childCount < 0 || childCount > 8) {
        fail(400, 'Select between 0 and 8 child passengers.');
    }
    if (!Number.isSafeInteger(infantCount) || infantCount < 0 || infantCount > 4 || infantCount > adultCount) {
        fail(400, 'Infants cannot exceed the number of adult passengers (max 4).');
    }

    const seatedPassengers = adultCount + childCount;
    const seatKey = String(seatPref || 'window').trim().toLowerCase();
    const seat = SEAT_PREFS[seatKey] || SEAT_PREFS.window;

    const addonCodes = Array.isArray(addons)
        ? [...new Set(addons.map(a => String(a || '').trim().toLowerCase()))]
        : [];
    const selectedAddons = addonCodes.map(code => FLIGHT_ADDONS[code]).filter(Boolean);

    const pricing = await getTravelPricing();
    const singleLegUnitKes = applyTravelMarkup(flight.priceKes, 'flight', pricing).totalWithMarkupKes;
    const tripMultiplier = normalizedTrip === 'round' ? 1.95 : 1;
    const adultUnitFare = Math.round(singleLegUnitKes * tripMultiplier);
    const childUnitFare = Math.round(adultUnitFare * 0.75);
    const infantUnitFare = Math.round(adultUnitFare * 0.15);

    const baseFareKes = Math.round(
        adultUnitFare * adultCount +
        childUnitFare * childCount +
        infantUnitFare * infantCount
    );
    const taxKes = Math.round(baseFareKes * 0.05);
    const seatSurchargeKes = seat.surchargeKes * seatedPassengers;
    const addonsKes = selectedAddons.reduce((sum, a) => sum + a.priceKes * seatedPassengers, 0);

    const subtotalBeforePromoKes = baseFareKes + taxKes + seatSurchargeKes + addonsKes;
    const promo = promoCode ? getPromo(promoCode, 'flight') : null;
    if (promoCode && !promo) {
        fail(400, 'Invalid or expired flight promo code.');
    }
    const discountKes = promo ? Math.round(subtotalBeforePromoKes * (promo.discountPercent / 100)) : 0;
    const totalKes = Math.max(1, Math.round(subtotalBeforePromoKes - discountKes));
    const totalUsd = Math.round((totalKes / 130) * 100) / 100;

    return {
        flight,
        departureDate: parsedDep.iso,
        returnDate: parsedRet ? parsedRet.iso : '',
        tripType: normalizedTrip,
        cabinClass: String(cabinClass || 'economy').trim().toLowerCase(),
        adults: adultCount,
        children: childCount,
        infants: infantCount,
        seatedPassengers,
        seat,
        selectedAddons,
        promo,
        discountKes,
        baseFareKes,
        taxKes,
        seatSurchargeKes,
        addonsKes,
        totalKes,
        totalUsd
    };
}

async function createFlightBooking(body = {}) {
    const mode = checkoutMode();
    if (mode === 'unavailable') {
        fail(503, 'Flight booking checkout is currently unavailable.');
    }

    const {
        flightKey,
        departureDate,
        returnDate = '',
        tripType = 'oneway',
        cabinClass = 'economy',
        adults = 1,
        children = 0,
        infants = 0,
        seatPref = 'window',
        addons = [],
        promoCode = '',
        passenger = {},
        customer = {},
        requestId
    } = body || {};

    const name = typeof customer?.name === 'string' ? customer.name.trim() : '';
    const email = typeof customer?.email === 'string' ? customer.email.trim().toLowerCase() : '';
    if (!name || name.length > 120 || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        fail(400, 'Enter passenger full name and a valid email address.');
    }
    const phone = normalizePhone(customer?.phone);
    const passport = typeof passenger?.passport === 'string' ? passenger.passport.trim() : '';
    if (!passport || passport.length < 4 || passport.length > 40) {
        fail(400, 'Enter a valid Passport or National ID number.');
    }

    const quote = await quoteFlightBooking({
        flightKey,
        departureDate,
        returnDate,
        tripType,
        cabinClass,
        adults,
        children,
        infants,
        seatPref,
        addons,
        promoCode
    });

    const validRequestId = typeof requestId === 'string' && /^[\w-]{16,80}$/.test(requestId.trim()) ? requestId.trim() : '';
    const orderReference = validRequestId
        ? 'ORD-' + createHash('sha256').update(`flight-itinerary:${email}:${validRequestId}`).digest('hex').slice(0, 32).toUpperCase()
        : 'ORD-' + randomBytes(16).toString('hex').toUpperCase();

    const existing = await collection('commerce_orders').findOne({ _id: orderReference });
    if (existing) {
        if (existing.customer?.email !== email || existing.items?.[0]?.flightKey !== quote.flight.key) {
            fail(409, 'Start a new booking request for another flight or passenger email.');
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
                baseFareKes: quote.baseFareKes,
                taxKes: quote.taxKes,
                seatSurchargeKes: quote.seatSurchargeKes,
                addonsKes: quote.addonsKes,
                discountKes: quote.discountKes,
                promoCode: quote.promo?.code || null,
                adults: quote.adults,
                children: quote.children,
                infants: quote.infants,
                tripType: quote.tripType,
                seat: quote.seat.label,
                addons: quote.selectedAddons
            }
        };
    }

    const reservationRef = 'FLT-' + randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const lineKey = 'flight-itinerary:' + quote.flight.key;
    const routeLabel = `${quote.flight.originCode} → ${quote.flight.destinationCode}`;
    const title = `${quote.flight.airline} ${quote.flight.flightNumber} (${routeLabel}${quote.tripType === 'round' ? ' · Return' : ''})`;
    const passCount = Math.max(1, quote.seatedPassengers);
    const perPassengerKes = Math.round(quote.totalKes / passCount);

    const flightItineraryMeta = {
        flightKey: quote.flight.key,
        airline: quote.flight.airline,
        flightNumber: quote.flight.flightNumber,
        originCode: quote.flight.originCode,
        originName: quote.flight.originName,
        destinationCode: quote.flight.destinationCode,
        destinationName: quote.flight.destinationName,
        departureDate: quote.departureDate,
        returnDate: quote.returnDate,
        tripType: quote.tripType,
        depTime: quote.flight.depTime,
        arrTime: quote.flight.arrTime,
        durationText: quote.flight.durationText,
        cabinClass: quote.cabinClass,
        adults: quote.adults,
        children: quote.children,
        infants: quote.infants,
        seatPref: quote.seat.label,
        baggage: quote.flight.baggage,
        passport,
        addons: quote.selectedAddons.map(a => a.label),
        promoCode: quote.promo?.code || null,
        discountKes: quote.discountKes,
        baseFareKes: quote.baseFareKes,
        taxKes: quote.taxKes,
        seatSurchargeKes: quote.seatSurchargeKes,
        addonsKes: quote.addonsKes
    };

    const lineItem = {
        key: lineKey,
        kind: 'itinerary_flight',
        flightKey: quote.flight.key,
        title: `${title} · ${quote.departureDate} · ${quote.seat.label}`,
        eventTitle: title,
        quantity: passCount,
        designatedGate: `Airport Check-in · ${quote.flight.originCode}`,
        unitPriceKes: perPassengerKes,
        unitPriceUsd: Math.round((perPassengerKes / 130) * 100) / 100,
        subtotalKes: quote.totalKes,
        subtotalUsd: quote.totalUsd,
        flightItinerary: flightItineraryMeta
    };

    const orderDoc = {
        _id: orderReference,
        orderReference,
        customer: { name, email, phone },
        items: [lineItem],
        totalTickets: passCount,
        totalKes: quote.totalKes,
        totalUsd: quote.totalUsd,
        currency: 'KES',
        promoCode: quote.promo?.code || null,
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
        quantity: passCount,
        expiresAt,
        purgeAt: new Date(expiresAt)
    };

    const reservationDoc = {
        _id: orderReference,
        reservationRef,
        orderReference,
        kind: 'flight',
        bookingType: 'itinerary_flight',
        supplierManaged: false,
        status: 'PENDING_PAYMENT',
        fulfillmentStatus: 'PENDING',
        supplier: quote.flight.airline,
        title,
        flightKey: quote.flight.key,
        originCode: quote.flight.originCode,
        destinationCode: quote.flight.destinationCode,
        startsAt: quote.departureDate,
        endsAt: quote.returnDate || quote.departureDate,
        departureDate: quote.departureDate,
        returnDate: quote.returnDate,
        tripType: quote.tripType,
        cabinClass: quote.cabinClass,
        adults: quote.adults,
        children: quote.children,
        infants: quote.infants,
        seatPref: quote.seat.label,
        addons: quote.selectedAddons.map(a => a.label),
        promoCode: quote.promo?.code || null,
        passenger: { name, email, phone, passport },
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
                    kind: 'flight',
                    itemId: quote.flight.key,
                    itemTitle: title,
                    customerName: name,
                    customerEmail: email,
                    customerPhone: phone,
                    quantity: passCount,
                    totalKes: quote.totalKes,
                    currency: 'KES',
                    status: 'PENDING'
                }
            },
            { upsert: true, new: true }
        ).catch(() => {});
    }

    return {
        orderReference,
        reservationRef,
        totalKes: quote.totalKes,
        totalUsd: quote.totalUsd,
        expiresAt,
        mode,
        breakdown: {
            baseFareKes: quote.baseFareKes,
            taxKes: quote.taxKes,
            seatSurchargeKes: quote.seatSurchargeKes,
            addonsKes: quote.addonsKes,
            discountKes: quote.discountKes,
            promoCode: quote.promo?.code || null,
            adults: quote.adults,
            children: quote.children,
            infants: quote.infants,
            tripType: quote.tripType,
            seat: quote.seat.label,
            addons: quote.selectedAddons
        }
    };
}

module.exports = {
    CURATED_FLIGHTS,
    FLIGHT_ADDONS,
    SEAT_PREFS,
    resolveFlightPriceKes,
    listCuratedFlights,
    resolveFlightListing,
    quoteFlightBooking,
    createFlightBooking
};
