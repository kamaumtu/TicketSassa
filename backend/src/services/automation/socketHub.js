const { Server } = require('socket.io');
const { randomInt, randomBytes, createHmac, timingSafeEqual } = require('node:crypto');
const { organizerIdentity } = require('../organizerAccess');
const { isConnected } = require('../../config/db');
const { DepositRequest, AdminNotification } = require('../../models/automation');
const { emitDepositEvent } = require('../depositAlerts');

let io = null;
const RUNTIME_TOKEN_FALLBACK = randomBytes(32).toString('hex');
const SOCKET_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function socketTokenSecret() {
    const seed = process.env.ORGANIZER_KEY || process.env.ORGANIZER_ACCOUNTS || process.env.JWT_SECRET || RUNTIME_TOKEN_FALLBACK;
    return createHmac('sha256', 'ticketsasa-admin-socket-v1').update(String(seed)).digest('hex');
}

function createSocketToken(actor = 'admin') {
    const payload = Buffer.from(JSON.stringify({
        actor: String(actor || 'admin').slice(0, 80),
        exp: Date.now() + SOCKET_TOKEN_TTL_MS
    }), 'utf8').toString('base64url');
    const sig = createHmac('sha256', socketTokenSecret()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

function verifySocketToken(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    if (!payload || !sig) return null;
    const expected = createHmac('sha256', socketTokenSecret()).update(payload).digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!parsed || typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
        return String(parsed.actor || 'admin');
    } catch {
        return null;
    }
}

function normalizeHostname(rawHost) {
    return String(rawHost || '').split(',')[0].trim().replace(/:\d+$/, '').toLowerCase();
}

function generateDepositReference() {
    const year = new Date().getFullYear();
    const seq = String(randomInt(100000, 999999));
    return `DEP-${year}-${seq}`;
}

function initSocketHub(httpServer) {
    if (io) return io;
    io = new Server(httpServer, {
        path: '/socket.io',
        cors: { origin: true, credentials: true },
        pingInterval: 20000,
        pingTimeout: 20000
    });

    io.use((socket, next) => {
        const tokenActor = verifySocketToken(socket.handshake.auth?.token || socket.handshake.query?.token);
        if (tokenActor) {
            socket.data.adminActor = tokenActor;
            return next();
        }
        const authHeader = socket.handshake.headers?.authorization || socket.handshake.auth?.authorization || '';
        const origin = socket.handshake.headers?.origin || '';
        const referer = socket.handshake.headers?.referer || '';
        const hostName = normalizeHostname(socket.handshake.headers?.['x-forwarded-host'] || socket.handshake.headers?.host || '');
        // Allow authenticated admin Basic header OR same-origin admin session from /admin
        if (organizerIdentity(authHeader)) {
            socket.data.adminActor = organizerIdentity(authHeader);
            return next();
        }
        try {
            if (origin && hostName && new URL(origin).hostname.toLowerCase() === hostName) {
                socket.data.adminActor = 'admin-dashboard';
                return next();
            }
        } catch {}
        try {
            if (referer && hostName) {
                const refUrl = new URL(referer);
                if (refUrl.hostname.toLowerCase() === hostName && refUrl.pathname.startsWith('/admin')) {
                    socket.data.adminActor = 'admin-dashboard';
                    return next();
                }
            }
        } catch {}
        return next(new Error('Admin authorization required.'));
    });

    io.on('connection', (socket) => {
        socket.join('admins');
        socket.emit('hub:ready', { connectedAt: new Date().toISOString(), actor: socket.data.adminActor || 'admin' });
        socket.on('deposit:acknowledge', async ({ id, reference } = {}) => {
            try {
                await acknowledgeDeposit(id || reference, socket.data.adminActor || 'admin');
            } catch {}
        });
    });

    return io;
}

function emitToAdmins(event, payload) {
    if (io) io.to('admins').emit(event, payload);
    emitDepositEvent(event, payload);
}

async function notifyDepositInitiated({ orderReference, customerName, customerPhone, customerEmail = '', amountKes, method = 'M-PESA', provider = 'mpesa', checkoutRequestId = '' }) {
    const reference = generateDepositReference();
    const initiatedAt = new Date();
    let depositDoc = {
        _id: reference,
        reference,
        orderReference: orderReference || reference,
        customerName: String(customerName || 'Customer').slice(0, 120),
        customerPhone: String(customerPhone || '').slice(0, 24),
        customerEmail: String(customerEmail || '').slice(0, 180),
        amountKes: Math.round(Number(amountKes) || 0),
        method,
        provider,
        checkoutRequestId,
        status: 'PENDING',
        walletCredited: false,
        acknowledged: false,
        initiatedAt
    };

    let notificationDoc = {
        type: 'deposit_initiated',
        title: 'NEW DEPOSIT REQUEST!',
        message: `Customer: ${depositDoc.customerName} | Amount: KES ${depositDoc.amountKes.toLocaleString('en-KE')} | Method: ${method} | Ref: ${reference} | Status: PENDING`,
        payload: depositDoc,
        read: false,
        acknowledged: false,
        createdAt: initiatedAt
    };

    if (isConnected()) {
        try {
            const created = await DepositRequest.create({
                reference: depositDoc.reference,
                orderReference: depositDoc.orderReference,
                customerName: depositDoc.customerName,
                customerPhone: depositDoc.customerPhone,
                customerEmail: depositDoc.customerEmail,
                amountKes: depositDoc.amountKes,
                method: depositDoc.method,
                provider: depositDoc.provider,
                checkoutRequestId: depositDoc.checkoutRequestId,
                status: 'PENDING',
                walletCredited: false,
                acknowledged: false,
                initiatedAt
            });
            depositDoc = created.toObject();
            const notif = await AdminNotification.create({
                type: 'deposit_initiated',
                title: notificationDoc.title,
                message: notificationDoc.message,
                payload: {
                    depositId: String(created._id),
                    reference: created.reference,
                    orderReference: created.orderReference,
                    customerName: created.customerName,
                    customerPhone: created.customerPhone,
                    amountKes: created.amountKes,
                    method: created.method,
                    status: created.status,
                    initiatedAt: created.initiatedAt
                },
                read: false,
                acknowledged: false
            });
            notificationDoc = notif.toObject();
        } catch (err) {
            console.warn('Could not persist deposit notification:', err.message);
        }
    }

    emitToAdmins('deposit:initiated', { deposit: depositDoc, notification: notificationDoc });
    return { deposit: depositDoc, notification: notificationDoc };
}

async function markDepositVerified({
    orderReference,
    checkoutRequestId,
    receipt,
    status,
    failureReason = '',
    failureCode = '',
    customerName = 'Customer',
    customerPhone = '',
    customerEmail = '',
    amountKes = 0,
    method = 'M-PESA',
    provider = 'mpesa'
}) {
    const isSuccess = status === 'COMPLETED';
    const cleanReason = !isSuccess ? String(failureReason || 'Payment failed').slice(0, 240) : '';
    const cleanCode = !isSuccess ? String(failureCode || '').slice(0, 40) : '';

    let depositObj = {
        reference: orderReference || generateDepositReference(),
        orderReference: orderReference || '',
        customerName: String(customerName || 'Customer').slice(0, 120),
        customerPhone: String(customerPhone || '').slice(0, 24),
        customerEmail: String(customerEmail || '').slice(0, 180),
        amountKes: Math.round(Number(amountKes) || 0),
        method,
        provider,
        checkoutRequestId: checkoutRequestId || '',
        status: isSuccess ? 'COMPLETED' : 'FAILED',
        mpesaReceipt: receipt || undefined,
        walletCredited: isSuccess,
        failureReason: cleanReason || undefined,
        failureCode: cleanCode || undefined,
        initiatedAt: new Date(),
        ...(isSuccess ? { verifiedAt: new Date() } : {})
    };

    if (isConnected()) {
        try {
            const orClauses = [];
            if (orderReference) orClauses.push({ orderReference });
            if (checkoutRequestId) orClauses.push({ checkoutRequestId });
            let existing = orClauses.length ? await DepositRequest.findOne({ $or: orClauses }) : null;

            // Duplicate callback prevention: never credit wallet or emit twice
            if (existing && existing.status === 'COMPLETED' && existing.walletCredited && isSuccess) {
                return existing;
            }
            if (existing && existing.status === 'FAILED' && !isSuccess && existing.failureReason === cleanReason) {
                return existing;
            }

            if (!existing) {
                existing = await DepositRequest.create({
                    reference: generateDepositReference(),
                    orderReference: depositObj.orderReference || undefined,
                    customerName: depositObj.customerName,
                    customerPhone: depositObj.customerPhone,
                    customerEmail: depositObj.customerEmail,
                    amountKes: depositObj.amountKes,
                    method: depositObj.method,
                    provider: depositObj.provider,
                    checkoutRequestId: depositObj.checkoutRequestId,
                    status: depositObj.status,
                    mpesaReceipt: receipt || undefined,
                    walletCredited: isSuccess,
                    acknowledged: !isSuccess,
                    failureReason: cleanReason,
                    failureCode: cleanCode,
                    initiatedAt: new Date(),
                    ...(isSuccess ? { verifiedAt: new Date() } : {})
                });
            } else {
                existing.status = isSuccess ? 'COMPLETED' : 'FAILED';
                if (checkoutRequestId && !existing.checkoutRequestId) existing.checkoutRequestId = checkoutRequestId;
                if (receipt) existing.mpesaReceipt = receipt;
                if (isSuccess) {
                    existing.walletCredited = true;
                    existing.verifiedAt = new Date();
                    existing.failureReason = '';
                    existing.failureCode = '';
                } else {
                    existing.failureReason = cleanReason;
                    existing.failureCode = cleanCode;
                }
                await existing.save();
            }

            depositObj = existing.toObject();
        } catch (err) {
            console.warn('Could not update deposit verification record:', err.message);
        }
    }

    const reasonSuffix = !isSuccess && cleanReason ? ` · Reason: ${cleanReason}` : '';
    let notifObj = {
        type: 'deposit_verified',
        title: isSuccess ? 'DEPOSIT VERIFIED & CREDITED' : `DEPOSIT FAILED${cleanReason ? ': ' + cleanReason.slice(0, 60) : ''}`,
        message: `${depositObj.customerName} · KES ${Number(depositObj.amountKes || 0).toLocaleString('en-KE')} · ${depositObj.reference} · ${depositObj.status}${receipt ? ` (${receipt})` : ''}${reasonSuffix}`,
        payload: {
            reference: depositObj.reference,
            orderReference: depositObj.orderReference,
            customerName: depositObj.customerName,
            customerPhone: depositObj.customerPhone,
            amountKes: depositObj.amountKes,
            status: depositObj.status,
            receipt,
            failureReason: cleanReason || undefined,
            failureCode: cleanCode || undefined
        },
        read: false,
        acknowledged: !isSuccess,
        createdAt: new Date()
    };

    if (isConnected()) {
        const createdNotif = await AdminNotification.create(notifObj).catch(() => null);
        if (createdNotif) notifObj = createdNotif.toObject();
    }

    emitToAdmins('deposit:verified', { deposit: depositObj, notification: notifObj });
    return depositObj;
}

async function acknowledgeDeposit(idOrRef, actor = 'admin') {
    if (!isConnected()) return null;
    const now = new Date();
    const isObjectId = /^[a-f0-9]{24}$/i.test(String(idOrRef || ''));
    const query = isObjectId ? { _id: idOrRef } : { $or: [{ reference: idOrRef }, { orderReference: idOrRef }] };
    const updated = await DepositRequest.findOneAndUpdate(
        query,
        { $set: { acknowledged: true, acknowledgedBy: actor, acknowledgedAt: now } },
        { new: true }
    );
    if (updated) {
        const refMatch = [{ 'payload.reference': updated.reference }];
        if (updated.orderReference) refMatch.push({ 'payload.orderReference': updated.orderReference });
        await AdminNotification.updateMany(
            { $or: refMatch },
            { $set: { acknowledged: true, read: true, acknowledgedAt: now } }
        );
        emitToAdmins('deposit:acknowledged', {
            reference: updated.reference,
            orderReference: updated.orderReference,
            id: String(updated._id),
            acknowledgedBy: actor
        });
    }
    return updated;
}

function sendTestNotification(kind = 'initiated', actor = 'admin') {
    const normalized = ['initiated', 'completed', 'failed'].includes(kind) ? kind : 'initiated';
    const ref = `TEST-${Date.now().toString(36).toUpperCase()}`;
    const status = normalized === 'completed' ? 'COMPLETED' : normalized === 'failed' ? 'FAILED' : 'PENDING';
    const deposit = {
        _id: ref,
        reference: ref,
        orderReference: ref,
        customerName: 'Test Customer',
        customerPhone: '254700000000',
        amountKes: 1500,
        method: 'M-PESA',
        provider: 'test',
        status,
        mpesaReceipt: normalized === 'completed' ? 'TEST987654' : undefined,
        failureReason: normalized === 'failed' ? 'Cancelled by user (test alert)' : undefined,
        failureCode: normalized === 'failed' ? '1032' : undefined,
        initiatedAt: new Date().toISOString(),
        isTest: true,
        triggeredBy: actor
    };
    emitToAdmins('deposit:test', { kind: normalized, deposit });
    return { kind: normalized, deposit };
}

module.exports = {
    initSocketHub,
    createSocketToken,
    verifySocketToken,
    emitToAdmins,
    notifyDepositInitiated,
    markDepositVerified,
    acknowledgeDeposit,
    sendTestNotification
};
