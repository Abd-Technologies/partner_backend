const express = require("express");
const router = express.Router();
const directPayController =require('../../controllers/FrontSite/directPayController');


router.post(
  "/directpay_payment",
  directPayController.createDirectPayPayment
);

module.exports = router;
