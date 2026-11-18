const mongoose = require('mongoose');

const isConnected = () => mongoose.connection.readyState === 1;
let pendingConnection;

const connectDB = () => {
    if (isConnected()) {
        return Promise.resolve();
    }
    if (pendingConnection) return pendingConnection;

    const uri = process.env.MONGODB_URI;

    if (!uri) {
        console.warn('[!] WARNING: MONGODB_URI is not set in backend/.env.');
        return Promise.resolve();
    }

    console.log('[*] Connecting to MongoDB...');
    pendingConnection = mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        heartbeatFrequencyMS: 10000,
        maxIdleTimeMS: 60000,
        bufferCommands: false
    }).then(() => {
        console.log('[+] MongoDB connected.');
    }).catch(error => {
        console.error('MongoDB connection failed:', error.name, error.code || 'network-or-access');
    }).finally(() => { pendingConnection = undefined; });
    return pendingConnection;
};

module.exports = { connectDB, isConnected };
