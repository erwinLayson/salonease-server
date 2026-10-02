import express from "express";
import type { Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import registerRoutes from "./routes/index.js";
import ErrorHandler from "./middleware/ErrorHandler.js";
import { NotFoundError } from "./helper/error.js";

const app: Express = express();

app.use(express.json());

// Parses the httpOnly session cookie so `req.cookies` is available to auth middleware.
app.use(cookieParser());

// CORS: lets the API be called from other origins (e.g. a separately
// deployed client). Credentials (the httpOnly session cookie) require an
// explicit allow-list — a wildcard origin cannot be combined with
// credentials. Set CORS_ORIGINS to a comma-separated list; it falls back
// to PUBLIC_APP_URL, and CORS stays disabled when neither is set.
const allowedOrigins = (process.env.CORS_ORIGINS ?? process.env.PUBLIC_APP_URL ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

app.use(
    cors({
        origin: allowedOrigins.length > 0 ? allowedOrigins : false,
        credentials: true,
        optionsSuccessStatus: 204,
        maxAge: 600, // cache preflight responses for 10 minutes
    })
);

registerRoutes(app);

// Any route that matched nothing is a 404, handled by the shared error handler.
app.use((_req, _res, next) => {
    next(new NotFoundError("Route not found", 404));
});

// Error handler must be registered last.
app.use(ErrorHandler);

export default app;
