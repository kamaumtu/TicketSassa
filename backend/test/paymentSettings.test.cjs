const { test } = require('node:test');
const assert = require('node:assert/strict');
let connected = true;
let stored = null;
let writes = 0;
require('../src/config/db');
require.cache[require.resolve('../src/config/db')].exports = { isConnected: () => connected };
require('../src/services/commerceDb');
require.cache[require.resolve('../src/services/commerceDb')].exports = {
    collection: () => ({ findOne: async () => stored, updateOne: async (filter, change) => { writes++; stored = { ...filter, ...change.$set }; } })
};
require('../src/services/payment-gateways');
require.cache[require.resolve('../src/services/payment-gateways')].exports = {
    createPaymentGateways: () => ({ available: () => [
        { id: 'payhero', name: 'PayHero', configured: true }, { id: 'nexuspay', name: 'Nexus Pay', configured: true },
        { id: 'missing', name: 'Missing', configured: false }
    ] })
};
const settings = require('../src/services/paymentSettings');
test('admin provider changes persist and reject invalid or offline saves', async () => {
    for (const provider of ['payhero', 'nexuspay']) {
        const result = await settings.setPaymentProvider(provider, 'admin-fixture');
        assert.equal(result.provider, provider); assert.equal(stored.provider, provider);
        assert.equal(stored.updatedBy, 'admin-fixture'); assert.equal((await settings.getPaymentSettings()).provider, provider);
    }
    await assert.rejects(settings.setPaymentProvider('missing', 'admin-fixture'), { status: 400 });
    await assert.rejects(settings.setPaymentProvider('unknown', 'admin-fixture'), { status: 400 });
    connected = false;
    await assert.rejects(settings.setPaymentProvider('payhero', 'admin-fixture'), { status: 503 });
    assert.equal(writes, 2); assert.equal((await settings.getPaymentSettings()).provider, 'nexuspay');
    assert.equal((await settings.getPaymentSettings()).storageAvailable, false);
});
