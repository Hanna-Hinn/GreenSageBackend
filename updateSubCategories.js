const Category = require("./models/categoryModel");
const connectDB = require("./db/dbConnection");
const mongoose = require("mongoose")(async () => {
  await connectDB(
    "mongodb+srv://hannahinn30:dKpkXlVM1tjU9qMF@cluster0.i35cd.mongodb.net/test?retryWrites=true&w=majority&appName=Cluster0"
  );

  const payload = {
    Vitamins: [
      "Vitamin A",
      "Vitamin B",
      "Vitamin C",
      "Vitamin D",
      "Vitamin E",
      "Vitamin K",
      "Multivitamins",
    ],
    Medicines: [
      "Over-the-counter",
      "Prescription",
      "Pain Relief",
      "Cold & Flu",
      "Antibiotics",
      "Digestive Health",
    ],
    Herbs: [
      "Leafy Herbs",
      "Roots & Rhizomes",
      "Seeds",
      "Flowers",
      "Bark",
      "Extracts & Tinctures",
    ],
    Vegetables: [
      "Leafy Greens",
      "Root Vegetables",
      "Cruciferous",
      "Marrow",
      "Alliums",
      "Legumes",
    ],
    Fruits: [
      "Citrus",
      "Berries",
      "Tropical",
      "Stone Fruits",
      "Pomes",
      "Melons",
      "Dried Fruits",
    ],
    Others: [
      "Superfoods",
      "Protein Supplements",
      "Healthy Snacks",
      "Herbal Blends",
      "Beverages",
    ],
  };

  for (const [name, subs] of Object.entries(payload)) {
    const res = await Category.updateOne(
      { name },
      { $set: { subCategories: subs } }
    );
    console.log(
      `${name}: matched=${res.matchedCount}, modified=${res.modifiedCount}`
    );
  }

  await mongoose.disconnect();
})();
