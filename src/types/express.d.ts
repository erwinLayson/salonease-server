import type { AuthUser } from "../constant/users.js";

declare global {
    namespace Express {
        interface Request {
            /** Set by the `authenticate` middleware for protected routes. */
            user?: AuthUser;
        }
    }
}

export {};
