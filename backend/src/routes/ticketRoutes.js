const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');

router.get('/', ticketController.getAllTiers);
router.post('/validate-promo', ticketController.validatePromo);

module.exports = router;
