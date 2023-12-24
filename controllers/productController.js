const Product = require('../models/productModel');
const Category = require('../models/categoryModel');
const User = require('../models/userModel');
const asyncWrapper = require('../middleware/asyncWrapper');
const { createCustomError } = require('../utils/customError');
const mongoose = require('mongoose');
const { getCategoryNameById } = require('../services/categoryServices');
const { PAGE_SIZE } = require('../constants');


// createProduct Endpoint/API
const createProduct = asyncWrapper(async (req, res, next) => {
    const { name, description, price, availableInStock, imageUrl, categoryId } = req.body;

    if (!name || !description || !price || !availableInStock || !imageUrl || !categoryId) {
        console.log('Missing required fields');
        return next(createCustomError('Please provide all required fields', 400));
    }

    // Check for existing product with the same name and description
    const existingProduct = await Product.findOne({ name, description });

    if (existingProduct) {
        return next(createCustomError('Product with the same name and description already exists', 400));
    }

    const category = await Category.findById(categoryId);

    if (!category) {
        return next(createCustomError('Category does notexist', 400));
    }

    // Fetch user details
    const createdBy = req.user.id;
    const user = await User.findOne({ _id: createdBy });
    console.log(user);
    // Access user's firstName
    const firstName = user.firstName;
    const lastName = user.lastName;
    console.log(firstName + lastName);

    const owner = `${firstName} ${lastName}`;

    // const product = await Product.create(req.body, owner);   // Or
    const product = await Product.create({
        name,
        description,
        price,
        availableInStock,
        imageUrl,
        categoryId,
        owner
    });

    // Update the associated category with the new product reference
    await category.updateOne(
        { $push: { products: product._id } },
        { new: true }
    );

    console.log('Product created successfully');
    res.status(201).json({
        msg: `Product created successfully`,
        success: true,
        data: product,
    });
});

// getProducts Endpoint/API
const getProducts = asyncWrapper(async (req, res, next) => {
    const { pageNumber } = req.query;

    if (!pageNumber) {
        return next(createCustomError('Page Number is missing', 400));
    }

    if (isNaN(pageNumber) || pageNumber < 1) {
        return next(createCustomError('Invalid Page Number', 400));          //###############
    }

    const newPageOffset = pageNumber === 1 ? 0 : (pageNumber - 1) * PAGE_SIZE;
    const products = await Product.find({})
        .skip(newPageOffset)
        .limit(PAGE_SIZE);
    const totalProducts = await Product.find({}).count();
    const totalPages = Math.ceil(totalProducts / PAGE_SIZE);          //###############

    if (pageNumber > totalPages) {                                   //###############
        return next(createCustomError('Page Number exceeds total pages', 400));
    }

    res.status(200).json({
        msg: `Products fetched successfully`,
        success: true,
        data: { products, totalProducts, totalPages }     //###############
    });
});

// getProduct Endpoint/API
const getProduct = asyncWrapper(async (req, res, next) => {
    const { id: productId } = req.params;

    // Check if the productId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return next(createCustomError(`Invalid productId ID: ${productId}`, 400));
    }
    // -----------------------------------------------------------------------------------------------------
    // Fetch the product and populate its 'ratings' field
    const product = await Product.findById(productId).populate('ratings', '-ratingId -__v');

    // Check if the productId exists
    if (!product) {
        return next(createCustomError(`No product with id: ${productId}`, 404));
    }

    // Calculate the average rating
    const averageRating = product.averageRating;

    const categoryId = product.categoryId;

    // Fetch the category and all its fields
    // const category = await Category.findById(categoryId);

    // Fetch the category name
    const categoryName = await getCategoryNameById(categoryId);

    res.status(200).json({
        msg: `Product fetched successfully`,
        success: true,
        data: { product, averageRating, categoryName }
    })
});


// updateProduct Endpoint/API
const updateProduct = asyncWrapper(async (req, res, next) => {
    const { id: productId } = req.params;

    // Check if the productId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return next(createCustomError(`Invalid productId ID: ${productId}`, 400));
    }

    const existingProduct = await Product.findById(productId);

    // Check if the productId exists
    if (!existingProduct) {
        return next(createCustomError(`No product with id: ${productId}`, 404));
    }

    // const existingProductData = {
    //     name: existingProduct.name,
    //     description: existingProduct.description,
    //     price: existingProduct.price,
    //     availableInStock: existingProduct.price,
    //     imageUrl: existingProduct.imageUrl,
    //     categoryId: existingProduct.categoryId
    // }

    // // Check if the req.body is the same as existing product data
    // if (JSON.stringify(existingProductData) === JSON.stringify(req.body)) {
    //     return next(createCustomError('Nothing to update', 400))

    // }

    // console.log(JSON.stringify(existingProductData));
    // console.log(JSON.stringify(req.body));



    // The approach to update the productId in Category
    // Get the categoryId of the product

    const updatedProduct = await Product.findByIdAndUpdate({ _id: productId }, req.body, {
        new: true,
        runValidators: true
    })

    const categoryId = await Category.findById(req.body.categoryId)

    if (!categoryId) {
        return next(createCustomError('Category does not exist', 400));
    }

    const existingCategoryId = existingProduct.categoryId;

    // Remove the product reference from the associated category
    await Category.findByIdAndUpdate(
        existingCategoryId,
        { $pull: { products: productId } },
        { new: true }
    );

    // Update the associated category with the new product reference
    await Category.updateOne(
        { _id: req.body.categoryId },
        { $push: { products: productId } },
        { new: true }
    );

    res.status(200).json({
        msg: `Product updated successfully`,
        success: true,
        data: updatedProduct
    })
});


// deleteProduct Endpoint/API
const deleteProduct = asyncWrapper(async (req, res, next) => {
    const { id: productId } = req.params;

    // Check if the productId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return next(createCustomError(`Invalid productId ID: ${productId}`, 400));
    }

    const existingProduct = await Product.findById(productId);

    // Check if the productId exists
    if (!existingProduct) {
        return next(createCustomError(`No product with id: ${productId}`, 404));
    }

    // Get the categoryId of the product
    const categoryId = existingProduct.categoryId;

    if (!categoryId) {
        return next(createCustomError('Category does not exist', 400));
    }

    // Remove the product reference from the associated category
    await Category.findByIdAndUpdate(
        categoryId,
        { $pull: { products: productId } },
        { new: true }
    );

    // Delete the product
    await existingProduct.deleteOne();

    res.status(200).json({
        msg: `Product deleted successfully`,
        success: true,
    });
});

const search = asyncWrapper(async (req, res, next) => {
    const { categoryName, productName, description, ownerName } = req.query;

    const query = {};

    if (categoryName) {
        // Make the search for category name case-insensitive
        const categoryRegex = new RegExp(categoryName, 'i');
        const category = await Category.findOne({ name: { $regex: categoryRegex } });

        if (category) {
            query.categoryId = category._id;
        } else {
            return res.status(400).json({ success: false, msg: 'Category not found' });
        }
    }

    if (productName) {
        query.name = { $regex: productName, $options: 'i' };
    }

    if (description) {
        query.description = { $regex: description, $options: 'i' };
    }

    if (ownerName) {
        query.owner = { $regex: ownerName, $options: 'i' };
    }

    const products = await Product.find(query);

    res.status(200).json({
        success: true,
        msg: 'Products fetched successfully',
        data: products,
    });
});

const getRelatedProducts = asyncWrapper(async (req, res, next) => {
    const userId = req.params.userId;

    // Find user by ID
    const user = await User.findById(userId);
    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Build a query based on the healthStatus fields
    const healthStatusQuery = Object.keys(user.healthStatus)
        .filter(key => user.healthStatus[key])
        .map(key => ({ description: new RegExp(key, 'i') }));

    if (healthStatusQuery.length === 0) {
        return res.status(200).json({ success: true, data: [] }); // No healthStatus fields selected
    }

    // Find products matching the healthStatus criteria
    const products = await Product.find({ $or: healthStatusQuery });

    res.status(200).json({ success: true, data: products });
});


module.exports = {
    createProduct,
    getProducts,
    getProduct,
    updateProduct,
    deleteProduct,
    getRelatedProducts,
    search
}
