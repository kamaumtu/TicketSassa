const day = 86400000;
const eatOffset = 3 * 3600000;

function isLiveTicket(item) {
    // Older orders sometimes labelled travel lines as tickets. Their
    // original inventory key still identifies the product type.
    if (typeof item?.key === 'string') {
        return item.key.startsWith('ticket:') || item.key.startsWith('itinerary:') || item.key.startsWith('flight-itinerary:');
    }
    return ['ticket', 'itinerary_holiday', 'itinerary_flight'].includes(item?.kind);
}

function realCompletedOrder(order) {
    return order.mode === 'live' && order.paymentStatus === 'COMPLETED' &&
        order.provider !== 'demo' && !/^DEMO-/i.test(order.receipt ?? '');
}

function revenueSummary(orders, now = Date.now()) {
    const eatDay = Math.floor((now + eatOffset) / day);
    const today = eatDay * day - eatOffset;
    const monday = today - ((new Date(eatDay * day).getUTCDay() + 6) % 7) * day;
    const report = { todayKes: 0, weekKes: 0, totalKes: 0, undatedPayments: 0 };
    for (const order of orders) {
        if (!realCompletedOrder(order)) continue;
        const lines = Array.isArray(order.items) ? order.items : [];
        if (!lines.some(isLiveTicket)) continue;
        const subtotal = item => Math.max(0, Number(item.subtotalKes ?? item.unitPriceKes * item.quantity) || 0);
        const ticketTotal = lines.filter(isLiveTicket).reduce((sum, item) => sum + subtotal(item), 0);
        const orderSubtotal = lines.reduce((sum, item) => sum + subtotal(item), 0);
        const paidExcludingTips = Math.max(0, Number(order.totalKes) - (Number(order.tipKes) || 0));
        const revenue = orderSubtotal ? Math.round(paidExcludingTips * ticketTotal / orderSubtotal * 100) : 0;
        if (!Number.isFinite(revenue)) continue;
        report.totalKes += revenue;
        const paidAt = order.paidAt ? new Date(order.paidAt).getTime() : NaN;
        if (!Number.isFinite(paidAt)) {
            report.undatedPayments++;
            continue;
        }
        if (paidAt > now) continue;
        if (paidAt >= monday) report.weekKes += revenue;
        if (paidAt >= today) report.todayKes += revenue;
    }
    return { ...report, todayKes: report.todayKes / 100, weekKes: report.weekKes / 100, totalKes: report.totalKes / 100 };
}

module.exports = { revenueSummary, realCompletedOrder, isLiveTicket };
