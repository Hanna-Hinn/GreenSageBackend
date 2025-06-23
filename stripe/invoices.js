const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.SECRET_KEY, { apiVersion: "2023-10-16" });

const User = require("../models/userModel");
const asyncWrapper = require("../middleware/asyncWrapper");
const { createCustomError } = require("../utils/customError");

/**
 * GET /api/invoices/:userId
 * Returns [{ id, number, amount_due, status, hosted_invoice_url, created }]
 */
router.get(
  "/api/invoices/:userId",
  asyncWrapper(async (req, res, next) => {
    const { userId } = req.params;

    /* 1. sanity */
    if (!mongoose.Types.ObjectId.isValid(userId))
      return next(createCustomError(`Invalid userId: ${userId}`, 400));

    /* 2. get Stripe customer id */
    const user = await User.findById(userId);
    if (!user) return next(createCustomError("User not found", 404));
    if (!user.stripeCustomerId) return res.json({ invoices: [] }); // none yet

    /* 3. fetch invoices from Stripe */
    const { data: invoices } = await stripe.invoices.list({
      customer: user.stripeCustomerId,
      limit: 100, // adjust as needed
    });

    /* 4. shape & send */
    res.json({
      invoices: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        amount: inv.amount_due / 100, // dollars
        status: inv.status, // draft, open, paid, void, etc.
        url: inv.hosted_invoice_url,
        created: inv.created * 1000, // ms epoch
      })),
    });
  })
);

module.exports = router;
