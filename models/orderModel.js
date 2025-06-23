const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User", // Reference the User model
    required: true,
  },
  date: {
    type: Date,
    require: true,
  },
  deliveryFee: {
    type: Number,
    required: true,
  },
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Payment", // Reference the User model
    required: false,
  },
  paymentStatus: {
    type: String,
    enum: ["pending", "paid"],
    default: "pending",
  },
  shipmentStatus: {
    type: String,
    enum: ["pending", "shipped", "delivered"],
    default: "pending",
  },
  userAddress: {},
  userName: {},
  totalPrice: Number,
  cartItems: [],
  stripeInvoiceId: String,
  stripeInvoiceUrl: String,
});

module.exports = mongoose.model("Order", orderSchema);
