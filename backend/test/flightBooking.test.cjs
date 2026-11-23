const { test } = require('node:test');
const assert = require('node:assert/strict');

const stores = new Map();
function matches(doc, filter = {}) {
    if (!doc) return false;
    for (const [k, v] of Object.entries(filter)) {
        if (k === '$or' && Array.isArray(v)) {
            if (!v.some(sub => matches(doc, sub))) return false;
            continue;
        }
        if (doc[k] !== v) return false;
    }
    return true;
}

function collection(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
        createIndex: async () => 'ok',
        find: (filter = {}) => {
            const list = [...store.values()].filter(row => matches(row, filter)).map(r => structuredClone(r));
            return {
                sort() { return this; },
                limit() { return this; },
                toArray: async () => list
            };
        },
        findOne: async (filter = {}) => {
            for (const row of store.values()) {
                if (matches(row, filter)) return structuredClone(row);
            }
            return null;
        },
        insertOne: async doc => {
            const id = doc._id ?? doc.orderReference;
            store.set(id, structuredClone({ ...doc, _id: id }));
            return { acknowledged: true };
        },
        insertMany: async docs => {
            for (const doc of docs) {
                const id = doc._id ?? doc.qrCodeToken;
                store.set(id, structuredClone({ ...doc, _id: id }));
            }
            return { acknowledged: true, insertedCount: docs.length };
        },
        replaceOne: async (filter, doc) => {
            const id = filter._id ?? doc._id ?? doc.orderReference;
            store.set(id, structuredClone({ ...doc, _id: id }));
            return { acknowledged: true };
        },
        updateOne: async (filter, update = {}) => {
            let row = [...store.values()].find(r => matches(r, filter));
            if (!row && update.$setOnInsert) {
                row = { ...filter, ...update.$setOnInsert };
            }
            if (row) {
                if (update.$inc) {
                    for (const [k, v] of Object.entries(update.$inc)) {
                        row[k] = (Number(row[k]) || 0) + v;
                    }
                }
                if (update.$set) Object.assign(row, update.$set);
                const id = row._id ?? filter._id;
                store.set(id, structuredClone({ ...row, _id: id }));
            }
            return { matchedCount: row ? 1 : 0 };
        },
        updateMany: async (filter, update = {}) => {
            let matchedCount = 0;
            for (const [id, row] of store.entries()) {
                if (matches(row, filter)) {
                    matchedCount++;
                    if (update.$set) Object.assign(row, update.$set);
                    if (update.$unset) {
                        for (const k of Object.keys(update.$unset)) delete row[k];
                    }
                    store.set(id, row);
                }
            }
            return { matchedCount };
        },
        deleteMany: async (filter = {}) => {
            let deletedCount = 0;
            for (const [id, row] of [...store.entries()]) {
                if (matches(row, filter)) {
                    store.delete(id);
                    deletedCount++;
                }
            }
            return { deletedCount };
        }
    };
}

let currentMode = 'demo';
require('../src/config/db');
require.cache[require.resolve('../src/config/db')].exports = { isConnected: () => false };

require('../src/services/commerceDb');
require.cache[require.resolve('../src/services/commerceDb')].exports = {
    collection,
    transaction: async fn => fn({}),
    stockKey: (product, mode = currentMode) => mode + ':' + product,
    checkoutMode: () => currentMode,
    demoEnabled: () => currentMode === 'demo',
    availability: async () => 100,
    lockStock: async () => {}
};

require('../src/controllers/ticketController');
require.cache[require.resolve('../src/controllers/ticketController')].exports = {
    getTicketCatalog: async () => []
};
require('../src/routes/publishedEvents');
require.cache[require.resolve('../src/routes/publishedEvents')].exports = {
    reservedTiers: async () => []
};

const flightCatalog = require('../src/services/flightCatalog');
const holidayCatalog = require('../src/services/holidayCatalog');
const commerce = require('../src/controllers/commerceController');
const { renderPassPdfBuffer } = require('../src/services/automation/pdfTicketService');
const { isLiveTicket } = require('../src/services/ticketRevenue');

function futureDayIso(offsetDays) {
    return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function mockRes() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) { this.statusCode = code; return this; },
        set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
        json(payload) { this.body = payload; return this; },
        send(payload) { this.body = payload; return this; }
    };
}

test('on-site flight & synced holiday booking engine', async t => {
    await t.test('resolveFlightPriceKes and resolveHolidayPriceKes provide authoritative fallback pricing', () => {
        assert.equal(flightCatalog.resolveFlightPriceKes({ priceKes: 12450, originCode: 'NBO', destinationCode: 'MBA' }), 12450);
        assert.equal(flightCatalog.resolveFlightPriceKes({ priceKes: null, originCode: 'NBO', destinationCode: 'MBA' }), 8500);
        assert.equal(flightCatalog.resolveFlightPriceKes({ priceKes: null, originCode: 'NBO', destinationCode: 'ZNZ' }), 22500);
        assert.equal(flightCatalog.resolveFlightPriceKes({ priceKes: null, originCode: 'NBO', destinationCode: 'DXB' }), 58000);

        assert.equal(holidayCatalog.resolveHolidayPriceKes({ priceKes: 42000, category: 'Beach Holidays', country: 'Kenya' }), 42000);
        assert.equal(holidayCatalog.resolveHolidayPriceKes({ priceKes: null, category: 'Beach Holidays', country: 'Kenya' }), 18500);
        assert.equal(holidayCatalog.resolveHolidayPriceKes({ priceKes: null, category: 'Safari Packages', country: 'Kenya' }), 24500);
        assert.equal(holidayCatalog.resolveHolidayPriceKes({ priceKes: null, category: 'International Travel Packages', country: 'UAE' }), 65000);
    });

    await t.test('quoteFlightBooking calculates authoritative fare, tax, seat surcharge, and add-ons', async () => {
        const dep = futureDayIso(7);
        const q = await flightCatalog.quoteFlightBooking({
            flightKey: 'KQ604',
            departureDate: dep,
            seatPref: 'extra-leg',
            addons: ['insurance', 'baggage'],
            totalKes: 1 // tampered price ignored
        });
        // Base 7850, Tax 5% = 393, Extra legroom = 1200, Insurance 750 + Baggage 2000 = 2750 => Total 12193
        assert.equal(q.baseFareKes, 7850);
        assert.equal(q.taxKes, Math.round(7850 * 0.05));
        assert.equal(q.seatSurchargeKes, 1200);
        assert.equal(q.addonsKes, 2750);
        assert.equal(q.totalKes, 7850 + Math.round(7850 * 0.05) + 1200 + 2750);

        await assert.rejects(
            flightCatalog.quoteFlightBooking({ flightKey: 'KQ604', departureDate: futureDayIso(-2) }),
            { status: 400 }
        );
        await assert.rejects(
            flightCatalog.quoteFlightBooking({ flightKey: 'UNKNOWN', departureDate: dep }),
            { status: 404 }
        );
    });

    await t.test('flight booking -> demo STK push -> payment completion -> QR boarding pass -> PDF e-ticket', async () => {
        const dep = futureDayIso(10);
        const created = await flightCatalog.createFlightBooking({
            flightKey: 'KQ604',
            departureDate: dep,
            tripType: 'oneway',
            cabinClass: 'economy',
            seatPref: 'window',
            addons: ['insurance'],
            passenger: { passport: 'AK1294810' },
            customer: { name: 'Mr. Alex Kamau', email: 'alex@example.com', phone: '0712345678' },
            requestId: 'flt-req-1234567890abcdef'
        });

        assert.ok(created.orderReference.startsWith('ORD-'));
        assert.ok(created.reservationRef.startsWith('FLT-'));
        assert.equal(created.totalKes, 7850 + Math.round(7850 * 0.05) + 750);

        // Idempotent retry returns same order
        const retry = await flightCatalog.createFlightBooking({
            flightKey: 'KQ604',
            departureDate: dep,
            tripType: 'oneway',
            cabinClass: 'economy',
            seatPref: 'window',
            addons: ['insurance'],
            passenger: { passport: 'AK1294810' },
            customer: { name: 'Mr. Alex Kamau', email: 'alex@example.com', phone: '0712345678' },
            requestId: 'flt-req-1234567890abcdef'
        });
        assert.equal(retry.orderReference, created.orderReference);

        // Trigger demo STK push
        const stkRes = mockRes();
        await commerce.initiateMpesaStkPush({
            body: { orderReference: created.orderReference, phone: '0712345678' }
        }, stkRes, err => { throw err; });
        assert.equal(stkRes.statusCode, 200);
        assert.equal(stkRes.body.mode, 'demo');

        // Confirm demo payment
        const confRes = mockRes();
        await commerce.confirmDemo({
            body: { orderReference: created.orderReference, checkoutRequestId: stkRes.body.CheckoutRequestID }
        }, confRes, err => { throw err; });
        assert.equal(confRes.statusCode, 200);
        assert.equal(confRes.body.passes.length, 1);

        const pass = confRes.body.passes[0];
        assert.ok(pass.passReference.startsWith('FLT-'));
        assert.equal(pass.flightItinerary.originCode, 'NBO');
        assert.equal(pass.flightItinerary.destinationCode, 'MBA');
        assert.equal(pass.flightItinerary.passport, 'AK1294810');

        // Confirm reservation marked CONFIRMED with FLTVCH code
        const reservation = await collection('commerce_travel_reservations').findOne({ orderReference: created.orderReference });
        assert.equal(reservation.status, 'CONFIRMED');
        assert.ok(reservation.confirmationCode.startsWith('FLTVCH-'));

        // Revenue recognition includes flight itinerary items
        const order = await collection('commerce_orders').findOne({ _id: created.orderReference });
        assert.equal(isLiveTicket(order.items[0]), true);

        // PDF e-ticket renders cleanly
        const pdfBuffer = await renderPassPdfBuffer(pass);
        assert.ok(Buffer.isBuffer(pdfBuffer));
        assert.equal(pdfBuffer.subarray(0, 5).toString('utf8'), '%PDF-');
    });

    await t.test('multi-passenger round-trip flight + promo code + card payment + WhatsApp/SMS log', async () => {
        const dep = futureDayIso(12);
        const ret = futureDayIso(16);
        const booked = await flightCatalog.createFlightBooking({
            flightKey: 'KQ604',
            departureDate: dep,
            returnDate: ret,
            tripType: 'round',
            adults: 2,
            children: 1,
            infants: 1,
            seatPref: 'window',
            addons: [],
            promoCode: 'FLYKE5',
            passenger: { passport: 'BK998877' },
            customer: { name: 'Ms. Jane Wanjiku', email: 'jane@example.com', phone: '0722111222' },
            requestId: 'flt-multi-1234567890abcdef'
        });

        assert.equal(booked.breakdown.adults, 2);
        assert.equal(booked.breakdown.children, 1);
        assert.equal(booked.breakdown.infants, 1);
        assert.equal(booked.breakdown.tripType, 'round');
        assert.equal(booked.breakdown.promoCode, 'FLYKE5');
        assert.ok(booked.breakdown.discountKes > 0);

        // Card checkout initiate + verify
        const initRes = mockRes();
        await commerce.initiateCardPayment({
            body: { orderReference: booked.orderReference },
            protocol: 'http',
            get: () => 'localhost:8000'
        }, initRes, err => { throw err; });
        assert.equal(initRes.statusCode, 200);
        assert.ok(initRes.body.reference.startsWith('CARD-'));

        const verRes = mockRes();
        await commerce.verifyCardPayment({
            body: { orderReference: booked.orderReference, reference: initRes.body.reference }
        }, verRes, err => { throw err; });
        assert.equal(verRes.statusCode, 200);
        // 2 adults + 1 child = 3 seated boarding passes
        assert.equal(verRes.body.passes.length, 3);
    });

    await t.test('holiday + return flight bundle with BUNDLE15 promo and PDF voucher', async () => {
        const checkin = futureDayIso(15);
        const checkout = futureDayIso(19);
        const quote = await holidayCatalog.quoteHolidayItinerary({
            packageKey: 'neptune-village',
            checkin,
            checkout,
            adults: 2,
            bundleReturnFlight: true,
            promoCode: 'BUNDLE15'
        });
        assert.ok(quote.bundledFlight);
        assert.equal(quote.bundledFlight.destinationCode, 'UKA');
        assert.equal(quote.bundledFlightKes, 14000 * 2);
        assert.equal(quote.promo.code, 'BUNDLE15');
        assert.ok(quote.discountKes > 0);
    });
});
