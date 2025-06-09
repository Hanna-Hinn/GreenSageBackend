const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, `Name can not be empty`],
    trim: true,
    minLength: [1, "Name can not be less than 1 character"],
    maxLength: [50, "Name can not be longer than 50 characters"],
  },
  description: {
    type: String,
    required: [true, `Description can not be empty`],
    trim: true,
    minLength: [1, "Name can not be less than 1 character"],
    maxLength: [255, "Name can not be longer than 255 characters"],
  },
  products: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product", // Reference the Product model
    },
  ],
  subCategories: [{ type: String }],
});

module.exports = mongoose.model("Category", categorySchema);
