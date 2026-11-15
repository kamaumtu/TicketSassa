require('dotenv').config();
const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const { resolve } = require('node:path');
const cors = require('cors');
const { checkoutMode, createIndexes } = require('./services/commerceDb');
const { connectDB, isConnected } = require('./config/db');

// Import Route Handlers
const eventRoutes = require('./routes/eventRoutes');
const zoneRoutes = require('./routes/zoneRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const passRoutes = require('./routes/passRoutes');
const merchRoutes = require('./routes/merchRoutes');

const app = express();
app.locals.eventCatalog = eventRoutes.catalog;
const PORT = process.env.PORT || 8000;

// Connect to MongoDB Atlas (with graceful fallback)
connectDB().then(async () => {
    if (isConnected()) await createIndexes();
    await app.locals.eventCatalog.start();
}).catch(error => {
    console.error('Could not initialize booking storage:', error.message);
});

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use('/api/published-events', require('./routes/publishedEvents').router);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logger
app.use((req, res, next) => {
    const path = req.path.replace(/^(\/api\/passes\/(?:verify|redeem|qr)\/).+$/, '$1[redacted]');
    console.log(`[${new Date().toISOString()}] ${req.method} ${path}`);
    next();
});

// Root Health & API Discovery Check
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'UP',
        service: 'Talanta × Ticketsasa × HustleSasa Unified Backend API',
        environment: process.env.NODE_ENV || 'development',
        database: isConnected() ? 'connected' : 'disconnected',
        checkout: { mode: checkoutMode(), livePayments: checkoutMode() === 'live' },
        capabilities: [
            'Ticketsasa Event & Pass Ticketing',
            'Talanta seating previews',
            'HustleSasa Creator Storefront & Merch Bundles',
            'Turnstile Gate Scanner Verification'
        ],
        timestamp: new Date().toISOString()
    });
});

// Mount Routes
app.use('/api/events', eventRoutes);
app.use('/api/zones', zoneRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/passes', passRoutes);
app.use('/api/merch', merchRoutes);

// Serve the standalone client and its public assets from the API origin.
const publicRoot = resolve(__dirname, '../..');
app.get('/', (req, res) => res.sendFile('index.html', { root: publicRoot }));
function privateTool(keyName, realm) {
    return (req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        const key = process.env[keyName];
        const scanner = keyName === 'PASS_SCANNER_KEY' && process.env.PASS_SCANNER_ACCOUNTS;
        if (!key && !scanner) return res.sendStatus(404);

        const credentials = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(req.get('Authorization') || '');
        if (credentials) {
            const decoded = Buffer.from(credentials[1], 'base64');
            if (scanner) {
                const text = decoded.toString('utf8');
                if (text.startsWith('admin:') &&
                    require('./services/scannerAccess').authenticateScanner('Bearer ' + text.slice(6))) return next();
            }
            const expected = Buffer.from('admin:' + key);
            if (!scanner && decoded.length === expected.length && timingSafeEqual(decoded, expected)) return next();
        }
        res.set('WWW-Authenticate', 'Basic realm="' + realm + '", charset="UTF-8"');
        res.sendStatus(401);
    };
}

const { organizerIdentity } = require('./services/organizerAccess');
function adminOnly(req, res, next) {
    res.set('Cache-Control', 'private, no-store');
    if (!process.env.ORGANIZER_ACCOUNTS && !process.env.ORGANIZER_KEY) return res.sendStatus(404);
    req.organizerId = organizerIdentity(req.get('Authorization'));
    if (req.organizerId) return next();
    res.set('WWW-Authenticate', 'Basic realm="Event publishing", charset="UTF-8"');
    return res.sendStatus(401);
}
app.use('/api/admin', adminOnly, require('./routes/admin'));
app.use('/admin-ui', adminOnly, express.static(resolve(publicRoot, 'admin-ui/dist'), { index: false }));
app.get('/admin', adminOnly, (req, res) => {
    res.sendFile('admin-ui/dist/index.html', { root: publicRoot });
});
app.get('/organizer', adminOnly, (req, res) => {
    res.sendFile('organizer.html', { root: publicRoot });
});
app.get('/staff/check-in', privateTool('PASS_SCANNER_KEY', 'Ticket check-in'), (req, res) => {
    res.sendFile('staff-check-in.html', { root: publicRoot });
});
app.get(['/organizer.js', '/staff-check-in.js', '/app.js', '/styles.css', '/storefront.css', '/frontend-angular/src/kenya-event-catalog.js'], (req, res) => {
    res.sendFile(req.path.slice(1), { root: publicRoot });
});
app.use('/assets', express.static(resolve(publicRoot, 'assets'), { index: false }));

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Endpoint ${req.originalUrl} not found on this server.`
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    if (err.status === 503) return res.status(503).json({ success: false, message: err.message });
    if (err.status >= 400 && err.status < 500) {
        return res.status(err.status).json({ success: false, message: 'Invalid request.' });
    }
    console.error('[-] Server Error:', err.stack);
    res.status(500).json({
        success: false,
        message: 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

app.listen(PORT, () => {
    console.log(`
=====================================================================
🚀 TALANTA × TICKETSASA × HUSTLESASA BACKEND RUNNING
📡 Local Address: http://localhost:${PORT}
🩺 Health Check: http://localhost:${PORT}/api/health
🌐 MongoDB connection status: /api/health
=====================================================================
    `);
});

module.exports = app;
