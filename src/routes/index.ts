import type { Express } from "express";
import authenticate from "../middleware/authenticate.js";
import publicRouter from "./public.js";
import authRouter from "./auth.js";
import ownerRouter from "./owner.js";
import staffRouter from "./staff.js";

/**
 * Mounts every router.
 *
 * Anything mounted under `/api/owner` or `/api/staff` is authenticated as a whole
 * router, then role-restricted by the router itself. New protected routers must be
 * mounted here AND listed in `routes/registry.ts`.
 */
export default function registerRoutes(app: Express): void {
    app.use("/api/public", publicRouter);
    app.use("/api/auth", authRouter);

    // Every route below requires a valid session.
    app.use("/api/owner", authenticate, ownerRouter);
    app.use("/api/staff", authenticate, staffRouter);
}
