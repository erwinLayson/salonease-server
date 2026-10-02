import type { CookieOptions } from "express";

/** Name of the httpOnly cookie that carries the session JWT. */
export const AUTH_COOKIE_NAME = "salonease_token";

/** Session lifetime (also the cookie max-age). */
export const AUTH_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Cookie options for the session.
 *
 * The deployed SPA (e.g. Vercel) and API (e.g. Render) live on different sites,
 * so the session cookie is a cross-site request. `SameSite=Lax` cookies are NOT
 * sent on cross-site XHR/fetch, so login would appear to succeed and then
 * immediately 401 on the next call — i.e. the user is signed straight back out.
 * Cross-site requests require `SameSite=None`, which browsers only accept when
 * the cookie is also `Secure`.
 *
 * Local development keeps `Lax`: the Vite dev server proxies /api, so requests
 * are same-origin and the cookie still works over plain HTTP (`secure` off).
 */
export const authCookieOptions = (): CookieOptions => {
    const isProduction = process.env.NODE_ENV === "production";

    return {
        httpOnly: true,
        sameSite: isProduction ? "none" : "lax",
        secure: isProduction,
        path: "/",
        maxAge: AUTH_COOKIE_MAX_AGE_MS,
    };
};
