const { test } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
let connected = true;
const stores = new Map();
const matches = (row, filter) => Object.entries(filter).every(([key, value]) => row[key] === value);
function collection(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
        createIndex: async () => {},
        find: filter => ({ sort() { return this; }, limit() { return this; }, toArray: async () => [...store.values()].filter(row => matches(row, filter)) }),
        findOne: async filter => [...store.values()].find(row => matches(row, filter)),
        insertOne: async row => store.set(row._id, structuredClone(row)),
        replaceOne: async (filter, row) => store.set(filter._id, structuredClone(row)),
        updateMany: async (filter, update) => { for (const row of store.values()) if (matches(row, filter)) Object.assign(row, update.$set); },
        updateOne: async (filter, update) => { let row = [...store.values()].find(row => matches(row, filter));
            if (!row && update.$setOnInsert) { row = { ...filter, ...update.$setOnInsert }; store.set(row._id, row); }
            if (row && update.$set) Object.assign(row, update.$set); }
    };
}
require('../src/config/db');
require.cache[require.resolve('../src/config/db')].exports = { isConnected: () => connected };
require('../src/services/commerceDb');
require.cache[require.resolve('../src/services/commerceDb')].exports = { collection, checkoutMode: () => 'live', stockKey: key => key };
mongoose.connection.db = { collection };
mongoose.startSession = async () => ({ withTransaction: async fn => fn(), endSession: async () => {} });
mongoose.connection.transaction = async fn => fn({});
process.env.FLIGHT_OFFERS_URL = 'https://supplier.invalid/flights';
process.env.FLIGHT_BOOKING_URL = 'https://supplier.invalid/bookings';
const catalog = require('../src/services/travelCatalog');
const bookings = require('../src/services/travelBookings');
const now = Date.now();
const offer = { id: 'offer-1', title: 'Nairobi to Mombasa', supplier: 'Test fixture', priceKes: 8500, currency: 'KES',
    available: 2, bookable: true, startsAt: new Date(now + 86400000).toISOString(), endsAt: new Date(now + 90000000).toISOString(),
    expiresAt: new Date(now + 3600000).toISOString() };
const response = body => ({ ok: true, text: async () => JSON.stringify(body) });
test('travel publishing and supplier booking checks', async t => {
    await t.test('rejects missing prices, zero fares, expired offers and invalid dates', () => {
        for (const changes of [{ priceKes: 0 }, { currency: 'USD' }, { available: -1 }, { expiresAt: new Date(now - 1).toISOString() }, { endsAt: 'invalid' }, { startsAt: new Date(now - 1).toISOString() }]) {
            assert.equal(catalog.normalizeOffer({ ...offer, ...changes }, 'flight', now), null);
        }
        const valid = catalog.normalizeOffer(offer, 'flight', now);
        assert.equal(valid.status, 'available'); assert.equal(valid.expiresAt, now + 30 * 60000);
    });
    await t.test('requires a booking adapter before publishing an offer as bookable', () => {
        assert.equal(catalog.normalizeOffer(offer, 'holiday', now).status, 'listing_only');
    });
    await t.test('sync publishes valid offers and records activity', async () => {
        global.fetch = async () => response({ offers: [offer, { ...offer, id: 'bad', priceKes: 0 }] });
        const result = await catalog.sync('test');
        assert.equal(result.sources.flight.available, 1); assert.equal(result.sources.flight.rejected, 1);
        assert.equal(result.history.length, 1); assert.equal((await catalog.offers('flight')).length, 1);
    });
    await t.test('malformed refresh preserves prior offers until expiry', async () => {
        global.fetch = async () => response({ offers: [{ ...offer, priceKes: 0 }] });
        const result = await catalog.sync('test'); assert.equal(result.sources.flight.status, 'error');
        assert.equal((await catalog.offers('flight')).length, 1);
    });
    const body = { offerId: 'flight:offer-1', requestId: 'test-request-123456789012345', customer: { name: 'Test Guest', email: 'fixture@example.invalid', phone: '0712345678' } };
    await t.test('price changes and failed supplier holds never create payable orders', async () => {
        global.fetch = async () => response({ status: 'HELD', reservationRef: 'fixture-hold', priceKes: 1, currency: 'KES', expiresAt: new Date(Date.now() + 600000).toISOString() });
        await assert.rejects(bookings.createBooking(body), { status: 409 });
        assert.equal(stores.get('commerce_orders').size, 0);
    });
    await t.test('supplier hold determines server price and repeated requests reuse the order', async () => {
        let calls = 0;
        global.fetch = async () => { calls++; return response({ status: 'HELD', reservationRef: 'fixture-hold', priceKes: 8500, currency: 'KES', expiresAt: new Date(Date.now() + 600000).toISOString() }); };
        const first = await bookings.createBooking({ ...body, priceKes: 1 });
        const second = await bookings.createBooking(body);
        assert.equal(first.totalKes, 8500); assert.equal(first.orderReference, second.orderReference); assert.equal(calls, 1);
        const order = await collection('commerce_orders').findOne({ _id: first.orderReference });
        assert.equal(order.items[0].kind, 'flight'); assert.equal(order.totalTickets, 0); await bookings.requireHold(order);
    });
    await t.test('supplier failure remains pending and only real confirmations produce a code', async () => {
        const held = [...stores.get('commerce_travel_reservations').values()][0];
        let calls = 0; global.fetch = async () => { calls++; return response({}); };
        assert.equal((await bookings.confirm(held, 'FIXTURE')).status, 'HELD'); assert.equal(calls, 0);
        await collection('commerce_orders').updateOne({ _id: held.orderReference }, { $set: { paymentStatus: 'COMPLETED', receipt: 'FIXTURE' } });
        global.fetch = async () => { throw new Error('offline'); };
        assert.equal((await bookings.confirm(held, 'FIXTURE')).status, 'AWAITING_SUPPLIER');
        global.fetch = async () => response({ status: 'CONFIRMED', confirmationCode: 'SUPPLIER-123' });
        assert.equal((await bookings.confirm(held, 'FIXTURE')).confirmationCode, 'SUPPLIER-123');
    });
    await t.test('an empty supplier snapshot withdraws disappeared offers', async () => {
        global.fetch = async () => response({ offers: [] }); await catalog.sync('test');
        assert.equal((await catalog.offers('flight')).length, 0);
        await assert.rejects(catalog.getOffer('flight:offer-1'), { status: 409 });
    });
    await t.test('database outages cannot fall back to in-memory travel orders', async () => {
        connected = false; assert.deepEqual(await catalog.offers(), []);
        await assert.rejects(bookings.createBooking(body), { status: 503 });
    });
});
