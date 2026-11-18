const { randomBytes } = require('node:crypto');
const { collection, demoEnabled } = require('./commerceDb');

function supplierStatus() {
    const amadeusConfigured = Boolean(process.env.AMADEUS_CLIENT_ID?.trim() && process.env.AMADEUS_CLIENT_SECRET?.trim());
    const webhookConfigured = Boolean(process.env.TRAVEL_SUPPLIER_WEBHOOK_URL?.trim());
    const liveSupplierReady = amadeusConfigured || webhookConfigured;
    return {
        amadeusGds: amadeusConfigured ? 'live' : 'local_inventory',
        supplierWebhook: webhookConfigured ? 'configured' : 'local_inventory',
        flightReservationEnabled: demoEnabled() || liveSupplierReady,
        holidayReservationEnabled: demoEnabled() || liveSupplierReady
    };
}

function generatePnr(prefix = 'TS') {
    return `${prefix}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

async function notifyExternalSupplier(payload) {
    const webhook = process.env.TRAVEL_SUPPLIER_WEBHOOK_URL?.trim();
    if (!webhook) return { delivered: false, mode: 'local' };
    try {
        const res = await fetch(webhook, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(process.env.TRAVEL_SUPPLIER_TOKEN?.trim()
                    ? { Authorization: 'Bearer ' + process.env.TRAVEL_SUPPLIER_TOKEN.trim() }
                    : {})
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000)
        });
        return { delivered: res.ok, status: res.status, mode: 'webhook' };
    } catch (err) {
        return { delivered: false, error: err.message, mode: 'webhook' };
    }
}

async function createFlightHold({ orderReference, flight, passenger, departureDate, returnDate, cabin, seatPref, addons, totalKes }) {
    const airlineCode = String(flight?.flightNumber || flight?.id || 'KQ').replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase() || 'KQ';
    const pnr = generatePnr(airlineCode);
    const reservation = {
        _id: pnr,
        reservationRef: pnr,
        kind: 'flight',
        orderReference,
        status: 'HELD',
        supplier: flight?.airline || 'Kenya Airways',
        flightId: flight?.id || 'KQ604',
        flightNumber: flight?.flightNumber || 'KQ 604',
        route: `${flight?.origin || 'NBO'} -> ${flight?.dest || 'MBA'}`,
        departureDate,
        returnDate: returnDate || null,
        cabin: cabin || 'economy',
        seatPref: seatPref || 'window',
        addons: addons || [],
        passenger,
        totalKes: Math.round(Number(totalKes) || 0),
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + 15 * 60 * 1000
    };
    await collection('commerce_travel_reservations').insertOne(reservation);
    return reservation;
}

async function createHolidayHold({ orderReference, holiday, guest, checkin, checkout, adults, roomType, addons, totalKes }) {
    const ref = generatePnr('HTL');
    const reservation = {
        _id: ref,
        reservationRef: ref,
        kind: 'holiday',
        orderReference,
        status: 'HELD',
        supplier: holiday?.resortName || holiday?.title || 'Ticketsasa Holiday Partner',
        packageKey: holiday?.key || 'neptune-village',
        destination: holiday?.destination || 'Kenya',
        checkin,
        checkout,
        adults: Number(adults) || 2,
        roomType: roomType || 'Standard Sharing',
        addons: addons || [],
        guest,
        totalKes: Math.round(Number(totalKes) || 0),
        createdAt: new Date().toISOString(),
        expiresAt: Date.now() + 15 * 60 * 1000
    };
    await collection('commerce_travel_reservations').insertOne(reservation);
    return reservation;
}

async function confirmTravelReservation(orderReference, receipt, mode) {
    const resCol = collection('commerce_travel_reservations');
    const existing = await resCol.findOne({ orderReference });
    if (!existing) return null;
    if (existing.status === 'CONFIRMED') return existing;
    if (mode !== 'demo' && !process.env.TRAVEL_SUPPLIER_WEBHOOK_URL?.trim() &&
        !(process.env.AMADEUS_CLIENT_ID?.trim() && process.env.AMADEUS_CLIENT_SECRET?.trim())) {
        await resCol.updateOne({ _id: existing._id }, {
            $set: { status: 'AWAITING_SUPPLIER', mpesaReceipt: receipt || null }
        });
        return { ...existing, status: 'AWAITING_SUPPLIER' };
    }

    const confirmationCode = existing.kind === 'flight'
        ? `072-${randomBytes(5).toString('hex').toUpperCase()}`
        : `VCH-${randomBytes(4).toString('hex').toUpperCase()}`;

    const webhookResult = await notifyExternalSupplier({
        action: 'confirm_reservation',
        reservationRef: existing.reservationRef,
        orderReference,
        receipt,
        kind: existing.kind,
        supplier: existing.supplier
    });

    await resCol.updateOne(
        { _id: existing._id },
        {
            $set: {
                status: 'CONFIRMED',
                confirmationCode,
                mpesaReceipt: receipt || null,
                supplierSync: webhookResult,
                confirmedAt: new Date().toISOString()
            }
        }
    );
    return {
        ...existing,
        status: 'CONFIRMED',
        confirmationCode,
        mpesaReceipt: receipt || null,
        supplierSync: webhookResult,
        confirmedAt: new Date().toISOString()
    };
}

async function getTravelReservation(ref) {
    const clean = String(ref || '').trim().toUpperCase();
    if (!clean) return null;
    return await collection('commerce_travel_reservations').findOne({
        $or: [{ _id: clean }, { reservationRef: clean }, { orderReference: clean }]
    });
}

module.exports = {
    supplierStatus,
    createFlightHold,
    createHolidayHold,
    confirmTravelReservation,
    getTravelReservation
};
