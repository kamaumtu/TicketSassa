const mongoose = require('mongoose');

let clientInitialized = false;

mongoose.connection.on('connected', () => {
    clientInitialized = true;
});

mongoose.connection.on('reconnected', () => {
    clientInitialized = true;
});

// Keep NAT mappings warm without congesting the pool
setInterval(() => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
        mongoose.connection.db.admin().ping().catch(() => {});
    }
}, 25000).unref();

const isConnected = () => mongoose.connection.readyState === 1;

let pendingConnection;

const connectDB = () => {
    if (isConnected()) {
        return Promise.resolve();
    }
    if (pendingConnection) return pendingConnection;
    if (mongoose.connection.readyState === 2 || (clientInitialized && mongoose.connection.getClient())) {
        return Promise.resolve();
    }

    const uri = process.env.MONGODB_URI;

    if (!uri) {
        console.warn('[!] WARNING: MONGODB_URI is not set in backend/.env.');
        return Promise.resolve();
    }

    console.log('[*] Connecting to MongoDB...');
    pendingConnection = mongoose.connect(uri, {
        family: 4,
        serverMonitoringMode: 'poll',
        heartbeatFrequencyMS: 30000,
        serverSelectionTimeoutMS: 15000,
        connectTimeoutMS: 15000,
        socketTimeoutMS: 25000,
        waitQueueTimeoutMS: 0,
        minPoolSize: 0,
        maxPoolSize: 10,
        maxConnecting: 2,
        maxIdleTimeMS: 0,
        retryReads: true,
        retryWrites: true,
        bufferCommands: false
    }).then(() => {
        clientInitialized = true;
        console.log('[+] MongoDB connected.');
    }).catch(error => {
        clientInitialized = false;
        console.error('MongoDB connection failed:', error.name, error.code || 'network-or-access');
    }).finally(() => { pendingConnection = undefined; });
    return pendingConnection;
};

module.exports = { connectDB, isConnected };
