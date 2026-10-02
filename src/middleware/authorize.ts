import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ForbiddenError, UnauthorizedError } from "../helper/error.js";

// Types
import type { Role } from "../constant/users.js";

/**
 * Restricts a route to one or more roles. Must run after `authenticate`.
 * Authorization is enforced here on the server — never in the UI alone.
 */
export const requireRole = (...roles: Role[]): RequestHandler =>
    (req: Request, _res: Response, next: NextFunction): void => {
        if (!req.user) {
            next(new UnauthorizedError("Authentication required"));
            return;
        }

        if (!roles.includes(req.user.role)) {
            next(new ForbiddenError("You do not have permission to access this resource"));
            return;
        }

        next();
    };
