import UserModel from "../model/users.js";
import { databasePool } from "../config/database.js";
import { hashPassword } from "../helper/password.js";

// Types
import type { PoolConnection } from "mysql2/promise";
import type { Role } from "../constant/users.js";

export type CreateUserServiceInput = {
    username: string;
    email?: string | null;
    password: string; // plaintext; hashed before storage
    role: Role;
};

/**
 * Creates a user account with a hashed password.
 * Accepts an existing connection so callers can compose this inside a transaction.
 */
export const createUserService = async (
    user: CreateUserServiceInput,
    existingConnection?: PoolConnection
): Promise<number> => {
    const connection = existingConnection ?? (await databasePool().getConnection());
    const ownConnection = !existingConnection;

    try {
        const userModel = new UserModel(connection);
        return await userModel.createUser({
            username: user.username,
            email: user.email ?? null,
            password: hashPassword(user.password),
            role: user.role,
        });
    } finally {
        if (ownConnection) {
            connection.release();
        }
    }
};
