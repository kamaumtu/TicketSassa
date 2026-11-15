const mongoose = require('mongoose');

const DigitalPassSchema = new mongoose.Schema({
    passReference: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    orderReference: {
        type: String,
        required: true,
        index: true
    },
    attendeeName: {
        type: String,
        required: true
    },
    tierName: {
        type: String,
        required: true
    },
    designatedGate: {
        type: String,
        required: true
    },
    eventTitle: {
        type: String,
        default: 'Time Attack: The Last Lap & Konshens Live'
    },
    venue: {
        type: String,
        default: 'Talanta Sports City - Raila Odinga International Stadium'
    },
    eventDate: {
        type: Date,
        default: () => new Date('2026-11-08T09:00:00+03:00')
    },
    qrCodeToken: {
        type: String,
        required: true,
        unique: true
    },
    status: {
        type: String,
        enum: ['VALID', 'USED', 'CANCELLED'],
        default: 'VALID'
    },
    scannedBy: String,
    scannedAt: {
        type: Date,
        default: null
    },
    scannedGate: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('DigitalPass', DigitalPassSchema);
