const { Server } = require('socket.io');
const { randomInt } = require('node:crypto');
const { organizerIdentity } = require('../organizerAccess');
const { isConnected } = require('../../config/db');
const { DepositRequest, AdminNotification } = require('../../models/automation');

let io = null;

function generateDepositReference() {
    const year = new Date().getFullYear();
    const seq = String(randomInt(100000, 999999));
    return `DEP-${year}-${seq}`;
}

function initSocketHub(httpServer) {
    if (io) return io;
    io = new Server(httpServer, {
        path: '/socket.io',
        cors: { origin: true, credentials: true }
    });

    io.use((socket, next) => {
        const authHeader = socket.handshake.headers?.authorization || socket.handshake.auth?.authorization || '';
        const origin = socket.handshake.headers?.origin || '';
        const referer = socket.handshake.headers?.referer || '';
        const host = (socket.handshake.headers?.['x-forwarded-host'] || socket.handshake.headers?.host || '').split(',')[0].trim();
        // Allow authenticated admin Basic header OR same-origin admin session from /admin
        if (organizerIdentity(authHeader)) {
            socket.data.adminActor = organizerIdentity(authHeader);
            return next();
        }
        try {
            if (origin && host && new URL(origin).host === host) {
                socket.data.adminActor = 'admin-dashboard';
                return next();
            }
        } catch {}
        try {
            if (referer && host) {
                const refUrl = new URL(referer);
                if (refUrl.host === host && refUrl.pathname.startsWith('/admin')) {
                    socket.data.adminActor = 'admin-dashboard';
                    return next();
                }
            }
        } catch {}
        return next(new Error('Admin authorization required.'));
    });

    io.on('connection', (socket) => {
        socket.join('admins');
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
        await AdminNotification.updateMany(
            { 'payload.reference': updated.reference },
            { $set: { acknowledged: true, read: true, acknowledgedAt: now } }
        );
        emitToAdmins('deposit:acknowledged', { reference: updated.reference, id: String(updated._id), acknowledgedBy: actor });
    }
    return updated;
}

module.exports = {
    initSocketHub,
    emitToAdmins,
    notifyDepositInitiated,
    markDepositVerified,
    acknowledgeDeposit
};
