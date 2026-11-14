const express = require('express');
const router = express.Router();
const merchController = require('../controllers/merchController');

router.get('/', merchController.getAllMerch);
router.post('/validate-promo', merchController.validatePromo);

module.exports = router;

