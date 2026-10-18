import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError, UnauthorizedError } from "../helper/error.js";
import {
    optionalInteger,
    optionalString,
    requireDateString,
    requireIdParam,
    requireInteger,
    requireNumber,
    requireString,
} from "../helper/validation.js";
import { combineDateTime, endOfDay, formatDate, startOfDay } from "../helper/time.js";
import { SERVICE_CATEGORIES } from "../constant/services.js";
import * as commissionService from "../service/commissions.js";
import * as dailyCloseService from "../service/dailyClose.js";
import * as queueService from "../service/queue.js";

// Types
import type { Request } from "express";
import type { CommissionRateType } from "../service/commissionRules.js";

const present = (value: unknown): boolean =>
    value !== undefined && value !== null && value !== "";

const parseRateType = (value: unknown): CommissionRateType => {
    const raw = requireString(value ?? "percent", "rateType", 10);
    if (raw !== "percent" && raw !== "fixed") {
        throw new BadRequestError("rateType must be percent or fixed");
    }
    return raw;
};

const parseRuleBody = (body: unknown) => {
    const input = (body ?? {}) as Record<string, unknown>;

    let serviceCategory: string | null = null;
    if (present(input.serviceCategory)) {
        const raw = requireString(input.serviceCategory, "serviceCategory", 40);
        if (!SERVICE_CATEGORIES.includes(raw as (typeof SERVICE_CATEGORIES)[number])) {
            throw new BadRequestError(
                `serviceCategory must be one of: ${SERVICE_CATEGORIES.join(", ")}`
            );
        }
        serviceCategory = raw;
    }

    return {
        staffId: optionalInteger(input.staffId, "staffId"),
        serviceId: optionalInteger(input.serviceId, "serviceId"),
        serviceCategory,
        rateType: parseRateType(input.rateType),
        rateValue: requireNumber(input.rateValue, "rateValue"),
        effectiveFrom: requireDateString(
            input.effectiveFrom ?? formatDate(new Date()),
            "effectiveFrom"
        ),
        effectiveTo: present(input.effectiveTo)
            ? requireDateString(input.effectiveTo, "effectiveTo")
            : null,
        priority: present(input.priority) ? requireInteger(input.priority, "priority") : 0,
        notes: optionalString(input.notes, "notes", 255),
    };
};

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

// --- Commission rules ---

/** GET /api/owner/commission-rules?includeInactive=true */
export const listRules = asyncHandler(async (req, res) => {
    const data = await commissionService.listRules(req.query.includeInactive === "true");
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/commission-rules */
export const createRule = asyncHandler(async (req, res) => {
    const data = await commissionService.createRule(parseRuleBody(req.body));
    res.status(201).json({ success: true, data });
});

/** PUT /api/owner/commission-rules/:id */
export const updateRule = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = parseRuleBody(body);
    const data = await commissionService.updateRule(requireIdParam(req.params.id), {
        ...parsed,
        isActive: body.isActive === undefined ? true : body.isActive === true,
    });
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/commission-rules/preview */
export const previewRule = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await commissionService.previewCommission({
        staffId: requireIdParam(String(body.staffId ?? ""), "staffId"),
        serviceId: requireIdParam(String(body.serviceId ?? ""), "serviceId"),
        baseAmount: requireNumber(body.baseAmount, "baseAmount"),
        date: present(body.date) ? requireDateString(body.date, "date") : formatDate(new Date()),
    });
    res.status(200).json({ success: true, data });
});

/** DELETE /api/owner/commission-rules/:id */
export const deleteRule = asyncHandler(async (req, res) => {
    await commissionService.deleteRule(requireIdParam(req.params.id));
    res.status(204).send();
});

// --- Commission entries and payouts ---

/** GET /api/owner/commissions/entries?from=&to=&staffId=&status= */
export const listEntries = asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req);
    const data = await commissionService.listEntries({
        from,
        to,
        staffId: optionalInteger(req.query.staffId, "staffId"),
        status: present(req.query.status)
            ? requireString(req.query.status, "status", 20)
            : null,
    });
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/commission-payouts */
export const listPayouts = asyncHandler(async (req, res) => {
    const staffId = optionalInteger(req.query.staffId, "staffId");
    const data = await commissionService.listPayouts(staffId);
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/commission-payouts */
export const createPayout = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const data = await commissionService.createPayout({
        staffId: requireIdParam(String(body.staffId ?? ""), "staffId"),
        periodStart: requireDateString(body.periodStart, "periodStart"),
        periodEnd: requireDateString(body.periodEnd, "periodEnd"),
        notes: optionalString(body.notes, "notes", 255),
        createdBy: req.user.id,
    });
    res.status(201).json({ success: true, data });
});

/** PATCH /api/owner/commission-payouts/:id/status { status, paymentMethod? } */
export const updatePayoutStatus = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = requireString(body.status, "status", 20);
    if (!["draft", "approved", "paid", "void"].includes(status)) {
        throw new BadRequestError("status must be draft, approved, paid or void");
    }
    const data = await commissionService.updatePayoutStatus(
        requireIdParam(req.params.id),
        status as "draft" | "approved" | "paid" | "void",
        present(body.paymentMethod) ? requireString(body.paymentMethod, "paymentMethod", 10) : null
    );
    res.status(200).json({ success: true, data });
});

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
            ["Bucket", "Staff", "Service", "Payment method", "Transactions", "Gross", "Paid", "Commission"],
            rows.map((row) => [
                row.bucket,
                row.staff_name,
                row.service_name,
                row.payment_method,
                row.transactions,
                row.gross,
                row.paid,
                row.commission,
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

/** GET /api/owner/reports/commissions?from=&to= */
export const commissionReport = asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req);
    const data = await commissionService.commissionSummary(from, to);

    if (req.query.format === "csv") {
        const body = csv(
            ["Staff", "Entries", "Commission"],
            data.map((row) => [row.staff_name, row.entries, row.total])
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="commission-report-${formatDate(from)}-${formatDate(to)}.csv"`
        );
        res.status(200).send(body);
        return;
    }

    res.status(200).json({ success: true, data });
});

// --- Staff self-service ---

/** GET /api/staff/commissions?from=&to= */
export const listMyEntries = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    const { from, to } = parseRange(req);
    const data = await commissionService.listStaffEntries(req.user.id, from, to);
    res.status(200).json({ success: true, data });
});

/** GET /api/staff/commission-payouts */
export const listMyPayouts = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    const data = await commissionService.listStaffPayouts(req.user.id);
    res.status(200).json({ success: true, data });
});
