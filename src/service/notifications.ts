import type { PoolConnection } from "mysql2/promise";
import NotificationModel from "../model/notifications.js";
import { withConnection } from "../helper/withConnection.js";

// Types
import type { Role } from "../constant/users.js";
import type {
    CreateNotificationInput,
    InAppNotificationRow,
} from "../model/notifications.js";

export interface NotificationDetail {
    id: number;
    type: string;
    severity: string;
    title: string;
    body: string;
    link: string | null;
    readAt: Date | null;
    createdAt: Date;
}

const toDetail = (row: InAppNotificationRow): NotificationDetail => ({
    id: row.id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.read_at,
    createdAt: row.created_at,
});

export const listNotifications = async (
    userId: number
): Promise<{ items: NotificationDetail[]; unread: number }> =>
    withConnection(async (connection) => {
        const model = new NotificationModel(connection);
        const rows = await model.listForUser(userId);
        return { items: rows.map(toDetail), unread: await model.unreadCount(userId) };
    });

export const markNotificationRead = (userId: number, id: number): Promise<boolean> =>
    withConnection((connection) => new NotificationModel(connection).markRead(id, userId));

/**
 * Creates one notification for every active user with a role. Accepts an
 * optional connection so callers inside a transaction (e.g. stock deduction)
 * can create the alert atomically.
 */
export const notifyRole = async (
    role: Role,
    input: Omit<CreateNotificationInput, "userId">,
    connection?: PoolConnection
): Promise<void> => {
    const run = async (conn: PoolConnection): Promise<void> => {
        const model = new NotificationModel(conn);
        const userIds = await model.listActiveUserIdsByRole(role);
        for (const userId of userIds) {
            await model.insert({ ...input, userId });
        }
    };

    if (connection) {
        await run(connection);
        return;
    }

    await withConnection(run);
};

/** Creates a notification for one user; used for staff-specific event changes. */
export const notifyUser = async (
    userId: number,
    input: Omit<CreateNotificationInput, "userId">,
    connection?: PoolConnection
): Promise<void> => {
    if (connection) {
        await new NotificationModel(connection).insert({ ...input, userId });
        return;
    }

    await withConnection((conn) =>
        new NotificationModel(conn).insert({ ...input, userId })
    );
};
