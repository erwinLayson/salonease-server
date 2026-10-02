import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError, UnauthorizedError } from "../helper/error.js";
import * as appointmentsService from "../service/appointments.js";
import {
    optionalInteger,
    optionalString,
    requireDateString,
    requireIdParam,
} from "../helper/validation.js";
import { combineDateTime, endOfDay } from "../helper/time.js";
import { PAYMENT_METHODS, PAYMENT_STATUSES } from "../constant/transactions.js";
import * as transactionsService from "../service/transactions.js";

import type { Request } from "express";
import type { TransactionFilter } from "../model/transactions.js";
import type { PaymentMethod, PaymentStatus } from "../model/transactions.js";

const present = (value: unknown): boolean =>
    value !== undefined && value !== null && value !== "";

const parseFilters = (req: Request): TransactionFilter => {
    let from: Date | null = null;
    let to: Date | null = null;

    if (present(req.query.date)) {
        from = combineDateTime(requireDateString(req.query.date, "date"), "00:00:00");
        to = endOfDay(from);
    } else {
        if (present(req.query.from)) {
            from = combineDateTime(requireDateString(req.query.from, "from"), "00:00:00");
        }
        if (present(req.query.to)) {
            to = endOfDay(combineDateTime(requireDateString(req.query.to, "to"), "00:00:00"));
        }
    }

    let paymentMethod: PaymentMethod | null = null;
    if (present(req.query.paymentMethod)) {
        const raw = String(req.query.paymentMethod);
        if (!PAYMENT_METHODS.includes(raw as PaymentMethod)) {
            throw new BadRequestError(`paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}`);
        }
        paymentMethod = raw as PaymentMethod;
    }

    let paymentStatus: PaymentStatus | null = null;
    if (present(req.query.paymentStatus)) {
        const raw = String(req.query.paymentStatus);
        if (!PAYMENT_STATUSES.includes(raw as PaymentStatus)) {
            throw new BadRequestError(`paymentStatus must be one of: ${PAYMENT_STATUSES.join(", ")}`);
        }
        paymentStatus = raw as PaymentStatus;
    }

    return {
        from,
        to,
        staffId: optionalInteger(req.query.staffId, "staffId"),
        paymentMethod,
        paymentStatus,
        search: optionalString(req.query.search, "search", 120),
    };
};

/** GET /api/owner/transactions */
export const listTransactions = asyncHandler(async (req, res) => {
    const data = await transactionsService.listTransactions(parseFilters(req));
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/transactions/:id */
export const getTransaction = asyncHandler(async (req, res) => {
    const data = await transactionsService.getTransaction(requireIdParam(req.params.id));
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/appointments/:id/transaction */
export const getTransactionByAppointment = asyncHandler(async (req, res) => {
    const data = await transactionsService.getTransactionByAppointment(
        requireIdParam(req.params.id)
    );
    res.status(200).json({ success: true, data: data ?? null });
});

/** PATCH /api/owner/transactions/:id  { paymentMethod?, paymentStatus?, notes? } */
export const updateTransaction = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const data = await transactionsService.updateTransaction(id, {
        paymentMethod: present(body.paymentMethod)
            ? String(body.paymentMethod)
            : undefined,
        paymentStatus: present(body.paymentStatus)
            ? String(body.paymentStatus)
            : undefined,
        notes:
            body.notes === undefined
                ? undefined
                : optionalString(body.notes, "notes", 2000),
    });

    res.status(200).json({ success: true, data });
});

/** GET /api/owner/dashboard/summary  — today's stats for the KPI cards */
export const getDashboardSummary = asyncHandler(async (req, res) => {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const to = endOfDay(from);
    const revenue = await transactionsService.getTodaySummary(from, to);
    res.status(200).json({ success: true, data: revenue });
});

/** GET /api/owner/reports/yearly?year=2026 — yearly performance report */
export const getYearlyReport = asyncHandler(async (req, res) => {
    const currentYear = new Date().getFullYear();
    const year = present(req.query.year)
        ? Number(req.query.year)
        : currentYear;

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        throw new BadRequestError("year must be a valid year (2000–2100)");
    }

    const data = await transactionsService.getYearlyReport(year);
    res.status(200).json({ success: true, data });
});

// --- Staff self-service (FR-AP5: only the caller's own appointments) ---

/** GET /api/staff/appointments/:id/transaction — 404 unless it belongs to the caller. */
export const getMyTransaction = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    // Ownership check: 404 for another staff member's appointment.
    const appointment = await appointmentsService.getAppointmentForStaffUser(
        req.user.id,
        requireIdParam(req.params.id)
    );
    const data = await transactionsService.getTransactionByAppointment(
        appointment.id
    );
    res.status(200).json({ success: true, data: data ?? null });
});

/**
 * GET /api/staff/transactions — billing history for the appointments
 * the caller completed. Scoped to the signed-in staff member's own
 * row, so a staff member only ever sees the transactions they
 * handled; any client-supplied staffId is ignored.
 */
export const listMyTransactions = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    const staff = await appointmentsService.findStaffForUser(req.user.id);

    // A staff account without a staff profile simply has no history.
    if (!staff) {
        res.status(200).json({ success: true, data: [] });
        return;
    }

    const data = await transactionsService.listTransactions({
        ...parseFilters(req),
        staffId: staff.id,
    });
    res.status(200).json({ success: true, data });
});

/**
 * PATCH /api/staff/appointments/:id/transaction  { paymentMethod?, paymentStatus? }
 *
 * Records how the customer paid. Notes and waivers
 * stay with the owner.
 */
export const updateMyTransaction = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    // Ownership check: 404 for another staff member's appointment.
    const appointment = await appointmentsService.getAppointmentForStaffUser(
        req.user.id,
        requireIdParam(req.params.id)
    );

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await transactionsService.updateTransactionForAppointment(
        appointment.id,
        {
            paymentMethod: present(body.paymentMethod)
                ? String(body.paymentMethod)
                : undefined,
            paymentStatus: present(body.paymentStatus)
                ? String(body.paymentStatus)
                : undefined,
        }
    );

    res.status(200).json({ success: true, data });
});
