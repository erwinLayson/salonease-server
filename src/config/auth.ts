import type { CookieOptions } from "express";

/** Name of the httpOnly cookie that carries the session JWT. */
export const AUTH_COOKIE_NAME = "salonease_token";

/** Session lifetime (also the cookie max-age). */
export const AUTH_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Cookie options for the session.
 * httpOnly prevents JS access; `secure` is enabled only in production so it works
 * over plain HTTP during local development.
 */
export const authCookieOptions = (): CookieOptions => ({
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
});
