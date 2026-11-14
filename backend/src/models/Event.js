const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    subtitle: {
        type: String,
        default: ''
    },
    description: {
        type: String,
        required: true
    },
    venue: {
        name: { type: String, default: 'Raila Odinga International Stadium' },
        complex: { type: String, default: 'Talanta Sports City' },
        location: { type: String, default: 'Jamhuri Grounds, Ngong Road, Nairobi, Kenya' }
    },
    eventDate: {
        type: Date,
        required: true
    },
    gatesOpenTime: {
        type: String,
        default: '09:00 AM EAT'
    },
    headliner: {
        name: { type: String, default: 'Konshens' },
        genre: { type: String, default: 'Caribbean Dancehall' },
        bio: { type: String, default: 'Jamaican dancehall royalty performing live in Nairobi.' }
    },
    motorsportSeries: {
        name: { type: String, default: 'Time Attack - The Last Lap' },
        organizer: { type: String, default: 'Delta Motor Sport Club (DMSC)' },
        seasonRound: { type: String, default: 'Round 4 Championship Finale' }
    },
    bannerImageUrl: {
        type: String,
        default: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=1200&q=80'
    },
    isLive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Event', EventSchema);
