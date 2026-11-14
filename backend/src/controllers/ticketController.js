const TicketTier = require('../models/TicketTier');
const { isConnected } = require('../config/db');
const { soldQuantity, heldQuantity } = require('../services/commerceDb');

const defaultTiers = [
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
];

const demoEvent = {
    id: 'talanta-open-day-demo',
    title: 'Talanta Open Day',
    description: 'A sample general-admission event for testing the ticket purchase and entry flow.'
};

async function getTicketCatalog() {
    const tiers = isConnected() ? await TicketTier.find({ isActive: true }).lean() : defaultTiers;
    const { publishedTiers } = require('../routes/publishedEvents');
    return [...tiers, ...publishedTiers()].map(tier => ({
        ...tier,
        eventId: tier.eventId || demoEvent.id,
        eventTitle: tier.eventTitle || demoEvent.title
    }));
}

exports.getTicketCatalog = getTicketCatalog;
exports.demoEvent = demoEvent;

exports.getAllTiers = async (req, res, next) => {
    try {
        const data = (await getTicketCatalog()).map(item => ({
            ...item,
            remainingAllocation: Math.max(0, item.remainingAllocation - soldQuantity('ticket:' + item.tierKey) - heldQuantity('ticket:' + item.tierKey))
        }));
        res.json({ success: true, count: data.length, data });
    } catch (error) {
        next(error);
    }
};
