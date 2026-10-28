const {
  validateDirectPayRequest,
  toPaisas,
  generateTransactionId,
  generateChecksum,
  buildPayinUrl
} = require("../../helper/directPayUtil");

exports.createDirectPayPayment = async (req, res) => {
  try {
 

    const {
      planId,
      amount,
      payerName,
      email,
      msisdn,
      successRedirectUrl,
      failedRedirectUrl
    } = req.body;
    // Oct 2026 security pass: the logged-in user (route has validateToken),
    // never a userId from the body.
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.json({ status: "0", message: "User not loggedIn!" });
    }

    // 1. The amount must be a real price of this plan right now: one of its
    //    Price rows, or her live end-of-trial offer price (helper/trialOffer.js).
    const { Price, TrialOffer } = require("../../models");
    const prices = planId ? await Price.findAll({ where: { planId }, attributes: ["id", "priceAmount", "durationId"] }) : [];
    let match = prices.find((p) => Number(p.priceAmount) > 0 && Number(p.priceAmount) === Number(amount));
    if (!match && planId && TrialOffer) {
      try {
        const offer = await TrialOffer.findOne({ where: { userId, redeemedAt: null } });
        if (offer && new Date(offer.expiresAt) > new Date()) {
          const items = typeof offer.items === "string" ? JSON.parse(offer.items) : offer.items;
          const item = (items || []).find(
            (i) => Number(i.planId) === Number(planId) && Number(i.offerPrice) > 0 && Number(i.offerPrice) === Number(amount)
          );
          if (item) match = { priceAmount: item.offerPrice, durationId: item.durationId };
        }
      } catch (e) {
        console.warn("[directpay] trial offer check:", e.message);
      }
    }
    if (!match) {
      return res.json({ status: "0", message: "Price changed, please refresh plans" });
    }

    // 2. Amount → paisas
    const amountPaisas = toPaisas(amount);

    // 3. IDs & description
    const clientTransactionId = generateTransactionId(planId, userId);
    // Payment attempts (analytics add-on): she opened DirectPay.
    // payment_success later needs this row (one use, within 3 hours).
    await require("../../helper/purchaseLedger").directPayStarted({
      userId,
      planId,
      amount: Number(match.priceAmount),
      durationId: match.durationId,
      ref: clientTransactionId,
    });
    const description = `Fit Her Plan ${planId}`;

    // 4. Checksum
    const checksum = generateChecksum(
      clientTransactionId,
      description,
      amountPaisas
    );

    // 5. Build final URL
    const paymentUrl = buildPayinUrl({
      clientTransactionId,
      amountPaisas,
      description,
      payerName,
      email,
      msisdn,
      checksum,
      successRedirectUrl,
      failedRedirectUrl
    });

    // 6. Respond
    return res.json({
      status: "1",
      message: "OK",
      data: {
        url: paymentUrl,
        client_transaction_id: clientTransactionId
      }
    });

  } catch (error) {
    console.error("DirectPay Controller Error:", error);
    return res.json({
      status: "0",
      message: "Internal server error"
    });
  }
};
