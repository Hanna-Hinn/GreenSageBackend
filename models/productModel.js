const mongoose = require("mongoose");
const { Decimal128 } = require("mongodb");

const imageURLRegex = /^(http|https):\/\/(www\.)?(.*)\.(?:jpeg|jpg|png|gif)$/i;

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, `Name can not be empty`],
    trim: true,
  },
  quantityType: { type: String },
  description: {
    type: String,
  },
  price: {
    type: Decimal128,
    required: [true, `Price can not be empty`],
    default: 0,
  },
  availableInStock: {
    type: Number,
    default: 0,
  },
  // ratingCount: Number, // Number of reviews
  imageUrl: {
    type: String,
    required: [true, `ImageUrl can not be empty`],
    trim: true,
    validate: [
      {
        validator: (value) => imageURLRegex.test(value),
        message: `Invalid image URL format`,
      },
    ],
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category", // Reference the Category model
    required: true,
  },
  ratings: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rating", // Reference the Rating model
    },
  ],
  cartItems: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CartItem", // Reference the CartItem model
    },
  ],
  favorits: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Favorite", // Reference the Favorite model
    },
  ],
  owner: {
    type: String,
  },
  newAdded: {
    type: Boolean,
    default: false,
  },
  featured: {
    type: Boolean,
    default: false,
  },
  popular: {
    type: Boolean,
    default: false,
  },
  topSelling: {
    type: Boolean,
    default: false,
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Category",
    required: true,
  },
  subCategory: { type: String, required: false },
  avoidIf: [{ type: String }],
});

// Virtual field for calculated average rating
productSchema.virtual("averageRating").get(function () {
  // Calculate the average rating from the 'ratings' array
  const ratings = this.ratings;
  if (ratings.length === 0) {
    return 0;
  }

  const sum = ratings.reduce((acc, rating) => acc + Number(rating.rating), 0);
  const average = sum / ratings.length;
  return average;
});

// productSchema.set('toJSON', { getters: true });

module.exports = mongoose.model("Product", productSchema);
