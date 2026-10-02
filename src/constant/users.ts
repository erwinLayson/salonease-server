/** Roles that can authenticate. Customers are guests and never have a role. */
export type Role = "owner" | "staff";

/** Input shape used when creating a user account. */
export type User = {
    username: string;
    password: string;
};

/** A row from the `users` table (snake_case mirrors the schema). */
export type UserRow = {
    id: number;
    username: string;
    email: string | null;
    password: string;
    role: Role;
    is_active: number; // MySQL TINYINT(1) -> 0 or 1
};

/** The authenticated principal attached to a request (never includes the password). */
export type AuthUser = {
    id: number;
    username: string;
    role: Role;
};

/** Account summary for the signed-in user (returned by GET /api/auth/me). */
export type AccountDetails = {
    id: number;
    username: string;
    email: string | null;
    role: Role;
    lastLoginAt: string | null;
    createdAt: string;
};
