const Event = require('../models/Event');
const { isConnected } = require('../config/db');

// Static fallback data in case database is in transit / bootstrapping
const defaultEvent = {
    title: 'TIME ATTACK: THE LAST LAP & THE MEGA HYPE FESTIVAL',
    slug: 'time-attack-the-last-lap',
    subtitle: 'Championship Finale + Konshens Live in Concert',
    description: 'Experience Kenya’s greatest convergence of raw horsepower, precision asphalt drifting, and legendary Caribbean dancehall vibes inside Nairobi’s newly inaugurated Raila Odinga International Stadium & Jamhuri Circuit.',
    venue: {
        name: 'Raila Odinga International Stadium',
        complex: 'Talanta Sports City',
        location: 'Jamhuri Grounds, Ngong Road, Nairobi, Kenya'
    },
    eventDate: new Date('2026-11-08T09:00:00+03:00'),
    gatesOpenTime: '09:00 AM EAT',
    headliner: {
        name: 'Konshens',
        genre: 'Caribbean Dancehall',
        bio: 'Jamaican dancehall superstar bringing his legendary energy back to Nairobi.'
    },
    motorsportSeries: {
        name: 'Time Attack - The Last Lap',
        organizer: 'Delta Motor Sport Club (DMSC)',
        seasonRound: 'Round 4 Championship Finale'
    },
    bannerImageUrl: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=1200&q=80',
    isLive: true
};

exports.getFeaturedEvent = async (req, res) => {
    try {
        let event = null;
        try {
            if (isConnected()) event = await Event.findOne({ isLive: true });
        } catch (dbErr) {
            // DB fallback
        }
        return res.status(200).json({
            success: true,
            data: event || defaultEvent
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.getEventsList = async (req, res) => {
    try {
        let events = [];
        try {
            if (isConnected()) events = await Event.find();
        } catch (dbErr) {}

        return res.status(200).json({
            success: true,
            count: events.length || 1,
            data: events.length ? events : [defaultEvent]
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};
