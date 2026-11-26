const test = require('node:test');
const assert = require('node:assert/strict');
const {
    formatWhatsAppUrl,
    cleanEmail,
    cleanPhone,
    cleanHours,
    getSupportSettings,
    clearSupportSettingsCache
} = require('../src/services/supportSettings');

test('supportSettings normalizes Kenyan and international WhatsApp numbers to wa.me links', () => {
    assert.equal(formatWhatsAppUrl('0712 345 678'), 'https://wa.me/254712345678');
    assert.equal(formatWhatsAppUrl('+254 712 345 678'), 'https://wa.me/254712345678');
    assert.equal(formatWhatsAppUrl('0110 223 344'), 'https://wa.me/254110223344');
    assert.equal(formatWhatsAppUrl('712345678'), 'https://wa.me/254712345678');
    assert.equal(formatWhatsAppUrl(''), null);
});

test('supportSettings validates email, phone, and hours cleanly', () => {
    assert.equal(cleanEmail('help@ticketsassa.co.ke'), 'help@ticketsassa.co.ke');
    assert.equal(cleanEmail('   '), null);
    assert.throws(() => cleanEmail('not-an-email'), { status: 400 });

    assert.equal(cleanPhone('+254 700 123 456'), '+254 700 123 456');
    assert.equal(cleanPhone(''), null);
    assert.throws(() => cleanPhone('123'), { status: 400 });

    assert.equal(cleanHours('Daily 8am - 8pm'), 'Daily 8am - 8pm');
    assert.equal(cleanHours(''), null);
});

test('getSupportSettings falls back to environment variables when database is disconnected', async () => {
    const prev = {
        SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
        SUPPORT_PHONE: process.env.SUPPORT_PHONE,
        SUPPORT_WHATSAPP: process.env.SUPPORT_WHATSAPP,
        SUPPORT_HOURS: process.env.SUPPORT_HOURS
    };
    try {
        process.env.SUPPORT_EMAIL = 'desk@example.com';
        process.env.SUPPORT_PHONE = '+254 711 000 111';
        process.env.SUPPORT_WHATSAPP = '0711000111';
        process.env.SUPPORT_HOURS = 'Mon-Sat 8am-6pm';
        clearSupportSettingsCache();

        const res = await getSupportSettings(true);
        assert.equal(res.email, 'desk@example.com');
        assert.equal(res.phone, '+254 711 000 111');
        assert.equal(res.whatsapp, '0711000111');
        assert.equal(res.whatsappUrl, 'https://wa.me/254711000111');
        assert.equal(res.hours, 'Mon-Sat 8am-6pm');
    } finally {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        clearSupportSettingsCache();
    }
});
