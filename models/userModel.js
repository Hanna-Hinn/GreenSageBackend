const mongoose = require('mongoose');
const validator = require('validator');

const imageURLRegex = /^(http|https):\/\/(www\.)?(.*)\.(?:jpeg|jpg|png|gif)$/i;

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: [true, 'First name can not be empty'],
        trim: true,
        maxLength: [30, 'Name can not be longer than 30 characters']
    },
    lastName: {
        type: String,
        required: [true, 'Last name can not be empty'],
        trim: true,
        maxLength: [30, 'Name can not be longer than 30 characters']
    },
    email: {
        type: String,
        required: [true, 'Email can not be empty'],
        trim: true,
        unique: [true, 'Email already exists'],
        validate: {
            validator: (value) => validator.isEmail(value),
            message: 'Invalid email format',
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
        default: 'owner',
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
    ratings: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Rating', // Reference the Rating model
    }],
    cart: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Cart',
        // populate: true, // automatically fetch the cart when querying a user
    },
});

module.exports = mongoose.model('User', userSchema);
