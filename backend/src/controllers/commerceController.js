const { randomBytes } = require('node:crypto');
const { commerceDb, transaction, soldQuantity, heldQuantity, demoEnabled, checkoutMode, stockKey } = require('../services/commerceDb');
const { getPromo } = require('../services/promos');
const { getTicketCatalog } = require('./ticketController');
const { getMerchCatalog } = require('./merchController');
const Order = require('../models/Order');
const DigitalPass = require('../models/DigitalPass');
const { isConnected } = require('../config/db');

// PayHero and NexusPay Payment Gateway Integration
const { createPaymentGateways, phoneNumber: validateGatewayPhone } = require('../services/payment-gateways');
const { createPayHeroBalanceFetcher } = require('../services/payhero-balance');

const paymentGateways = createPaymentGateways({ env: process.env });
const fetchPayHeroBalance = createPayHeroBalanceFetcher({ env: process.env });

function reject(status, message) {
    throw Object.assign(new Error(message), { status });
}

function handler(action) {
    return async (req, res, next) => {
        try {
            await action(req, res);
        } catch (error) {
            if (error.status) return res.status(error.status).json({ success: false, message: error.message });
            next(error);
        }
    };
}

const token = (prefix) => prefix + randomBytes(16).toString('hex').toUpperCase();
const round = amount => Math.round(amount * 100) / 100;
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function phoneNumber(value) {
    const digits = typeof value === 'string' ? value.trim().replace(/[\s()+-]/g, '') : '';
    const local = digits.replace(/^(254|0)/, '');
    if (!/^[17]\d{8}$/.test(local)) reject(400, 'Enter a valid Kenyan mobile number.');
    return '254' + local;
}

function inventoryKey(kind, key) {
    return kind + ':' + key;
}

async function getInventory(includeClosed = false) {
    const [tickets, merch] = await Promise.all([getTicketCatalog(), getMerchCatalog()]);
    const reserved = includeClosed ? await require('../routes/publishedEvents').reservedTiers().catch(() => []) : [];
    const sellable = includeClosed ? [...tickets, ...reserved] : tickets;
    return new Map([
        ...sellable.map(tier => [inventoryKey('ticket', tier.tierKey), { ...tier, stock: tier.remainingAllocation }]),
        ...merch.map(product => [inventoryKey('merch', product.productKey), product])
    ]);
}

function available(key, item, orderReference) {
    return Math.max(0, item.stock - soldQuantity(key) - heldQuantity(key, orderReference));
}

function getOrder(reference) {
    const row = commerceDb().prepare('SELECT data FROM orders WHERE reference = ?').get(reference);
    return row ? JSON.parse(row.data) : null;
}

function saveOrder(order) {
    commerceDb().prepare('INSERT INTO orders (reference, email, data) VALUES (?, ?, ?) ON CONFLICT(reference) DO UPDATE SET data = excluded.data, email = excluded.email')
        .run(order.orderReference, order.customer.email, JSON.stringify(order));
}

function getPasses(reference) {
    return commerceDb().prepare('SELECT data FROM passes WHERE order_reference = ? ORDER BY rowid')
        .all(reference).map(row => JSON.parse(row.data));
}

function orderSummary(order) {
    const { orderReference, items, currency, totalKes, totalUsd, totalTickets, paymentStatus, promoCode, tipKes, mode, expiresAt, provider, receipt } = order;
    return { orderReference, items, currency, totalKes, totalUsd, totalTickets, paymentStatus, promoCode, tipKes, mode, expiresAt, provider, receipt };
}

function completeOrder(db, order, receipt) {
    const { orderReference } = order;
    const addSale = db.prepare('INSERT INTO sales (product, quantity) VALUES (?, ?) ON CONFLICT(product) DO UPDATE SET quantity = quantity + excluded.quantity');
    const addPass = db.prepare('INSERT INTO passes (token, reference, order_reference, data) VALUES (?, ?, ?, ?)');
    for (const item of order.items) {
        addSale.run(item.key, item.quantity);
        if (item.kind !== 'ticket') continue;
        for (let n = 0; n < item.quantity; n++) {
            const pass = {
                passReference: token('TSASA-'), qrCodeToken: token('PASS-'), orderReference,
                attendeeName: order.customer.name, tierName: item.title, designatedGate: item.designatedGate,
                eventTitle: item.eventTitle || 'Talanta Sports City Live', status: 'VALID', mode: order.mode || 'live'
            };
            addPass.run(pass.qrCodeToken, pass.passReference, orderReference, JSON.stringify(pass));
        }
    }
    db.prepare('DELETE FROM holds WHERE order_reference = ?').run(orderReference);
    order.paymentStatus = 'COMPLETED';
    order.receipt = receipt;
    saveOrder(order);
    return { order, passes: getPasses(orderReference) };
}

exports.getCheckoutMode = (req, res) => res.json({ mode: checkoutMode() });

exports.getPaymentGateways = handler(async (req, res) => {
    const list = paymentGateways.available();
    res.json({
        success: true,
        gateways: [
            ...list,
            { id: 'demo', name: 'Demo STK Push (Simulation)', configured: true }
        ]
    });
});

exports.getPayHeroBalance = handler(async (req, res) => {
    const balance = await fetchPayHeroBalance();
    res.json({ success: true, data: balance });
});

exports.createOrder = handler(async (req, res) => {
    const { customer, items, currency = 'KES', paymentMethod = 'MPESA', promoCode, tipKes = 0 } = req.body;
    const name = typeof customer?.name === 'string' ? customer.name.trim() : '';
    const email = normalizeEmail(customer?.email);
    if (!name || name.length > 120 || !validEmail(email)) reject(400, 'Enter a name and valid email address.');
    const phone = phoneNumber(customer?.phone);
    if (!['KES', 'USD'].includes(currency) || paymentMethod !== 'MPESA') reject(400, 'Choose a supported currency and payment method.');
    if (!Number.isSafeInteger(tipKes) || tipKes < 0 || tipKes > 100000) reject(400, 'Invalid tip amount.');
    const promo = getPromo(promoCode);
    if (promoCode && !promo) reject(400, 'Invalid promo code.');
    if (!Array.isArray(items) || !items.length || items.length > 30) reject(400, 'Select at least one ticket or merchandise item.');

    const inventory = await getInventory();
    const quantities = new Map();
    for (const item of items) {
        const kind = item?.kind ?? 'ticket';
        const id = item?.tierKey ?? item?.productKey;
        const key = inventoryKey(kind, id);
        if (!inventory.has(key) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) reject(400, 'Invalid item or quantity.');
        quantities.set(key, (quantities.get(key) ?? 0) + item.quantity);
    }

    let totalTickets = 0;
    let subtotalKes = 0;
    let subtotalUsd = 0;
    const lines = [];
    for (const [key, quantity] of quantities) {
        const item = inventory.get(key);
        if (quantity > 100) reject(400, 'A single order can include at most 100 of each item.');
        if (quantity > available(key, item)) reject(409, 'Insufficient stock for ' + item.title + '.');
        if (item.tierKey) totalTickets += quantity;
        const subtotalLineKes = round(item.priceKes * quantity);
        const subtotalLineUsd = round(item.priceUsd * quantity);
        subtotalKes += subtotalLineKes;
        subtotalUsd += subtotalLineUsd;
        lines.push({
            key, kind: item.tierKey ? 'ticket' : 'merch', tierKey: item.tierKey, productKey: item.productKey,
            title: item.title, quantity, designatedGate: item.designatedGate, eventTitle: item.eventTitle,
            unitPriceKes: item.priceKes, unitPriceUsd: item.priceUsd,
            subtotalKes: subtotalLineKes, subtotalUsd: subtotalLineUsd
        });
    }

    const factor = (100 - (promo?.discountPercent ?? 0)) / 100;
    const order = {
        orderReference: token('ORD-'), customer: { name, email, phone }, items: lines,
        totalTickets, totalKes: round(subtotalKes * factor + tipKes), totalUsd: round(subtotalUsd * factor + tipKes / 125),
        currency, paymentMethod, paymentStatus: 'PENDING', promoCode: promo?.code, tipKes, mode: 'live', expiresAt: Date.now() + 10 * 60 * 1000
    };
    transaction(db => {
        db.prepare('DELETE FROM holds WHERE expires_at <= ?').run(Date.now());
        for (const line of lines) {
            if (line.quantity > available(line.key, inventory.get(line.key))) reject(409, 'Insufficient stock for ' + line.title + '.');
        }
        db.prepare('INSERT INTO orders (reference, email, data) VALUES (?, ?, ?)')
            .run(order.orderReference, email, JSON.stringify(order));
        const hold = db.prepare('INSERT INTO holds (order_reference, product, quantity, expires_at) VALUES (?, ?, ?, ?)');
        for (const line of lines) hold.run(order.orderReference, line.key, line.quantity, order.expiresAt);
    });
    res.status(201).json({ success: true, data: orderSummary(order) });
});

exports.getOrderByReference = handler(async (req, res) => {
    const order = getOrder(req.params.ref) ||
        (isConnected() ? await Order.findOne({ orderReference: req.params.ref }).lean() : null);
    if (!order) reject(404, 'Order reference not found.');
    res.json({ success: true, data: orderSummary(order) });
});

exports.lookupOrder = handler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const reference = typeof req.body.orderReference === 'string' ? req.body.orderReference.trim().toUpperCase() : '';
    if (!reference || !validEmail(email)) reject(400, 'Enter your order reference and email address.');
    let order = getOrder(reference);
    let passes;
    if (order?.customer.email === email) {
        passes = getPasses(reference);
    } else if (isConnected()) {
        order = await Order.findOne({ orderReference: reference }).lean();
        if (normalizeEmail(order?.customer?.email) === email) passes = await DigitalPass.find({ orderReference: reference }).lean();
    }
    if (!passes) reject(404, 'No order matches that reference and email address.');
    res.json({ success: true, data: orderSummary(order), passes });
});

exports.initiateMpesaStkPush = handler(async (req, res) => {
    const { orderReference, phone, provider = 'payhero' } = req.body;
    if (typeof orderReference !== 'string') reject(400, 'Order reference is required.');
    const phoneNormalized = phoneNumber(phone);

    const isLiveGateway = ['payhero', 'nexuspay'].includes(provider);
    let shouldInitiate = false;

    const order = transaction(db => {
        const stored = getOrder(orderReference);
        if (!stored || stored.customer.phone !== phoneNormalized) reject(404, 'Order not found for this mobile number.');
        if (stored.paymentStatus !== 'COMPLETED' && stored.expiresAt <= Date.now()) reject(410, 'Your ticket hold expired. Start a new checkout.');
        if (stored.paymentStatus === 'FAILED') reject(409, 'This order is no longer payable.');
        if (stored.paymentStatus === 'COMPLETED') reject(409, 'This order has already been paid.');

        stored.paymentStatus = 'PROCESSING';
        stored.provider = provider;

        if (isLiveGateway) {
            db.prepare('UPDATE holds SET expires_at = ? WHERE order_reference = ?')
                .run(Number.MAX_SAFE_INTEGER, orderReference);
            shouldInitiate = true;
        } else {
            stored.checkoutRequestId = token('DEMO-');
        }
        saveOrder(stored);
        return stored;
    });

    if (shouldInitiate) {
        try {
            const deposit = {
                amount: order.totalKes,
                payer_phone: phoneNormalized,
                external_reference: orderReference
            };
            const result = await paymentGateways.initiate(provider, deposit, order.customer.name);
            order.checkoutRequestId = result.checkoutRequestId;
            order.providerReference = result.providerReference;
            saveOrder(order);

            return res.json({
                success: true,
                mode: 'live',
                provider,
                checkoutRequestId: result.checkoutRequestId,
                providerReference: result.providerReference,
                orderReference,
                CustomerMessage: `M-Pesa STK prompt sent to ${phoneNormalized} via ${provider === 'nexuspay' ? 'Nexus Pay' : 'PayHero'}. Enter your PIN on your phone.`
            });
        } catch (err) {
            console.error(`[-] ${provider} initiation failed for order ${orderReference}:`, err.message);
            transaction(db => {
                order.paymentStatus = 'FAILED';
                saveOrder(order);
                db.prepare('DELETE FROM holds WHERE order_reference = ?').run(orderReference);
            });
            reject(err.status || 502, err.message || `Failed to initiate payment via ${provider}.`);
        }
    }

    res.json({
        success: true,
        mode: 'demo',
        provider: 'demo',
        CheckoutRequestID: order.checkoutRequestId,
        ResponseCode: '0',
        CustomerMessage: 'Demo payment ready. No money will be charged.'
    });
});

exports.getPaymentStatus = handler(async (req, res) => {
    const reference = req.params.orderReference?.trim().toUpperCase();
    if (!reference) reject(400, 'Order reference is required.');

    let order = getOrder(reference);
    if (!order) reject(404, 'Order not found.');

    if (order.paymentStatus === 'COMPLETED') {
        const passes = getPasses(reference);
        return res.json({
            success: true,
            status: 'COMPLETED',
            order: orderSummary(order),
            receipt: order.receipt,
            passes
        });
    }

    if (order.paymentStatus === 'PROCESSING' && ['payhero', 'nexuspay'].includes(order.provider)) {
        try {
            const deposit = {
                amount: order.totalKes,
                payer_phone: order.customer.phone,
                external_reference: order.orderReference,
                mpesa_checkout_request_id: order.checkoutRequestId,
                provider_reference: order.providerReference
            };
            const result = await paymentGateways.check(order.provider, deposit);
            if (result.status === 'completed') {
                const completed = transaction(db => {
                    const current = getOrder(reference);
                    if (current.paymentStatus === 'COMPLETED') return { order: current, passes: getPasses(reference) };
                    return completeOrder(db, current, result.receipt || token('REC-'));
                });
                return res.json({
                    success: true,
                    status: 'COMPLETED',
                    order: orderSummary(completed.order),
                    receipt: completed.order.receipt,
                    passes: completed.passes
                });
            } else if (result.status === 'failed' || result.status === 'cancelled') {
                transaction(db => {
                    order.paymentStatus = 'FAILED';
                    saveOrder(order);
                    db.prepare('DELETE FROM holds WHERE order_reference = ?').run(reference);
                });
                return res.json({
                    success: true,
                    status: 'FAILED',
                    reason: result.reason || 'Payment failed or was cancelled.',
                    order: orderSummary(order)
                });
            }
        } catch (err) {
            console.warn(`[!] Status check warning for order ${reference}:`, err.message);
        }
    }

    res.json({
        success: true,
        status: order.paymentStatus,
        order: orderSummary(order)
    });
});

exports.adminCheckPayment = handler(async (req, res) => {
    req.params.orderReference = req.params.reference;
    return exports.getPaymentStatus(req, res, () => {});
});

exports.mpesaCallback = handler(async (req, res) => {
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

exports.payheroCallback = handler(async (req, res) => {
    const tokenHeader = req.query.token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const expectedToken = process.env.PAYHERO_CALLBACK_TOKEN;
    if (expectedToken && tokenHeader && tokenHeader !== expectedToken) {
        reject(403, 'Invalid PayHero callback token.');
    }

    const raw = req.body?.response || req.body;
    if (!raw) reject(400, 'Payload missing.');

    const externalRef = raw.ExternalReference || raw.external_reference;
    const checkoutId = raw.CheckoutRequestID || raw.checkout_request_id;
    const reference = externalRef || checkoutId;

    if (!reference) reject(400, 'Missing reference in callback payload.');

    let order = getOrder(reference);
    if (!order && checkoutId) {
        const row = commerceDb().prepare(`SELECT data FROM orders WHERE json_extract(data, '$.checkoutRequestId') = ?`).get(checkoutId);
        if (row) order = JSON.parse(row.data);
    }

    if (!order) {
        return res.json({ ResultCode: 0, ResultDesc: 'Order not found, ignored.' });
    }

    try {
        const deposit = {
            amount: order.totalKes,
            payer_phone: order.customer.phone,
            external_reference: order.orderReference,
            mpesa_checkout_request_id: order.checkoutRequestId,
            provider_reference: order.providerReference
        };
        const parsed = paymentGateways.parsePayHero(deposit, raw);
        if (parsed.status === 'completed') {
            transaction(db => {
                const current = getOrder(order.orderReference);
                if (current.paymentStatus !== 'COMPLETED') {
                    completeOrder(db, current, parsed.receipt || token('PH-'));
                }
            });
        } else if (parsed.status === 'failed') {
            transaction(db => {
                const current = getOrder(order.orderReference);
                if (current.paymentStatus === 'PROCESSING') {
                    current.paymentStatus = 'FAILED';
                    saveOrder(current);
                    db.prepare('DELETE FROM holds WHERE order_reference = ?').run(order.orderReference);
                }
            });
        }
    } catch (err) {
        console.error('[-] PayHero verification error:', err.message);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

exports.nexuspayCallback = handler(async (req, res) => {
    const raw = req.body;
    if (!raw) reject(400, 'Payload missing.');

    const reference = raw.reference || raw.external_reference;
    const checkoutId = raw.checkoutRequestId;

    let order = reference ? getOrder(reference) : null;
    if (!order && checkoutId) {
        const row = commerceDb().prepare(`SELECT data FROM orders WHERE json_extract(data, '$.checkoutRequestId') = ?`).get(checkoutId);
        if (row) order = JSON.parse(row.data);
    }

    if (!order) {
        return res.json({ success: true, message: 'Order ignored.' });
    }

    const status = String(raw.status || '').toLowerCase();
    if (status === 'completed' || status === 'success') {
        transaction(db => {
            const current = getOrder(order.orderReference);
            if (current.paymentStatus !== 'COMPLETED') {
                completeOrder(db, current, raw.mpesaReceiptNumber || raw.receipt || token('NX-'));
            }
        });
    } else if (['failed', 'cancelled'].includes(status)) {
        transaction(db => {
            const current = getOrder(order.orderReference);
            if (current.paymentStatus === 'PROCESSING') {
                current.paymentStatus = 'FAILED';
                saveOrder(current);
                db.prepare('DELETE FROM holds WHERE order_reference = ?').run(order.orderReference);
            }
        });
    }

    res.json({ success: true, message: 'Nexus Pay callback accepted.' });
});

exports.confirmDemo = handler(async (req, res) => {
    const { orderReference, checkoutRequestId } = req.body;
    if (typeof orderReference !== 'string' || typeof checkoutRequestId !== 'string') reject(400, 'Order and checkout references are required.');
    const inventory = await getInventory(true);
    const result = transaction(db => {
        const order = getOrder(orderReference);
        if (!order || order.checkoutRequestId !== checkoutRequestId) reject(404, 'Checkout reference not found.');
        if (order.paymentStatus === 'COMPLETED') return { order, passes: getPasses(orderReference) };
        if (order.expiresAt <= Date.now()) reject(410, 'Your ticket hold expired. Start a new checkout.');
        if (order.paymentStatus !== 'PROCESSING') reject(409, 'This order is not awaiting payment.');

        for (const item of order.items) {
            const current = inventory.get(item.key);
            if (!current || item.quantity > available(item.key, current, orderReference)) reject(409, 'Insufficient stock for ' + item.title + '.');
        }
        return completeOrder(db, order, token('DEMO-'));
    });
    res.json({ success: true, mode: 'demo', data: orderSummary(result.order),
        receiptNumber: result.order.receipt, passes: result.passes, digitalPass: result.passes[0] ?? null });
});

exports.verifyPass = handler(async (req, res) => {
    const code = req.params.qrToken.trim().toUpperCase();
    const row = commerceDb().prepare('SELECT data FROM passes WHERE token = ? OR reference = ?').get(code, code);
    const pass = row ? JSON.parse(row.data) : isConnected() ? await DigitalPass.findOne({
        $or: [{ qrCodeToken: req.params.qrToken }, { passReference: code }]
    }).lean() : null;
    if (!pass || pass.status !== 'VALID') reject(404, 'No valid ticket matches this code.');
    res.json({ success: true, status: 'VALID', pass: { passReference: pass.passReference, tierName: pass.tierName,
        designatedGate: pass.designatedGate, eventTitle: pass.eventTitle, mode: pass.mode } });
});

exports.redeemPass = handler(async (req, res) => {
    const key = process.env.PASS_SCANNER_KEY;
    if (!key) reject(503, 'Gate scanning has not been configured.');
    if (req.get('Authorization') !== 'Bearer ' + key) reject(403, 'Scanner authorization required.');
    const code = req.params.qrToken.trim().toUpperCase();
    const gate = typeof req.body.gate === 'string' ? req.body.gate.trim().toUpperCase() : '';
    if (!/^GATE [A-D]$/.test(gate)) reject(400, 'Enter a gate from Gate A to Gate D.');
    const matchesGate = pass => {
        const assigned = pass.designatedGate.toUpperCase().match(/^GATE ([A-D])(?:\s*&\s*([A-D]))?/);
        return assigned?.slice(1).some(letter => 'GATE ' + letter === gate);
    };
    const consume = pass => {
        if (!pass || pass.status !== 'VALID') reject(409, 'Ticket is unavailable or has already been used.');
        if (!matchesGate(pass)) reject(409, 'This ticket is assigned to a different gate.');
    };
    const pass = transaction(db => {
        const row = db.prepare('SELECT data FROM passes WHERE token = ? OR reference = ?').get(code, code);
        if (!row) return null;
        const entry = JSON.parse(row.data);
        consume(entry);
        entry.status = 'USED';
        entry.scannedGate = gate;
        entry.scannedAt = new Date().toISOString();
        db.prepare('UPDATE passes SET data = ? WHERE token = ?').run(JSON.stringify(entry), entry.qrCodeToken);
        return entry;
    });
    if (!pass) {
        if (!isConnected()) reject(404, 'Ticket not found.');
        const legacy = await DigitalPass.findOne({ $or: [{ qrCodeToken: req.params.qrToken }, { passReference: code }] });
        consume(legacy);
        const used = await DigitalPass.findOneAndUpdate({ _id: legacy._id, status: 'VALID' },
            { status: 'USED', scannedGate: gate, scannedAt: new Date() }, { new: true });
        if (!used) reject(409, 'Ticket has already been used.');
        return res.json({ success: true, status: 'USED', passReference: used.passReference });
    }
    res.json({ success: true, status: 'USED', passReference: pass.passReference });
});

exports.passQr = handler(async (req, res) => {
    const code = req.params.qrToken.trim().toUpperCase();
    const row = commerceDb().prepare('SELECT data FROM passes WHERE token = ? OR reference = ?').get(code, code);
    const legacy = !row && isConnected() ? await DigitalPass.findOne({ qrCodeToken: req.params.qrToken, status: 'VALID' }).lean() : null;
    const pass = row ? JSON.parse(row.data) : legacy;
    if (!pass) reject(404, 'Ticket not found.');
    const qrToken = pass.qrCodeToken;
    const svg = await require('qrcode').toString(qrToken, { type: 'svg', errorCorrectionLevel: 'M', width: 200 });
    res.type('svg').set('Cache-Control', 'private, no-store').send(svg);
});
