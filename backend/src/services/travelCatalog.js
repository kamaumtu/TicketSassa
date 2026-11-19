const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { isConnected } = require('../config/db');

const INTERVAL = 15 * 60 * 1000;
const kinds = ['flight', 'holiday'];
const state = { stage: 'waiting', startedAt: null, finishedAt: null, nextRunAt: null, sources: {}, history: [] };
let pending;
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function db(name) {
    if (!isConnected()) fail(503, 'Travel bookings require the database connection.');
    return mongoose.connection.db.collection(name);
}
function config(kind) {
    const prefix = kind === 'flight' ? 'FLIGHT' : 'HOLIDAY';
    return { url: process.env[`${prefix}_OFFERS_URL`]?.trim(), token: process.env[`${prefix}_SUPPLIER_TOKEN`]?.trim(),
        bookingUrl: process.env[`${prefix}_BOOKING_URL`]?.trim() };
}
async function supplierRequest(url, token, payload) {
    if (!url) fail(503, 'Supplier connection needs setup.');
    let parsed;
    try { parsed = new URL(url); } catch { fail(503, 'Supplier URL is invalid.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail(503, 'Supplier URL must use HTTPS.');
    const response = await fetch(parsed, { method: payload ? 'POST' : 'GET', redirect: 'error',
        headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(15000) });
    if (!response.ok) fail(502, 'Supplier request failed.');
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) fail(502, 'Supplier response is too large.');
    try { return JSON.parse(text); } catch { fail(502, 'Supplier returned an invalid response.'); }
}
function normalizeOffer(row, kind, now = Date.now()) {
    if (!row || typeof row.id !== 'string' || !/^[\w.-]{1,100}$/.test(row.id)) return null;
    if (typeof row.title !== 'string' || !row.title.trim() || row.currency !== 'KES' ||
        !Number.isSafeInteger(row.priceKes) || row.priceKes < 1 || !Number.isSafeInteger(row.available) || row.available < 0) return null;
    const expiresAt = Date.parse(row.expiresAt);
    const startsAt = Date.parse(row.startsAt);
    const endsAt = Date.parse(row.endsAt);
    if (!Number.isFinite(expiresAt) || !Number.isFinite(startsAt) || startsAt <= now || expiresAt <= now ||
        !Number.isFinite(endsAt) || endsAt <= startsAt) return null;
    const text = value => typeof value === 'string' ? value.slice(0, 2000) : '';
    return { _id: `${kind}:${row.id}`, id: `${kind}:${row.id}`, supplierId: row.id, kind,
        title: row.title.trim().slice(0, 160), description: text(row.description), supplier: text(row.supplier),
        destination: text(row.destination), origin: text(row.origin), priceBasis: text(row.priceBasis) || 'per booking',
        priceKes: row.priceKes, currency: 'KES', available: row.available, startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(), expiresAt: Math.min(expiresAt, now + INTERVAL * 2),
        checkedAt: new Date(now).toISOString(), status: row.available > 0 && row.bookable === true && Boolean(config(kind).bookingUrl) ? 'available' : 'listing_only' };
}
async function sync(trigger = 'scheduled') {
    if (pending) return pending;
    pending = (async () => {
        state.stage = 'syncing'; state.startedAt = new Date().toISOString();
        const run = { _id: randomUUID(), trigger, startedAt: state.startedAt, sources: {} };
        for (const kind of kinds) {
            const cfg = config(kind);
            try {
                if (!cfg.url) { state.sources[kind] = { status: 'setup_required', count: 0, message: 'Add the supplier offers URL and booking URL in backend settings.' }; continue; }
                if (!isConnected()) fail(503, 'Database offline. Sync will retry automatically.');
                const result = await supplierRequest(cfg.url, cfg.token);
                if (!Array.isArray(result.offers) || result.offers.length > 1000) fail(502, 'Supplier must return an offers array with at most 1000 offers.');
                const offers = result.offers.map(row => normalizeOffer(row, kind)).filter(Boolean);
                // A malformed snapshot cannot withdraw valid inventory accidentally.
                if (result.offers.length && !offers.length) fail(502, 'No valid offers in supplier response.');
                const session = await mongoose.startSession();
                try { await session.withTransaction(async () => {
                    await db('travel_offers').updateMany({ kind }, { $set: { status: 'withdrawn' } }, { session });
                    for (const offer of offers) await db('travel_offers').replaceOne({ _id: offer._id }, offer, { upsert: true, session });
                }); } finally { await session.endSession(); }
                state.sources[kind] = { status: 'connected', count: offers.length, rejected: result.offers.length - offers.length,
                    available: offers.filter(o => o.status === 'available').length };
            } catch (error) { state.sources[kind] = { status: error.status === 503 ? 'database_offline' : 'error', count: 0, message: error.status ? error.message : 'Supplier refresh failed. Automatic retry is scheduled.' }; }
        }
        state.stage = 'idle'; state.finishedAt = new Date().toISOString(); state.nextRunAt = new Date(Date.now() + INTERVAL).toISOString();
        Object.assign(run, { sources: structuredClone(state.sources), finishedAt: state.finishedAt });
        state.history = [run, ...state.history].slice(0, 20);
        if (isConnected()) {
            try {
                await db('travel_sync_runs').createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
                await db('travel_sync_runs').insertOne({ ...run, purgeAt: new Date(Date.now() + 7 * 86400000) });
            } catch { /* In-process status still explains a storage outage. */ }
        }
        return lobby();
    })().finally(() => { pending = undefined; });
    return pending;
}
async function offers(kind, all = false) {
    if (!isConnected()) return [];
    const rows = await db('travel_offers').find(kind ? { kind } : {}).sort({ startsAt: 1 }).limit(1000).toArray().catch(() => []);
    return rows.map(row => ({ ...row, status: row.expiresAt <= Date.now() || Date.parse(row.startsAt) <= Date.now() ? 'expired' : row.status }))
        .filter(row => all || ['available', 'listing_only'].includes(row.status));
}
async function lobby() {
    let history = state.history;
    if (isConnected()) history = await db('travel_sync_runs').find({}).sort({ startedAt: -1 }).limit(20).toArray().catch(() => state.history);
    const reservations = isConnected() ? await db('commerce_travel_reservations').find({ supplierManaged: true }, { projection: {
        _id: 0, orderReference: 1, kind: 1, title: 1, status: 1, totalKes: 1, createdAt: 1, confirmationCode: 1
    } }).sort({ createdAt: -1 }).limit(50).toArray().catch(() => []) : [];
    return { ...state, history, reservations, storageAvailable: isConnected(), offers: await offers(null, true),
        configuration: Object.fromEntries(kinds.map(kind => [kind, { feedConfigured: Boolean(config(kind).url), bookingConfigured: Boolean(config(kind).bookingUrl) }])) };
}
function start() { void sync('startup'); const timer = setInterval(() => void sync(), INTERVAL); timer.unref(); }
async function getOffer(id) {
    if (typeof id !== 'string') fail(400, 'Choose a travel offer.');
    const row = await db('travel_offers').findOne({ _id: id });
    if (!row || row.status !== 'available' || row.expiresAt <= Date.now() || Date.parse(row.startsAt) <= Date.now()) fail(409, 'This offer expired or is no longer available. Refresh the offers.');
    return row;
}
async function bookingRequest(kind, payload) { const cfg = config(kind); return supplierRequest(cfg.bookingUrl, cfg.token, payload); }
module.exports = { start, sync, offers, lobby, getOffer, bookingRequest, normalizeOffer, config };
