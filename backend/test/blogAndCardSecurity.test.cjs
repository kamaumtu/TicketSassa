const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const { cardGatewayConfig, initiateCardCheckout, verifyCardCheckout } = require('../src/services/cardPayments');
const { getPromo } = require('../src/services/promos');
const { BlogPost, BLOG_CATEGORIES } = require('../src/models/BlogPost');
const { STARTER_POSTS, slugify, estimateReadMinutes, sanitizeImage } = require('../src/routes/blogRoutes');

function withEnv(overrides, fn) {
    const prev = {};
    for (const key of Object.keys(overrides)) {
        prev[key] = process.env[key];
        if (overrides[key] === undefined) delete process.env[key];
        else process.env[key] = overrides[key];
    }
    const restore = () => {
        for (const key of Object.keys(overrides)) {
            if (prev[key] === undefined) delete process.env[key];
            else process.env[key] = prev[key];
        }
    };
    try {
        const res = fn();
        if (res && typeof res.then === 'function') {
            return res.finally(restore);
        }
        restore();
        return res;
    } catch (err) {
        restore();
        throw err;
    }
}

test('cardPayments blocks unconfigured demo_card in PAYMENT_MODE=live', async () => {
    await withEnv({
        NODE_ENV: 'development',
        PAYMENT_MODE: 'live',
        PAYSTACK_SECRET_KEY: undefined,
        FLUTTERWAVE_SECRET_KEY: undefined
    }, async () => {
        const cfg = cardGatewayConfig();
        assert.equal(cfg.configured, false);
        assert.equal(cfg.enabled, false);
        assert.equal(cfg.provider, null);

        await assert.rejects(
            () => initiateCardCheckout({
                order: { orderReference: 'ORD-LIVE-1', totalKes: 2000, customer: { email: 'a@b.co', name: 'Test', phone: '254712345678' } },
                callbackUrl: 'https://ticketsassa.ticketsassa.workers.dev/'
            }),
            (err) => err && err.status === 503
        );

        const verify = await verifyCardCheckout({
            provider: 'demo_card',
            reference: 'CARD-ORD-LIVE-1',
            expectedAmountKes: 2000
        });
        assert.equal(verify.verified, false);
    });
});

test('cardPayments blocks unconfigured demo_card in NODE_ENV=production', async () => {
    await withEnv({
        NODE_ENV: 'production',
        PAYMENT_MODE: 'demo',
        PAYSTACK_SECRET_KEY: undefined,
        FLUTTERWAVE_SECRET_KEY: undefined
    }, async () => {
        const cfg = cardGatewayConfig();
        assert.equal(cfg.configured, false);
        assert.equal(cfg.enabled, false);
        assert.equal(cfg.provider, null);

        const verify = await verifyCardCheckout({
            provider: 'demo_card',
            reference: 'CARD-PROD-TEST',
            expectedAmountKes: 500
        });
        assert.equal(verify.verified, false);
    });
});

test('cardPayments enables Paystack when PAYSTACK_SECRET_KEY is configured in live production', () => {
    withEnv({
        NODE_ENV: 'production',
        PAYMENT_MODE: 'live',
        PAYSTACK_SECRET_KEY: 'sk_live_dummy_key',
        FLUTTERWAVE_SECRET_KEY: undefined
    }, () => {
        const cfg = cardGatewayConfig();
        assert.equal(cfg.configured, true);
        assert.equal(cfg.enabled, true);
        assert.equal(cfg.provider, 'paystack');
    });
});

test('promos customOnly blocks built-in demo codes while still allowing them in demo mode', () => {
    assert.equal(getPromo('TALANTA10', 'event', { customOnly: true }), null);
    const demoPromo = getPromo('TALANTA10', 'event', { customOnly: false });
    assert.equal(demoPromo?.discountPercent, 10);
});

test('blogRoutes helpers sanitize slugs, read times, and cover images safely', () => {
    assert.equal(slugify('Hello Kenya!! 2026 — Events & Fun'), 'hello-kenya-2026-events-fun');
    assert.equal(estimateReadMinutes('one two three'), 1);
    assert.equal(estimateReadMinutes(Array(450).fill('word').join(' ')), 3);

    assert.equal(sanitizeImage('/assets/real/back-to-rock-5.jpg'), '/assets/real/back-to-rock-5.jpg');
    assert.equal(sanitizeImage('https://example.com/poster.webp'), 'https://example.com/poster.webp');
    assert.equal(sanitizeImage('data:image/webp;base64,UklGRh4AAABXRUJQVlA4'), 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4');
    // Dangerous schemes and SVG data URLs fall back safely
    assert.equal(sanitizeImage('javascript:alert(1)'), '/assets/holidays/beach-holidays.jpg');
    assert.equal(sanitizeImage('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), '/assets/holidays/beach-holidays.jpg');
});

test('STARTER_POSTS are well-formed and reference existing local frontend assets', () => {
    assert.ok(STARTER_POSTS.length >= 4);
    const seen = new Set();
    const frontendDir = resolve(__dirname, '..', '..', 'frontend');
    for (const post of STARTER_POSTS) {
        assert.ok(post.slug && !seen.has(post.slug), `Duplicate or missing slug: ${post.slug}`);
        seen.add(post.slug);
        assert.ok(BLOG_CATEGORIES.includes(post.category), `Invalid category: ${post.category}`);
        assert.ok(post.title.length >= 10);
        assert.ok(post.content.length >= 100);
        if (post.coverImage.startsWith('/assets/')) {
            const abs = resolve(frontendDir, post.coverImage.slice(1));
            assert.ok(existsSync(abs), `Missing starter blog image on disk: ${abs}`);
        }
        const doc = new BlogPost(post);
        const err = doc.validateSync();
        assert.equal(err, undefined, `BlogPost validation failed for ${post.slug}: ${err?.message}`);
    }
});
