const mongoose = require('mongoose');
const { Decimal128 } = require('mongodb');


const ratingSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, `Title can not be empty`],
        trim: true,
        minLength: [1, 'Title can not be less than 1 character'],
        maxLength: [50, 'Title can not be longer than 50 characters']
    },
    rating: {
        type: Decimal128,
        required: [true, `Rating can not be empty`],
    },
    description: {
        type: String,
        required: [true, `Description can not be empty`],
        trim: true,
        minLength: [1, 'Description can not be less than 1 character'],
        maxLength: [255, 'Description can not be longer than 50 characters']
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',  // Reference the User model
        required: true,
    },
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',  // Reference the Product model
        required: true,
    }
});

module.exports = mongoose.model('Rating', ratingSchema);