import jwt from "jsonwebtoken";
import { getEnvName } from "./getEnvName.js";
import { UnauthorizedError } from "./error.js";

// Types
import type { AuthUser, Role } from "../constant/users.js";

const ALGORITHM = "HS256";

/** Claims stored in the session JWT. `sub` is the user id. */
type SessionClaims = {
    sub: number;
    username: string;
    role: Role;
};

const secret = (): string => getEnvName("JWT_SECRET");

/** Signs a session token for an authenticated owner/staff user. */
export const signToken = (user: AuthUser): string => {
    const payload: Omit<SessionClaims, "sub"> = {
        username: user.username,
        role: user.role,
    };

    const options: jwt.SignOptions = {
        subject: String(user.id),
        algorithm: ALGORITHM,
        // Format is validated by the operator via env (e.g. "1d", "12h").
        expiresIn: getEnvName("JWT_EXPIRES_IN") as NonNullable<
            jwt.SignOptions["expiresIn"]
        >,
    };

    return jwt.sign(payload, secret(), options);
};

/**
 * Verifies a session token and returns the authenticated principal.
 * The algorithm is pinned to HS256, which rejects `alg: none` and algorithm
 * confusion attacks. Any failure maps to a 401.
 */
export const verifyToken = (token: string): AuthUser => {
    try {
        const decoded = jwt.verify(token, secret(), { algorithms: [ALGORITHM] });

        if (typeof decoded === "string" || decoded.sub === undefined) {
            throw new Error("Malformed token payload");
        }

        const { sub, username, role } = decoded as jwt.JwtPayload &
            Omit<SessionClaims, "sub">;

        if (role !== "owner" && role !== "staff") {
            throw new Error("Unknown role in token");
        }

        return { id: Number(sub), username: String(username), role };
    } catch {
        throw new UnauthorizedError("Invalid or expired session");
    }
};
