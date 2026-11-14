const mongoose = require('mongoose');

const StadiumZoneSchema = new mongoose.Schema({
    zoneKey: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    capacity: {
        type: Number,
        required: true
    },
    availablePercent: {
        type: Number,
        default: 100
    },
    gate: {
        type: String,
        required: true
    },
    includedPerks: {
        type: [String],
        default: []
    },
    recommendedTier: {
        type: String,
        enum: ['regular', 'paddock', 'vip', 'vvip'],
        default: 'regular'
    },
    previewImageUrl: {
        type: String,
        default: ''
    },
    fieldOfViewAngle: {
        type: String,
        default: '180° Panoramic'
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('StadiumZone', StadiumZoneSchema);
