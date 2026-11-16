const { collection } = require('./commerceDb');
const { isConnected } = require('../config/db');
const { createPaymentGateways } = require('./payment-gateways');

const settingsKey = 'mpesa';

function settingsCollection() {
    if (!isConnected()) {
        throw Object.assign(new Error('Payment settings are temporarily unavailable.'), { status: 503 });
    }
    return collection('commerce_settings');
}

async function getPaymentSettings() {
    const stored = await settingsCollection().findOne({ _id: settingsKey });
    const options = createPaymentGateways().available().map(option => ({
        ...option, name: option.id === 'nexuspay' ? 'Makamesco (Nexus Pay)' : option.name
    }));
    return { provider: stored?.provider ?? options.find(option => option.configured)?.id ?? null, options };
}

async function setPaymentProvider(provider, actor) {
    const settings = await getPaymentSettings();
    if (!settings.options.some(option => option.id === provider && option.configured)) {
        throw Object.assign(new Error('Choose a configured M-Pesa provider.'), { status: 400 });
    }
    await settingsCollection().updateOne({ _id: settingsKey },
        { $set: { provider, updatedAt: new Date(), updatedBy: actor } }, { upsert: true });
    return { ...settings, provider };
}

module.exports = { getPaymentSettings, setPaymentProvider };
