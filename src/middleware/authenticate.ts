import type { Request, Response, NextFunction } from "express";
import { AUTH_COOKIE_NAME } from "../config/auth.js";
import { verifyToken } from "../helper/token.js";
import { getActiveUser } from "../service/auth.js";
import { UnauthorizedError } from "../helper/error.js";

/**
 * Requires a valid session cookie.
 *
 * On success the principal is attached to `req.user`. The account is re-checked
 * against the database on every request so that a deactivated (or deleted) user
 * cannot keep using a still-valid token, and role changes take effect at once.
 * Otherwise the request is rejected with 401 before reaching any handler.
 */
export default async function authenticate(
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const token = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE_NAME];

        if (!token) {
            throw new UnauthorizedError("Authentication required");
        }

        const principal = verifyToken(token);
        const activeUser = await getActiveUser(principal.id);

        if (!activeUser) {
            throw new UnauthorizedError("Session is no longer valid");
        }

        req.user = activeUser;
        next();
    } catch (err) {
        next(err);
    }
}
