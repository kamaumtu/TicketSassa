const mongoose = require('mongoose');

const isConnected = () => mongoose.connection.readyState === 1;

const connectDB = async () => {
    if (isConnected()) {
        console.log('[*] MongoDB is already connected.');
        return;
    }

    const uri = process.env.MONGODB_URI;

    if (!uri) {
        console.warn('[!] WARNING: MONGODB_URI is not set in backend/.env.');
        return;
    }

    try {
        console.log('[*] Connecting to MongoDB...');
        const conn = await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000, // Timeout after 5s if Atlas credentials / IP whitelist are invalid
        });

        console.log(`[+] MongoDB Connected Successfully: ${conn.connection.host}`);
    } catch (error) {
        console.error(`[-] MongoDB Connection Failed: ${error.message}`);
    }
};

module.exports = { connectDB, isConnected };
