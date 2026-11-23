const express = require('express');
const commerce = require('../controllers/commerceController');
const router = express.Router();

router.get('/mode', commerce.getCheckoutMode);
router.get('/methods', commerce.getPaymentMethods);
router.get('/payhero/balance', commerce.getPayHeroBalance);
router.post('/mpesa/stkpush', commerce.initiateMpesaStkPush);
router.post('/card/initiate', commerce.initiateCardPayment);
router.post('/card/verify', commerce.verifyCardPayment);
router.get('/status/:orderReference', commerce.getPaymentStatus);
router.post('/demo/confirm', commerce.confirmDemo);
router.post('/mpesa/callback', commerce.mpesaCallback);
router.post('/payhero/callback', commerce.payheroCallback);
router.post('/nexuspay/callback', commerce.nexuspayCallback);

module.exports = router;
