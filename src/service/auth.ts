import UserModel from "../model/users.js";
import { databasePool } from "../config/database.js";
import { withTransaction } from "../helper/withConnection.js";
import { hashPassword, verifyPassword } from "../helper/password.js";
import { ConflictError, UnauthorizedError } from "../helper/error.js";

// Types
import type { AccountDetails, AuthUser } from "../constant/users.js";

/**
 * Verifies owner/staff credentials.
 *
 * Every failure returns the same generic 401 so the response cannot be used to
 * enumerate usernames or discover which accounts exist.
 */
export const authenticate = async (
    username: string,
    password: string
): Promise<AuthUser> => {
    const connection = await databasePool().getConnection();

    try {
        const userModel = new UserModel(connection);
        const user = await userModel.findByUsername(username);

        if (!user || user.is_active !== 1) {
            throw new UnauthorizedError("Invalid username or password");
        }

        if (!verifyPassword(password, user.password)) {
            throw new UnauthorizedError("Invalid username or password");
        }

        await userModel.updateLastLogin(user.id);

        return { id: user.id, username: user.username, role: user.role };
    } finally {
        connection.release();
    }
};

/** Loads the current principal from the database (rejects deleted/disabled users). */
export const getActiveUser = async (id: number): Promise<AuthUser | null> => {
    const connection = await databasePool().getConnection();

    try {
        const userModel = new UserModel(connection);
        const user = await userModel.findById(id);

        if (!user || user.is_active !== 1) {
            return null;
        }

        return { id: user.id, username: user.username, role: user.role };
    } finally {
        connection.release();
    }
};

/** Account summary for the signed-in user (profile shown on /account). */
export const getAccountDetails = async (
    userId: number
): Promise<AccountDetails | null> => {
    const connection = await databasePool().getConnection();

    try {
        return await new UserModel(connection).getAccountDetails(userId);
    } finally {
        connection.release();
    }
};

export interface ChangeCredentialsInput {
    currentPassword: string;
    username?: string | undefined;
    password?: string | undefined;
}

/**
 * Updates the signed-in user's login credentials.
 *
 * The current password must verify first, so a hijacked session cannot lock
 * the real user out. Username and password are written in one transaction and
 * the refreshed principal is returned so the caller can re-issue the session
 * cookie (the token carries the username).
 */
export const changeCredentials = async (
    userId: number,
    input: ChangeCredentialsInput
): Promise<AuthUser> =>
    withTransaction(async (connection) => {
        const userModel = new UserModel(connection);
        const user = await userModel.findById(userId);

        if (!user || user.is_active !== 1) {
            throw new UnauthorizedError("Session is no longer valid");
        }

        if (!verifyPassword(input.currentPassword, user.password)) {
            throw new UnauthorizedError("Current password is incorrect");
        }

        if (input.username && input.username !== user.username) {
            // Case-insensitive match may return the caller's own row (a
            // case-only rename) — only a different account is a conflict.
            const existing = await userModel.findByUsername(input.username);
            if (existing && existing.id !== user.id) {
                throw new ConflictError("That username is already taken");
            }
            await userModel.updateUsername(user.id, input.username);
        }

        if (input.password) {
            await userModel.updatePassword(user.id, hashPassword(input.password));
        }

        return {
            id: user.id,
            username: input.username ?? user.username,
            role: user.role,
        };
    });
