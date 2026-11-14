require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB, isConnected } = require('./config/db');
const Event = require('./models/Event');
const StadiumZone = require('./models/StadiumZone');
const TicketTier = require('./models/TicketTier');

async function seedDatabase() {
    console.log('[*] Starting MongoDB Database Seeder...');
    await connectDB();
    if (!isConnected()) {
        process.exitCode = 1;
        return;
    }

    try {
        console.log('[*] Clearing existing collections...');
        await Event.deleteMany({});
        await StadiumZone.deleteMany({});
        await TicketTier.deleteMany({});

        // 1. Seed Main Event
        console.log('[*] Seeding Event: Time Attack The Last Lap...');
        await Event.create({
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
        });

        // 2. Seed Stadium Zones
        console.log('[*] Seeding Talanta Sports City Stadium Zones...');
        await StadiumZone.create([
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
        ]);

        // 3. Seed Ticket Tiers
        console.log('[*] Seeding Ticketsasa Pass Tiers...');
        await TicketTier.create([
            {
                tierKey: 'regular',
                title: 'Regular Arena Stand',
                category: 'General Admission',
                description: 'Access to East & West Grandstands, main food village, and concert viewing area.',
                priceKes: 1500,
                priceUsd: 12,
                features: [
                    'Grandstand unreserved seating',
                    'Full race heats & sprint viewing',
                    'Konshens concert soundstage',
                    'Mobile QR gate entry pass'
                ],
                totalAllocation: 30000,
                remainingAllocation: 8400,
                designatedGate: 'Gate C & D',
                isPopular: false
            },
            {
                tierKey: 'paddock',
                title: 'Speed Paddock Stand',
                category: 'Motorsport Enthusiast',
                description: 'Elevated North Curve speed apex view + restricted pit perimeter access.',
                priceKes: 3000,
                priceUsd: 24,
                features: [
                    'Trackside North Hairpin seating',
                    'Official DMSC event lanyard & badge',
                    'Paddock perimeter inspection access',
                    'Fast-track Gate B entry'
                ],
                totalAllocation: 10000,
                remainingAllocation: 2450,
                designatedGate: 'Gate B',
                isPopular: false
            },
            {
                tierKey: 'vip',
                title: 'VIP Pit & Hype Pass',
                category: 'VIP All Access',
                description: 'Direct pit lane hospitality lounge + golden circle front-row stage for Konshens.',
                priceKes: 5000,
                priceUsd: 40,
                features: [
                    'Golden Circle stage front at concert',
                    'Pit Lane walk with drivers & hypercars',
                    '2 Complimentary craft cocktail tokens',
                    'Dedicated VIP restrooms & express bar'
                ],
                totalAllocation: 3000,
                remainingAllocation: 240,
                designatedGate: 'Gate B / VIP',
                isPopular: true
            },
            {
                tierKey: 'vvip',
                title: 'VVIP Royal Box Suite',
                category: 'Ultra Luxury',
                description: 'Air-conditioned stadium suite, 5-course gourmet dining, and private artist lounge.',
                priceKes: 15000,
                priceUsd: 120,
                features: [
                    'Presidential Suite elevated balcony',
                    'Open premium bar & gourmet catering',
                    'Exclusive artist meet & greet pass',
                    'Reserved VIP parking inside Gate A'
                ],
                totalAllocation: 250,
                remainingAllocation: 18,
                designatedGate: 'Gate A (VIP Jamhuri)',
                isPopular: false
            }
        ]);

        console.log('[+] MongoDB Seeding Finished Successfully!');
    } catch (err) {
        console.error('[-] Seeding error:', err);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

seedDatabase();
