const { collection } = require('./commerceDb');
const { isConnected } = require('../config/db');
const { createPaymentGateways } = require('./payment-gateways');

const settingsKey = 'mpesa';
let cachedStored = null;
let cachedAt = 0;

function settingsCollection() {
    return collection('commerce_settings');
}

async function getPaymentSettings() {
    const storageAvailable = isConnected();
    let stored = cachedStored;
    if (storageAvailable && Date.now() - cachedAt > 30000) {
        try {
            stored = await settingsCollection().findOne({ _id: settingsKey }, { maxTimeMS: 5000 });
            cachedStored = stored;
            cachedAt = Date.now();
        } catch {
            // Keep last known provider setting during transient network latency
        }
    }
    const options = createPaymentGateways().available().map(option => ({
        ...option, name: option.id === 'nexuspay' ? 'Makamesco (Nexus Pay)' : option.name
    }));
    return { provider: stored?.provider ?? options.find(option => option.configured)?.id ?? null, options, storageAvailable };
}

async function setPaymentProvider(provider, actor) {
    const settings = await getPaymentSettings();
    if (!settings.options.some(option => option.id === provider && option.configured)) {
        throw Object.assign(new Error('Choose a configured M-Pesa provider.'), { status: 400 });
    }
    await settingsCollection().updateOne({ _id: settingsKey },
        { $set: { provider, updatedAt: new Date(), updatedBy: actor } }, { upsert: true });
    cachedStored = { _id: settingsKey, provider };
    cachedAt = Date.now();
    return { ...settings, provider };
}

module.exports = { getPaymentSettings, setPaymentProvider };
