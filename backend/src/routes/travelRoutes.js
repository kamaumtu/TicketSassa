const express = require('express');
const { route } = require('../services/http');
const {
    supplierStatus,
    getTravelReservation
} = require('../services/travelSuppliers');

const router = express.Router();
const catalog = require('../services/travelCatalog');
router.get('/offers', route(async (req, res) => {
    const kind = ['flight', 'holiday'].includes(req.query.kind) ? req.query.kind : undefined;
    res.set('Cache-Control', 'no-store').json({ offers: await catalog.offers(kind), storageAvailable: require('../config/db').isConnected() });
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
