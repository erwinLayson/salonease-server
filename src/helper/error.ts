import type { AppointmentDetail } from "../service/appointments.js";

export class AppError extends Error {
    constructor(message: string, public readonly statusCode: number){
        super(message);

        Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
        Error.captureStackTrace(this);
    }
}

export class InternalServerError extends AppError {
    constructor(message: string, statusCode: number, public readonly cause?: unknown) {
        super(message, statusCode);
    }
}

export class NotFoundError extends AppError {
    constructor(message: string, status: number){
        super(message, status);
    }
}

export class BadRequestError extends AppError {
    constructor(message: string){
        super(message, 400);
    }
}

export class ForbiddenError extends AppError {
    constructor(message: string){
        super(message, 403);
    }
}

export class ConflictError extends AppError {
    constructor(message: string){
        super(message, 409);
    }
}

/**
 * A 409 raised when a requested slot is unavailable, carrying nearby
 * alternative start times (`HH:mm`) so the UI can offer a quick re-pick.
 */
export class SlotConflictError extends ConflictError {
    constructor(message: string, public readonly alternatives: string[] = []){
        super(message);
    }
}

/**
 * A 409 raised when blocking time (leave/closure) overlaps active
 * appointments, carrying those appointments so the UI can resolve them.
 */
export class AppointmentConflictError extends ConflictError {
    constructor(
        message: string,
        public readonly conflicts: AppointmentDetail[] = []
    ) {
        super(message);
    }
}

export class UnauthorizedError extends AppError {
    constructor(message: string){
        super(message, 401);
    }
}

export class TooManyRequestsError extends AppError {
    constructor(message: string){
        super(message, 429);
    }
}

/**
 * Walks an error's `cause` chain looking for MySQL's duplicate-key error.
 * Used to turn a unique-constraint violation into a clean 409 conflict.
 */
export const isDuplicateKeyError = (err: unknown, depth = 0): boolean => {
    if (!err || typeof err !== "object" || depth > 5) return false;

    const candidate = err as { code?: string; cause?: unknown };
    if (candidate.code === "ER_DUP_ENTRY") return true;

    return isDuplicateKeyError(candidate.cause, depth + 1);
};

/**
 * Walks an error's `cause` chain looking for MySQL's transient deadlock error.
 * Deadlocks are retried by `withTransaction`.
 */
export const isDeadlockError = (err: unknown, depth = 0): boolean => {
    if (!err || typeof err !== "object" || depth > 5) return false;

    const candidate = err as { code?: string; cause?: unknown };
    if (candidate.code === "ER_LOCK_DEADLOCK") return true;

    return isDeadlockError(candidate.cause, depth + 1);
};
