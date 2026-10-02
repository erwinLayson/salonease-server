import type { Request, Response, NextFunction } from "express";
import { authenticate, changeCredentials, getAccountDetails } from "../service/auth.js";
import { signToken } from "../helper/token.js";
import { AUTH_COOKIE_NAME, authCookieOptions } from "../config/auth.js";
import { BadRequestError, UnauthorizedError } from "../helper/error.js";
import { asyncHandler } from "../helper/asyncHandler.js";
import { optionalString, requireString } from "../helper/validation.js";

const MIN_PASSWORD_LENGTH = 8;

/** POST /api/auth/login — verifies credentials and sets the session cookie. */
export const login = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const { username, password } = body;

        if (
            typeof username !== "string" ||
            typeof password !== "string" ||
            username.trim() === "" ||
            password === ""
        ) {
            throw new BadRequestError("Username and password are required");
        }

        // Throws 401 for unknown/inactive/wrong-password users.
        const user = await authenticate(username.trim(), password);
        const token = signToken(user);

        res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
        res.status(200).json({ success: true, user });
    } catch (err) {
        next(err);
    }
};

/** POST /api/auth/logout — clears the session cookie. */
export const logout = (_req: Request, res: Response): void => {
    const { maxAge: _maxAge, ...options } = authCookieOptions();
    res.clearCookie(AUTH_COOKIE_NAME, options);
    res.status(200).json({ success: true });
};

/**
 * GET /api/auth/me — returns the current authenticated principal
 * plus account details (email, member-since, last sign-in) for the
 * account page. Never includes the password.
 */
export const me = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    const details = await getAccountDetails(req.user.id);

    // The account is re-checked on every request, so the row always
    // exists — fall back to the token principal just in case.
    res.status(200).json({
        success: true,
        user: details ?? {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role,
        },
    });
});

/**
 * PUT /api/auth/me — updates the signed-in user's login credentials.
 *
 * Body: `currentPassword` (always required) plus any of `username` and
 * `password`. The session cookie is re-issued with the fresh principal so the
 * username change is reflected immediately.
 */
export const updateCredentials = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        if (!req.user) {
            throw new UnauthorizedError("Authentication required");
        }

        const body = (req.body ?? {}) as Record<string, unknown>;
        const currentPassword = requireString(body.currentPassword, "Current password", 128);
        const username = optionalString(body.username, "Username", 50);
        const password = optionalString(body.password, "Password", 128);

        if (!username && !password) {
            throw new BadRequestError("Enter a new username or password to update");
        }

        if (password && password.length < MIN_PASSWORD_LENGTH) {
            throw new BadRequestError(
                `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
            );
        }

        const user = await changeCredentials(req.user.id, {
            currentPassword,
            username: username ?? undefined,
            password: password ?? undefined,
        });

        const token = signToken(user);
        res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
        res.status(200).json({ success: true, user });
    } catch (err) {
        next(err);
    }
};
