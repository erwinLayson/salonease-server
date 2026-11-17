import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError, UnauthorizedError } from "../helper/error.js";
import {
    optionalString,
    requireDateString,
    requireIdParam,
    requireNumber,
    requireString,
} from "../helper/validation.js";
import { combineDateTime, endOfDay, formatDate, startOfDay } from "../helper/time.js";
import * as dailyCloseService from "../service/dailyClose.js";
import * as queueService from "../service/queue.js";

// Types
import type { Request } from "express";

const present = (value: unknown): boolean =>
    value !== undefined && value !== null && value !== "";

const parseRange = (req: Request): { from: Date; to: Date } => {
    const now = new Date();
    const from = present(req.query.from)
        ? combineDateTime(requireDateString(req.query.from, "from"), "00:00:00")
        : startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = present(req.query.to)
        ? endOfDay(combineDateTime(requireDateString(req.query.to, "to"), "00:00:00"))
        : endOfDay(now);
    return { from, to };
};

const csv = (headers: string[], rows: Array<Array<string | number | null>>): string => {
    const escape = (value: string | number | null): string => {
        const text = value === null ? "" : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [headers.join(","), ...rows.map((row) => row.map(escape).join(","))].join("\n");
};

// --- Daily close ---

/** GET /api/owner/closures?from=&to= */
export const listClosures = asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req);
    const data = await dailyCloseService.listClosures(
        formatDate(from),
        formatDate(new Date(to.getTime() - 1))
    );
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/closures/:date */
export const getClosure = asyncHandler(async (req, res) => {
    const date = requireDateString(req.params.date, "date");
    const data = await dailyCloseService.getDaySummary(date);
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/closures { date, cashCounted?, notes? } */
export const closeDay = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const data = await dailyCloseService.closeDay({
        date: requireDateString(body.date, "date"),
        cashCounted: present(body.cashCounted)
            ? requireNumber(body.cashCounted, "cashCounted")
            : null,
        notes: optionalString(body.notes, "notes", 255),
        userId: req.user.id,
    });
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/closures/:date/reopen { reason } */
export const reopenDay = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await dailyCloseService.reopenDay(
        requireDateString(req.params.date, "date"),
        requireString(body.reason, "reason", 255),
        req.user.id
    );
    res.status(200).json({ success: true, data });
});

// --- Reports ---

/** GET /api/owner/reports/daily-sales?from=&to=&groupBy=day|week|month|staff|service|method&format=csv */
export const salesReport = asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req);
    const rawGroup = present(req.query.groupBy)
        ? requireString(req.query.groupBy, "groupBy", 10)
        : "day";
    const groupOptions = ["day", "week", "month", "staff", "service", "method"] as const;
    if (!groupOptions.includes(rawGroup as (typeof groupOptions)[number])) {
        throw new BadRequestError(`groupBy must be one of: ${groupOptions.join(", ")}`);
    }
    const groupBy = rawGroup as (typeof groupOptions)[number];
    const rows = await dailyCloseService.getSalesReport(from, to, groupBy);

    if (req.query.format === "csv") {
        const body = csv(
            ["Bucket", "Staff", "Service", "Payment method", "Transactions", "Gross", "Paid"],
            rows.map((row) => [
                row.bucket,
                row.staff_name,
                row.service_name,
                row.payment_method,
                row.transactions,
                row.gross,
                row.paid,
            ])
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="sales-report-${formatDate(from)}-${formatDate(to)}.csv"`
        );
        res.status(200).send(body);
        return;
    }

    res.status(200).json({ success: true, data: rows });
});

/** GET /api/owner/reports/wait-times?from=&to=&format=csv */
export const waitTimesReport = asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req);
    const fromDate = formatDate(from);
    const toDate = formatDate(new Date(to.getTime() - 1));
    const data = await queueService.getWaitTimeReport(fromDate, toDate);

    if (req.query.format === "csv") {
        const body = csv(
            ["Group", "Date", "Staff", "Tickets", "Served", "Average wait (min)", "Longest wait (min)"],
            [
                ...data.days.map((row) => [
                    "Day",
                    row.date,
                    null,
                    row.tickets,
                    row.served,
                    row.avgWaitMinutes,
                    row.longestWaitMinutes,
                ]),
                ...data.staff.map((row) => [
                    "Staff",
                    null,
                    row.staffName,
                    row.tickets,
                    row.served,
                    row.avgWaitMinutes,
                    row.longestWaitMinutes,
                ]),
            ]
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="wait-times-${fromDate}-${toDate}.csv"`
        );
        res.status(200).send(body);
        return;
    }

    res.status(200).json({ success: true, data });
});

/** GET /api/owner/reports/reconciliation?from=&to= */
export const reconciliationReport = asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req);
    const data = await dailyCloseService.getReconciliation(from, to);
    res.status(200).json({ success: true, data });
});


