const { resolve } = require('node:path');
const http = require('node:http');
require('dotenv').config({ path: resolve(__dirname, '../.env') });
const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const cors = require('cors');
const { checkoutMode, createIndexes } = require('./services/commerceDb');
const { connectDB, isConnected } = require('./config/db');
const { initSocketHub } = require('./services/automation/socketHub');
const { startAutomationEngine } = require('./services/automation/discoveryEngine');
const { adminRouter: automationAdminRoutes, publicRouter: automationPublicRoutes } = require('./routes/automation');

// Import Route Handlers
const eventRoutes = require('./routes/eventRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const passRoutes = require('./routes/passRoutes');
const travelRoutes = require('./routes/travelRoutes');
const { router: authRoutes, createAuthIndexes } = require('./routes/auth');

const app = express();
app.set('trust proxy', 1);
app.locals.eventCatalog = eventRoutes.catalog;
require('./services/travelCatalog').start();
setInterval(() => { void require('./services/travelBookings').reconcile().catch(() => {}); }, 60000).unref();
const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

// Start event catalog refresh immediately (with MongoDB or fallback store)
app.locals.eventCatalog.start().catch(err => console.warn('Initial catalog refresh warning:', err.message));

let databaseInitialization;
let databaseReady = false;
let indexesCreated = false;
let lastCatalogSyncAt = 0;

require('mongoose').connection.on('connected', () => {
    databaseReady = true;
});
require('mongoose').connection.on('reconnected', () => {
    databaseReady = true;
    console.log('[+] MongoDB reconnected.');
});
require('mongoose').connection.on('disconnected', () => {
    databaseReady = false;
    console.warn('MongoDB disconnected. Automatic recovery will retry.');
});

function initializeDatabase() {
    if (databaseInitialization) return databaseInitialization;
    databaseInitialization = (async () => {
        await connectDB();
        if (!isConnected()) return;
        if (!indexesCreated) {
            await Promise.all([createIndexes(), createAuthIndexes()]);
            indexesCreated = true;
        }
        if (Date.now() - lastCatalogSyncAt > 5 * 60 * 1000) {
            lastCatalogSyncAt = Date.now();
            await app.locals.eventCatalog.refresh('database-ready');
            await require('./services/travelCatalog').sync('database-ready');
        }
        databaseReady = isConnected();
    })().catch(error => {
        databaseReady = false;
        console.error('Could not initialize booking storage:', error.name);
    }).finally(() => { databaseInitialization = undefined; });
    return databaseInitialization;
}

void initializeDatabase();
setInterval(() => { void initializeDatabase(); }, 15000).unref();
const { reconcilePendingPayments } = require('./controllers/commerceController');
setInterval(() => {
    reconcilePendingPayments().catch(error => console.error('Payment status refresh failed:', error.name));
}, 30000).unref();

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use('/api/published-events', require('./routes/publishedEvents').router);
app.post('/api/admin/events', adminOnly, express.json({ limit: '2mb' }));
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
        service: 'Ticketsassa Backend API',
        environment: process.env.NODE_ENV || 'development',
        database: isConnected() ? 'connected' : 'disconnected',
        checkout: { mode: checkoutMode(), livePayments: checkoutMode() === 'live' },
        capabilities: [
            'Ticketsassa Event & Pass Ticketing',
            'Turnstile Gate Scanner Verification'
        ],
        timestamp: new Date().toISOString()
    });
});

// Mount Routes
app.get('/api/support/contact', (req, res) => {
    const email = String(process.env.SUPPORT_EMAIL || '').trim();
    const phone = String(process.env.SUPPORT_PHONE || '').trim();
    res.set('Cache-Control', 'no-store').json({
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null,
        phone: /^\+?[\d ()-]{7,25}$/.test(phone) ? phone : null
    });
});
app.use('/api/auth', authRoutes);
app.use('/api/me', require('./routes/customerTrips'));
app.use('/api/events', eventRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/passes', passRoutes);
app.use('/api/travel', travelRoutes);
app.use('/api/automation', automationPublicRoutes);

// Serve the standalone client and its public assets from the API origin.
const publicRoot = resolve(__dirname, '../../frontend');
app.get('/', (req, res) => res.sendFile('index.html', { root: publicRoot }));
app.get(['/manifest.webmanifest', '/offline.html', '/install-app.js', '/service-worker.js'], (req, res) => {
    if (req.path === '/manifest.webmanifest') res.type('application/manifest+json');
    if (req.path === '/service-worker.js') res.set('Cache-Control', 'no-cache');
    res.sendFile(req.path.slice(1), { root: publicRoot });
});
app.get('/downloads/ticketsasa.apk', (req, res, next) => {
    res.download(resolve(publicRoot, 'dist/ticketsasa.apk'), 'ticketsasa.apk', {
        headers: { 'Content-Type': 'application/vnd.android.package-archive' }
    }, error => {
        if (!error) return;
        if (error.status === 404 && !res.headersSent) return res.sendStatus(404);
        next(error);
    });
});
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
app.use('/api/admin/automation', adminOnly, automationAdminRoutes);
app.use('/api/admin', adminOnly, require('./routes/admin'));
app.use('/admin-ui', adminOnly, express.static(resolve(publicRoot, 'admin-ui/dist'), { index: false }));
app.get(['/admin', '/admin/publishing', '/admin/travel', '/admin/discovery'], adminOnly, (req, res) => {
    res.sendFile('admin-ui/dist/index.html', { root: publicRoot });
});
app.get('/organizer', adminOnly, (req, res) => {
    res.sendFile('organizer.html', { root: publicRoot });
});
app.get('/staff/check-in', privateTool('PASS_SCANNER_KEY', 'Ticket check-in'), (req, res) => {
    res.sendFile('staff-check-in.html', { root: publicRoot });
});
app.get(['/organizer.js', '/staff-check-in.js', '/app.js', '/support-answers.js', '/support-chat.js', '/travel-offers.js', '/discovered-marketplace.js', '/styles.css', '/storefront.css', '/frontend-angular/src/kenya-event-catalog.js'], (req, res) => {
    res.set('Cache-Control', 'no-cache');
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

const server = http.createServer(app);
initSocketHub(server);
startAutomationEngine(app.locals.eventCatalog);

server.listen(PORT, HOST, () => {
    const nets = require('node:os').networkInterfaces();
    const lanIp = Object.values(nets).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address;
    console.log(`
=====================================================================
🚀 TICKETSASA BACKEND RUNNING (HTTP + SOCKET.IO)
📡 Local Address: http://localhost:${PORT}
🌐 Network Address: ${lanIp ? `http://${lanIp}:${PORT}` : `http://0.0.0.0:${PORT}`}
🩺 Health Check: http://localhost:${PORT}/api/health
🌐 MongoDB connection status: /api/health
=====================================================================
    `);
});

module.exports = app;
