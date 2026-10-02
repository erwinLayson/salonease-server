import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError, UnauthorizedError } from "../helper/error.js";
import { optionalInteger, requireDateString } from "../helper/validation.js";
import { formatDate } from "../helper/time.js";
import { getScheduleView } from "../service/scheduleView.js";
import { findStaffForUser } from "../service/appointments.js";

// Types
import type { Request } from "express";
import type { ScheduleViewKind } from "../service/scheduleView.js";

const parseScheduleQuery = (req: Request) => {
    const viewRaw = typeof req.query.view === "string" && req.query.view !== "" ? req.query.view : "day";
    if (viewRaw !== "day" && viewRaw !== "week" && viewRaw !== "month") {
        throw new BadRequestError("view must be 'day', 'week' or 'month'");
    }

    const hasDate =
        req.query.date !== undefined && req.query.date !== null && req.query.date !== "";

    return {
        view: viewRaw as ScheduleViewKind,
        // Defaults to today so the endpoint is usable without a date.
        date: hasDate ? requireDateString(req.query.date, "date") : formatDate(new Date()),
        staffId: optionalInteger(req.query.staffId, "staffId"),
    };
};

/** GET /api/owner/schedule?view=day|week&date=YYYY-MM-DD&staffId= */
export const getOwnerSchedule = asyncHandler(async (req, res) => {
    const data = await getScheduleView(parseScheduleQuery(req));
    res.status(200).json({ success: true, data });
});

/** GET /api/staff/schedule — forced to the signed-in staff member only. */
export const getStaffSchedule = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    const query = parseScheduleQuery(req);
    const staff = await findStaffForUser(req.user.id);

    // A staff account without a staff profile has an empty schedule.
    if (!staff) {
        res.status(200).json({
            success: true,
            data: { view: query.view, from: query.date, to: query.date, staff: [] },
        });
        return;
    }

    const data = await getScheduleView({ ...query, staffId: staff.id });
    res.status(200).json({ success: true, data });
});
