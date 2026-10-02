import type { Request, Response, NextFunction, RequestHandler } from "express";
import { TooManyRequestsError } from "../helper/error.js";

/**
 * In-memory sliding-window rate limiter used as spam protection for the public
 * booking endpoints (`FR-GB7`).
 *
 * NOTE: state is per-process. A multi-instance deployment would need a shared
 * store (e.g. Redis); for this single-instance deployment it is sufficient.
 * `resetRateLimits()` exists so tests can start from a clean slate.
 */

const buckets = new Map<string, number[]>();

export interface RateLimitOptions {
    windowMs: number;
    max: number;
    /** Distinguishes limits that share the same client key. */
    keyPrefix?: string;
    message?: string;
}

/** Clears all rate-limit state (used by tests). */
export const resetRateLimits = (): void => {
    buckets.clear();
};

export const rateLimit = (options: RateLimitOptions): RequestHandler =>
    (req: Request, res: Response, next: NextFunction): void => {
        const key = `${options.keyPrefix ?? "default"}:${req.ip ?? "unknown"}`;
        const now = Date.now();
        const windowStart = now - options.windowMs;

        const recent = (buckets.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

        if (recent.length >= options.max) {
            const oldest = recent[0]!;
            const retryAfterSeconds = Math.max(
                1,
                Math.ceil((oldest + options.windowMs - now) / 1000)
            );

            res.setHeader("Retry-After", String(retryAfterSeconds));
            next(
                new TooManyRequestsError(
                    options.message ??
                        "Too many requests. Please wait a moment before trying again."
                )
            );
            return;
        }

        recent.push(now);
        buckets.set(key, recent);
        next();
    };
