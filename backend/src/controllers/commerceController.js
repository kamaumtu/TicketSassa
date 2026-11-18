const mpesa = require('../services/mpesa');
const { randomBytes } = require('node:crypto');
const { collection, transaction, availability, lockStock, stockKey, demoEnabled, checkoutMode } = require('../services/commerceDb');
const { getPromo } = require('../services/promos');
const { getTicketCatalog } = require('./ticketController');
const Order = require('../models/Order');
const DigitalPass = require('../models/DigitalPass');
const { isConnected } = require('../config/db');
const { getPaymentSettings } = require('../services/paymentSettings');
const { confirmTravelReservation } = require('../services/travelSuppliers');
const { confirmImportedTiers } = require('../services/eventAllocations');
const { sendOrderTicketsEmail } = require('../services/accountProviders');

// PayHero and NexusPay Payment Gateway Integration
const { createPaymentGateways } = require('../services/payment-gateways');
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

function priceChanged(catalog) {
    void catalog?.refresh('price-change').catch(() => {});
    reject(409, 'The supplier changed the ticket price. Refresh the event and review the new price before paying.');
}

function requireCurrentQuote(quote) {
    if (quote.validUntil <= Date.now()) reject(409, 'The supplier quote expired. Refresh and select tickets again.');
}

async function getInventory(includeClosed = false) {
    const tickets = await getTicketCatalog();
    const reserved = includeClosed ? await require('../routes/publishedEvents').reservedTiers().catch(() => []) : [];
    const sellable = includeClosed ? [...tickets, ...reserved] : tickets;
    return new Map(sellable.map(tier =>
        [inventoryKey('ticket', tier.tierKey), { ...tier, stock: tier.remainingAllocation }]));
}

function getOrder(reference, session) {
    return collection('commerce_orders').findOne({ _id: reference }, { session });
}

function saveOrder(order, session) {
    return collection('commerce_orders').replaceOne({ _id: order.orderReference }, order, { session });
}

function getPasses(orderReference, session) {
    return collection('commerce_passes').find({ orderReference }, { session, projection: { _id: 0 } }).toArray();
}

function orderSummary(order) {
    const { orderReference, items, currency, totalKes, totalUsd, totalTickets, paymentStatus, promoCode, tipKes, mode, expiresAt, provider, receipt } = order;
    return { orderReference, items, currency, totalKes, totalUsd, totalTickets, paymentStatus, promoCode, tipKes, mode, expiresAt, provider, receipt };
}

async function completeOrder(session, order, receipt) {
    const { orderReference } = order;
    const passes = [];
    for (const item of [...order.items].sort((a, b) => a.key.localeCompare(b.key))) {
        await collection('commerce_stock').updateOne({ _id: stockKey(item.key, order.mode) },
            { $inc: { sold: item.quantity } }, { upsert: true, session });
        if (!['ticket', 'flight', 'holiday'].includes(item.kind) ||
            (order.mode === 'live' && /^(flight|holiday):/.test(item.key))) continue;
        for (let index = 0; index < item.quantity; index++) {
            passes.push({ qrCodeToken: token('PASS-'), passReference: token('TSASA-'), orderReference,
                attendeeName: order.customer.name, tierName: item.title, eventTitle: item.eventTitle,
                designatedGate: item.designatedGate || 'Gate A', status: 'VALID', mode: order.mode });
        }
    }
    if (passes.length) await collection('commerce_passes').insertMany(
        passes.map(pass => ({ ...pass, _id: pass.qrCodeToken })), { session });
    await collection('commerce_holds').deleteMany({ orderReference }, { session });
    order.paymentStatus = 'COMPLETED';
    order.paidAt = new Date();
    order.receipt = receipt;
    await saveOrder(order, session);
    const travelReservation = await confirmTravelReservation(orderReference, receipt, order.mode).catch(() => null);
    void sendOrderTicketsEmail(order, passes, travelReservation).catch(() => null);
    return { order, passes, travelReservation };
}

exports.getCheckoutMode = (req, res) => res.json({ mode: checkoutMode() });

exports.getPayHeroBalance = handler(async (req, res) => {
    if (!require('../services/organizerAccess').organizerIdentity(req.get('Authorization'))) {
        reject(403, 'Organizer authorization required.');
    }
    res.json({ success: true, data: await fetchPayHeroBalance() });
});

exports.createOrder = handler(async (req, res) => {
    const mode = checkoutMode();
    if (mode === 'unavailable') reject(503, 'Checkout is currently unavailable.');
    const { customer, items, currency = 'KES', paymentMethod = 'MPESA', promoCode, tipKes = 0 } = req.body;
    const name = typeof customer?.name === 'string' ? customer.name.trim() : '';
    const email = normalizeEmail(customer?.email);
    if (!name || name.length > 120 || !validEmail(email)) reject(400, 'Enter a name and valid email address.');
    const phone = phoneNumber(customer?.phone);
    if (!['KES', 'USD'].includes(currency) || paymentMethod !== 'MPESA') reject(400, 'Choose a supported currency and payment method.');
    if (!Number.isSafeInteger(tipKes) || tipKes < 0 || tipKes > 100000) reject(400, 'Invalid tip amount.');
    if (mode === 'live' && currency !== 'KES') reject(400, 'M-Pesa accepts Kenyan shillings only.');
    const promo = mode === 'demo' ? getPromo(promoCode) : null;
    if (promoCode && !promo) reject(400, 'Invalid promo code.');
    if (!Array.isArray(items) || !items.length || items.length > 30) reject(400, 'Select at least one item.');

    const inventory = await getInventory();
    const quantities = new Map();
    const displayedPrices = new Map();
    for (const item of items) {
        const kind = item?.kind ?? 'ticket';
        if (!['ticket', 'flight', 'holiday'].includes(kind)) reject(400, 'This item type is unavailable.');
        if (['flight', 'holiday'].includes(kind)) {
            if (mode === 'live' && !require('../services/travelSuppliers').supplierStatus().flightReservationEnabled) {
                reject(503, 'Travel checkout is unavailable until supplier reservations can be confirmed.');
            }
            const customId = item?.id || item?.tierKey || item?.productKey || token('TRV-');
            const key = inventoryKey(kind, customId);
            const priceKes = Math.max(1, Math.round(Number(item?.unitPriceKes || item?.priceKes || 1000)));
            const priceUsd = round(priceKes / 125);
            inventory.set(key, {
                tierKey: customId,
                title: String(item?.title || 'Ticketsasa Travel Booking').slice(0, 140),
                eventTitle: kind === 'flight' ? 'Ticketsasa Flight Booking' : 'Ticketsasa Holiday Package',
                designatedGate: 'Travel Desk / E-Voucher',
                priceKes,
                priceUsd,
                stock: 999,
                published: true
            });
            quantities.set(key, (quantities.get(key) ?? 0) + (Number(item?.quantity) || 1));
            continue;
        }
        const id = item?.tierKey ?? item?.productKey;
        const key = inventoryKey(kind, id);
        if (!inventory.has(key) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) reject(400, 'Invalid item or quantity.');
        const expectedPrice = item.unitPriceKes ?? inventory.get(key).priceKes;
        if (displayedPrices.has(key) && displayedPrices.get(key) !== expectedPrice) reject(400, 'Ticket prices in the cart do not match.');
        displayedPrices.set(key, expectedPrice);
        quantities.set(key, (quantities.get(key) ?? 0) + item.quantity);
    }

    const confirmed = mode === 'live'
        ? await confirmImportedTiers([...quantities.keys()].map(key => inventory.get(key).tierKey)) : new Map();
    if (confirmed.size) {
        for (const [tierKey, quote] of confirmed) {
            const key = inventoryKey('ticket', tierKey);
            if (quote.priceKes !== displayedPrices.get(key)) priceChanged(req.app.locals.eventCatalog);
            Object.assign(inventory.get(key), { priceKes: quote.priceKes, priceUsd: round(quote.priceKes / 125), stock: quote.capacity });
        }
    }

    let totalTickets = 0;
    let subtotalKes = 0;
    let subtotalUsd = 0;
    const lines = [];
    for (const [key, quantity] of quantities) {
        const item = inventory.get(key);
        if (quantity > 100) reject(400, 'A single order can include at most 100 of each item.');
        if (mode === 'live' && !item.published) reject(400, 'This item has no authorized ticket allocation.');
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
        currency, paymentMethod, paymentStatus: 'PENDING', promoCode: promo?.code, tipKes, mode, createdAt: new Date(), expiresAt: Date.now() + 10 * 60 * 1000
    };
    if (mode === 'live' && (!Number.isSafeInteger(order.totalKes) || order.totalKes < 1)) {
        reject(400, 'The M-Pesa total must be a positive whole number of Kenyan shillings.');
    }
    await transaction(async session => {
        await lockStock([...quantities.keys()], session);
        for (const line of lines) {
            const quote = confirmed.get(line.tierKey);
            if (quote) requireCurrentQuote(quote);
            if (line.quantity > await availability(line.key, inventory.get(line.key).stock, session)) {
                reject(409, 'Insufficient stock for ' + line.title + '.');
            }
        }
        await collection('commerce_orders').insertOne({ ...order, _id: order.orderReference }, { session });
        await collection('commerce_holds').insertMany(lines.map(line => ({
            _id: order.orderReference + ':' + line.key, orderReference: order.orderReference, product: stockKey(line.key),
            quantity: line.quantity, expiresAt: order.expiresAt, purgeAt: new Date(order.expiresAt)
        })), { session });
    });
    res.status(201).json({ success: true, data: orderSummary(order) });
});

exports.getOrderByReference = handler(async (req, res) => {
    const order = await getOrder(req.params.ref) ||
        (isConnected() ? await Order.findOne({ orderReference: req.params.ref }).lean() : null);
    if (!order) reject(404, 'Order reference not found.');
    res.json({ success: true, data: orderSummary(order) });
});

exports.lookupOrder = handler(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const reference = typeof req.body.orderReference === 'string' ? req.body.orderReference.trim().toUpperCase() : '';
    if (!reference || !validEmail(email)) reject(400, 'Enter your order reference and email address.');
    let order = await getOrder(reference);
    let passes;
    if (order?.customer.email === email) {
        order = await reconcile(order);
        passes = await getPasses(reference);
    } else if (isConnected()) {
        order = await Order.findOne({ orderReference: reference }).lean();
        if (normalizeEmail(order?.customer?.email) === email) passes = await DigitalPass.find({ orderReference: reference }).lean();
    }
    if (!passes) reject(404, 'No order matches that reference and email address.');
    res.json({ success: true, data: orderSummary(order), passes });
});

exports.initiateMpesaStkPush = handler(async (req, res) => {
    const serverMode = checkoutMode();
    if (serverMode === 'unavailable') reject(503, 'Checkout is currently unavailable.');
    const { orderReference, phone } = req.body;
    if (typeof orderReference !== 'string') reject(400, 'Order reference is required.');
    const mobile = phoneNumber(phone);
    const mode = serverMode;

    const preview = await getOrder(orderReference);
    if (!preview || preview.customer?.phone !== mobile) reject(404, 'Order not found for this mobile number.');
    const stock = preview.paymentStatus === 'PENDING' ? await getInventory() : null;
    const confirmed = mode === 'live' && stock
        ? await confirmImportedTiers(preview.items.filter(item => item.key?.startsWith('ticket:')).map(item => item.tierKey)) : new Map();
    const { order, start } = await transaction(async session => {
        const stored = await getOrder(orderReference, session);
        if (!stored || stored.customer.phone !== mobile) reject(404, 'Order not found for this mobile number.');
        if (stored.mode !== mode) reject(409, 'This order uses a different checkout mode.');
        if (stored.paymentStatus === 'FAILED') reject(409, 'This order is no longer payable.');
        // Existing payments keep their original provider, including after an admin changes the setting.
        if (stored.paymentStatus !== 'PENDING') return { order: stored, start: false };
        if (stored.expiresAt <= Date.now()) reject(410, 'Your ticket hold expired. Start a new checkout.');
        if (mode === 'live' && stored.items.some(item => /^(flight|holiday):/.test(item.key)) &&
            !require('../services/travelSuppliers').supplierStatus().flightReservationEnabled) {
            reject(503, 'Travel checkout is unavailable until supplier reservations can be confirmed.');
        }
        if (stored.items.some(item => item.key?.startsWith('ticket:') && !stock?.has(item.key))) {
            reject(409, 'An item is no longer available. Start a new checkout.');
        }
        if (mode === 'live') {
            const settings = await getPaymentSettings();
            if (!settings.options.some(option => option.id === settings.provider && option.configured)) {
                reject(503, 'M-Pesa is currently unavailable.');
            }
            stored.provider = settings.provider;
            await lockStock(stored.items.map(item => item.key), session);
            for (const item of stored.items) {
                const quote = confirmed.get(item.tierKey);
                if (!quote) continue;
                requireCurrentQuote(quote);
                if (quote.priceKes !== item.unitPriceKes) priceChanged(req.app.locals.eventCatalog);
                if (item.quantity > await availability(item.key, quote.capacity, session, orderReference)) {
                    reject(409, 'The supplier no longer has enough tickets for ' + item.title + '.');
                }
            }
            const holds = await collection('commerce_holds').updateMany({ orderReference, expiresAt: { $gt: Date.now() } },
                { $set: { expiresAt: Number.MAX_SAFE_INTEGER }, $unset: { purgeAt: '' } }, { session });
            if (holds.matchedCount !== stored.items.length) reject(410, 'Your ticket hold expired. Start a new checkout.');
        } else {
            stored.provider = 'demo';
            stored.checkoutRequestId = token('DEMO-');
        }
        stored.paymentStatus = 'PROCESSING';
        await saveOrder(stored, session);
        return { order: stored, start: mode === 'live' };
    });

    if (start) {
        try {
            const result = await paymentGateways.initiate(order.provider, providerDetails(order), order.customer.name);
            order.checkoutRequestId = result.checkoutRequestId;
            order.providerReference = result.providerReference;
            await saveOrder(order);
        } catch (error) {
            console.error('M-Pesa initiation did not complete for order', orderReference);
            if (error.definitelyRejected || error.definitive) {
                await settle(orderReference, { status: 'failed' });
                reject(422, 'M-Pesa could not start this payment. Please try again.');
            }
            // An unknown outcome keeps the hold and never sends a second prompt.
        }
    }
    res.json({
        success: true,
        mode,
        CheckoutRequestID: order.checkoutRequestId,
        checkoutRequestId: order.checkoutRequestId,
        checkoutStarted: Boolean(order.checkoutRequestId),
        CustomerMessage: mode === 'demo' ? 'Demo checkout ready.'
            : order.paymentStatus === 'COMPLETED' ? 'Your payment is confirmed.'
            : order.checkoutRequestId ? 'Approve the M-Pesa prompt on your phone.'
            : 'Waiting for M-Pesa to confirm the request.'
    });
});

function providerDetails(order) {
    return {
        amount: order.totalKes, payer_phone: order.customer.phone,
        external_reference: order.orderReference, account_reference: order.orderReference.slice(-12),
        mpesa_checkout_request_id: order.checkoutRequestId, provider_reference: order.providerReference
    };
}

function settle(reference, result) {
    return transaction(async session => {
        const current = await getOrder(reference, session);
        if (current.paymentStatus !== 'PROCESSING') return current;
        if (result.status === 'completed') return (await completeOrder(session, current, result.receipt ?? null)).order;
        if (['failed', 'cancelled'].includes(result.status)) {
            current.paymentStatus = 'FAILED';
            await collection('commerce_holds').deleteMany({ orderReference: reference }, { session });
            await saveOrder(current, session);
        }
        return current;
    });
}

const pendingQueries = new Map();
const lastQueries = new Map();

async function reconcile(order) {
    if (order.mode !== 'live' || order.paymentStatus !== 'PROCESSING' || !order.checkoutRequestId) return order;
    const reference = order.orderReference;
    if (pendingQueries.has(reference)) return pendingQueries.get(reference);
    if (Date.now() - (lastQueries.get(reference) ?? 0) < 5000) return getOrder(reference);
    if (lastQueries.size >= 1000) lastQueries.delete(lastQueries.keys().next().value);
    lastQueries.set(reference, Date.now());
    const query = (async () => {
        let result;
        try {
            if (!order.provider || order.provider === 'daraja') {
                const reply = await mpesa.query(order.checkoutRequestId);
                if (reply.CheckoutRequestID !== order.checkoutRequestId) return order;
                const code = String(reply.ResultCode);
                result = { status: code === '0' ? 'completed'
                    : ['1', '1032', '1037', '2001'].includes(code) ? 'failed' : 'pending' };
            } else result = await paymentGateways.check(order.provider, providerDetails(order));
        } catch {
            return getOrder(reference);
        }
        return result.status === 'pending' ? getOrder(reference) : settle(reference, result);
    })().finally(() => pendingQueries.delete(reference));
    pendingQueries.set(reference, query);
    return query;
}

let checkingPendingPayments = false;

exports.reconcilePendingPayments = async () => {
    if (checkingPendingPayments || !isConnected()) return;
    checkingPendingPayments = true;
    try {
        const orders = collection('commerce_orders');
        const pending = await orders.find({ mode: 'live', paymentStatus: 'PROCESSING',
            checkoutRequestId: { $type: 'string', $ne: '' } })
            .sort({ lastPaymentCheckAt: 1, createdAt: 1 }).limit(12).toArray();
        for (const order of pending) {
            await orders.updateOne({ _id: order._id }, { $set: { lastPaymentCheckAt: new Date() } });
            await reconcile(order);
        }
    } finally {
        checkingPendingPayments = false;
    }
};

exports.getPaymentStatus = handler(async (req, res) => {
    const reference = req.params.orderReference.trim().toUpperCase();
    const order = await getOrder(reference);
    if (!order || normalizeEmail(req.query.email) !== order.customer.email) reject(404, 'Order not found.');
    const current = await reconcile(order);
    res.json({ success: true, status: current.paymentStatus, order: orderSummary(current),
        passes: current.paymentStatus === 'COMPLETED' ? await getPasses(reference) : [] });
});

exports.adminCheckPayment = handler(async (req, res) => {
    const order = await getOrder(req.params.reference);
    if (!order || order.mode !== 'live') reject(404, 'Live order not found.');
    if (order.paymentStatus === 'PROCESSING' && !order.checkoutRequestId) {
        reject(409, 'Verify the payment in the merchant account. The provider did not return a checkout reference.');
    }
    const current = await reconcile(order);
    res.json({ paymentStatus: current.paymentStatus });
});

function callback(provider, identify) {
    return handler(async (req, res) => {
        const { id, reference } = identify(req.body);
        const matches = [];
        if (typeof id === 'string' && id.length <= 128) matches.push({ checkoutRequestId: id });
        if (typeof reference === 'string' && /^ORD-[A-F0-9]{32}$/.test(reference)) matches.push({ _id: reference });
        if (!matches.length) reject(400, 'Invalid payment reference.');
        const order = await collection('commerce_orders').findOne({
            mode: 'live', provider: provider === 'daraja' ? { $in: ['daraja', null] } : provider, $or: matches
        });
        if (order) await reconcile(order);
        res.json({ success: true, ResultCode: 0, ResultDesc: 'Accepted' });
    });
}

exports.mpesaCallback = callback('daraja', body => ({ id: body?.Body?.stkCallback?.CheckoutRequestID }));
exports.payheroCallback = callback('payhero', body => {
    const raw = body?.response ?? body;
    return { id: raw?.CheckoutRequestID ?? raw?.checkout_request_id,
        reference: raw?.ExternalReference ?? raw?.external_reference };
});
exports.nexuspayCallback = callback('nexuspay', body => ({
    id: body?.checkoutRequestId, reference: body?.reference ?? body?.external_reference
}));

exports.confirmDemo = handler(async (req, res) => {
    if (!demoEnabled()) reject(503, 'Demo checkout is unavailable.');
    const { orderReference, checkoutRequestId } = req.body;
    if (typeof orderReference !== 'string' || typeof checkoutRequestId !== 'string') reject(400, 'Order and checkout references are required.');
    const inventory = await getInventory(true);
    const result = await transaction(async session => {
        const order = await getOrder(orderReference, session);
        if (!order || (order.mode !== 'demo' && order.provider !== 'demo') || order.checkoutRequestId !== checkoutRequestId) reject(404, 'Checkout reference not found.');
        if (order.paymentStatus === 'COMPLETED') return { order, passes: await getPasses(orderReference, session) };
        if (order.expiresAt <= Date.now()) reject(410, 'Your ticket hold expired. Start a new checkout.');
        if (order.paymentStatus !== 'PROCESSING') reject(409, 'This order is not awaiting payment.');

        for (const item of order.items) {
            if (['flight', 'holiday'].includes(item.kind)) continue;
            const current = inventory.get(item.key);
            if (!current || item.quantity > await availability(item.key, current.stock, session, orderReference)) reject(409, 'Insufficient stock for ' + item.title + '.');
        }
        return completeOrder(session, order, token('DEMO-'));
    });
    res.json({ success: true, mode: 'demo', data: orderSummary(result.order),
        receiptNumber: result.order.receipt, passes: result.passes, digitalPass: result.passes[0] ?? null });
});

exports.verifyPass = handler(async (req, res) => {
    const code = req.params.qrToken.trim().toUpperCase();
    const pass = await collection('commerce_passes').findOne({ $or: [{ _id: code }, { passReference: code }] }) ||
        await DigitalPass.findOne({ $or: [{ qrCodeToken: req.params.qrToken }, { passReference: code }] }).lean();
    if (!pass || pass.status !== 'VALID' || pass.mode === 'demo' && !demoEnabled()) reject(404, 'No valid ticket matches this code.');
    res.json({ success: true, status: 'VALID', pass: { passReference: pass.passReference, tierName: pass.tierName,
        designatedGate: pass.designatedGate, eventTitle: pass.eventTitle, mode: pass.mode } });
});

exports.redeemPass = handler(async (req, res) => {
    const scanner = require('../services/scannerAccess').authenticateScanner(req.get('Authorization'));
    if (!scanner) reject(403, 'Scanner authorization required.');
    const code = req.params.qrToken.trim().toUpperCase();
    const gate = typeof req.body.gate === 'string' ? req.body.gate.trim().toUpperCase() : '';
    if (!/^GATE [A-D]$/.test(gate)) reject(400, 'Enter a gate from Gate A to Gate D.');
    if (scanner.gate && scanner.gate !== gate) reject(403, 'This scanner is assigned to a different gate.');
    const matchesGate = pass => {
        if (/Travel Desk/i.test(pass.designatedGate || '')) return true;
        const assigned = pass.designatedGate.toUpperCase().match(/^GATE ([A-D])(?:\s*&\s*([A-D]))?/);
        return assigned?.slice(1).some(letter => 'GATE ' + letter === gate);
    };
    const consume = pass => {
        if (!pass || pass.status !== 'VALID' || pass.mode === 'demo' && !demoEnabled()) reject(409, 'Ticket is unavailable or has already been used.');
        if (!matchesGate(pass)) reject(409, 'This ticket is assigned to a different gate.');
    };
    const pass = await transaction(async session => {
        const entry = await collection('commerce_passes').findOne({
            $or: [{ _id: code }, { passReference: code }]
        }, { session });
        if (!entry) return null;
        consume(entry);
        await collection('commerce_passes').updateOne({ _id: entry._id }, { $set: {
            status: 'USED', scannedGate: gate, scannedBy: scanner.id, scannedAt: new Date().toISOString()
        } }, { session });
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
    const pass = await collection('commerce_passes').findOne({ _id: code }) ||
        await DigitalPass.findOne({ qrCodeToken: req.params.qrToken, status: 'VALID' }).lean();
    if (!pass || pass.mode === 'demo' && !demoEnabled()) reject(404, 'Ticket not found.');
    const qrToken = pass.qrCodeToken;
    const svg = await require('qrcode').toString(qrToken, { type: 'svg', errorCorrectionLevel: 'M', width: 200 });
    res.type('svg').set('Cache-Control', 'private, no-store').send(svg);
});
