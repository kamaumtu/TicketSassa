const { bulkAvailability, demoEnabled } = require('../services/commerceDb');

let cachedTiers = null;
let cachedTiersAt = 0;

async function getTicketCatalog() {
    const { publishedTiers } = require('../routes/publishedEvents');
    return publishedTiers();
}

exports.getTicketCatalog = getTicketCatalog;

exports.getAllTiers = async (req, res, next) => {
    try {
        if (cachedTiers && Date.now() - cachedTiersAt < 5000) {
            return res.json({ success: true, count: cachedTiers.length, data: cachedTiers });
        }
        const catalog = await getTicketCatalog();
        const availMap = await bulkAvailability(
            catalog.map(item => ({ product: 'ticket:' + item.tierKey, capacity: item.remainingAllocation }))
        ).catch(() => new Map());
        const data = catalog.map(item => ({
            ...item,
            remainingAllocation: availMap.get('ticket:' + item.tierKey) ?? item.remainingAllocation
        }));
        cachedTiers = data;
        cachedTiersAt = Date.now();
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
