const express = require('express');
const commerce = require('../controllers/commerceController');
const router = express.Router();

router.post('/', commerce.createOrder);
router.post('/lookup', commerce.lookupOrder);
router.get('/:ref', commerce.getOrderByReference);

module.exports = router;
