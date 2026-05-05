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
      userId,
      successRedirectUrl,
      failedRedirectUrl
    } = req.body;

    // 2. Amount → paisas
    const amountPaisas = toPaisas(amount);

    // 3. IDs & description
    const clientTransactionId = generateTransactionId(planId, userId);
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
