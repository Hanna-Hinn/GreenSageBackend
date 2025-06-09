const mongoose = require("mongoose");
const validator = require("validator");

const imageURLRegex = /^(http|https):\/\/(www\.)?(.*)\.(?:jpeg|jpg|png|gif)$/i;

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, "First name can not be empty"],
    trim: true,
    maxLength: [30, "Name can not be longer than 30 characters"],
  },
  lastName: {
    type: String,
    required: [true, "Last name can not be empty"],
    trim: true,
    maxLength: [30, "Name can not be longer than 30 characters"],
  },
  email: {
    type: String,
    required: [true, "Email can not be empty"],
    trim: true,
    unique: [true, "Email already exists"],
    validate: {
      validator: (value) => validator.isEmail(value),
      message: "Invalid email format",
    },
  },
  mobile: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: true,
  },
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
  role: {
    type: String,
    required: true,
    default: "owner",
  },
  addresses: [
    {
      street: {
        type: String,
        required: true,
      },
      postalCode: {
        type: String,
        required: true,
      },
      state: {
        type: String,
        required: true,
      },
      city: {
        type: String,
        required: true,
      },
    },
  ],
  ratings: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rating", // Reference the Rating model
    },
  ],
  cart: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Cart",
    // populate: true, // automatically fetch the cart when querying a user
  },
  favorite: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Favorite", // Reference the Favorite model
  },
  orders: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
    },
  ],
  healthStatus: {
    vitaminD: {
      type: Boolean,
      default: false,
    },
    iron: {
      type: Boolean,
      default: false,
    },
    vitaminB12: {
      type: Boolean,
      default: false,
    },
    calcium: {
      type: Boolean,
      default: false,
    },
    omega3: {
      type: Boolean,
      default: false,
    },
    iodine: {
      type: Boolean,
      default: false,
    },
    vitaminC: {
      type: Boolean,
      default: false,
    },
    folate: {
      type: Boolean,
      default: false,
    },
    magnesium: {
      type: Boolean,
      default: false,
    },
    zinc: {
      type: Boolean,
      default: false,
    },
    others: {
      type: String,
      default: "",
    },
  },
  description: {
    type: String,
    trim: true,
    minLength: [1, "Description can not be less than 1 character"],
    maxLength: [255, "Description can not be longer than 50 characters"],
  },
  diagnosedDiseases: [{ type: String }],
});

module.exports = mongoose.model("User", userSchema);
