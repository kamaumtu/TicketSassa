const express = require('express');
const router = express.Router();
const zoneController = require('../controllers/zoneController');

router.get('/', zoneController.getAllZones);
router.get('/:key', zoneController.getZoneByKey);

module.exports = router;
