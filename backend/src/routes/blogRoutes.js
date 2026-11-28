const express = require('express');
const { randomBytes } = require('node:crypto');
const { isConnected } = require('../config/db');
const { route } = require('../services/http');
const { BlogPost, BLOG_CATEGORIES } = require('../models/BlogPost');

const publicBlogRouter = express.Router();
const adminBlogRouter = express.Router();

const STARTER_POSTS = [
    {
        slug: 'how-to-book-event-tickets-and-scan-fast-with-mpesa',
        title: 'How to Book Kenyan Events & Get Instant QR Passes with M-Pesa',
        excerpt: 'Skip box-office queues. Here is how instant M-Pesa STK Push checkout, PDF ticket downloads, and fast gate QR scanning work on Ticketsassa.',
        category: 'Guides',
        author: 'Ticketsassa Team',
        coverImage: '/assets/real/back-to-rock-5.jpg',
        status: 'published',
        featured: true,
        readMinutes: 3,
        content: `Booking concert, sports, comedy, and festival tickets across Kenya should take less than a minute — without waiting for manual WhatsApp confirmations.

1. Pick Your Event & Ticket Tier
Browse upcoming events across Nairobi, Mombasa, Naivasha, Kisumu, and all 47 counties. Select your preferred pass (Early Bird, Regular, VIP, or Group) directly from the event details page.

2. Approve the M-Pesa STK Prompt
Enter your name, email, and Safaricom number starting with 07 or 01. You will receive an M-Pesa PIN prompt directly on your phone. As soon as your payment confirms, your order is verified automatically.

3. Download Your QR PDF Ticket
Your digital pass with a unique QR code appears immediately on screen and inside "My Tickets" / "Check Ticket". Save the PDF to your phone before arriving at the venue so gate staff can scan you in within seconds — even if mobile data is busy at the entrance.`
    },
    {
        slug: 'weekend-escape-guide-diani-watamu-naivasha-maasai-mara',
        title: 'Kenya Weekend Escapes: Diani, Watamu, Naivasha & Maasai Mara',
        excerpt: 'From 1-hour coastal flights to Naivasha lakeside retreats and Mara safaris, compare Kenya’s favorite short-break destinations and how to plan smarter.',
        category: 'Travel',
        author: 'Ticketsassa Travel Desk',
        coverImage: '/assets/holidays/dest-diani.jpg',
        status: 'published',
        featured: false,
        readMinutes: 4,
        content: `You do not need two weeks off work to enjoy a memorable Kenyan getaway. With quick domestic flights and direct highway routes, a 3-day weekend is plenty.

Diani & Watamu (South & North Coast)
Fly straight from Wilson Airport to Ukunda (Diani) or from JKIA to Malindi/Mombasa in just over an hour. Beach resorts offer half-board and all-inclusive stays with snorkeling, dhow cruises, and Wasini Island day trips.

Lake Naivasha & Elementaita
Less than two hours from Nairobi, Naivasha is ideal for weekend music festivals, Crescent Island boat rides, Hell's Gate cycling, and family lodge stays.

Maasai Mara Safari Weekends
For wildlife lovers, a 2-night Mara package covers morning and sunset game drives, full-board lodge dining, and optional Wilson-to-Mara bush flights that maximize your time in the reserve.`
    },
    {
        slug: 'smart-tips-booking-domestic-flights-kenya',
        title: '5 Practical Tips for Booking Domestic Flights in Kenya',
        excerpt: 'Choosing between JKIA and Wilson Airport, baggage allowances on regional carriers, and booking early for coastal and holiday weekends.',
        category: 'Flights',
        author: 'Ticketsassa Travel Desk',
        coverImage: '/assets/holidays/dest-mombasa.jpg',
        status: 'published',
        featured: false,
        readMinutes: 3,
        content: `Flying domestically between Nairobi, Mombasa, Diani (Ukunda), Kisumu, Eldoret, Malindi, and Lamu saves hours on the road — especially during festive seasons and long weekends.

1. Check JKIA (NBO) vs. Wilson Airport (WIL)
Full-size jets (Kenya Airways, Jambojet) typically depart from JKIA, while coastal and safari flights to Ukunda, Lamu, Malindi, and Maasai Mara frequently operate out of Wilson Airport.

2. Mind Checked vs. Cabin Baggage Limits
Standard jet flights commonly include 15–23 kg checked baggage plus cabin luggage, while smaller bush aircraft have stricter soft-bag limits. Always confirm baggage before departure.

3. Book Holiday & Festival Weekends Early
Coastal and Kisumu routes fill up quickly around December holidays, Easter, and major festival dates. Locking your itinerary early helps secure lower fare classes.

4. Keep Your Booking Reference & ID Handy
Arrive at domestic departures at least 60–90 minutes before boarding with your National ID or passport matching the passenger name on your reservation.`
    },
    {
        slug: 'organizer-checklist-sell-out-your-next-kenyan-event',
        title: 'Organizer Checklist: How to Launch & Sell Out Your Next Event',
        excerpt: 'From crisp event posters and tiered Early Bird pricing to fast QR gate check-in, here is how Kenyan event organizers run smoother shows.',
        category: 'Events',
        author: 'Ticketsassa Editorial',
        coverImage: '/assets/real/back-and-forth-party.jpg',
        status: 'published',
        featured: false,
        readMinutes: 4,
        content: `Whether you are hosting an intimate rooftop session in Westlands, a coastal beach party, or a county stadium concert, smooth ticketing builds instant trust with attendees.

Set Clear Ticket Tiers Early
Launch with a limited Early Bird allocation to reward early buyers and generate momentum, followed by Advance, Gate, and VIP or Group tables.

Use High-Impact Event Artwork
Clear typography showing the event title, date, venue, and headline acts converts far better when shared on WhatsApp Status and Instagram Stories.

Prepare Your Gate Check-In Team
Every ticket purchased on Ticketsassa generates a unique, single-use QR pass. Using our Staff Check-In scanner prevents duplicate screenshots and keeps entry lines moving smoothly at peak hours.`
    }
];

let seededCheckDone = false;

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 90);
}

function estimateReadMinutes(content) {
    const words = String(content || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.min(30, Math.ceil(words / 200)));
}

function sanitizeImage(raw) {
    if (!raw || typeof raw !== 'string') return '/assets/holidays/beach-holidays.jpg';
    const trimmed = raw.trim();
    if (!trimmed) return '/assets/holidays/beach-holidays.jpg';
    if (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length <= 1400000) {
        return trimmed;
    }
    if (trimmed.startsWith('/assets/')) return trimmed;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
    } catch {}
    return '/assets/holidays/beach-holidays.jpg';
}

async function ensureStarterPosts() {
    if (!isConnected() || seededCheckDone) return;
    seededCheckDone = true;
    try {
        const count = await BlogPost.countDocuments();
        if (count === 0) {
            const now = Date.now();
            await BlogPost.insertMany(
                STARTER_POSTS.map((p, idx) => ({
                    ...p,
                    publishedAt: new Date(now - idx * 86400000)
                }))
            );
        }
    } catch (err) {
        seededCheckDone = false;
        console.warn('Could not seed starter blog posts:', err.message);
    }
}

// ---------------------------------------------------------------------------
// PUBLIC ROUTES (/api/blog)
// ---------------------------------------------------------------------------
publicBlogRouter.get('/', route(async (req, res) => {
    const { category = '', q = '' } = req.query || {};
    if (!isConnected()) {
        const list = STARTER_POSTS.filter(p => {
            if (category && category !== 'all' && p.category.toLowerCase() !== String(category).toLowerCase()) return false;
            if (q && ![p.title, p.excerpt, p.content, p.category].join(' ').toLowerCase().includes(String(q).toLowerCase())) return false;
            return true;
        });
        return res.json({ data: list, categories: BLOG_CATEGORIES, storageAvailable: false });
    }

    await ensureStarterPosts();
    const filter = { status: 'published' };
    if (category && category !== 'all' && BLOG_CATEGORIES.includes(String(category))) {
        filter.category = String(category);
    }
    if (q && String(q).trim()) {
        const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [{ title: rx }, { excerpt: rx }, { content: rx }, { category: rx }, { author: rx }];
    }
    const posts = await BlogPost.find(filter).sort({ featured: -1, publishedAt: -1, createdAt: -1 }).limit(60).lean();
    res.set('Cache-Control', req.query.fresh === '1' ? 'no-store' : 'public, max-age=15, stale-while-revalidate=60')
        .json({ data: posts, categories: BLOG_CATEGORIES, storageAvailable: true });
}));

publicBlogRouter.get('/:slug', route(async (req, res) => {
    const slug = slugify(req.params.slug);
    if (!slug) return res.status(400).json({ message: 'Invalid article slug.' });
    if (!isConnected()) {
        const fallback = STARTER_POSTS.find(p => p.slug === slug);
        if (!fallback) return res.status(404).json({ message: 'Article not found.' });
        return res.json({ data: fallback });
    }
    await ensureStarterPosts();
    const post = await BlogPost.findOne({ slug, status: 'published' }).lean();
    if (!post) return res.status(404).json({ message: 'Article not found.' });
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=60').json({ data: post });
}));

// ---------------------------------------------------------------------------
// ADMIN ROUTES (/api/admin/blog)
// ---------------------------------------------------------------------------
adminBlogRouter.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('X-Admin-Action') !== 'dashboard') {
        return res.status(403).json({ message: 'Admin action header required.' });
    }
    next();
});

adminBlogRouter.get('/', route(async (req, res) => {
    if (!isConnected()) {
        return res.json({ data: STARTER_POSTS, categories: BLOG_CATEGORIES, storageAvailable: false });
    }
    await ensureStarterPosts();
    const posts = await BlogPost.find({}).sort({ updatedAt: -1, createdAt: -1 }).limit(100).lean();
    res.set('Cache-Control', 'no-store').json({ data: posts, categories: BLOG_CATEGORIES, storageAvailable: true });
}));

adminBlogRouter.post('/', express.json({ limit: '2mb' }), route(async (req, res) => {
    if (!isConnected()) return res.status(503).json({ message: 'Database offline. Connect MongoDB before saving articles.' });
    const { title, excerpt, content, category, author, coverImage, status, featured } = req.body || {};
    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    const cleanContent = typeof content === 'string' ? content.trim() : '';
    if (!cleanTitle || cleanTitle.length > 180) {
        return res.status(400).json({ message: 'Enter an article title (up to 180 characters).' });
    }
    if (!cleanContent || cleanContent.length < 20) {
        return res.status(400).json({ message: 'Write at least 20 characters of article content.' });
    }
    const cleanCategory = BLOG_CATEGORIES.includes(category) ? category : 'Events';
    const cleanStatus = status === 'draft' ? 'draft' : 'published';
    const cleanExcerpt = (typeof excerpt === 'string' && excerpt.trim())
        ? excerpt.trim().slice(0, 500)
        : cleanContent.replace(/\s+/g, ' ').slice(0, 180) + (cleanContent.length > 180 ? '…' : '');
    let baseSlug = slugify(req.body?.slug || cleanTitle) || ('post-' + randomBytes(4).toString('hex'));
    if (await BlogPost.exists({ slug: baseSlug })) {
        baseSlug = `${baseSlug}-${randomBytes(2).toString('hex')}`;
    }

    const created = await BlogPost.create({
        slug: baseSlug,
        title: cleanTitle,
        excerpt: cleanExcerpt,
        content: cleanContent.slice(0, 30000),
        category: cleanCategory,
        author: (typeof author === 'string' && author.trim()) ? author.trim().slice(0, 80) : 'Ticketsassa Editorial',
        coverImage: sanitizeImage(coverImage),
        status: cleanStatus,
        featured: Boolean(featured),
        readMinutes: estimateReadMinutes(cleanContent),
        publishedAt: cleanStatus === 'published' ? new Date() : null
    });
    res.status(201).json({ success: true, data: created });
}));

adminBlogRouter.put('/:id', express.json({ limit: '2mb' }), route(async (req, res) => {
    if (!isConnected()) return res.status(503).json({ message: 'Database offline. Connect MongoDB before updating articles.' });
    const existing = await BlogPost.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Article not found.' });

    const { title, excerpt, content, category, author, coverImage, status, featured } = req.body || {};
    if (typeof title === 'string' && title.trim()) existing.title = title.trim().slice(0, 180);
    if (typeof content === 'string' && content.trim()) {
        existing.content = content.trim().slice(0, 30000);
        existing.readMinutes = estimateReadMinutes(existing.content);
    }
    if (typeof excerpt === 'string') {
        existing.excerpt = excerpt.trim()
            ? excerpt.trim().slice(0, 500)
            : existing.content.replace(/\s+/g, ' ').slice(0, 180);
    }
    if (BLOG_CATEGORIES.includes(category)) existing.category = category;
    if (typeof author === 'string' && author.trim()) existing.author = author.trim().slice(0, 80);
    if (coverImage !== undefined) existing.coverImage = sanitizeImage(coverImage);
    if (status === 'published' || status === 'draft') {
        if (status === 'published' && !existing.publishedAt) existing.publishedAt = new Date();
        existing.status = status;
    }
    if (typeof featured === 'boolean') existing.featured = featured;

    await existing.save();
    res.json({ success: true, data: existing });
}));

adminBlogRouter.delete('/:id', route(async (req, res) => {
    if (!isConnected()) return res.status(503).json({ message: 'Database offline.' });
    const deleted = await BlogPost.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Article not found.' });
    res.json({ success: true });
}));

module.exports = { publicBlogRouter, adminBlogRouter, STARTER_POSTS, slugify, estimateReadMinutes, sanitizeImage };
