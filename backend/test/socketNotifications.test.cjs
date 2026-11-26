const test = require('node:test');
const assert = require('node:assert/strict');
const { createSocketToken, verifySocketToken, sendTestNotification } = require('../src/services/automation/socketHub');
const { depositBus } = require('../src/services/depositAlerts');
const { DepositRequest } = require('../src/models/automation');

test('createSocketToken and verifySocketToken validate genuine tokens and reject tampered tokens', () => {
    const token = createSocketToken('admin-user');
    assert.equal(verifySocketToken(token), 'admin-user');

    const [payload, sig] = token.split('.');
    const tamperedSig = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    assert.equal(verifySocketToken(`${payload}.${tamperedSig}`), null);
    assert.equal(verifySocketToken(''), null);
    assert.equal(verifySocketToken('not-a-token'), null);
});

test('sendTestNotification emits deposit:test on depositBus for initiated, completed, and failed', () => {
    const received = [];
    const listener = (env) => received.push(env);
    depositBus.on('deposit_event', listener);
    try {
        const a = sendTestNotification('initiated', 'tester');
        const b = sendTestNotification('completed', 'tester');
        const c = sendTestNotification('failed', 'tester');
        assert.equal(a.deposit.status, 'PENDING');
        assert.equal(b.deposit.status, 'COMPLETED');
        assert.equal(b.deposit.mpesaReceipt, 'TEST987654');
        assert.equal(c.deposit.status, 'FAILED');
        assert.equal(received.length, 3);
        assert.deepEqual(received.map(r => r.event), ['deposit:test', 'deposit:test', 'deposit:test']);
    } finally {
        depositBus.off('deposit_event', listener);
    }
});

test('DepositRequest allows empty customerPhone for card checkouts', () => {
    const doc = new DepositRequest({
        reference: 'DEP-2026-999001',
        orderReference: 'ORD-CARD-001',
        customerName: 'Card Buyer',
        customerPhone: '',
        amountKes: 2500,
        method: 'CARD',
        provider: 'paystack'
    });
    const err = doc.validateSync();
    assert.equal(err, undefined);
});
