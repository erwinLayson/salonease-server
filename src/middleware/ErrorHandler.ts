import type{Response, Request, NextFunction} from "express";

import {AppError, AppointmentConflictError, BadRequestError, ConflictError, InternalServerError, NotFoundError, SlotConflictError} from "../helper/error.js";

interface MysqlErrorShape {
    code?: string;
    errno?: number;
    sqlMessage?: string;
    sql?: string;
}

/** Walks the error `cause` chain (max 5 levels) to find a MySQL error object. */
function findMysqlError(err: unknown, depth = 0): MysqlErrorShape | null {
    if (!err || typeof err !== "object" || depth > 5) return null;
    const e = err as MysqlErrorShape & {cause?: unknown};
    if (typeof e.code === "string" && e.code.startsWith("ER_")) return e;
    return findMysqlError(e.cause, depth + 1);
}

/**
 * Maps common MySQL errors to user-friendly AppErrors so raw DB internals
 * never surface as 500s. Returns null when the error is not DB-related.
 */
function mapMysqlError(err: unknown): AppError | null {
    const mysqlErr = findMysqlError(err);
    if (!mysqlErr?.code) return null;

    switch (mysqlErr.code) {
        // 1062 - a UNIQUE constraint was violated
        case "ER_DUP_ENTRY": {
            // MySQL 8 / MariaDB 10.5+ report the key as 'table.constraint'
            // (e.g. 'users.uq_users_username'); older servers report it bare,
            // so strip any table prefix before the lookup.
            const key = /for key ['"]([^'"]+)['"]/.exec(mysqlErr.sqlMessage ?? "")?.[1]?.split(".").pop();
            const messages: Record<string, string> = {
                uq_users_username: "That username is already taken.",
                uq_users_email: "An account with this email already exists.",
                uq_staff_user: "This account is already linked to a staff profile.",
                uq_services_name: "A service with this name already exists.",
                uq_staff_service: "This service is already assigned to this staff member.",
                uq_staff_schedule_block: "A schedule block already exists for this staff member on that day and time.",
                uq_appointments_reference: "A booking with this reference already exists.",
                uq_appointments_manage_token: "This booking's management link already exists.",
                uq_appointments_active_slot: "This staff member is already booked at that time.",
                uq_transactions_reference: "A transaction with this reference already exists.",
                uq_transactions_appointment_id: "This appointment already has a recorded transaction.",
            };
            return new ConflictError(
                (key && messages[key]) ?? "This record already exists. Please check for duplicates before trying again."
            );
        }

        // 1452 - INSERT/UPDATE references a row that does not exist
        case "ER_NO_REFERENCED_ROW_2":
            return new BadRequestError("The selected record no longer exists. Please refresh and try again.");

        // 1451 - DELETE blocked because other rows still reference it
        case "ER_ROW_IS_REFERENCED_2":
            return new ConflictError("Cannot delete this record because other records still reference it.");

        // 1048 / 1041 - required column missing
        case "ER_BAD_NULL_ERROR":
            return new BadRequestError("A required field is missing. Please fill in all required fields and try again.");

        // 1406 - value longer than the column allows
        case "ER_DATA_TOO_LONG":
            return new BadRequestError("One of the values entered is too long.");

        // 1264 - value out of range (e.g. negative number where not allowed)
        case "ER_WARN_DATA_OUT_OF_RANGE":
            return new BadRequestError("One of the values entered is out of the allowed range.");

        // 1064 - malformed SQL (programming error, but should not surface as 500 noise)
        case "ER_PARSE_ERROR":
            return new InternalServerError("Internal Server error", 500, err);

        // 1146 - table does not exist (missing migration)
        case "ER_NO_SUCH_TABLE":
            return new NotFoundError("The requested data is not available. Please contact support if this persists.", 503);
        default:
            return null;
    }
}

export default function ErrorHandler(
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
) {
    // Known, intentional errors thrown anywhere in the app.
    if (err instanceof AppError) {
        const isServerError = err.statusCode >= 500;

        // If an AppError (e.g. the generic 500s models throw for failed queries)
        // wraps a known DB error, respond with the specific, user-friendly
        // mapping instead of a raw "Internal Server Error".
        const mapped = mapMysqlError(err.cause);
        if (mapped && err instanceof InternalServerError) {
            if (mapped.statusCode >= 500) {
                console.error("Internal Server Error (db-mapped):", {
                    message: mapped.message,
                    dbCode: findMysqlError(err.cause)?.code,
                    method: req.method,
                    url: req.originalUrl,
                    stack: err.stack,
                });
            } else {
                console.warn("Client Error (db-mapped):", {
                    statusCode: mapped.statusCode,
                    message: mapped.message,
                    dbCode: findMysqlError(err.cause)?.code,
                    method: req.method,
                    url: req.originalUrl,
                });
            }
            return res.status(mapped.statusCode).json({
                success: false,
                message: mapped.message,
            });
        }

        if (isServerError) {
            console.error("Internal Server Error:", {
                message: err.message,
                cause: err instanceof InternalServerError ? err.cause : undefined,
                method: req.method,
                url: req.originalUrl,
                stack: err.stack,
            });
        } else {
            console.warn("Client Error:", {
                statusCode: err.statusCode,
                message: err.message,
                method: req.method,
                url: req.originalUrl,
            });
        }

        return res.status(err.statusCode).json({
            success: false,
            // 4xx messages are safe to show by design; never leak internals on 5xx.
            message: isServerError ? "Internal Server Error" : err.message,
            // A slot conflict also offers nearby alternatives for a quick re-pick.
            ...(err instanceof SlotConflictError ? { alternatives: err.alternatives } : {}),
            // Blocking time over active bookings returns them for resolution.
            ...(err instanceof AppointmentConflictError ? { conflicts: err.conflicts } : {}),
        });
    }

    // Unknown/unexpected errors -> generic 500 without leaking internals.
    console.error("Unhandled Error:", {
        message: err.message,
        method: req.method,
        url: req.originalUrl,
        stack: err.stack,
    });

    return res.status(500).json({
        success: false,
        message: "Internal Server Error",
    });
}