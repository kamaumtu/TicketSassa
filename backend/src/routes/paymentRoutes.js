const express = require('express');
const commerce = require('../controllers/commerceController');
const router = express.Router();

router.get('/mode', commerce.getCheckoutMode);
router.post('/mpesa/stkpush', commerce.initiateMpesaStkPush);
router.post('/demo/confirm', commerce.confirmDemo);
router.post('/mpesa/callback', (req, res) => res.status(503).json({
    success: false, message: 'Live M-Pesa is not configured.'
}));

module.exports = router;
