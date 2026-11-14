const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');

const { createEventCatalog } = require('../config/eventCatalog');
const catalog = createEventCatalog();
catalog.start();

router.catalog = catalog;
router.get('/kenya', async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await catalog.get());
});

router.get('/featured', eventController.getFeaturedEvent);
router.get('/', eventController.getEventsList);

module.exports = router;
