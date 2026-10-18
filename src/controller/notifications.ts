import { asyncHandler } from "../helper/asyncHandler.js";
import { NotFoundError, UnauthorizedError } from "../helper/error.js";
import { requireIdParam } from "../helper/validation.js";
import * as notificationService from "../service/notifications.js";

/** GET /api/notifications */
export const list = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    const data = await notificationService.listNotifications(req.user.id);
    res.status(200).json({ success: true, data });
});

/** PATCH /api/notifications/:id/read */
export const markRead = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    const updated = await notificationService.markNotificationRead(
        req.user.id,
        requireIdParam(req.params.id)
    );
    if (!updated) throw new NotFoundError("Notification not found", 404);
    res.status(200).json({ success: true });
});
