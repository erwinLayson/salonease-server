import express from "express";
import type { Express } from "express";
import cookieParser from "cookie-parser";
import registerRoutes from "./routes/index.js";
import ErrorHandler from "./middleware/ErrorHandler.js";
import { NotFoundError } from "./helper/error.js";

const app: Express = express();

app.use(express.json());

// Parses the httpOnly session cookie so `req.cookies` is available to auth middleware.
app.use(cookieParser());

registerRoutes(app);

// Any route that matched nothing is a 404, handled by the shared error handler.
app.use((_req, _res, next) => {
    next(new NotFoundError("Route not found", 404));
});

// Error handler must be registered last.
app.use(ErrorHandler);

export default app;
