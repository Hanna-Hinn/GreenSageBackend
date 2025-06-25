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

const ratingPopulate = {
  path: "ratings",
  select: "-ratingId -__v -productId",
  populate: {
    path: "userId",
    model: "User",
    select: "firstName lastName imageUrl",
  },
};

const buildRatingDetails = (ratings = []) =>
  ratings.map((r) => ({
    _id: r._id,
    title: r.title,
    rating: r.rating,
    description: r.description,
    user: r.userId
      ? {
          _id: r.userId._id,
          firstName: r.userId.firstName,
          lastName: r.userId.lastName,
          imageUrl: r.userId.imageUrl,
        }
      : null,
  }));

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
  if (!pageNumber)
    return next(createCustomError("Page Number is missing", 400));
  if (isNaN(pageNumber) || pageNumber < 1)
    return next(createCustomError("Invalid Page Number", 400));

  const skip = pageNumber === 1 ? 0 : (pageNumber - 1) * PAGE_SIZE;

  const products = await Product.find({})
    .skip(skip)
    .limit(PAGE_SIZE)
    .populate(ratingPopulate) // <-- nested populate
    .lean();

  const totalProducts = await Product.countDocuments({});
  const totalPages = Math.ceil(totalProducts / PAGE_SIZE);
  if (pageNumber > totalPages)
    return next(createCustomError("Page Number exceeds total pages", 400));

  const productsWithDetails = await Promise.all(
    products.map(async (p) => ({
      ...p,
      categoryName: await getCategoryNameById(p.categoryId),
      averageRating: p.averageRating,
      ratingCount: p.ratings.length,
      ratingDetails: buildRatingDetails(p.ratings),
    }))
  );

  res.status(200).json({
    msg: "Products fetched successfully",
    success: true,
    data: { products: productsWithDetails, totalProducts, totalPages },
  });
});

// getProduct Endpoint/API
const getProduct = asyncWrapper(async (req, res, next) => {
  const { id: productId } = req.params;

  /* ---------- validate ID ---------- */
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(createCustomError(`Invalid productId ID: ${productId}`, 400));
  }

  /* ---------- fetch product with nested ratings+user ---------- */
  const product = await Product.findById(productId)
    .populate(ratingPopulate)
    .lean({ virtuals: true });

  if (!product) {
    return next(createCustomError(`No product with id: ${productId}`, 404));
  }

  /* ---------- basic derived fields ---------- */
  const categoryName = await getCategoryNameById(product.categoryId);
  const ratingDetails = buildRatingDetails(product.ratings);
  const ratingCount = product.ratings.length;
  const averageRating = product.averageRating; // virtual field

  /* ---------- owner details ---------- */
  const [firstName, ...lastArr] = (product.owner || "").split(" ");
  const lastName = lastArr.join(" ");
  const ownerDetails = await User.find(
    { firstName, lastName },
    { healthStatus: 0, ratings: 0, orders: 0 }
  ).lean();

  /* ---------- related products ---------- */
  const rawRelated = await fetchRelatedProducts(productId);

  const relatedProducts = await Promise.all(
    rawRelated.map(async (p) => {
      // populate ratings->user on each related product
      const populated = await Product.findById(p._id)
        .populate(ratingPopulate)
        .lean({ virtuals: true });

      return {
        _id: populated._id,
        owner: populated.owner,
        categoryName,
        name: populated.name,
        description: populated.description,
        price: populated.price,
        availableInStock: populated.availableInStock,
        imageUrl: populated.imageUrl,
        relatedProductAverageRating: populated.averageRating,
        ratingCount: populated.ratings.length,
        ratingDetails: buildRatingDetails(populated.ratings),
        averageRating: populated.averageRating,
      };
    })
  );

  /* ---------- response ---------- */
  res.status(200).json({
    msg: "Product fetched successfully",
    success: true,
    data: {
      product: {
        ...product,
        categoryName,
        averageRating,
        ratingCount,
        ratingDetails,
        ownerDetails,
      },
      relatedProducts,
    },
  });
});

// updateProduct Endpoint/API
const updateProduct = asyncWrapper(async (req, res, next) => {
  const { id: productId } = req.params;

  /* ---------- validation ---------- */
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return next(createCustomError(`Invalid productId ID: ${productId}`, 400));
  }

  const existingProduct = await Product.findById(productId);
  if (!existingProduct) {
    return next(createCustomError(`No product with id: ${productId}`, 404));
  }

  /* ---------- update mongo document ---------- */
  const updatedProduct = await Product.findByIdAndUpdate(productId, req.body, {
    new: true,
    runValidators: true,
  });

  /* ---------- keep Category ⟷ Product references in sync ---------- */
  const prevCategoryId = existingProduct.categoryId.toString();
  const newCategoryIdRaw = req.body.categoryId || updatedProduct.categoryId;
  const newCategoryId = newCategoryIdRaw.toString();

  if (prevCategoryId !== newCategoryId) {
    // ensure new category exists
    const targetCategory = await Category.findById(newCategoryId);
    if (!targetCategory) {
      return next(createCustomError("Category does not exist", 400));
    }

    // pull from old category
    await Category.findByIdAndUpdate(
      prevCategoryId,
      { $pull: { products: productId } },
      { new: true }
    );
    // push into new category
    await Category.findByIdAndUpdate(
      newCategoryId,
      { $push: { products: productId } },
      { new: true }
    );
  }

  /* ---------- fetch fresh doc with populated ratings & user ---------- */
  const populated = await Product.findById(productId)
    .populate(ratingPopulate)
    .lean();

  const categoryName = await getCategoryNameById(populated.categoryId);
  const ratingDetails = buildRatingDetails(populated.ratings);

  /* ---------- response ---------- */
  res.status(200).json({
    msg: "Product updated successfully",
    success: true,
    data: {
      ...populated,
      categoryName,
      averageRating: populated.averageRating,
      ratingCount: populated.ratings.length,
      ratingDetails,
    },
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

  /* ---------- pagination checks ---------- */
  if (!pageNumber) {
    return next(createCustomError("Page Number is missing", 400));
  }
  if (isNaN(pageNumber) || pageNumber < 1) {
    return next(createCustomError("Invalid Page Number", 400));
  }
  const skip = pageNumber === 1 ? 0 : (pageNumber - 1) * PAGE_SIZE;

  /* ---------- build query ---------- */
  const query = {};

  // category by name (case-insensitive exact match)
  if (categoryName) {
    const catRegex = new RegExp(categoryName, "i");
    const catDoc = await Category.findOne({ name: { $regex: catRegex } });
    if (!catDoc) {
      return res
        .status(400)
        .json({ success: false, msg: "Category not found" });
    }
    query.categoryId = catDoc._id;
  }

  // name / description partial matches
  if (productName || description) {
    query.$or = [];
    if (productName) {
      query.$or.push({ name: { $regex: new RegExp(productName, "i") } });
    }
    if (description) {
      query.$or.push({ description: { $regex: new RegExp(description, "i") } });
    }
  }

  // owner text search
  if (ownerName) {
    query.owner = { $regex: ownerName, $options: "i" };
  }

  /* ---------- fetch & count ---------- */
  const [products, totalProducts] = await Promise.all([
    Product.find(query)
      .populate(ratingPopulate)
      .skip(skip)
      .limit(PAGE_SIZE)
      .lean(),
    Product.countDocuments(query),
  ]);

  const totalPages = Math.ceil(totalProducts / PAGE_SIZE);
  if (pageNumber > totalPages && totalPages !== 0) {
    return next(createCustomError("Page Number exceeds total pages", 400));
  }

  /* ---------- enrich each product ---------- */
  const productsWithDetails = await Promise.all(
    products.map(async (p) => ({
      ...p,
      categoryName: await getCategoryNameById(p.categoryId),
      averageRating: p.averageRating,
      ratingCount: p.ratings.length,
      ratingDetails: buildRatingDetails(p.ratings),
    }))
  );

  /* ---------- response ---------- */
  res.status(200).json({
    success: true,
    msg: "Products fetched successfully",
    data: {
      products: productsWithDetails,
      totalProducts,
      totalPages,
    },
  });
});

// filter Endpoin/API
const filter = asyncWrapper(async (req, res, next) => {
  const { pageNumber, topRated, newAdded, featured, popular, topSelling } =
    req.query;

  /* ---------- pagination checks ---------- */
  if (!pageNumber) {
    return next(createCustomError("Page Number is missing", 400));
  }
  if (isNaN(pageNumber) || pageNumber < 1) {
    return next(createCustomError("Invalid Page Number", 400));
  }
  const skip =
    pageNumber === "1" || pageNumber === 1 ? 0 : (pageNumber - 1) * PAGE_SIZE;

  /* ---------- base query for boolean flags ---------- */
  const query = {};
  if (newAdded === "true") query.newAdded = true;
  if (featured === "true") query.featured = true;
  if (popular === "true") query.popular = true;
  if (topSelling === "true") query.topSelling = true;

  /* ---------- fetch all candidates with ratings populated ---------- */
  let products = await Product.find(query).populate(ratingPopulate).lean();

  /* ---------- apply topRated filtering in-memory (needs averageRating) ---------- */
  if (topRated === "true") {
    products = products.filter((p) => p.averageRating >= 3.5);
  }

  const totalProducts = products.length;
  const totalPages = Math.ceil(totalProducts / PAGE_SIZE);
  if (pageNumber > totalPages && totalPages !== 0) {
    return next(createCustomError("Page Number exceeds total pages", 400));
  }

  /* ---------- slice for pagination ---------- */
  const pageSlice = products.slice(skip, skip + PAGE_SIZE);

  /* ---------- enrich each product ---------- */
  const productsWithDetails = await Promise.all(
    pageSlice.map(async (p) => ({
      ...p,
      categoryName: await getCategoryNameById(p.categoryId),
      averageRating: p.averageRating,
      ratingCount: p.ratings.length,
      ratingDetails: buildRatingDetails(p.ratings),
    }))
  );

  /* ---------- response ---------- */
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

  /* ---------- pagination checks ---------- */
  if (!pageNumber) {
    return next(createCustomError("Page Number is missing", 400));
  }
  if (isNaN(pageNumber) || pageNumber < 1) {
    return next(createCustomError("Invalid Page Number", 400));
  }
  const skip =
    pageNumber === "1" || pageNumber === 1 ? 0 : (pageNumber - 1) * PAGE_SIZE;

  /* ---------- fetch user ---------- */
  const user = await User.findById(userId).lean();
  if (!user) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  /* ---------- build health-status search tokens ---------- */
  const healthStatusQuery = [];
  Object.entries(user.healthStatus || {}).forEach(([key, val]) => {
    if (key === "others" || key === "otherCheck") return;
    if (val === true) {
      healthStatusQuery.push({ description: new RegExp(key, "i") });
    }
  });
  if (user.healthStatus?.others) {
    const otherWords = user.healthStatus.others
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    if (otherWords.length) {
      healthStatusQuery.push({
        description: { $regex: otherWords.join("|"), $options: "i" },
      });
    }
  }

  /* ---------- primary query (and fallback) ---------- */
  const mongoQuery = healthStatusQuery.length ? { $or: healthStatusQuery } : {};

  let [products, totalProducts] = await Promise.all([
    Product.find(mongoQuery)
      .populate(ratingPopulate)
      .skip(skip)
      .limit(PAGE_SIZE)
      .lean(),
    Product.countDocuments(mongoQuery),
  ]);

  // When no matches, fall back to "all products"
  if (totalProducts === 0) {
    [products, totalProducts] = await Promise.all([
      Product.find({})
        .populate(ratingPopulate)
        .skip(skip)
        .limit(PAGE_SIZE)
        .lean(),
      Product.countDocuments({}),
    ]);
  }

  const totalPages = Math.ceil(totalProducts / PAGE_SIZE);
  if (pageNumber > totalPages && totalPages !== 0) {
    return next(createCustomError("Page Number exceeds total pages", 400));
  }

  /* ---------- enrich each product ---------- */
  const productsWithDetails = await Promise.all(
    products.map(async (p) => ({
      ...p,
      categoryName: await getCategoryNameById(p.categoryId),
      averageRating: p.averageRating,
      ratingCount: p.ratings.length,
      ratingDetails: buildRatingDetails(p.ratings),
    }))
  );

  /* ---------- response ---------- */
  res.status(200).json({
    success: true,
    msg: "User related products fetched successfully",
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

  /* ---------- pagination checks ---------- */
  if (!pageNumber) {
    return next(createCustomError("Page Number is missing", 400));
  }
  if (isNaN(pageNumber) || pageNumber < 1) {
    return next(createCustomError("Invalid Page Number", 400));
  }
  const skip =
    pageNumber === "1" || pageNumber === 1 ? 0 : (pageNumber - 1) * PAGE_SIZE;

  /* ---------- build Mongo query ---------- */
  const query = {};

  // 1) category by name (case-insensitive)
  if (categoryName) {
    const catRegex = new RegExp(categoryName, "i");
    const catDoc = await Category.findOne({ name: { $regex: catRegex } });
    if (!catDoc) {
      return res
        .status(400)
        .json({ success: false, msg: "Category not found" });
    }
    query.categoryId = catDoc._id;
  }

  // 2) name / description partial matches
  if (productName || description) {
    query.$or = [];
    if (productName) {
      query.$or.push({ name: { $regex: new RegExp(productName, "i") } });
    }
    if (description) {
      query.$or.push({
        description: { $regex: new RegExp(description, "i") },
      });
    }
  }

  // 3) owner search
  if (ownerName) {
    query.owner = { $regex: ownerName, $options: "i" };
  }

  /* ---------- fetch candidate products with ratings populated ---------- */
  const rawProducts = await Product.find(query)
    .populate(ratingPopulate)
    .lean({ virtuals: true }); // include averageRating virtual in lean

  /* ---------- enrich each product ---------- */
  const enriched = await Promise.all(
    rawProducts.map(async (p) => {
      const avg =
        p.ratings.length > 0
          ? p.ratings.reduce((acc, r) => acc + Number(r.rating), 0) /
            p.ratings.length
          : 0;

      return {
        ...p,
        categoryName: await getCategoryNameById(p.categoryId),
        averageRating: avg,
        ratingCount: p.ratings.length,
        ratingDetails: buildRatingDetails(p.ratings),
      };
    })
  );

  /* ---------- filter logic for flags ---------- */
  const afterFlags = applyFilterLogic(enriched, {
    topRated,
    newAdded,
    featured,
    popular,
    topSelling,
  });

  /* ---------- pagination ---------- */
  const totalFilteredProducts = afterFlags.length;
  const totalPages = Math.ceil(totalFilteredProducts / PAGE_SIZE);
  if (pageNumber > totalPages && totalPages !== 0) {
    return next(createCustomError("Page Number exceeds total pages", 400));
  }

  const paginated = afterFlags.slice(skip, skip + PAGE_SIZE);

  /* ---------- response ---------- */
  res.status(200).json({
    success: true,
    msg: "Products fetched successfully",
    data: {
      products: paginated,
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

const extractHealthConditions = (healthStatus = {}) => {
  const base = Object.keys(healthStatus).filter(
    (k) => healthStatus[k] === true // only active
  );

  if (healthStatus.otherCheck && healthStatus.others) {
    base.push(healthStatus.others);
  }

  return base;
};

const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getRecommendedProducts = asyncWrapper(async (req, res, next) => {
  try {
    const userId = req.params.userId;

    /* ---------- fetch user ---------- */
    const user = await User.findById(userId).lean();
    if (!user) {
      return next(createCustomError(`Invalid userId ID: ${userId}`, 404));
    }

    /* ---------- build avoid-list (diseases + health flags) ---------- */
    const conditionsToAvoid = [
      ...(user.diagnosedDiseases || []),
      ...extractHealthConditions(user.healthStatus),
    ].map((s) => s.toLowerCase());

    /* ---------- build positive keyword list ---------- */
    const keywords = Object.keys(user.healthStatus || {})
      .filter((k) => k !== "others" && user.healthStatus[k] === true)
      .concat(
        user.healthStatus?.others
          ? user.healthStatus.others
              .split(",")
              .map((w) => w.trim())
              .filter(Boolean)
          : []
      )
      .map((w) => w.toLowerCase());

    const baseQuery = { avoidIf: { $nin: conditionsToAvoid } };
    let finalQuery = baseQuery;

    if (keywords.length) {
      const regex = new RegExp(
        keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
        "i"
      );
      finalQuery = {
        ...baseQuery,
        $or: [{ name: { $regex: regex } }, { description: { $regex: regex } }],
      };
    }

    /* ---------- fetch products with populated ratings ---------- */
    const products = await Product.find(finalQuery)
      .populate(ratingPopulate)
      .lean({ virtuals: true });

    /* ---------- enrich each product ---------- */
    const productsWithDetails = await Promise.all(
      products.map(async (p) => ({
        ...p,
        categoryName: await getCategoryNameById(p.categoryId),
        averageRating: p.averageRating,
        ratingCount: p.ratings.length,
        ratingDetails: buildRatingDetails(p.ratings),
      }))
    );

    /* ---------- response ---------- */
    res.status(200).json({
      msg: "Products fetched successfully",
      success: true,
      data: productsWithDetails,
    });
  } catch (err) {
    console.error("Error in getRecommendedProducts:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

const searchAndFilterProductsV2 = asyncWrapper(async (req, res, next) => {
  try {
    /* ---------- query params ---------- */
    const searchTerm = req.query.query || "";
    const categoryFilter = req.query.category;
    const subCategoryFilter = req.query.subCategory;
    const userId = req.query.userId;

    /* ---------- build base Mongo query ---------- */
    const query = {};

    /* 1. FREE-TEXT SEARCH (name / description) ---------------------- */
    if (searchTerm.trim()) {
      const regex = new RegExp(searchTerm, "i");
      query.$or = [
        { name: { $regex: regex } },
        { description: { $regex: regex } },
      ];
    }

    /* 2. CATEGORY FILTER ------------------------------------------- */
    if (categoryFilter) {
      const catLookup = mongoose.Types.ObjectId.isValid(categoryFilter)
        ? { _id: categoryFilter }
        : { name: { $regex: new RegExp("^" + categoryFilter + "$", "i") } };

      const catDocs = await Category.find(catLookup).lean();
      if (catDocs.length) {
        query.category = { $in: catDocs.map((c) => c._id) };
      } else {
        // unknown category ⇒ empty result set
        return res.json([]);
      }
    }

    /* 3. SUB-CATEGORY FILTER --------------------------------------- */
    if (subCategoryFilter) {
      // find categories that contain the sub-category
      const catsWithSub = await Category.find({
        subCategories: {
          $regex: new RegExp("^" + subCategoryFilter + "$", "i"),
        },
      }).lean();
      if (catsWithSub.length) {
        query.category = { $in: catsWithSub.map((c) => c._id) };
        query.subCategory = {
          $regex: new RegExp("^" + subCategoryFilter + "$", "i"),
        };
      } else {
        return res.json([]);
      }
    }

    /* 4. USER HEALTH “AVOID IF” FILTER ------------------------------ */
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      const user = await User.findById(userId).lean();
      if (user) {
        const avoid = [
          ...(user.diagnosedDiseases || []),
          ...extractHealthConditions(user.healthStatus),
        ];
        if (avoid.length)
          query.avoidIf = { $nin: avoid.map((s) => s.toLowerCase()) };
      }
    }

    /* ---------- execute query, populate ratings → user ------------- */
    const products = await Product.find(query)
      .populate(ratingPopulate)
      .lean({ virtuals: true });

    /* ---------- enrich each product with rating + category info ---- */
    const productsWithDetails = await Promise.all(
      products.map(async (p) => ({
        ...p,
        categoryName: await getCategoryNameById(p.categoryId),
        averageRating: p.averageRating,
        ratingCount: p.ratings.length,
        ratingDetails: buildRatingDetails(p.ratings),
      }))
    );

    /* ---------- response ------------------------------------------ */
    res.status(200).json({
      success: true,
      msg: "Products fetched successfully",
      data: productsWithDetails,
    });
  } catch (err) {
    console.error("Error in searchAndFilterProductsV2:", err);
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
