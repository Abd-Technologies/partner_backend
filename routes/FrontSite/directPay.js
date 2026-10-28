const express = require("express");
const router = express.Router();
const directPayController =require('../../controllers/FrontSite/directPayController');
const { validateToken } = require("../../middlewares/AuthorizationMW");


router.post(
  "/directpay_payment",
  validateToken,
  directPayController.createDirectPayPayment
);

module.exports = router;
