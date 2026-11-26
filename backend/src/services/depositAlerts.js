const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');

const depositBus = new EventEmitter();
depositBus.setMaxListeners(50);

const recent = [];
const MAX_RECENT = 50;

function recordDepositInitiated({ orderReference, customerName, customerPhone, totalKes, provider, itemsSummary, mode }) {
    const entry = {
        id: randomUUID(),
        orderReference: String(orderReference || ''),
        customerName: String(customerName || 'Customer').slice(0, 120),
        customerPhone: String(customerPhone || '').slice(0, 24),
        totalKes: Number(totalKes) || 0,
        provider: String(provider || 'mpesa'),
        mode: String(mode || 'live'),
        itemsSummary: String(itemsSummary || 'Ticket Order').slice(0, 200),
        initiatedAt: new Date().toISOString()
    };
    recent.unshift(entry);
    if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
    depositBus.emit('deposit', entry);
    return entry;
}

function emitDepositEvent(eventName, payload) {
    depositBus.emit('deposit_event', { event: eventName, payload, timestamp: new Date().toISOString() });
}

function getRecentDeposits(limit = 25) {
    return recent.slice(0, Math.max(1, Math.min(limit, MAX_RECENT)));
}

module.exports = { depositBus, recordDepositInitiated, emitDepositEvent, getRecentDeposits };
