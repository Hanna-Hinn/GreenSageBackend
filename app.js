const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const connectDB = require("./db/dbConnection");
const process = require("process");
require("dotenv").config();
const cors = require("cors");
const { configureSocket } = require("./socket");

const app = express();
const server = http.createServer(app);
configureSocket(server);

// M
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");
const register = require("./utils/api/register");
const login = require("./utils/api/login");
const stripe = require("./stripe/stripe");
const invoices = require("./stripe/invoices");

// Routers
const users = require("./routes/userRoutes");
const owners = require("./routes/ownerRoutes");
const addresses = require("./routes/addressRoutes");
const categories = require("./routes/categoryRoutes");
const products = require("./routes/productRoutes");
const ratings = require("./routes/ratingRoutes ");
const carts = require("./routes/cartRoutes");
const favorites = require("./routes/favoriteRoutes");
const shipments = require("./routes/shippingRoutes");
const payments = require("./routes/paymnetRoutes");
const orders = require("./routes/orderRoutes");

// CORS Middleware
app.use(cors());

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

// Routes Middleware
app.use(register);
app.use(login);
app.use(stripe);
app.use(invoices);
app.use("/api/users", users);
app.use("/api/owners", owners);
app.use("/api/addresses", addresses);
app.use("/api/categories", categories);
app.use("/api/products", products);
app.use("/api/ratings", ratings);
app.use("/api/carts", carts);
app.use("/api/favorites", favorites);
app.use("/api/shipments", shipments);
app.use("/api/payments", payments);
app.use("/api/orders", orders);

// M
app.use(notFound);
app.use(errorHandler);

const PORT = parseInt(process.env.PORT) || 5000;
const start = async () => {
  try {
    await connectDB(process.env.MONGO_URI);
    server.listen(PORT, () => {
      console.log(`Server is listening on port ${PORT}...`);
    });
  } catch (error) {
    console.log(error);
  }
};
start();

app.use(express.static("public"));
