const Product = require("../models/productModel");
const Category = require("../models/categoryModel");
const User = require("../models/userModel");
const Notification = require("../models/notificationModel");
// const Rating = require('../models/ratingModel');
const asyncWrapper = require("../middleware/asyncWrapper");
const { createCustomError } = require("../utils/customError");
const mongoose = require("mongoose");
const { getCategoryNameById } = require("../services/categoryServices");
const {
  fetchRelatedProducts,
  applyFilterLogic,
} = require("../services/productService");
const { PAGE_SIZE } = require("../constants");
const {
  productNotifications,
  connectedUsers,
  emitProductNotificationToConnectedUsers,
} = require("../socket");

// createProduct Endpoint/API
const createProduct = asyncWrapper(async (req, res, next) => {
  const {
    name,
    description,
    price,
    availableInStock,
    imageUrl,
    categoryId,
    quantityType,
    subCategory,
    avoidIf = [],
    newAdded,
    featured,
    popular,
    topSelling,
  } = req.body;

  if (
    !name ||
    !description ||
    !price ||
    !availableInStock ||
    !imageUrl ||
    !categoryId
  ) {
    return next(createCustomError("Please provide all required fields", 400));
  }

  const duplicate = await Product.findOne({ name, description });
  if (duplicate) {
    return next(
      createCustomError(
        "Product with the same name and description already exists",
        400
      )
    );
  }

  const category = await Category.findById(categoryId);
  if (!category) return next(createCustomError("Category does not exist", 400));

  if (subCategory) {
    const match = category.subCategories?.some(
      (sc) => sc.toLowerCase() === subCategory.toLowerCase()
    );
    if (!match) {
      return next(
        createCustomError(
          `Sub-category "${subCategory}" is not defined for category "${category.name}"`,
          400
        )
      );
    }
  }

  const creator = await User.findById(req.user.id).lean();
  const owner = creator
    ? `${creator.firstName} ${creator.lastName}`
    : "Unknown";

  const product = await Product.create({
    name,
    description,
    price,
    availableInStock,
    imageUrl,
    categoryId,
    category: categoryId,
    ...(quantityType && { quantityType }),
    ...(subCategory && { subCategory }),
    ...(Array.isArray(avoidIf) &&
      avoidIf.length && { avoidIf: avoidIf.map((c) => c.toLowerCase()) }),
    owner,
    newAdded,
    featured,
    popular,
    topSelling,
  });

  const productNotification = {
    message: "A new product has been created!",
    product,
  };
  emitProductNotificationToConnectedUsers(productNotification);

  const allUsers = await User.find({});
  for (const u of allUsers) {
    const uid = u._id.toString();
    const isConnected = [...connectedUsers.values()].some(
      (cu) => cu._id.toString() === uid
    );

    if (isConnected) {
      await new Notification({ userId: uid, product: product._id }).save();
    } else {
      if (!productNotifications.has(uid)) productNotifications.set(uid, []);
      productNotifications.get(uid).push(productNotification);
    }
  }

  await category.updateOne({ $push: { products: product._id } });

  res.status(201).json({
    msg: "Product created successfully",
    success: true,
    data: product,
  });
});

// getProducts Endpoint/API
const getProducts = asyncWrapper(async (req, res, next) => {
  const { pageNumber } = req.query;

  if (!pageNumber) {
    return next(createCustomError("Page Number is missing", 400));
  }

  if (isNaN(pageNumber) || pageNumber < 1) {
    return next(createCustomError("Invalid Page Number", 400));
  }

  const newPageOffset = pageNumber === 1 ? 0 : (pageNumber - 1) * PAGE_SIZE;

  // Populate the 'ratings' field for each product
  const products = await Product.find({})
    .skip(newPageOffset)
    .limit(PAGE_SIZE)
    .populate({
      path: "ratings",
      select: "-ratingId -__v",
    });

  const totalProducts = await Product.countDocuments({});
  const totalPages = Math.ceil(totalProducts / PAGE_SIZE);

  if (pageNumber > totalPages) {
    return next(createCustomError("Page Number exceeds total pages", 400));
  }

  // Access the virtual field 'averageRating' for each product
  const productsWithDetails = await Promise.all(
    products.map(async (product) => {
      const categoryId = product.categoryId;
      const categoryName = await getCategoryNameById(categoryId);

      const averageRating = product.averageRating;

      // Fetch user details for each rating
      const userIds = product.ratings.map((rating) => rating.userId);
      const ratingUsers = await Promise.all(
        userIds.map((userId) => User.findById(userId))
      );

      // Extract relevant information from each user
      const ratingDetails = product.ratings.map((rating, index) => ({
        rating: {
          _id: rating._id,
          userName: ratingUsers[index]
            ? `${ratingUsers[index].firstName} ${ratingUsers[index].lastName}`
            : "Unknown",
          title: rating.title,
          rating: rating.rating,
          description: rating.description,
        },
      }));

      return {
        _id: product._id,
        owner: product.owner,
        categoryName,
        name: product.name,
        description: product.description,
        price: product.price,
        availableInStock: product.availableInStock,
        imageUrl: product.imageUrl,
        cartItems: product.cartItems,
        favorits: product.favorits,
        averageRating,
        ratingCount: product.ratings.length,
        ratingDetails,
        newAdded: product.newAdded,
        featured: product.featured,
        popular: product.popular,
        topSelling: product.topSelling,
        ...product,
      };
    })
  );

  res.status(200).json({
    msg: `Products fetched successfully`,
    success: true,
    data: { products: productsWithDetails, totalProducts, totalPages },
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
  const product = await Product.findById(productId).populate(
    "ratings",
    "-ratingId -__v"
  );

  // Check if the productId exists
  if (!product) {
    return next(createCustomError(`No product with id: ${productId}`, 404));
  }

  // Calculate the average rating
  // const averageRating = product.averageRating;

  const categoryId = product.categoryId;

  // Fetch the category and all its fields
  // const category = await Category.findById(categoryId);

  // Fetch the category name
  const categoryName = await getCategoryNameById(categoryId);

  // Return the count of ratings
  const ratingCount = product.ratings.length;

  const ownerName = product.owner;
  // Split the full name into an array of first and last names
  const nameParts = ownerName.split(" ");
  // Extract firstName and lastName
  const firstName = nameParts[0]; // "John"
  const lastName = nameParts.slice(1).join(" "); // "Doe"

  const ownerDetails = await User.find(
    {
      firstName: firstName,
      lastName: lastName,
    },
    {
      healthStatus: 0,
      ratings: 0,
      orders: 0,
    }
  );

  // console.log(ownerDetails);

  // Fetch user details for each rating
  const userIds = product.ratings.map((rating) => rating.userId);
  const ratingUsers = await Promise.all(
    userIds.map((userId) => User.findById(userId))
  );
  // Extract relevant information from each user
  // const ratingUserNames = ratingUsers.map(user => user ? `${user.firstName} ${user.lastName}` : "Unknown");

  // Extract relevant information from each user
  const ratingDetails = product.ratings.map((rating, index) => ({
    rating: {
      _id: rating._id,
      userName: ratingUsers[index]
        ? `${ratingUsers[index].firstName} ${ratingUsers[index].lastName}`
        : "Unknown",
      userImage: ratingUsers[index] ? ratingUsers[index].imageUrl : "Unknown",
      title: rating.title,
      rating: rating.rating,
      description: rating.description,
      // userId: rating.userId,
      // productId: rating.productId,
    },
  }));

  // Fetch relatedProducts
  const relatedProducts = await fetchRelatedProducts(productId);
  // console.log(relatedProducts);
  // Map over related products and fetch details
  const relatedProductsDetails = relatedProducts.map(async (relatedProduct) => {
    const ratingsLength = relatedProduct.ratings.length;

    const relatedProductAverageRating =
      ratingsLength > 0
        ? relatedProduct.ratings.reduce(
            (acc, rating) => acc + Number(rating.rating),
            0
          ) / ratingsLength
        : 0;

    // console.log(relatedProductAverageRating);

    // Fetch user details for each rating
    const relatedProductUserIds = relatedProduct.ratings.map(
      (rating) => rating.userId
    );
    const relatedProductRatingUsers = await Promise.all(
      relatedProductUserIds.map((userId) => User.findById(userId))
    );

    const ownerName = relatedProduct.owner;
    // Split the full name into an array of first and last names
    const nameParts = ownerName.split(" ");
    // Extract firstName and lastName
    const firstName = nameParts[0]; // "John"
    const lastName = nameParts.slice(1).join(" "); // "Doe"

    const relatedProductOwnerDetails = await User.find(
      {
        firstName: firstName,
        lastName: lastName,
      },
      {
        healthStatus: 0,
        ratings: 0,
        orders: 0,
      }
    );

    const relatedProductsRtingDetails = relatedProduct.ratings.map(
      (rating, index) => ({
        rating: {
          _id: rating._id,
          userName: relatedProductRatingUsers[index]
            ? `${relatedProductRatingUsers[index].firstName} ${relatedProductRatingUsers[index].lastName}`
            : "Unknown",
          userImage: relatedProductRatingUsers[index]
            ? relatedProductRatingUsers[index].imageUrl
            : "Unknown",
          title: rating.title,
          rating: rating.rating,
          description: rating.description,
          // userId: rating.userId,
          // productId: rating.productId,
        },
      })
    );

    return {
      _id: relatedProduct._id,
      owner: relatedProduct.owner,
      categoryName,
      name: relatedProduct.name,
      description: relatedProduct.description,
      price: relatedProduct.price,
      availableInStock: relatedProduct.availableInStock,
      imageUrl: relatedProduct.imageUrl,
      cartItems: relatedProduct.cartItems,
      favorits: relatedProduct.favorits,
      relatedProductAverageRating,
      ratingCount: relatedProduct.ratings.length,
      relatedProductsRtingDetails,
      relatedProductOwnerDetails,
    };
  });

  // Wait for all related product details to be fetched
  const allRelatedProductsDetails = await Promise.all(relatedProductsDetails);

  res.status(200).json({
    msg: `Product fetched successfully`,
    success: true,
    data: {
      product: {
        _id: product._id,
        owner: product.owner,
        categoryName,
        name: product.name,
        description: product.description,
        price: product.price,
        availableInStock: product.availableInStock,
        imageUrl: product.imageUrl,
        cartItems: product.cartItems,
        favorits: product.favorits,
        averageRating: product.averageRating,
        ratingCount,
        ratingDetails,
        ownerDetails,
        ...product,
      },
      relatedProducts: allRelatedProductsDetails,
    },
  });
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

  const updatedProduct = await Product.findByIdAndUpdate(
    { _id: productId },
    req.body,
    {
      new: true,
      runValidators: true,
    }
  );

  const categoryId = await Category.findById(req.body.categoryId);

  if (!categoryId) {
    return next(createCustomError("Category does not exist", 400));
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
    data: updatedProduct,
  });
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
    return next(createCustomError("Category does not exist", 400));
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

// search Endpoin/API
const search = asyncWrapper(async (req, res, next) => {
  const { pageNumber, categoryName, productName, description, ownerName } =
    req.query;

  if (!pageNumber) {
    return next(createCustomError("Page Number is missing", 400));
  }

  if (isNaN(pageNumber) || pageNumber < 1) {
    return next(createCustomError("Invalid Page Number", 400));
  }

  const newPageOffset = pageNumber === 1 ? 0 : (pageNumber - 1) * PAGE_SIZE;

  const query = {};

  if (categoryName) {
    // Make the search for category name case-insensitive
    const categoryRegex = new RegExp(categoryName, "i");
    const category = await Category.findOne({
      name: { $regex: categoryRegex },
    });

    if (category) {
      query.categoryId = category._id;
    } else {
      return res
        .status(400)
        .json({ success: false, msg: "Category not found" });
    }
  }

  if (productName) {
    query.name = { $regex: productName, $options: "i" };
  }

  if (description) {
    query.description = { $regex: description, $options: "i" };
  }

  if (ownerName) {
    query.owner = { $regex: ownerName, $options: "i" };
  }

  const products = await Product.find(query)
    .skip(newPageOffset)
    .limit(PAGE_SIZE);

  const totalProducts = await Product.countDocuments(query);
  const totalPages = Math.ceil(totalProducts / PAGE_SIZE);

  if (pageNumber > totalPages) {
    return next(createCustomError("Page Number exceeds total pages", 400));
  }

  res.status(200).json({
    success: true,
    msg: "Products fetched successfully",
    data: { products, totalProducts, totalPages },
  });
});

// filter Endpoin/API
const filter = asyncWrapper(async (req, res, next) => {
  const { pageNumber, topRated, newAdded, featured, popular, topSelling } =
    req.query;

  if (!pageNumber) {
    return next(createCustomError("Page Number is missing", 400));
  }

  if (isNaN(pageNumber) || pageNumber < 1) {
    return next(createCustomError("Invalid Page Number", 400));
  }

  const newPageOffset = pageNumber === 1 ? 0 : (pageNumber - 1) * PAGE_SIZE;

  const query = {};

  // Populate the 'ratings' field for each product
  const products = await Product.find({}).populate({
    path: "ratings",
    select: "-ratingId -__v",
  });

  if (topRated === "true") {
    const filteredProducts = products.filter(
      (product) => product.averageRating >= 3.5
    );

    const productIds = filteredProducts.map((product) => product._id);

    query._id = { $in: productIds };
  }

  if (newAdded === "true") {
    // If topRated is true, filter products with average rating above 4.0
    query.newAdded = true;
  }

  if (featured === "true") {
    // If topRated is true, filter products with average rating above 4.0
    query.featured = true;
  }

  if (popular === "true") {
    // If topRated is true, filter products with average rating above 4.0
    query.popular = true;
  }

  if (topSelling === "true") {
    // If topRated is true, filter products with average rating above 4.0
    query.topSelling = true;
  }

  const filterdProducts = await Product.find(query)
    .populate({
      path: "ratings",
      select: "-ratingId -__v",
    })
    .skip(newPageOffset)
    .limit(PAGE_SIZE);

  const totalProducts = await Product.countDocuments(query);
  const totalPages = Math.ceil(totalProducts / PAGE_SIZE);

  if (pageNumber > totalPages) {
    return next(createCustomError("Page Number exceeds total pages", 400));
  }

  // Access the virtual field 'averageRating' for each product
  const productsWithDetails = await Promise.all(
    filterdProducts.map(async (product) => {
      const categoryId = product.categoryId;
      const categoryName = await getCategoryNameById(categoryId);

      const averageRating = product.averageRating;

      // Fetch user details for each rating
      const userIds = product.ratings.map((rating) => rating.userId);
      const ratingUsers = await Promise.all(
        userIds.map((userId) => User.findById(userId))
      );

      // Extract relevant information from each user
      const ratingDetails = product.ratings.map((rating, index) => ({
        rating: {
          _id: rating._id,
          userName: ratingUsers[index]
            ? `${ratingUsers[index].firstName} ${ratingUsers[index].lastName}`
            : "Unknown",
          title: rating.title,
          rating: rating.rating,
          description: rating.description,
        },
      }));

      return {
        _id: product._id,
        owner: product.owner,
        categoryName,
        name: product.name,
        description: product.description,
        price: product.price,
        availableInStock: product.availableInStock,
        imageUrl: product.imageUrl,
        cartItems: product.cartItems,
        favorits: product.favorits,
        averageRating,
        ratingCount: product.ratings.length,
        ratingDetails,
        newAdded: product.newAdded,
        featured: product.featured,
        popular: product.popular,
        topSelling: product.topSelling,
        ...product,
      };
    })
  );

  // const averageRating = products.averageRating;
  // console.log(averageRating);

  res.status(200).json({
    msg: "Products fetched successfully",
    success: true,
    data: { productsWithDetails, totalProducts, totalPages },
  });
});

// getUserRelatedProducts Endpoint/API
const getUserRelatedProducts = asyncWrapper(async (req, res, next) => {
  const userId = req.params.userId;

  const { pageNumber } = req.query;
  if (!pageNumber) {
    return next(createCustomError("Page Number is missing", 400));
  }

  if (isNaN(pageNumber) || pageNumber < 1) {
    return next(createCustomError("Invalid Page Number", 400));
  }

  const newPageOffset = pageNumber === 1 ? 0 : (pageNumber - 1) * PAGE_SIZE;

  // Find user by ID
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  // Build a query based on the healthStatus fields
  const healthStatusQuery = Object.keys(user.healthStatus)
    .filter(
      (key) =>
        key !== "others" &&
        (user.healthStatus[key] ||
          (key === "others" && user.healthStatus.others !== ""))
    )
    .map((key) => {
      if (key === "others") {
        const otherKeywords = user.healthStatus.others
          .split(",")
          .map((keyword) => keyword.trim());
        return {
          description: { $regex: otherKeywords.join("|"), $options: "i" },
        };
      } else {
        return { description: new RegExp(key, "i") };
      }
    });

  if (
    healthStatusQuery.length === 0 &&
    (!user.healthStatus.others || user.healthStatus.others === "")
  ) {
    return res.status(200).json({ success: true, data: [] }); // Both healthStatus and others are empty
  }

  // If 'others' field is not empty, search in 'others'
  if (user.healthStatus.others && user.healthStatus.others !== "") {
    const otherKeywords = user.healthStatus.others
      .split(",")
      .map((keyword) => keyword.trim());
    healthStatusQuery.push({
      description: { $regex: otherKeywords.join("|"), $options: "i" },
    });
  }

  // Find products matching the healthStatus criteria
  let products = await Product.find({ $or: healthStatusQuery })
    .populate("ratings", "-ratingId -__v")
    .skip(newPageOffset)
    .limit(PAGE_SIZE);

  const totalProducts = await Product.countDocuments({
    $or: healthStatusQuery,
  });
  const totalPages = Math.ceil(totalProducts / PAGE_SIZE);

  if (totalProducts === 0) {
    products = await Product.find()
      .populate("ratings", "-ratingId -__v")
      .skip(newPageOffset)
      .limit(PAGE_SIZE);
  } else if (pageNumber > totalPages) {
    return next(createCustomError("Page Number exceeds total pages", 400));
  }

  // Access the virtual field 'averageRating' for each product
  const productsWithDetails = await Promise.all(
    products.map(async (product) => {
      const categoryId = product.categoryId;
      const categoryName = await getCategoryNameById(categoryId);

      const averageRating = product.averageRating;

      // Fetch user details for each rating
      const userIds = product.ratings.map((rating) => rating.userId);
      const ratingUsers = await Promise.all(
        userIds.map((userId) => User.findById(userId))
      );

      // Extract relevant information from each user
      const ratingDetails = product.ratings.map((rating, index) => ({
        rating: {
          _id: rating._id,
          userName: ratingUsers[index]
            ? `${ratingUsers[index].firstName} ${ratingUsers[index].lastName}`
            : "Unknown",
          title: rating.title,
          rating: rating.rating,
          description: rating.description,
        },
      }));

      return {
        _id: product._id,
        owner: product.owner,
        categoryName,
        name: product.name,
        description: product.description,
        price: product.price,
        availableInStock: product.availableInStock,
        imageUrl: product.imageUrl,
        cartItems: product.cartItems,
        favorits: product.favorits,
        averageRating,
        ratingCount: product.ratings.length,
        ratingDetails,
        newAdded: product.newAdded,
        featured: product.featured,
        popular: product.popular,
        topSelling: product.topSelling,
        ...product,
      };
    })
  );

  res.status(200).json({
    success: true,
    msg: `User related products fetched successfully`,
    data: { productsWithDetails, totalProducts, totalPages },
  });
});

// searchAndFilter Endpoint/API
const searchAndFilter = asyncWrapper(async (req, res, next) => {
  const {
    pageNumber,
    categoryName,
    productName,
    description,
    ownerName,
    topRated,
    newAdded,
    featured,
    popular,
    topSelling,
  } = req.query;

  if (!pageNumber) {
    return next(createCustomError("Page Number is missing", 400));
  }

  if (isNaN(pageNumber) || pageNumber < 1) {
    return next(createCustomError("Invalid Page Number", 400));
  }

  const newPageOffset = pageNumber === 1 ? 0 : (pageNumber - 1) * PAGE_SIZE;

  const query = {};

  if (categoryName) {
    const categoryRegex = new RegExp(categoryName, "i");
    const category = await Category.findOne({
      name: { $regex: categoryRegex },
    });

    if (category) {
      query.categoryId = category._id;
    } else {
      return res
        .status(400)
        .json({ success: false, msg: "Category not found" });
    }
  }

  const nameRegex = productName ? new RegExp(productName, "i") : null;
  const descriptionRegex = description ? new RegExp(description, "i") : null;

  if (nameRegex || descriptionRegex) {
    query.$or = [];
    if (nameRegex) {
      query.$or.push({ name: { $regex: nameRegex } });
    }
    if (descriptionRegex) {
      query.$or.push({ description: { $regex: descriptionRegex } });
    }
  }

  if (ownerName) {
    query.owner = { $regex: ownerName, $options: "i" };
  }
  const searchResults = await Product.aggregate([
    {
      $match: query, // Your existing query conditions
    },
    {
      $lookup: {
        from: "ratings",
        localField: "_id",
        foreignField: "productId",
        as: "ratings",
      },
    },
    {
      $lookup: {
        from: "categories", // Assuming your categories collection is named 'categories'
        localField: "categoryId",
        foreignField: "_id",
        as: "category",
      },
    },
    {
      $addFields: {
        averageRating: {
          $ifNull: [{ $avg: "$ratings.rating" }, 0],
        },
        categoryName: {
          $arrayElemAt: ["$category.name", 0], // Assuming 'name' is the field in the Category model
        },
      },
    },
    {
      $project: {
        category: 0, // Exclude the 'category' field
        ratings: 0,
      },
    },
  ]);
  console.log(searchResults);

  const filteredResults = applyFilterLogic(searchResults, {
    topRated,
    newAdded,
    featured,
    popular,
    topSelling,
  });

  const totalFilteredProducts = filteredResults.length;
  const totalPages = Math.ceil(totalFilteredProducts / PAGE_SIZE);

  const paginatedResults = filteredResults.slice(
    newPageOffset,
    newPageOffset + PAGE_SIZE
  );

  if (pageNumber > totalPages) {
    return next(createCustomError("Page Number exceeds total pages", 400));
  }

  res.status(200).json({
    success: true,
    msg: "Products fetched successfully",
    data: {
      products: paginatedResults,
      totalProducts: totalFilteredProducts,
      totalPages,
    },
  });
});

// getUserNotifications Endpoint/API
const getUserNotifications = asyncWrapper(async (req, res, next) => {
  const { id: userId } = req.params;

  // Check if the userId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(createCustomError(`Invalid userId ID: ${userId}`, 400));
  }

  // Fetch the Notifications for the user
  const notifications = await Notification.find({ userId });

  // Check if the notifications exist
  if (notifications.length === 0) {
    return next(createCustomError(`No notifications found`, 404));
  }

  // Fetch product details for each notification
  const productDetailsPromises = notifications.map(async (notification) => {
    const productDetails = notification.product
      ? await Product.findById(notification.product, {
          ratings: 0,
          cartItems: 0,
          favorits: 0,
        })
      : null;

    if (productDetails !== null) {
      return {
        notificationId: notification._id,
        productDetails,
        type: "Product promotion",
        msg: "New product created",
      };
    } else {
      return {
        notificationId: notification._id,
        status: notification.status,
        type: "Status updated",
        msg: `Order status changed to ${notification.status.shipmentStatus}`,
      };
    }
  });

  // Wait for all product details promises to resolve
  const productDetailsResults = await Promise.all(productDetailsPromises);

  res.status(200).json({
    msg: "Notifications fetched successfully",
    success: true,
    data: productDetailsResults,
  });
});

const getRecommendedProducts = asyncWrapper(async (req, res, next) => {
  try {
    const userId = req.params.userId;
    const user = await User.findById(userId).lean();
    if (!user) {
      return next(createCustomError(`Invalid userId ID: ${userId}`, 404));
    }

    const conditionsToAvoid = [];
    if (user.diagnosedDiseases) {
      conditionsToAvoid.push(...user.diagnosedDiseases);
    }
    if (user.healthStatus) {
      conditionsToAvoid.push(...user.healthStatus);
    }

    const recommendedProducts = await Product.find({
      avoidIf: { $nin: conditionsToAvoid },
    }).populate("category");
    res.status(200).json({
      msg: "Products fetched successfully",
      success: true,
      data: recommendedProducts,
    });
  } catch (err) {
    console.error("Error in getRecommendedProducts:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const searchAndFilterProductsV2 = asyncWrapper(async (req, res, next) => {
  try {
    const searchTerm = req.query.query || "";
    const categoryFilter = req.query.category;
    const subCategoryFilter = req.query.category;
    const userId = req.query.userId;

    let userConditions = [];
    if (userId) {
      const user = await User.findById(userId).lean();
      if (user) {
        if (user.diagnosedDiseases) {
          userConditions.push(...user.diagnosedDiseases);
        }
        if (user.healthStatus) {
          userConditions.push(...user.healthStatus);
        }
      }
    }
    const regexTerm = new RegExp(searchTerm, "i");

    const query = {};

    if (searchTerm) {
      query.$or = [
        { name: { $regex: regexTerm } },
        { description: { $regex: regexTerm } },
      ];
    }

    let categoryIds = [];
    if (categoryFilter) {
      const categoryQuery = mongoose.Types.ObjectId.isValid(categoryFilter)
        ? { _id: categoryFilter }
        : { name: { $regext: newRegExp("^" + categoryFilter + "$", "i") } };
      const categoryDocs = await Category.find(categoryQuery).lean();
      categoryIds = categoryDocs.map((c) => c._id);
      if (categoryIds.length > 0) {
        query.category = { $in: categoryIds };
      }
    }

    if (subCategoryFilter) {
      const catsWithSub = await Category.find({
        subCategories: {
          $regex: new RegExp("^" + subCategoryFilter + "$", "i"),
        },
      }).lean();
      const catIdsWithSub = catsWithSub.map((c) => c._id);
      if (catIdsWithSub.length > 0) {
        query.category = { $in: catIdsWithSub };
        query.subCategory = {
          $regex: new RegExp("^" + subCategoryFilter + "$", "i"),
        };
      }
    }
    if (userConditions.length > 0) {
      query.avoidIf = { $nin: userConditions };
    }
    // Execute query
    const products = await Product.find(query).populate("category").lean();
    res.json(products);
  } catch (err) {
    console.error("Error in searchAndFilterProducts:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = {
  createProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  getUserRelatedProducts,
  search,
  filter,
  searchAndFilter,
  getUserNotifications,
  getRecommendedProducts,
  searchAndFilterProductsV2,
};
