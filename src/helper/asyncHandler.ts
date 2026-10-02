import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Wraps an async route handler so any thrown/rejected error is forwarded to the
 * Express error middleware instead of becoming an unhandled rejection.
 */
export const asyncHandler = (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler =>
    (req, res, next) => {
        fn(req, res, next).catch(next);
    };
