const Cart = require('../models/cartModel');
const User = require('../models/userModel');
const Product = require('../models/productModel');
const asyncWrapper = require('../middleware/asyncWrapper');
const { createCustomError } = require('../utils/customError');
const mongoose = require('mongoose');

// fetchCart Endpoint/API
const fetchCart = asyncWrapper(async (req, res, next) => {
    // const userId = req.body.userId; // Changed later to fetch from the jwt token
    const { id: userId } = req.params;

    // Check if the userID is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return next(createCustomError(`Invalid user ID: ${userId}`, 400));
    }

    // logging the process
    console.log(`Fetching Cart from userId: ${userId}`);

    // Fetching the cart based on the user
    const cart = await Cart.findOne({ userId });

    // If the cart is not found return error
    if (!cart) {
        console.log(`Error Fetching Cart from userId: ${userId}`);
        return next(createCustomError(`Invalid User`, 403));
    }

    // Fetch additional information for each product in cartItems
    const cartItemsWithDetails = await Promise.all(
        cart.cartItems.map(async (cartItem) => {
            const product = await Product.findById(cartItem.productId).populate('ratings');
            // console.log(product);

            if (!product) {
                console.log(`Error Fetching Product for productId: ${cartItem.productId}`);
                return next(createCustomError(`Product not found`, 404));
            }

            return {
                ...cartItem.toObject(),
                averageRating: product.averageRating,
                productName: product.name,
                productImage: product.imageUrl,
            };
        })
    );

    // Create a new cart object with updated cartItems
    const updatedCart = {
        ...cart.toObject(),
        cartItems: cartItemsWithDetails,
    };

    // The cart is Fetched and returned in the response
    return res.status(200).json({
        success: true,
        message: `Cart successfully Fetched`,
        data: updatedCart,
    });
});


const addItemToCart = asyncWrapper(async (req, res, next) => {
    const userId = req.params.userId;
    const productId = req.params.productId;

    // Check if the userID is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return next(createCustomError(`Invalid user ID: ${userId}`, 400));
    }

    // Check if the productId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return next(createCustomError(`Invalid user ID: ${productId}`, 400));
    }

    let quantity = req.body.quantity;

    // logging the process
    console.log('Adding Item to Cart with userId: ' + userId);

    // fetch the user and cart and product
    const fetchedProduct = await Product.findById(productId);
    const user = await User.findById(userId);
    const cart = await Cart.findOne({ userId });

    // If the fetched product does not exist
    if (!fetchedProduct) {
        return next(createCustomError(`Product does not exist`, 404));
    }
    if (!user) {
        return next(createCustomError(`User does not exist`, 404));
    }

    // Check if the cart already contains the product
    const existingCartItem = cart.cartItems.find(item => item.productId.equals(productId));

    if (existingCartItem) {
        // If the cart item already exists, update the quantity
        const totalQuantity = existingCartItem.quantity + quantity;

        if (totalQuantity > fetchedProduct.availableInStock) {
            return res.status(200).json({
                success: false,
                message: 'Required quantity more than the available',
                available_quantity: fetchedProduct.availableInStock,
            });
        }

        const newTotal = parseFloat(cart.totalPrice) + existingCartItem.price * quantity;

        // Calculate itemTotalPrice for the existingCartItem
        const existingItemTotalPrice = (existingCartItem.quantity + quantity) * existingCartItem.price;
        console.log(existingItemTotalPrice);

        // Update the cart's total price and existing cart item's quantity and itemTotalPrice
        await Cart.findByIdAndUpdate(cart._id, {
            totalPrice: newTotal,
        });

        await Cart.findOneAndUpdate(
            { _id: cart._id, 'cartItems.productId': existingCartItem.productId },
            { $set: { 'cartItems.$.quantity': totalQuantity, 'cartItems.$.itemTotalPrice': existingItemTotalPrice } }
        );

        // Update the Product model's cartItems array with quantity and itemTotalPrice
        await Product.findByIdAndUpdate(productId, {
            $set: {
                cartItems: { _id: existingCartItem._id }
            },
        });

        return res.status(200).json({
            success: true,
            message: `Item Added to Cart Successfully`,
            data: { cartItem: existingCartItem }
        });
    } else {
        // If the cart item does not exist, create a new cart item
        const price = fetchedProduct.price;
        const itemTotalPrice = price * quantity; // Calculate itemTotalPrice for the newCartItem

        const newCartItem = {
            _id: new mongoose.Types.ObjectId(),
            price,
            quantity,
            productId: fetchedProduct._id,
            itemTotalPrice: itemTotalPrice, // Add itemTotalPrice to the newCartItem
            ownerName: fetchedProduct.owner
        };

        // Update the cart's total price and add the new cart item
        const newTotal = parseFloat(cart.totalPrice) + itemTotalPrice;
        // console.log("aaaaaaaaaaaaaaaa" + typeof(cart.totalItems = 1));

        await Cart.findByIdAndUpdate(cart._id, {
            totalPrice: newTotal,
            $push: { cartItems: newCartItem },
            totalItems: Number(cart.totalItems + 1),
        });

        // Update the Product model's cartItems array with quantity and itemTotalPrice
        await Product.findByIdAndUpdate(productId, {
            $push: { cartItems: { _id: newCartItem._id } },
        });

        return res.status(200).json({
            success: true,
            message: `Item Added to Cart Successfully`,
            data: newCartItem,
        });
    }
});


// // removeItemFromCart Endpoint/API
// const removeItemFromCart = asyncWrapper(async (req, res, next) => {
//     const userId = req.params.userId;
//     const productId = req.params.productId;

//     // logging the process
//     console.log('Removing Item from Cart with userId: ' + userId);

//     // fetch the cart and product
//     const cart = await Cart.findOne({ userId });
//     const productToRemove = await Product.findById(productId);

//     // If the product to remove does not exist
//     if (!productToRemove) {
//         return next(createCustomError(`Product does not exist`, 404));
//     }

//     // Check if the cart contains the product
//     const existingCartItem = cart.cartItems.find(item => item.productId.equals(productId));

//     if (existingCartItem) {
//         // Calculate the new total price and remove the item from the cart
//         const newTotal = parseFloat(cart.totalPrice) - existingCartItem.price * existingCartItem.quantity;

//         await Cart.findByIdAndUpdate(cart._id, {
//             totalPrice: newTotal,
//             $pull: { cartItems: { productId: existingCartItem.productId } },
//         });

//         return res.status(200).json({
//             success: true,
//             message: `Item Removed from Cart Successfully`,
//             data: existingCartItem,
//         });
//     } else {
//         return res.status(200).json({
//             success: false,
//             message: 'Item not found in the cart',
//         });
//     }
// });

// removeItemFromCart Endpoint/API
const removeItemFromCart = asyncWrapper(async (req, res, next) => {
    const userId = req.params.userId;
    const productId = req.params.productId;

    // Check if the userID is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return next(createCustomError(`Invalid user ID: ${userId}`, 400));
    }

    // Check if the productId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return next(createCustomError(`Invalid user ID: ${productId}`, 400));
    }

    // logging the process
    console.log('Removing Item from Cart with userId: ' + userId);

    // fetch the cart and product
    const cart = await Cart.findOne({ userId });
    const productToRemove = await Product.findById(productId);

    // If the product to remove does not exist
    if (!productToRemove) {
        return next(createCustomError(`Product does not exist`, 404));
    }

    // Check if the cart contains the product
    const existingCartItem = cart.cartItems.find(item => item.productId.equals(productId));

    if (existingCartItem) {
        if (existingCartItem.quantity === 1) {
            // If product quantity is 1 or no quantity is provided, remove the entire product
            const newTotal = parseFloat(cart.totalPrice) - existingCartItem.price * existingCartItem.quantity;

            // Remove the cart item from the Product model's cartItems array
            await Product.findByIdAndUpdate(productId, {
                $pull: { cartItems: existingCartItem._id },
            });

            await Cart.findByIdAndUpdate(cart._id, {
                totalPrice: newTotal,
                $pull: { cartItems: { productId: existingCartItem.productId } },
                totalItems: cart.totalItems - 1
            });

            return res.status(200).json({
                success: true,
                message: `Item Removed from Cart Successfully`,
                data: existingCartItem,
            });
        } else if (existingCartItem.quantity > 1) {
            // If product quantity is more than 1, decrease it by one
            const newTotal = parseFloat(cart.totalPrice) - existingCartItem.price;

            await Cart.findOneAndUpdate(
                { _id: cart._id, 'cartItems.productId': existingCartItem.productId },
                { $inc: { 'cartItems.$.quantity': -1 }, totalPrice: newTotal }
            );

            return res.status(200).json({
                success: true,
                message: `Quantity Decreased by 1 for the Item in Cart`,
                data: existingCartItem,
            });
        }
    } else {
        return res.status(200).json({
            success: false,
            message: 'Item not found in the cart',
        });
    }
});

// // removeProductFromCart Endpoint/API
const removeProductFromCart = asyncWrapper(async (req, res, next) => {
    const userId = req.params.userId;
    const productId = req.params.productId;

    // Check if the userID is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return next(createCustomError(`Invalid user ID: ${userId}`, 400));
    }

    // Check if the productId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return next(createCustomError(`Invalid user ID: ${productId}`, 400));
    }

    // logging the process
    console.log('Removing Item from Cart with userId: ' + userId);

    // fetch the cart and product
    const cart = await Cart.findOne({ userId });
    const productToRemove = await Product.findById(productId);

    // If the product to remove does not exist
    if (!productToRemove) {
        return next(createCustomError(`Product does not exist`, 404));
    }

    // Check if the cart contains the product
    const existingCartItem = cart.cartItems.find(item => item.productId.equals(productId));

    if (existingCartItem) {
        // If product quantity is 1 or no quantity is provided, remove the entire product
        const newTotal = parseFloat(cart.totalPrice) - existingCartItem.price * existingCartItem.quantity;

        // Remove the cart item from the Product model's cartItems array
        await Product.findByIdAndUpdate(productId, {
            $pull: { cartItems: existingCartItem._id },
        });

        await Cart.findByIdAndUpdate(cart._id, {
            totalPrice: newTotal,
            $pull: { cartItems: { productId: existingCartItem.productId } },
            totalItems: cart.totalItems - 1
        });

        return res.status(200).json({
            success: true,
            message: `Item Removed from Cart Successfully`,
            data: existingCartItem,
        });
    } else {
        return res.status(200).json({
            success: false,
            message: 'Item not found in the cart',
        });
    }
});

// clearCart Endpoint/API
const clearCart = asyncWrapper(async (req, res, next) => {
    const userId = req.params.userId;

    // Check if the userID is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return next(createCustomError(`Invalid user ID: ${userId}`, 400));
    }

    // logging the process
    console.log('Clearing Cart for userId: ' + userId);

    // Fetch the cart
    const cart = await Cart.findOne({ userId });

    if (cart) {
        // Clear all items from the cart
        await Cart.findByIdAndUpdate(cart._id, {
            totalPrice: 0,
            totalItems: 0,
            $set: { cartItems: [] },
        });

        // Remove the cart item from the Product model's cartItems array for all products
        await Product.updateMany({
            cartItems: cart._id,
        }, {
            $pull: { cartItems: cart._id },
        });

        return res.status(200).json({
            success: true,
            message: 'Cart Cleared Successfully',
            data: {},
        });
    } else {
        return res.status(200).json({
            success: false,
            message: 'Cart not found for the user',
        });
    }
});


module.exports = {
    fetchCart,
    addItemToCart,
    removeItemFromCart,
    removeProductFromCart,
    clearCart,
}