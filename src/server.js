
const express = require("express");
const connectDB = require("./config/db");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/cart", require("./routes/cartRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/analytics", require("./routes/analyticsRoutes"));


const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}).catch((error) => {
  console.error("Failed to connect to the database:", error);
  process.exit(1);
});
