const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Cart = require("../models/cartModel");
const User = require("../models/userModel");
const { createCustomError } = require("../utils/customError");
const { DELIVERY_FEES } = require("../constants");
require("dotenv").config({ path: "../.env" });
const stripe = require("stripe")(process.env.SECRET_KEY);

router.post("/api/create-payment-intent", async (req, res, next) => {
  try {
    const { userId, country } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return next(createCustomError(`Invalid userId ID: ${userId}`, 400));
    }

    const cart = await Cart.findOne({ userId });

    if (!cart) {
      return next(createCustomError("Cart not found for the given user", 404));
    }

    const { totalPrice } = cart;

    // Convert the total price to cents
    const adjustedTotalPrice = Math.round(
      (Number(totalPrice) + DELIVERY_FEES) * 100
    );

    const user = await User.findById(userId);

    if (!user) {
      return next(createCustomError("User not found", 404));
    }

    let stripeCustomer;

    if (!user.stripeCustomerId) {
      // If user does not have a Stripe customer ID, create a new customer
      stripeCustomer = await stripe.customers.create({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        // Add other relevant customer details
      });

      // Update the user in your database with the new Stripe customer ID
      user.stripeCustomerId = stripeCustomer.id;
      await user.save();
    } else {
      // If user already has a Stripe customer ID, retrieve the customer
      stripeCustomer = await stripe.customers.retrieve(user.stripeCustomerId);
    }

    const { firstName, lastName, email } = user;
    const userName = `${firstName} ${lastName}`;

    if (cart.cartItems.length === 0) {
      return next(createCustomError("Cart is empty", 400));
    }

    const paymentIntent = await stripe.paymentIntents.create({
      customer: stripeCustomer.id,
      receipt_email: email,
      description: "Your purchase description",
      shipping: {
        name: userName,
        address: {
          country,
        },
      },
      amount: adjustedTotalPrice,
      currency: "usd",
      payment_method_types: ["card"],
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Error creating payment intent:", error.message);
    res.status(500).send({ error: "Error creating payment intent" });
  }
});

module.exports = router;
