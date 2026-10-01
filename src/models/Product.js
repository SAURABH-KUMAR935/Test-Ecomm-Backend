const moongose = require('mongoose');

const productschema = moongose.Schema(
    {
        name: { type: String, required: true },
        description: { type: String, required: true },
        price: { type: Number, required: true },
        imageUrl: { type: String, default: "" },
        category: { type: String, required: true },
        countInStock: { type: Number, required: true },
        createdAt: { type: Date, default: Date.now },
        rating: { type: Number, default: 0 },
        numReviews: { type: Number, default: 0 },
    },
    { timestamps: true }
);

const Product = moongose.model('Product', productschema);
module.exports = Product;