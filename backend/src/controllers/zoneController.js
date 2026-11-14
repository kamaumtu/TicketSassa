const StadiumZone = require('../models/StadiumZone');
const { isConnected } = require('../config/db');

const defaultZones = [
    {
        zoneKey: 'pitlane',
        name: 'VIP Pit Lane & Paddock',
        description: 'Direct trackside access adjacent to the race car preparation paddock, live telemetry screens, and Konshens soundcheck access.',
        capacity: 2500,
        availablePercent: 18,
        gate: 'Gate B (Ngong Rd)',
        includedPerks: ['Pit Walk', 'VIP Bar Access', 'Live Telemetry Monitor'],
        recommendedTier: 'vip',
        previewImageUrl: 'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=800&q=80',
        fieldOfViewAngle: '180° Elevated Pit View'
    },
    {
        zoneKey: 'vvip',
        name: 'VVIP Royal Box & Presidential Suite',
        description: 'Panoramic air-conditioned private suite directly above the start/finish straight with 5-star catering and luxury balcony seating.',
        capacity: 450,
        availablePercent: 8,
        gate: 'Gate A (Presidential VIP)',
        includedPerks: ['5-Course Gourmet Catering', 'Open Premium Bar', 'Artist Meet & Greet', 'Reserved VIP Parking'],
        recommendedTier: 'vvip',
        previewImageUrl: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80',
        fieldOfViewAngle: 'Panoramic Royal Straight'
    },
    {
        zoneKey: 'stage',
        name: 'South Stand & Dancehall Fan Pit',
        description: 'Front-row energetic soundstage area directly facing the hydraulic concert stage where Konshens and guest DJs headline.',
        capacity: 15000,
        availablePercent: 28,
        gate: 'Gate C & D',
        includedPerks: ['Stage Pyrotechnics Front View', 'Express Beverage Bar'],
        recommendedTier: 'vip',
        previewImageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=800&q=80',
        fieldOfViewAngle: 'Stage Center Field'
    },
    {
        zoneKey: 'north',
        name: 'North Stand (Speed Hairpin Curve)',
        description: 'Prime braking zone where Time Attack racers decelerate from 210 km/h into the tight technical hairpin chicane.',
        capacity: 14000,
        availablePercent: 45,
        gate: 'Gate B',
        includedPerks: ['Extreme Braking G-Force Vantage', 'Official Event Lanyard'],
        recommendedTier: 'paddock',
        previewImageUrl: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?auto=format&fit=crop&w=800&q=80',
        fieldOfViewAngle: 'Hairpin Apex Curve'
    },
    {
        zoneKey: 'west',
        name: 'West Grandstand (Main Straight)',
        description: 'Covered stadium tier with complete panoramic view of the entire 4.2 km Jamhuri circuit and high-speed drag strip.',
        capacity: 18000,
        availablePercent: 60,
        gate: 'Gate C (West)',
        includedPerks: ['Shaded Stadium Seating', 'Food Village Access'],
        recommendedTier: 'regular',
        previewImageUrl: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=800&q=80',
        fieldOfViewAngle: 'Full Circuit Vista'
    },
    {
        zoneKey: 'east',
        name: 'East Grandstand (Drift Apex)',
        description: 'Overlooks the high-angle smoke drift exhibition zone where drivers perform synchronized twin tandem runs.',
        capacity: 12000,
        availablePercent: 30,
        gate: 'Gate D (East)',
        includedPerks: ['Tire Smoke Visuals', 'Exhaust Sound Zone'],
        recommendedTier: 'regular',
        previewImageUrl: 'https://images.unsplash.com/photo-1514316454349-750a7fd3da3a?auto=format&fit=crop&w=800&q=80',
        fieldOfViewAngle: 'Drift Sweep Apex'
    }
];

exports.getAllZones = async (req, res) => {
    try {
        let zones = [];
        try {
            if (isConnected()) zones = await StadiumZone.find();
        } catch (dbErr) {}

        return res.status(200).json({
            success: true,
            count: zones.length || defaultZones.length,
            data: zones.length ? zones : defaultZones
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.getZoneByKey = async (req, res) => {
    try {
        const { key } = req.params;
        let zone = null;
        try {
            if (isConnected()) zone = await StadiumZone.findOne({ zoneKey: key });
        } catch (dbErr) {}

        if (!zone) {
            zone = defaultZones.find(z => z.zoneKey === key);
        }

        if (!zone) {
            return res.status(404).json({ success: false, message: 'Stadium zone not found' });
        }

        return res.status(200).json({ success: true, data: zone });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};
