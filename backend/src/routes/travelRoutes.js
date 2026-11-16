const express = require('express');
const { route } = require('../services/http');
const {
    supplierStatus,
    createFlightHold,
    createHolidayHold,
    getTravelReservation
} = require('../services/travelSuppliers');

const router = express.Router();

router.get('/status', (req, res) => {
    res.json({ success: true, ...supplierStatus() });
});

router.post('/flights/reserve', route(async (req, res) => {
    const { orderReference, flight, passenger, departureDate, returnDate, cabin, seatPref, addons, totalKes } = req.body || {};
    if (!orderReference || !passenger?.email || !passenger?.phone || !departureDate) {
        return res.status(400).json({ success: false, message: 'Order reference, passenger contact, and departure date are required.' });
    }
    const reservation = await createFlightHold({
        orderReference,
        flight,
        passenger,
        departureDate,
        returnDate,
        cabin,
        seatPref,
        addons,
        totalKes
    });
    res.status(201).json({ success: true, reservation });
}));

router.post('/holidays/reserve', route(async (req, res) => {
    const { orderReference, holiday, guest, checkin, checkout, adults, roomType, addons, totalKes } = req.body || {};
    if (!orderReference || !guest?.email || !guest?.phone || !checkin || !checkout || checkout <= checkin) {
        return res.status(400).json({ success: false, message: 'Order reference, guest contact, and valid check-in/check-out dates are required.' });
    }
    const reservation = await createHolidayHold({
        orderReference,
        holiday,
        guest,
        checkin,
        checkout,
        adults,
        roomType,
        addons,
        totalKes
    });
    res.status(201).json({ success: true, reservation });
}));

router.get('/reservations/:ref', route(async (req, res) => {
    const reservation = await getTravelReservation(req.params.ref);
    if (!reservation) return res.status(404).json({ success: false, message: 'Travel reservation not found.' });
    res.json({ success: true, reservation });
}));

module.exports = router;
