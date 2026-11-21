const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

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

const holidayCatalog = require('../src/services/holidayCatalog');
const commerce = require('../src/controllers/commerceController');
const { renderPassPdfBuffer } = require('../src/services/automation/pdfTicketService');
const { isLiveTicket } = require('../src/services/ticketRevenue');

function futureDayIso(offsetDays) {
    return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function mockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) { this.statusCode = code; return this; },
        set(k, v) { this.headers[k.toLowerCase()] = v; return this; },
        json(payload) { this.body = payload; return this; },
        send(payload) { this.body = payload; return this; }
    };
    return res;
}

test('holiday itinerary ticket catalog, authoritative pricing, M-Pesa demo checkout, passes & PDF voucher', async t => {
    await t.test('listHolidayItineraries returns 13 curated packages and 2 add-ons', () => {
        const list = holidayCatalog.listHolidayItineraries();
        assert.equal(list.itineraries.length, 13);
        assert.deepEqual(list.addons.map(a => a.code).sort(), ['excursion', 'sgr']);
    });

    await t.test('quoteHolidayItinerary calculates authoritative totals and rejects invalid inputs', async () => {
        const checkin = futureDayIso(10);
        const checkout4n = futureDayIso(14);
        const q = await holidayCatalog.quoteHolidayItinerary({
            packageKey: 'neptune-village',
            checkin,
            checkout: checkout4n,
            adults: 2,
            roomTypeIndex: 1, // Ocean View Suite (+6000 / night)
            addons: ['sgr'],
            totalKes: 1 // tampered price ignored
        });
        // Base: 67760 * 2 = 135520, Room: 6000 * 4 = 24000, SGR: 4500 * 2 = 9000, Levy: 2% of (135520 + 24000) = 3190
        assert.equal(q.selectedNights, 4);
        assert.equal(q.baseCostKes, 135520);
        assert.equal(q.roomSurchargeKes, 24000);
        assert.equal(q.extrasKes, 9000);
        assert.equal(q.levyKes, 3190);
        assert.equal(q.totalKes, 171710);

        // Custom 6 nights pro-rates night rate cleanly
        const q6 = await holidayCatalog.quoteHolidayItinerary({
            packageKey: 'neptune-village',
            checkin,
            checkout: futureDayIso(16),
            adults: 2,
            roomTypeIndex: 0
        });
        assert.equal(q6.selectedNights, 6);
        assert.equal(q6.baseCostKes, Math.round((67760 / 4) * 6) * 2);

        await assert.rejects(
            holidayCatalog.quoteHolidayItinerary({ packageKey: 'neptune-village', checkin: futureDayIso(-2), checkout: futureDayIso(2), adults: 2 }),
            { status: 400 }
        );
        await assert.rejects(
            holidayCatalog.quoteHolidayItinerary({ packageKey: 'neptune-village', checkin, checkout: checkin, adults: 2 }),
            { status: 400 }
        );
        await assert.rejects(
            holidayCatalog.quoteHolidayItinerary({ packageKey: 'neptune-village', checkin, checkout: checkout4n, adults: 0 }),
            { status: 400 }
        );
        await assert.rejects(
            holidayCatalog.quoteHolidayItinerary({ packageKey: 'non-existent', checkin, checkout: checkout4n, adults: 2 }),
            { status: 404 }
        );
    });

    await t.test('booking -> demo STK push -> payment completion -> multi-guest QR passes -> PDF voucher -> order lookup', async () => {
        stores.clear();
        currentMode = 'demo';

        const checkin = futureDayIso(12);
        const checkout = futureDayIso(16);
        const reqBody = {
            packageKey: 'masai-mara',
            checkin,
            checkout, // 4 nights on 2N package -> pro-rated
            adults: 3,
            roomTypeIndex: 1, // +6000/night
            addons: ['sgr', 'excursion'],
            customer: { name: 'Grace Wanjiku', email: 'grace@example.com', phone: '0712345678' },
            requestId: 'itinerary-req-1234567890'
        };

        const first = await holidayCatalog.createHolidayItineraryBooking(reqBody);
        const second = await holidayCatalog.createHolidayItineraryBooking(reqBody);
        assert.match(first.orderReference, /^ORD-[A-F0-9]{32}$/);
        assert.match(first.reservationRef, /^HOL-[A-F0-9]{8}$/);
        assert.equal(first.orderReference, second.orderReference);
        assert.equal(first.totalKes, second.totalKes);

        const storedOrder = await collection('commerce_orders').findOne({ _id: first.orderReference });
        assert.equal(isLiveTicket(storedOrder.items[0]), true);
        assert.equal(storedOrder.totalTickets, 3);

        // Initiate demo STK push
        const stkReq = { body: { orderReference: first.orderReference, phone: '0712345678' } };
        const stkRes = mockRes();
        await commerce.initiateMpesaStkPush(stkReq, stkRes, err => { throw err; });
        assert.equal(stkRes.statusCode, 200);
        assert.match(stkRes.body.CheckoutRequestID, /^DEMO-/);

        // Confirm demo payment
        const confirmReq = {
            body: { orderReference: first.orderReference, checkoutRequestId: stkRes.body.CheckoutRequestID }
        };
        const confirmRes = mockRes();
        await commerce.confirmDemo(confirmReq, confirmRes, err => { throw err; });
        assert.equal(confirmRes.statusCode, 200);
        assert.equal(confirmRes.body.data.paymentStatus, 'COMPLETED');
        assert.equal(confirmRes.body.passes.length, 3);
        assert.match(confirmRes.body.passes[0].passReference, /^HOL-/);
        assert.equal(confirmRes.body.passes[0].itinerary.checkin, checkin);
        assert.equal(confirmRes.body.passes[0].itinerary.checkout, checkout);
        assert.equal(confirmRes.body.passes[0].itinerary.nights, 4);

        const updatedRes = await collection('commerce_travel_reservations').findOne({ orderReference: first.orderReference });
        assert.equal(updatedRes.status, 'CONFIRMED');
        assert.match(updatedRes.confirmationCode, /^HOLVCH-/);

        // Verify order lookup returns the 3 holiday passes
        const lookupReq = { body: { orderReference: first.orderReference, email: 'grace@example.com' } };
        const lookupRes = mockRes();
        await commerce.lookupOrder(lookupReq, lookupRes, err => { throw err; });
        assert.equal(lookupRes.statusCode, 200);
        assert.equal(lookupRes.body.passes.length, 3);

        // Verify PDF generation for holiday pass directly and via controller handler
        const pdfBuf = await renderPassPdfBuffer(confirmRes.body.passes[0]);
        assert.ok(Buffer.isBuffer(pdfBuf));
        assert.equal(pdfBuf.subarray(0, 5).toString('utf8'), '%PDF-');

        const pdfReq = { params: { qrToken: confirmRes.body.passes[0].qrCodeToken } };
        const pdfRes = mockRes();
        await commerce.passPdf(pdfReq, pdfRes, err => { throw err; });
        assert.equal(pdfRes.statusCode, 200);
        assert.equal(pdfRes.headers['content-type'], 'application/pdf');
        assert.equal(pdfRes.body.subarray(0, 5).toString('utf8'), '%PDF-');

        // Confirm duplicate-order idempotency with same requestId for same customer
        const expectedOrd = 'ORD-' + createHash('sha256').update(`itinerary:grace@example.com:${reqBody.requestId}`).digest('hex').slice(0, 32).toUpperCase();
        assert.equal(first.orderReference, expectedOrd);
    });
});
