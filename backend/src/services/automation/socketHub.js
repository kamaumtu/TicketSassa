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
        const host = socket.handshake.headers?.host || '';
        // Allow authenticated admin Basic header OR same-origin admin session from /admin
        if (organizerIdentity(authHeader)) {
            socket.data.adminActor = organizerIdentity(authHeader);
            return next();
        }
        try {
            if (origin && new URL(origin).host === host) {
                socket.data.adminActor = 'admin-dashboard';
                return next();
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

async function markDepositVerified({ orderReference, checkoutRequestId, receipt, status, failureReason = '', failureCode = '' }) {
    if (!isConnected()) return null;
    const filter = orderReference ? { orderReference } : { checkoutRequestId };
    const existing = await DepositRequest.findOne(filter);
    if (!existing) return null;
    // Duplicate callback prevention: never credit wallet twice
    if (existing.status === 'COMPLETED' && existing.walletCredited) return existing;

    const isSuccess = status === 'COMPLETED';
    existing.status = isSuccess ? 'COMPLETED' : 'FAILED';
    if (receipt) existing.mpesaReceipt = receipt;
    if (isSuccess) {
        existing.walletCredited = true;
        existing.verifiedAt = new Date();
        existing.failureReason = '';
        existing.failureCode = '';
    } else {
        existing.failureReason = String(failureReason || 'Payment failed').slice(0, 240);
        existing.failureCode = String(failureCode || '').slice(0, 40);
    }
    await existing.save();

    const reasonSuffix = !isSuccess && existing.failureReason ? ` · Reason: ${existing.failureReason}` : '';
    const notif = await AdminNotification.create({
        type: 'deposit_verified',
        title: isSuccess ? 'DEPOSIT VERIFIED & CREDITED' : `DEPOSIT FAILED${existing.failureReason ? ': ' + existing.failureReason.slice(0, 60) : ''}`,
        message: `${existing.customerName} · KES ${existing.amountKes.toLocaleString('en-KE')} · ${existing.reference} · ${existing.status}${receipt ? ` (${receipt})` : ''}${reasonSuffix}`,
        payload: {
            reference: existing.reference,
            orderReference: existing.orderReference,
            status: existing.status,
            receipt,
            failureReason: existing.failureReason || undefined,
            failureCode: existing.failureCode || undefined
        },
        read: false,
        acknowledged: !isSuccess
    }).catch(() => null);

    emitToAdmins('deposit:verified', { deposit: existing.toObject(), notification: notif?.toObject() });
    return existing;
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
