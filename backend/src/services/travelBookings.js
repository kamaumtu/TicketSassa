const { createHash } = require('node:crypto');
const { collection, checkoutMode, stockKey } = require('./commerceDb');
const mongoose = require('mongoose');
const { isConnected } = require('../config/db');
const catalog = require('./travelCatalog');
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function createBooking(body) {
    if (!isConnected()) fail(503, 'The database connection is unavailable. Please try again shortly.');
    if (checkoutMode() !== 'live') fail(503, 'Live payments need setup before travel bookings can be purchased.');
    const { offerId, customer, requestId } = body || {};
    const name = String(customer?.name || '').trim();
    const email = String(customer?.email || '').trim().toLowerCase();
    const mobile = String(customer?.phone || '').replace(/[\s()+-]/g, '').replace(/^(254|0)/, '');
    if (!name || name.length > 120 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[17]\d{8}$/.test(mobile)) fail(400, 'Enter your name, valid email and Kenyan mobile number.');
    if (typeof requestId !== 'string' || !/^[\w-]{20,80}$/.test(requestId)) fail(400, 'A booking request ID is required.');
    const orderReference = 'ORD-' + createHash('sha256').update(`travel:${email}:${requestId}`).digest('hex').slice(0, 32).toUpperCase();
    const existing = await collection('commerce_orders').findOne({ _id: orderReference });
    if (existing) {
        if (existing.items[0]?.key !== offerId) fail(409, 'Start a new booking request for another offer.');
        return { orderReference, totalKes: existing.totalKes, expiresAt: existing.expiresAt };
    }
    const offer = await catalog.getOffer(offerId);
    // The supplier owns availability. A successful hold must reserve actual inventory.
    const held = await catalog.bookingRequest(offer.kind, { action: 'hold', idempotencyKey: orderReference,
        offerId: offer.supplierId, expectedPriceKes: offer.priceKes, currency: 'KES', quantity: 1,
        startsAt: offer.startsAt, endsAt: offer.endsAt, customer: { name, email, phone: '254' + mobile } });
    const expiry = Date.parse(held.expiresAt);
    if (held.status !== 'HELD' || typeof held.reservationRef !== 'string' || !held.reservationRef ||
        held.priceKes !== offer.priceKes || held.currency !== 'KES' || !Number.isFinite(expiry) || expiry <= Date.now() + 120000) {
        fail(409, 'The supplier could not hold this offer at the displayed price. Refresh offers before paying.');
    }
    const expiresAt = Math.min(expiry, Date.now() + 10 * 60000);
    const item = { key: offer.id, kind: offer.kind, title: offer.title, eventTitle: offer.title, quantity: 1,
        unitPriceKes: offer.priceKes, unitPriceUsd: offer.priceKes / 125, subtotalKes: offer.priceKes, subtotalUsd: offer.priceKes / 125 };
    await mongoose.connection.transaction(async session => {
        const order = { _id: orderReference, orderReference, customer: { name, email, phone: '254' + mobile },
            items: [item], totalTickets: 0, totalKes: offer.priceKes, totalUsd: offer.priceKes / 125, currency: 'KES',
            paymentMethod: 'MPESA', paymentStatus: 'PENDING', mode: 'live', tipKes: 0, createdAt: new Date(), expiresAt };
        await collection('commerce_orders').updateOne({ _id: orderReference }, { $setOnInsert: order }, { upsert: true, session });
        await collection('commerce_holds').updateOne({ _id: orderReference + ':' + offer.id }, { $setOnInsert: {
            orderReference, product: stockKey(offer.id), quantity: 1, expiresAt, purgeAt: new Date(expiresAt) } }, { upsert: true, session });
        await collection('commerce_travel_reservations').updateOne({ _id: orderReference }, { $setOnInsert: {
            reservationRef: held.reservationRef, orderReference, kind: offer.kind, status: 'HELD', supplier: offer.supplier,
            offerId, title: offer.title, startsAt: offer.startsAt, endsAt: offer.endsAt, totalKes: offer.priceKes,
            supplierManaged: true, expiresAt, createdAt: new Date().toISOString() } }, { upsert: true, session });
    });
    return { orderReference, totalKes: offer.priceKes, expiresAt };
}
async function requireHold(order) {
    if (!order.items.some(item => ['flight', 'holiday'].includes(item.kind))) return;
    const hold = await collection('commerce_travel_reservations').findOne({ orderReference: order.orderReference });
    if (!hold?.supplierManaged || hold.status !== 'HELD' || hold.expiresAt <= Date.now() + 60000) fail(409, 'The supplier hold expired. Start a new travel booking.');
}
async function confirm(existing, receipt) {
    const paidOrder = await collection('commerce_orders').findOne({ _id: existing.orderReference, paymentStatus: 'COMPLETED', mode: 'live' });
    if (!paidOrder) return existing;
    receipt = paidOrder.receipt || receipt;
    let result;
    try { result = await catalog.bookingRequest(existing.kind, { action: 'confirm', idempotencyKey: existing.orderReference,
        reservationRef: existing.reservationRef, orderReference: existing.orderReference, receipt }); }
    catch { result = {}; }
    const confirmed = result.status === 'CONFIRMED' && typeof result.confirmationCode === 'string' && result.confirmationCode.length > 0;
    const changes = { status: confirmed ? 'CONFIRMED' : 'AWAITING_SUPPLIER', mpesaReceipt: receipt || null, lastAttemptAt: new Date(),
        ...(confirmed ? { confirmationCode: result.confirmationCode, confirmedAt: new Date().toISOString() } : {}) };
    await collection('commerce_travel_reservations').updateOne({ _id: existing._id }, { $set: changes });
    return { ...existing, ...changes };
}
async function reconcile() {
    if (!isConnected()) return;
    const pending = await collection('commerce_travel_reservations').aggregate([
        { $match: { supplierManaged: true, status: { $in: ['HELD', 'AWAITING_SUPPLIER'] } } },
        { $lookup: { from: 'commerce_orders', localField: 'orderReference', foreignField: '_id', as: 'paidOrder' } },
        { $match: { 'paidOrder.paymentStatus': 'COMPLETED', 'paidOrder.mode': 'live' } },
        { $sort: { lastAttemptAt: 1, createdAt: 1 } }, { $limit: 20 }, { $project: { paidOrder: 0 } }
    ]).toArray();
    for (const hold of pending) await confirm(hold, hold.mpesaReceipt);
}
module.exports = { createBooking, requireHold, confirm, reconcile };
