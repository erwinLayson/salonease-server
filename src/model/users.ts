import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";

// Types
import type { AccountDetails, Role, UserRow } from "../constant/users.js";

export type CreateUserInput = {
    username: string;
    email: string | null;
    password: string; // already hashed
    role: Role;
};

export default class UserModel {
    constructor(private connection: PoolConnection) {}

    /** Finds a user by username (used at login). */
    async findByUsername(username: string): Promise<UserRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                "SELECT id, username, email, password, role, is_active FROM users WHERE username = ? LIMIT 1",
                [username]
            );
            return (rows[0] as UserRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Finds a user by id (used to refresh the session principal). */
    async findById(id: number): Promise<UserRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                "SELECT id, username, email, password, role, is_active FROM users WHERE id = ? LIMIT 1",
                [id]
            );
            return (rows[0] as UserRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Account summary for the signed-in user (never includes the password). */
    async getAccountDetails(id: number): Promise<AccountDetails | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT id, username, email, role,
                        last_login_at AS lastLoginAt,
                        created_at AS createdAt
                 FROM users WHERE id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as AccountDetails | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Records a successful login. */
    async updateLastLogin(id: number): Promise<void> {
        try {
            await this.connection.execute(
                "UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
                [id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Updates the login username for a user. */
    async updateUsername(id: number, username: string): Promise<void> {
        try {
            await this.connection.execute("UPDATE users SET username = ? WHERE id = ?", [
                username,
                id,
            ]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Updates the login email for a user. */
    async updateEmail(id: number, email: string | null): Promise<void> {
        try {
            await this.connection.execute("UPDATE users SET email = ? WHERE id = ?", [
                email,
                id,
            ]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Updates the password hash for a user. */
    async updatePassword(id: number, passwordHash: string): Promise<void> {
        try {
            await this.connection.execute("UPDATE users SET password = ? WHERE id = ?", [
                passwordHash,
                id,
            ]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Activates or deactivates a login account. */
    async setActive(id: number, isActive: boolean): Promise<void> {
        try {
            await this.connection.execute("UPDATE users SET is_active = ? WHERE id = ?", [
                isActive ? 1 : 0,
                id,
            ]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Removes a login account. */
    async deleteById(id: number): Promise<void> {
        try {
            await this.connection.execute("DELETE FROM users WHERE id = ?", [id]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Creates a user account. `password` must already be hashed. */
    async createUser(user: CreateUserInput): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                "INSERT INTO users (username, email, password, role, is_active) VALUES (?, ?, ?, ?, 1)",
                [user.username, user.email, user.password, user.role]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }
}
