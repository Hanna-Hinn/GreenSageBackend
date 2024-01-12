// Message.js
const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },
    sender: {},
    reciver: {},
    message: String,
    timestamp: { type: Date, default: Date.now },

});

module.exports = mongoose.model('Chat', chatSchema);
