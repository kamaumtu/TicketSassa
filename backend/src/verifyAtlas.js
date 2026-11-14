const path = require('node:path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function verifyAtlas() {
    const uri = process.env.MONGODB_URI?.trim();
    if (!uri?.startsWith('mongodb+srv://')) {
        console.error('Set MONGODB_URI in backend/.env to your Atlas SRV connection string.');
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
