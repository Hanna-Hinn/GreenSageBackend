const asyncWrapper = require('../../middleware/asyncWrapper');
const { createCustomError } = require('../customError');

const express = require('express');
const router = express.Router();

const User = require('../../models/userModel');
const Cart = require('../../models/cartModel');


router.post('/api/register', asyncWrapper(async (req, res, next) => {
    const { firstName, lastName, email, mobile, password, imageUrl, addresses } = req.body;

    if (!firstName || !lastName || !email || !mobile || !password || !imageUrl || !addresses) {
        return next(createCustomError('Please provide all required fields', 400));
    }

    const alreadyExistsUser = await User.findOne({ where: { email } }).catch((err) => {
        console.log('Error:', err);
    });

    if (alreadyExistsUser) {
        return next(createCustomError(`User with ${email} already exists`, 400));
    }

    const userAddresses = addresses.map(address => ({
        street: address.street,
        postalCode: address.postalCode,
        state: address.state,
        city: address.city,
    }));

    const newUser = await User.create({
        firstName,
        lastName,
        email,
        mobile,
        password,
        imageUrl,
        role: 'customer',
        addresses: userAddresses,
    });

    const savedUser = await newUser.save().catch((err) => {
        console.log('Error: ', err);
        return next(createCustomError(`Can't register user at the moment`, 400));
    });

    // Create the cart associated with the user
    const cart = await Cart.create({
        totalPrice: 0,
        userId: newUser._id,
    });

    // Set the user's cart field to the cart's _id
    newUser.cart = cart._id;
    await newUser.save();

    if (savedUser) {
        res.status(200).json({
            success: true,
            message: 'Thanks for registering',
        });
    }
}));

module.exports = router;
