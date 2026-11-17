const { bulkAvailability, demoEnabled } = require('../services/commerceDb');

async function getTicketCatalog() {
    const { publishedTiers } = require('../routes/publishedEvents');
    return publishedTiers();
}

exports.getTicketCatalog = getTicketCatalog;

exports.getAllTiers = async (req, res, next) => {
    try {
        const catalog = await getTicketCatalog();
        const availMap = await bulkAvailability(
            catalog.map(item => ({ product: 'ticket:' + item.tierKey, capacity: item.remainingAllocation }))
        );
        const data = catalog.map(item => ({
            ...item,
            remainingAllocation: availMap.get('ticket:' + item.tierKey) ?? item.remainingAllocation
        }));
        res.json({ success: true, count: data.length, data });
    } catch (error) {
        next(error);
    }
};

exports.validatePromo = (req, res) => {
    const promo = demoEnabled() && require('../services/promos').getPromo(req.body?.code);
    if (!promo) return res.status(400).json({ success: false, message: 'Promo code is unavailable.' });
    res.json({ success: true, ...promo });
};
