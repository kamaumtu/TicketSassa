const { bulkAvailability, demoEnabled, collection } = require('../services/commerceDb');
const { isRemovedVenue } = require('../services/eventVisibility');
const { defaultProviders } = require('../services/providers/eventSyncService');

async function getTicketCatalog() {
    const { publishedTiers } = require('../routes/publishedEvents');
    const published = await publishedTiers();
    const providerDocs = await Promise.all(
        defaultProviders
            .filter(p => p.isEnabled(process.env))
            .map(p => collection('event_catalogs').findOne({ _id: p.endpointKey }).catch(() => null))
    );
    const providerTiers = providerDocs
        .flatMap(doc => doc?.events ?? [])
        .filter(event => !isRemovedVenue(event) && event.status !== 'cancelled' && Date.parse(event.startsAt) > Date.now() && event.checkout)
        .flatMap(event => Array.isArray(event.tiers) ? event.tiers : []);
    const byKey = new Map([...providerTiers, ...published]
        .filter(tier => tier?.tierKey).map(tier => [tier.tierKey, { ...tier, published: true }]));
    return [...byKey.values()];
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
