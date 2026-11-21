const express = require('express');
const commerce = require('../controllers/commerceController');
const router = express.Router();

router.get('/verify/:qrToken', commerce.verifyPass);
router.post('/redeem/:qrToken', commerce.redeemPass);
router.get('/qr/:qrToken', commerce.passQr);
router.get('/:qrToken/pdf', commerce.passPdf);

module.exports = router;
