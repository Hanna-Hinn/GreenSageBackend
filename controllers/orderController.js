const Order = require("../models/orderModel");
const Cart = require("../models/cartModel");
const User = require("../models/userModel");
const Payment = require("../models/paymentModel");
// const Shipping = require('../models/shippingModel');
const Product = require("../models/productModel");
const Notification = require("../models/notificationModel");
const asyncWrapper = require("../middleware/asyncWrapper");
const { createCustomError } = require("../utils/customError");
const { DELIVERY_FEES } = require("../constants");
const mongoose = require("mongoose");
const {
  connectedUsers,
  emitOrderNotificationToConnectedUsers,
  OrdersStatus,
} = require("../socket");
const { toCents } = require("../utils/money");
require("dotenv").config({ path: "../.env" });
const stripe = require("stripe")(process.env.SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// createOrder Endpoint/API
const createOrder = asyncWrapper(async (req, res, next) => {
  const { id: userId } = req.params;
  const {
    shipmentStatus = "pending",
    paymentMethod = "cod",
    addressId,
  } = req.body;

  if (!mongoose.Types.ObjectId.isValid(userId))
    return next(createCustomError(`Invalid user ID: ${userId}`, 400));

  if (!addressId || !mongoose.Types.ObjectId.isValid(addressId)) {
    return next(
      createCustomError(`Invalid or missing address ID: ${addressId}`, 400)
    );
  }

  const cart = await Cart.findOne({ userId });
  if (!cart) return next(createCustomError("Cart not found", 404));
  if (!cart.cartItems.length)
    return next(createCustomError("Cart is empty", 400));

  const user = await User.findById(userId);
  if (!user) return next(createCustomError("User not found", 404));

  const userName = `${user.firstName} ${user.lastName}`;
  const selectedAddress =
    typeof user.addresses.id === "function"
      ? user.addresses.id(addressId)
      : user.addresses.find((a) => a._id.toString() === addressId);

  if (!selectedAddress) {
    return next(
      createCustomError(
        `Address ${addressId} not found for user ${userId}`,
        404
      )
    );
  }

  const { totalPrice, cartItems } = cart;
  const totalPriceValue =
    cart.totalPrice instanceof mongoose.Types.Decimal128
      ? parseFloat(cart.totalPrice.toString())
      : cart.totalPrice;

  const adjustedTotalPrice = totalPriceValue + DELIVERY_FEES;

  const order = await Order.create({
    userId,
    date: new Date(),
    deliveryFee: DELIVERY_FEES,
    paymentStatus: paymentMethod === "cod" ? "pending" : "paid",
    shipmentStatus,
    userAddress: selectedAddress,
    totalPrice: adjustedTotalPrice,
    cartItems,
    userName,
  });

  const cartItemIds = cartItems.map((ci) => ci._id);
  await updateProductStockInCart(order._id);

  await user.updateOne({ $push: { orders: order._id } });
  await Cart.findByIdAndUpdate(cart._id, {
    totalPrice: 0,
    totalItems: 0,
    $set: { cartItems: [] },
  });
  await Product.updateMany(
    { cartItems: { $in: cartItemIds } },
    { $pullAll: { cartItems: cartItemIds } }
  );

  let stripeCustomerId = user.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: userName,
    });
    stripeCustomerId = customer.id;
    user.stripeCustomerId = customer.id;
    await user.save();
  }

  for (const ci of cartItems) {
    const priceValue =
      ci.price instanceof mongoose.Types.Decimal128
        ? parseFloat(ci.price.toString())
        : ci.price;

    await stripe.invoiceItems.create({
      customer: stripeCustomerId,
      description: ci.productName,
      quantity: ci.quantity,
      unit_amount: toCents(priceValue),
      currency: "usd",
    });
  }

  console.log("Cart items with prices:");
  cartItems.forEach((ci, i) => {
    console.log(`Item ${i + 1}:`, {
      price: ci.price,
      type: typeof ci.price,
      asString: ci.price.toString(),
      asFloat: parseFloat(ci.price.toString()),
    });
  });

  await stripe.invoiceItems.create({
    customer: stripeCustomerId,
    description: "Shipping",
    quantity: 1,
    unit_amount: toCents(DELIVERY_FEES),
    currency: "usd",
  });

  const invoice = await stripe.invoices.create({
    customer: stripeCustomerId,
    collection_method: "charge_automatically",
    metadata: { orderId: order._id.toString() },
  });
  const finalised = await stripe.invoices.finalizeInvoice(invoice.id);

  order.stripeInvoiceId = finalised.id;
  order.stripeInvoiceUrl = finalised.hosted_invoice_url;
  await order.save();

  res.status(201).json({
    msg: "Order created successfully",
    success: true,
    data: order,
    invoiceUrl: finalised.hosted_invoice_url,
  });
});

const createPaymentIntent = asyncWrapper(async (req, res, next) => {
  const { userId, country } = req.body;
  // console.log(userId);
  // console.log(country);

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(createCustomError(`Invalid userId ID: ${userId}`, 400));
  }

  const cart = await Cart.findOne({ userId });

  if (!cart) {
    return next(createCustomError("Cart not found for the given user", 404));
  }

  // Convert the total price to cents
  const totalPriceValue =
    cart.totalPrice instanceof mongoose.Types.Decimal128
      ? parseFloat(cart.totalPrice.toString())
      : cart.totalPrice;

  const adjustedTotalPrice = Math.round(
    (totalPriceValue + DELIVERY_FEES) * 100
  );

  const user = await User.findById(userId);

  if (!user) {
    return next(createCustomError("User not found", 404));
  }

  // // Validate userAddressIndex against the number of addresses
  // if (userAddressIndex < 0 || userAddressIndex >= user.addresses.length) {
  //     return next(createCustomError('Invalid userAddressIndex', 400));
  // }

  // Get the selected address
  const selectedAddress = user.addresses[0];

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

  const { firstName, lastName, email, mobile } = user;
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
      phone: mobile,
      address: {
        city: selectedAddress.city,
        country,
        line1: selectedAddress.street,
        postal_code: selectedAddress.postalCode,
        state: selectedAddress.state,
      },
    },
    amount: adjustedTotalPrice,
    currency: "usd",
    payment_method_types: ["card"],
  });

  console.log(paymentIntent);

  res.json({ clientSecret: paymentIntent.client_secret });
});

// Function to update product stock in the cart
async function updateProductStockInCart(orderId) {
  const order = await Order.findById(orderId).lean();
  if (!order) throw new Error("Order not found");

  await Promise.all(
    order.cartItems.map((ci) =>
      Product.updateOne(
        { _id: ci.productId },
        { $inc: { availableInStock: -ci.quantity } },
        { runValidators: false } // <- skip category check
      )
    )
  );
}

// getOrders Endpoint/API
const getOrders = asyncWrapper(async (req, res, next) => {
  const orders = await Order.find();

  res.status(200).json({
    success: true,
    msg: "Orders fetched successfully",
    data: orders,
  });
});

// getOrdersForUser Endpoint/API
const getOrdersForUser = asyncWrapper(async (req, res, next) => {
  const { id: userId } = req.params;

  // Check if the userId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(createCustomError(`Invalid userId ID: ${userId}`, 400));
  }

  // Find orders for the given user
  const orders = await Order.find({ userId }).lean();

  const user = await User.findById(userId).select("firstName lastName");
  const userName = `${user.firstName} ${user.lastName}`;

  const paymentIds = orders.map((order) => order.paymentId);

  // Fetch payment details for each paymentId
  const paymentType = await Promise.all(
    paymentIds.map(async (paymentId) => {
      const payment = await Payment.findById(paymentId);
      return payment ? payment.type : "Unknown";
    })
  );

  console.log(userName);
  console.log(paymentType);

  // Combine userName and paymentType with each order
  const ordersWithDetails = await Promise.all(
    orders.map(async (order, idx) => {
      /* ensure every cartItem has product name  image */
      const cartItems = await Promise.all(
        order.cartItems.map(async (item) => {
          if (item.productName) return item; // already enriched
          const p = await Product.findById(item.productId).select("name image");
          return {
            ...item,
            productName: p?.name ?? "Unknown",
            productImage: p?.image ?? null,
          };
        })
      );
      return {
        ...order,
        cartItems,
        userName,
        paymentType: paymentType[idx],
      };
    })
  );

  res.status(200).json({
    success: true,
    msg: "Orders fetched successfully for the user",
    data: ordersWithDetails,
  });
});

// getOrder Endpoint/API
const getOrder = asyncWrapper(async (req, res, next) => {
  const { id: orderId } = req.params;

  // Check if the orderId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(createCustomError(`Invalid orderId ID: ${orderId}`, 400));
  }

  const order = await Order.findById(orderId);

  const user = await User.findById(order.userId);
  const userEmail = user.email;
  const userMobile = user.mobile;

  // Fetch product details for each cartItem
  const cartItemsWithProductDetails = await Promise.all(
    order.cartItems.map(async (item) => {
      const product = await Product.findById(item.productId);
      const productName = product.name;

      return {
        ...item,
        productName,
      };
    })
  );

  // Update the order object with cartItems containing productName
  order.cartItems = cartItemsWithProductDetails;

  // Create a new object with the required structure
  const responseData = {
    success: true,
    msg: "Order fetched successfully",
    data: {
      ...order.toObject(),
      userEmail,
      userMobile,
    },
  };

  res.status(200).json(responseData);
});

// updateOrderStatus Endpoint/API
const updateOrderStatus = asyncWrapper(async (req, res, next) => {
  const { id: orderId } = req.params;
  const { shipmentStatus } = req.body;

  // Check if the orderId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return next(createCustomError(`Invalid orderId ID: ${orderId}`, 400));
  }

  // Update the order status
  const updatedOrder = await Order.findByIdAndUpdate(
    { _id: orderId },
    { shipmentStatus },
    { new: true, runValidators: true }
  );

  if (!updatedOrder) {
    return next(createCustomError(`No order found with id: ${orderId}`, 404));
  }

  // // Emit a notification to the user using socket.io
  const userId = updatedOrder.userId.toString();

  // Emit a notification to the user with the updated order status
  const orderStatusUpdated = {
    orderId: updatedOrder._id,
    shipmentStatus: updatedOrder.shipmentStatus,
  };

  console.log(orderStatusUpdated);

  emitOrderNotificationToConnectedUsers(orderStatusUpdated, userId);

  let userIsConnected = false;

  // Iterate over the values in the connectedUsers Map
  for (const connectedUser of connectedUsers.values()) {
    // Check if the user ID matches
    if (connectedUser._id.toString() === userId) {
      console.log(
        `User with ID ${userId} is currently connected, skipping notification storage`
      );
      userIsConnected = true;

      const newNotification = new Notification({
        userId: connectedUser._id,
        status: orderStatusUpdated,
      });
      await newNotification.save();

      break; // Exit the inner loop since we found the user
    }
  }

  // If the user is not connected, store the notification
  if (!userIsConnected) {
    console.log(
      `Notification stored for not connected user with ID: ${userId}`
    );
    if (!OrdersStatus.has(userId)) {
      OrdersStatus.set(userId, []);
    }
    OrdersStatus.get(userId).push(orderStatusUpdated);
  }

  res.status(200).json({
    success: true,
    message: "Order status updated successfully",
    data: updatedOrder,
  });
});

// getOwnerOrders Endpoint/API
const getOwnerOrders = asyncWrapper(async (req, res, next) => {
  const { id: userId } = req.params;

  // Check if the userId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(createCustomError(`Invalid orderId ID: ${userId}`, 400));
  }

  const user = await User.findById(userId);
  const fullName = `${user.firstName} ${user.lastName}`;
  // console.log(fullName);

  const orders = await Order.find({});
  const allCartItems = orders.flatMap((order) => order.cartItems);

  const matchingCartItems = allCartItems.filter(
    (item) => item.ownerName === fullName
  );
  // console.log(matchingCartItems);

  const matchingOrders = orders
    .filter((order) =>
      order.cartItems.some((cartItem) =>
        matchingCartItems.some((matchingItem) =>
          matchingItem._id.equals(cartItem._id)
        )
      )
    )
    .map((order) => {
      const matchingOrder = {
        ...order.toObject(),
        cartItems: order.cartItems
          .filter((cartItem) =>
            matchingCartItems.some((matchingItem) =>
              matchingItem._id.equals(cartItem._id)
            )
          )
          .flat(), // Flatten the cartItems array
      };

      // Calculate the correct total price for matchingOrder
      matchingOrder.totalPrice = matchingOrder.cartItems.reduce(
        (total, cartItem) => total + cartItem.itemTotalPrice,
        0
      );

      return matchingOrder;
    });

  const OrdersNumber = matchingOrders.length;

  res.status(200).json({
    success: true,
    message: "Owner orders fetched successfully",
    data: { matchingOrders, OrdersNumber },
  });
});

module.exports = {
  createOrder,
  getOrders,
  getOrder,
  getOrdersForUser,
  updateOrderStatus,
  getOwnerOrders,
  createPaymentIntent,
};
