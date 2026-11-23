const express = require('express');
const { route } = require('../services/http');
const {
    supplierStatus,
    getTravelReservation
} = require('../services/travelSuppliers');

const router = express.Router();
const catalog = require('../services/travelCatalog');
const holidayCatalog = require('../services/holidayCatalog');
const flightCatalog = require('../services/flightCatalog');
router.get('/offers', route(async (req, res) => {
    const kind = ['flight', 'holiday'].includes(req.query.kind) ? req.query.kind : undefined;
    res.set('Cache-Control', 'no-store').json({ offers: await catalog.offers(kind), storageAvailable: require('../config/db').isConnected() });
}));
router.get('/itineraries', route(async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ success: true, ...holidayCatalog.listHolidayItineraries() });
}));
router.post('/itineraries/quote', route(async (req, res) => {
    res.json({ success: true, quote: await holidayCatalog.quoteHolidayItinerary(req.body) });
}));
router.post('/itineraries/book', route(async (req, res) => {
    res.status(201).json({ success: true, ...await holidayCatalog.createHolidayItineraryBooking(req.body) });
}));
router.get('/flights/catalog', route(async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ success: true, ...flightCatalog.listCuratedFlights() });
}));
router.post('/flights/quote', route(async (req, res) => {
    res.json({ success: true, quote: await flightCatalog.quoteFlightBooking(req.body) });
}));
router.post('/flights/book', route(async (req, res) => {
    res.status(201).json({ success: true, ...await flightCatalog.createFlightBooking(req.body) });
}));
router.get('/bundle-flight', (req, res) => {
    const destination = String(req.query.destination || '');
    const title = String(req.query.title || '');
    res.json({ success: true, flight: holidayCatalog.matchBundleFlight(destination, title) });
});
router.get('/promos/validate', route(async (req, res) => {
    await require('../services/travelPricing').getTravelPricing();
    const code = String(req.query.code || '').trim();
    const kind = String(req.query.kind || 'all').trim().toLowerCase();
    const promo = require('../services/promos').getPromo(code, kind);
    if (!promo) {
        return res.status(404).json({ success: false, message: 'Promo code not valid for this booking type.' });
    }
    res.json({ success: true, promo });
}));
router.post('/bookings', route(async (req, res) => {
    res.status(201).json({ success: true, ...await require('../services/travelBookings').createBooking(req.body) });
}));
router.get('/bookings/:ref', route(async (req, res) => {
    if (!require('../config/db').isConnected()) return res.status(503).json({ message: 'Database unavailable.' });
    const order = await require('../services/commerceDb').collection('commerce_orders').findOne({ _id: req.params.ref,
        'customer.email': String(req.query.email || '').trim().toLowerCase() });
    if (!order) return res.status(404).json({ message: 'Booking not found for this email.' });
    const reservation = await getTravelReservation(order.orderReference);
    res.set('Cache-Control', 'no-store').json({ orderReference: order.orderReference, paymentStatus: order.paymentStatus,
        totalKes: order.totalKes, reservation: reservation ? { status: reservation.status, title: reservation.title,
            confirmationCode: reservation.confirmationCode, startsAt: reservation.startsAt, endsAt: reservation.endsAt } : null });
}));

// Legacy sample itineraries cannot reserve supplier inventory.
router.post(['/flights/reserve', '/holidays/reserve'], (req, res) => res.status(410).json({ message: 'Choose a current offer from the travel offers section to book.' }));
router.get('/reservations/:ref', (req, res) => res.status(410).json({ message: 'Use booking lookup with the customer email.' }));

router.get('/status', (req, res) => {
    res.json({ success: true, ...supplierStatus() });
});

router.use((error, req, res, next) => {
    if ([400, 404, 409, 410, 502, 503].includes(error.status)) return res.status(error.status).json({ success: false, message: error.message });
    next(error);
});

module.exports = router;
