const mongoose = require('mongoose');

const MerchProductSchema = new mongoose.Schema({
    productKey: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    category: { type: String, default: 'Apparel' },
    priceKes: { type: Number, required: true },
    priceUsd: { type: Number, required: true },
    image: { type: String, required: true },
    sizes: { type: [String], default: ['S', 'M', 'L', 'XL'] },
    stock: { type: Number, default: 100 },
    creator: { type: String, default: 'Time Attack × Konshens Official' }
}, { timestamps: true });

module.exports = mongoose.model('MerchProduct', MerchProductSchema);

