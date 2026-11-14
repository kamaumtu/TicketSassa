const mongoose = require('mongoose');

const OrderItemSchema = new mongoose.Schema({
    tierKey: { type: String, required: true },
    title: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceKes: { type: Number, required: true },
    unitPriceUsd: { type: Number, required: true },
    subtotalKes: { type: Number, required: true },
    subtotalUsd: { type: Number, required: true }
});

const OrderSchema = new mongoose.Schema({
    orderReference: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    customer: {
        name: { type: String, required: true },
        email: { type: String, required: true },
        phone: { type: String, required: true }
    },
    items: [OrderItemSchema],
    totalTickets: {
        type: Number,
        required: true
    },
    totalKes: {
        type: Number,
        required: true
    },
    totalUsd: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        enum: ['KES', 'USD'],
        default: 'KES'
    },
    paymentStatus: {
        type: String,
        enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
        default: 'PENDING'
    },
    paymentMethod: {
        type: String,
        enum: ['MPESA', 'CARD'],
        default: 'MPESA'
    },
    mpesaCheckoutRequestId: {
        type: String,
        default: null
    },
    mpesaReceiptNumber: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Order', OrderSchema);
