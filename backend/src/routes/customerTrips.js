const express = require('express');
const mongoose = require('mongoose');
const { route } = require('../services/http');
const { resolveSessionAccount } = require('./auth');
const { collection } = require('../services/commerceDb');
const { isConnected } = require('../config/db');
const { FlightListing, HolidayPackage } = require('../models/automation');
const { resolveFlightPriceKes } = require('../services/flightCatalog');
const { resolveHolidayPriceKes } = require('../services/holidayCatalog');
const { getTravelPricing, applyTravelMarkup } = require('../services/travelPricing');

const router = express.Router();

async function requireUser(req, res, next) {
    const user = await resolveSessionAccount(req);
    if (!user) return res.status(401).json({ success: false, message: 'Sign in to view your trips and saved deals.' });
    req.customerUser = user;
    next();
}

// My Trips & Tickets (all orders, digital passes & travel reservations for signed-in user)
router.get('/trips', requireUser, route(async (req, res) => {
    const email = req.customerUser.email;
    const orders = await collection('commerce_orders')
        .find({ 'customer.email': email })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray()
        .catch(() => []);

    const orderRefs = orders.map(o => o.orderReference).filter(Boolean);
    const [passes, reservations] = orderRefs.length
        ? await Promise.all([
            collection('commerce_passes').find({ orderReference: { $in: orderRefs } }).toArray().catch(() => []),
            collection('commerce_travel_reservations').find({ orderReference: { $in: orderRefs } }).toArray().catch(() => [])
        ])
        : [[], []];

    res.set('Cache-Control', 'no-store').json({
        success: true,
        user: req.customerUser,
        orders: orders.map(o => ({
            orderReference: o.orderReference,
            totalKes: o.totalKes,
            currency: o.currency,
            paymentMethod: o.paymentMethod,
            paymentStatus: o.paymentStatus,
            createdAt: o.createdAt,
            items: o.items
        })),
        passes,
        reservations
    });
}));

// Saved Favorites & Price-Drop Watchlist
router.get('/favorites', requireUser, route(async (req, res) => {
    const items = await collection('customer_favorites')
        .find({ email: req.customerUser.email })
        .sort({ savedAt: -1 })
        .limit(100)
        .toArray()
        .catch(() => []);
    res.set('Cache-Control', 'no-store').json({ success: true, favorites: items });
}));

router.post('/favorites', requireUser, route(async (req, res) => {
    const { itemKey, kind, title, subtitle = '', image = '', priceKes = 0, meta = {} } = req.body || {};
    const cleanKey = String(itemKey || '').trim().slice(0, 120);
    if (!cleanKey || !['flight', 'holiday', 'event'].includes(kind) || !title) {
        return res.status(400).json({ success: false, message: 'Valid itemKey, kind, and title are required.' });
    }
    const id = `${req.customerUser.email}::${cleanKey}`;
    const doc = {
        _id: id,
        email: req.customerUser.email,
        itemKey: cleanKey,
        kind,
        title: String(title).trim().slice(0, 160),
        subtitle: String(subtitle || '').trim().slice(0, 160),
        image: String(image || '').trim().slice(0, 300),
        savedPriceKes: Math.max(0, Math.round(Number(priceKes) || 0)),
        alertOnDrop: true,
        meta: meta && typeof meta === 'object' ? meta : {},
        savedAt: new Date()
    };
    await collection('customer_favorites').replaceOne({ _id: id }, doc, { upsert: true });
    res.status(201).json({ success: true, favorite: doc });
}));

router.delete('/favorites/:itemKey', requireUser, route(async (req, res) => {
    const cleanKey = decodeURIComponent(String(req.params.itemKey || '')).trim();
    const id = `${req.customerUser.email}::${cleanKey}`;
    await collection('customer_favorites').deleteOne({ _id: id });
    res.json({ success: true });
}));

// Price-Drop Alerts (compares saved favorites against live synced prices)
router.get('/price-alerts', requireUser, route(async (req, res) => {
    const favorites = await collection('customer_favorites')
        .find({ email: req.customerUser.email, alertOnDrop: true })
        .toArray()
        .catch(() => []);

    const pricing = await getTravelPricing();
    const alerts = [];
    for (const fav of favorites) {
        if (!isConnected() || !fav.savedPriceKes) continue;
        const idPart = String(fav.itemKey || '').replace(/^(flight|holiday):/, '').replace(/^db:/, '');
        let currentPriceKes = null;
        if (fav.kind === 'flight') {
            const clauses = [{ externalId: idPart }];
            if (mongoose.Types.ObjectId.isValid(idPart)) clauses.unshift({ _id: idPart });
            const doc = await FlightListing.findOne({ $or: clauses }).lean().catch(() => null);
            if (doc) currentPriceKes = applyTravelMarkup(resolveFlightPriceKes(doc), 'flight', pricing).totalWithMarkupKes;
        } else if (fav.kind === 'holiday') {
            const clauses = [{ externalId: idPart }];
            if (mongoose.Types.ObjectId.isValid(idPart)) clauses.unshift({ _id: idPart });
            const doc = await HolidayPackage.findOne({ $or: clauses }).lean().catch(() => null);
            if (doc) currentPriceKes = applyTravelMarkup(resolveHolidayPriceKes(doc), 'holiday', pricing).totalWithMarkupKes;
        }
        if (currentPriceKes != null && currentPriceKes < fav.savedPriceKes) {
            alerts.push({
                itemKey: fav.itemKey,
                kind: fav.kind,
                title: fav.title,
                savedPriceKes: fav.savedPriceKes,
                currentPriceKes,
                savingsKes: fav.savedPriceKes - currentPriceKes
            });
        }
    }
    res.set('Cache-Control', 'no-store').json({ success: true, alerts });
}));

module.exports = router;
