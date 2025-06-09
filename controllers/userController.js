const User = require("../models/userModel");
const Product = require("../models/productModel");
const Rating = require("../models/ratingModel");
const asyncWrapper = require("../middleware/asyncWrapper");
const { createCustomError } = require("../utils/customError");
const mongoose = require("mongoose");
const { getCategoryNameById } = require("../services/categoryServices");
const { PAGE_SIZE } = require("../constants");

const normaliseDiseases = (arr = []) =>
  arr
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => x.trim().toLowerCase());

const mapAddresses = (addresses = []) =>
  addresses.map((a) => ({
    street: a.street,
    postalCode: a.postalCode,
    state: a.state,
    city: a.city,
  }));

// createUser Endpoint/API
const createUser = asyncWrapper(async (req, res, next) => {
  const {
    firstName,
    lastName,
    email,
    mobile,
    password,
    imageUrl,
    addresses = [],
    description,
    healthStatus = {},
    diagnosedDiseases = [],
  } = req.body;

  if (
    !firstName ||
    !lastName ||
    !email ||
    !mobile ||
    !password ||
    !imageUrl ||
    !addresses.length ||
    !description
  ) {
    console.log("Missing required fields");
    return next(createCustomError("Please provide all required fields", 400));
  }
  // Check if email already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    console.log("Duplicate email");
    return next(createCustomError("Email already exists", 400));
  }

  const user = await User.create({
    firstName,
    lastName,
    email,
    mobile,
    password,
    imageUrl,
    role: "owner",
    addresses: mapAddresses(addresses),
    healthStatus,
    diagnosedDiseases: normaliseDiseases(diagnosedDiseases),
    description,
  });

  console.log("User created successfully");
  res.status(201).json({
    msg: `User created successfully`,
    success: true,
    data: user,
  });
});

// // addAddress Endpoint/API
// const addAddress = asyncWrapper(async (req, res, next) => {
//     const { id: userID } = req.params;
//     const { street, postalCode, state, city } = req.body;

//     const user = await User.findById(userID);
//     if (!user) {
//         return next(createCustomError('User not found', 404));
//     }

//     const newAddress = {
//         street,
//         postalCode,
//         state,
//         city,
//     };

//     user.addresses.push(newAddress);
//     await user.save();

//     res.status(200).json({
//         msg: 'Address added successfully',
//         success: true,
//         data: user,
//     });
// });

// getUsers Endpoint/API
const getUsers = asyncWrapper(async (req, res, next) => {
  const users = await User.find({});
  res.status(200).json({
    msg: `Users fetched successfully`,
    success: true,
    data: users,
  });
});

// getUser Endpoint/API
const getUser = asyncWrapper(async (req, res, next) => {
  const { id: userID } = req.params;

  // Check if the userID is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(userID)) {
    return next(createCustomError(`Invalid user ID: ${userID}`, 400));
  }

  // Fetch the user and populate its 'ratings' field
  // const user = await User.findOne({ _id: userID })
  const user = await User.findById(userID)
    .populate("ratings", "-ratingId -__v")
    .populate("orders");

  // Check if the user exists
  if (!user) {
    return next(createCustomError(`No user with id: ${userID}`, 404));
  }

  res.status(200).json({
    msg: "User fetched successfully",
    success: true,
    data: user,
  });
});

// updateUser Endpoint/API
const updateUser = asyncWrapper(async (req, res, next) => {
  const { id: userID } = req.params;

  // Check if the userID is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(userID)) {
    return next(createCustomError(`Invalid user ID: ${userID}`, 400));
  }

  // Fetch the existing user data
  const existingUser = await User.findById(userID);

  // Check if the user exists
  if (!existingUser) {
    return next(createCustomError(`No user with id: ${userID}`, 404));
  }

  // Extract only "name" and "email" properties for comparison
  const existingUserData = {
    firstName: existingUser.firstName,
    lastName: existingUser.lastName,
    email: existingUser.email,
    mobile: existingUser.mobile,
    password: existingUser.password,
    imageUrl: existingUser.imageUrl,
    description: existingUser.description,
  };

  // Check if the req.body is the same as existing user data
  if (JSON.stringify(existingUserData) === JSON.stringify(req.body)) {
    return next(createCustomError("Nothing to update", 400));
  }

  console.log(JSON.stringify(existingUserData));
  console.log(JSON.stringify(req.body));

  // Update the user data
  const updatedUser = await User.findOneAndUpdate({ _id: userID }, req.body, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    msg: `User updated successfully`,
    success: true,
    data: updatedUser,
  });
});

// deleteUser Endpoint/API
const deleteUser = asyncWrapper(async (req, res, next) => {
  const { id: userID } = req.params;

  // Check if the userID is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(userID)) {
    return next(createCustomError(`Invalid user ID: ${userID}`, 400));
  }

  const user = await User.findById(userID);

  // Check if the user exists
  if (!user) {
    return next(createCustomError(`No user with id: ${userID}`, 404));
  }

  // const deletedUser = await user.deleteOne(); Or
  await user.deleteOne();

  res.status(200).json({
    msg: `user deleted successfully`,
    success: true,
  });
});

// getOwners Endpoint/API
const getOwners = asyncWrapper(async (req, res, next) => {
  const owners = await User.find(
    { role: "owner" },
    { healthStatus: 0, ratings: 0, orders: 0 }
  );

  // Get product counts for each owner
  const ownersWithProductCount = await Promise.all(
    owners.map(async (owner) => {
      const productCount = await Product.countDocuments({
        owner: `${owner.firstName} ${owner.lastName}`,
      });
      return { ...owner.toObject(), productCount };
    })
  );
  res.status(200).json({
    msg: `Owners fetched successfully`,
    success: true,
    data: ownersWithProductCount,
  });
});

// getOwnerById Endpoint/API
const getOwner = asyncWrapper(async (req, res, next) => {
  const { id: ownerId } = req.params;

  // Find the owner by ID
  const owner = await User.findById(
    { _id: ownerId },
    { healthStatus: 0, ratings: 0, orders: 0 }
  );

  if (!owner) {
    return next(createCustomError(`No owner with id: ${ownerId}`, 404));
  }

  // Get product count for the owner
  const productCount = await Product.countDocuments({
    owner: `${owner.firstName} ${owner.lastName}`,
  });

  const { pageNumber } = req.query;

  if (!pageNumber) {
    return next(createCustomError("Page Number is missing", 400));
  }

  if (isNaN(pageNumber) || pageNumber < 1) {
    return next(createCustomError("Invalid Page Number", 400));
  }

  const newPageOffset = pageNumber === 1 ? 0 : (pageNumber - 1) * PAGE_SIZE;

  // Get all products owned by the owner
  const products = await Product.find({
    owner: `${owner.firstName} ${owner.lastName}`,
  })
    .skip(newPageOffset)
    .limit(PAGE_SIZE)
    .populate({
      path: "ratings",
      select: "-ratingId -__v",
    });

  const totalProducts = await Product.countDocuments({
    owner: `${owner.firstName} ${owner.lastName}`,
  });
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
      };
    })
  );

  res.status(200).json({
    msg: `Owner and their products fetched successfully`,
    success: true,
    data: {
      owner: { ...owner.toObject(), productCount },
      products: productsWithDetails,
      totalProducts,
      totalPages,
    },
  });
});

const updateHealthStatus = asyncWrapper(async (req, res, next) => {
  const { id: userId } = req.params;
  const { healthStatus } = req.body;

  // Check if the userId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(createCustomError(`Invalid user Id: ${userId}`, 400));
  }

  if (!healthStatus) {
    return next(createCustomError(`Invalid request`, 400));
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: { healthStatus } },
    { new: true, runValidators: true } // Return the updated document
  );

  if (!updatedUser) {
    return next(createCustomError(`User not found`, 404));
  }

  res.status(200).json({
    success: true,
    msg: "Health status updated successfully",
    data: updatedUser,
  });
});

const updateHealthInfo = asyncWrapper(async (req, res, next) => {
  const { id: userId } = req.params;
  const { healthStatus, diagnosedDiseases } = req.body;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return next(createCustomError(`Invalid user Id: ${userId}`, 400));
  }
  if (!healthStatus && !diagnosedDiseases) {
    return next(createCustomError("Nothing to update", 400));
  }

  const updatePayload = {};
  if (healthStatus) updatePayload.healthStatus = healthStatus;
  if (diagnosedDiseases)
    updatePayload.diagnosedDiseases = normaliseDiseases(diagnosedDiseases);

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: updatePayload },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!updated) return next(createCustomError("User not found", 404));

  res.status(200).json({
    success: true,
    msg: "Health info updated successfully",
    data: updated,
  });
});

module.exports = {
  createUser,
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  getOwners,
  getOwner,
  updateHealthStatus,
  updateHealthInfo,
};
