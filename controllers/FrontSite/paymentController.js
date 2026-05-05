const stripe = require('stripe')('sk_test_51JScKSIUi1Nn55FGHGE4jQorQhzXXvYGSF9cW0gsgIQiYo5Sc9JwUAGKiQyAMHZj5ktbrV406c6UDbx5zZfpuRfP00TvGURXOz');
const { User, UserPlan, Plan, Wallet, ShippingSchedule } = require("../../models");
const ApiResponse = require("../../helper/ApiResponse");
const bcrypt = require("bcryptjs");
const { sign } = require("jsonwebtoken");
const sentOtpMail = require("../../helper/sentOtpMail");
var otp = require("otpauth");

async function stripe_payment(req, res) {
  try {
    
    const { amount, cardNo, exp_year, exp_month, cvc, planId } = req.body;
    const checkPlan = await UserPlan.findOne({where:[{status:true},{PlanId:planId},{UserId:req.user.id}]});
    if(checkPlan)
    {
      const response = ApiResponse("0","You have already purchased this plan!",{});
      return res.json(response);
    }
    // Create a payment method using the card details
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        number: cardNo,
        exp_month: exp_month,
        exp_year: exp_year,
        cvc: cvc,
      },
    });

    // Create a payment intent using the payment method
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100, // Stripe expects amount in cents
      currency: 'USD',
      payment_method: paymentMethod.id,
      confirm: true,
    });

    const currentDate = new Date();

    const userPlan = new UserPlan();
    userPlan.buyingDate = currentDate;
    userPlan.expireDate = currentDate.setMonth(currentDate.getMonth() + 1);
    userPlan.UserId = req.user.id;
    userPlan.PlanId = planId;
    userPlan.price = amount;
    userPlan.status = true;
    userPlan.subscriptionId = paymentIntent.id;
    userPlan.save().then(async dat => {


      const wallet = new Wallet();
      wallet.amount = amount;
      wallet.UserPlanId = dat.id;
      wallet.status = true;
      await wallet.save();

      sentOtpMail("Purchased Plan", `You have successfully purchased plan ID :$ ${dat.id} with amount of ${amount}`, req.user.email)
      const response = ApiResponse("1", "Payment Done!", {});
      return res.json(response);
    })
      .catch((error) => {
        const response = ApiResponse("0", error.message, {});
        return res.json(response);
      })
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

module.exports = {
  stripe_payment
}