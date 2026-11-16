const path = require('node:path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function verifyAtlas() {
    const uri = process.env.MONGODB_URI?.trim();
    if (!uri || !/^mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?[^/]+\.mongodb\.net(?::\d+)?(?:[,/]|$)/i.test(uri)) {
        console.error('Set MONGODB_URI in backend/.env to your Atlas connection string.');
        process.exitCode = 1;
        return;
    }

    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
        await mongoose.connection.db.command({ ping: 1 });
        console.log('MongoDB Atlas connection verified.');
    } catch (error) {
        console.error('Atlas connection failed (' + error.name + '). Check the connection string, database user and Atlas network access.');
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

void verifyAtlas();
