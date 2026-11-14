const mongoose = require('mongoose');

const TicketTierSchema = new mongoose.Schema({
    eventId: String,
    eventTitle: String,
    tierKey: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    title: {
        type: String,
        required: true
    },
    category: {
        type: String,
        default: 'General Admission'
    },
    description: {
        type: String,
        required: true
    },
    priceKes: {
        type: Number,
        required: true
    },
    priceUsd: {
        type: Number,
        required: true
    },
    features: {
        type: [String],
        default: []
    },
    totalAllocation: {
        type: Number,
        default: 1000
    },
    remainingAllocation: {
        type: Number,
        default: 1000
    },
    designatedGate: {
        type: String,
        default: 'Gate C'
    },
    isPopular: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('TicketTier', TicketTierSchema);
