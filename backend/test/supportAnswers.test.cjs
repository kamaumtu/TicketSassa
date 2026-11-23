const { test } = require('node:test');
const assert = require('node:assert/strict');
const { answer } = require('../../frontend/support-answers');
test('support answers do not confuse refunds, payment failures and ticket lookup', () => {
    const refund = answer('I need a refund for my ticket');
    assert.match(refund.text, /supplier’s terms/); assert.doesNotMatch(refund.text, /Demo orders|do not charge/);
    assert.ok(refund.actions.some(a => a.id === 'contact'));
    assert.match(answer('I paid but no ticket').text, /before paying again/);
    assert.match(answer('payment failed for my ticket').text, /before retrying/);
    assert.ok(answer('Where is my ticket QR code?').actions.some(a => a.id === 'orders'));
});
test('status answers distinguish an unavailable service, disconnected database and live checkout', () => {
    assert.match(answer('service status').text, /could not verify/);
    assert.match(answer('service status', { health: { database: 'disconnected' } }).text, /database is reconnecting/);
    const live = answer('service status', { health: { database: 'connected', checkout: { mode: 'live' } } });
    assert.match(live.text, /does not confirm an individual payment/);
    assert.match(answer('M-Pesa checkout', { health: { checkout: { mode: 'unavailable' } } }).text, /currently unavailable/);
});
test('login guidance uses provider configuration without promising an email or Google sign-in', () => {
    const disabled = answer('login help', { auth: { storageAvailable: true, google: false, confirmationEmail: false } });
    assert.match(disabled.text, /Google sign-in is not configured/);
    assert.match(disabled.text, /Confirmation-email delivery is not configured/);
    assert.match(answer('login', { auth: { storageAvailable: false } }).text, /database connection/);
});
test('travel and fallback answers offer useful navigation without inventing bookings', () => {
    const travel = answer('holiday tickets');
    assert.ok(travel.actions.some(a => a.id === 'holidays'));
    assert.match(travel.text, /saved itinerary is a plan/);
    assert.match(answer('Jaza Jaza instalments').text, /cannot promise an instalment plan/);
    assert.ok(answer('something else').actions.some(a => a.id === 'contact'));
});
test('obvious secrets are flagged for redaction', () => {
    assert.equal(answer('my PIN is 1234').sensitive, true);
    assert.equal(answer('password: supersecret').sensitive, true);
    assert.equal(answer('card 4242424242424242').sensitive, true);
    assert.notEqual(answer('forgot password').sensitive, true);
});
