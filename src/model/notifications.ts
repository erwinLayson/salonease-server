import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";
import { safeRowLimit } from "../helper/sql.js";

// Types
import type { Role } from "../constant/users.js";

export type InAppNotificationType =
    | "low_stock"
    | "event_assigned"
    | "event_changed"
    | "commission_ready"
    | "system";

export type InAppNotificationSeverity = "info" | "warning" | "critical";

export type InAppNotificationRow = {
    id: number;
    user_id: number;
    type: InAppNotificationType;
    severity: InAppNotificationSeverity;
    title: string;
    body: string;
    link: string | null;
    read_at: Date | null;
    created_at: Date;
};

export type CreateNotificationInput = {
    userId: number;
    type: InAppNotificationType;
    severity?: InAppNotificationSeverity;
    title: string;
    body: string;
    link?: string | null;
};

export default class NotificationModel {
    constructor(private connection: PoolConnection) {}

    async insert(input: CreateNotificationInput): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO in_app_notifications
                    (user_id, type, severity, title, body, link)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    input.userId,
                    input.type,
                    input.severity ?? "info",
                    input.title,
                    input.body,
                    input.link ?? null,
                ]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async listForUser(userId: number, limit = 50): Promise<InAppNotificationRow[]> {
        try {
            const safeLimit = safeRowLimit(limit, 50);
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT id, user_id, type, severity, title, body, link, read_at, created_at
                 FROM in_app_notifications
                 WHERE user_id = ?
                 ORDER BY created_at DESC, id DESC
                 LIMIT ${safeLimit}`,
                [userId]
            );
            return rows as InAppNotificationRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async unreadCount(userId: number): Promise<number> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                "SELECT COUNT(*) AS total FROM in_app_notifications WHERE user_id = ? AND read_at IS NULL",
                [userId]
            );
            return Number(rows[0]?.total ?? 0);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async markRead(id: number, userId: number): Promise<boolean> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                "UPDATE in_app_notifications SET read_at = NOW() WHERE id = ? AND user_id = ? AND read_at IS NULL",
                [id, userId]
            );
            return result.affectedRows > 0;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async listActiveUserIdsByRole(role: Role): Promise<number[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                "SELECT id FROM users WHERE role = ? AND is_active = 1 ORDER BY id",
                [role]
            );
            return rows.map((row) => row.id as number);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }
}
