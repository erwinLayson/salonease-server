import SchedulingModel from "../model/scheduling.js";
import StaffModel from "../model/staff.js";
import { withConnection } from "../helper/withConnection.js";
import { addMinutes, startOfDay } from "../helper/time.js";
import {
    AppointmentConflictError,
    BadRequestError,
    NotFoundError,
} from "../helper/error.js";
import { BOOKING_RULES } from "../config/booking.js";
import { listConflictingAppointments } from "./appointments.js";

// Types
import type {
    CreateExceptionInput,
    ScheduleBlockInput,
    ScheduleExceptionRow,
    StaffScheduleRow,
} from "../constant/scheduling.js";

/** Validates that blocks are well-formed and do not overlap on the same weekday. */
const validateBlocks = (blocks: ScheduleBlockInput[]): void => {
    const byWeekday = new Map<number, Array<{ start: string; end: string }>>();

    for (const block of blocks) {
        if (!Number.isInteger(block.weekday) || block.weekday < 0 || block.weekday > 6) {
            throw new BadRequestError("weekday must be between 0 (Sunday) and 6 (Saturday)");
        }
        if (block.startTime >= block.endTime) {
            throw new BadRequestError("Each schedule block must end after it starts");
        }

        const list = byWeekday.get(block.weekday) ?? [];
        list.push({ start: block.startTime, end: block.endTime });
        byWeekday.set(block.weekday, list);
    }

    for (const [, list] of byWeekday) {
        list.sort((a, b) => a.start.localeCompare(b.start));

        for (let i = 1; i < list.length; i += 1) {
            if (list[i]!.start < list[i - 1]!.end) {
                throw new BadRequestError("Working hours for the same weekday must not overlap");
            }
        }
    }
};

export const getWeeklySchedule = async (staffId: number): Promise<StaffScheduleRow[]> =>
    withConnection(async (connection) => {
        if (!(await new StaffModel(connection).findById(staffId))) {
            throw new NotFoundError("Staff not found", 404);
        }
        return new SchedulingModel(connection).listSchedules(staffId);
    });

/** Replaces all regular working hours for a staff member. */
export const replaceWeeklySchedule = (
    staffId: number,
    blocks: ScheduleBlockInput[]
): Promise<StaffScheduleRow[]> =>
    withConnection(async (connection) => {
        if (!(await new StaffModel(connection).findById(staffId))) {
            throw new NotFoundError("Staff not found", 404);
        }

        validateBlocks(blocks);

        const model = new SchedulingModel(connection);
        await model.replaceSchedules(staffId, blocks);
        return model.listSchedules(staffId);
    });

/** Lists exceptions in a date range (defaults to the booking window from now). */
export const listExceptions = (
    staffId: number | null,
    from?: Date,
    to?: Date
): Promise<ScheduleExceptionRow[]> => {
    const now = new Date();
    const rangeFrom = from ?? startOfDay(now);
    const rangeTo = to ?? addMinutes(now, BOOKING_RULES.advanceBookingWindowDays * 24 * 60);

    return withConnection((connection) =>
        new SchedulingModel(connection).listExceptions(staffId, rangeFrom, rangeTo)
    );
};

export const createException = (input: CreateExceptionInput): Promise<ScheduleExceptionRow> =>
    withConnection(async (connection) => {
        if (input.endAt <= input.startAt) {
            throw new BadRequestError("endAt must be after startAt");
        }

        if (input.type === "leave") {
            if (input.staffId === null) {
                throw new BadRequestError("A leave exception must target a staff member");
            }
            if (!(await new StaffModel(connection).findById(input.staffId))) {
                throw new NotFoundError("Staff not found", 404);
            }
        } else if (input.type === "closure" && input.staffId !== null) {
            throw new BadRequestError("A salon closure affects all staff and must not set staffId");
        }

        // Block-time must not silently strand existing bookings: return the
        // overlapping appointments as a 409 unless the owner forces it.
        if (!input.force) {
            const conflicts = await listConflictingAppointments(
                input.startAt,
                input.endAt,
                input.staffId
            );
            if (conflicts.length > 0) {
                const count = conflicts.length;
                throw new AppointmentConflictError(
                    `${count} active appointment${count === 1 ? "" : "s"} overlap this time. ` +
                        `Reschedule or cancel ${count === 1 ? "it" : "them"}, or block anyway.`,
                    conflicts
                );
            }
        }

        const model = new SchedulingModel(connection);
        const id = await model.createException(input);
        return (await model.findExceptionById(id))!;
    });

export const deleteException = (id: number): Promise<void> =>
    withConnection(async (connection) => {
        const model = new SchedulingModel(connection);

        if (!(await model.findExceptionById(id))) {
            throw new NotFoundError("Schedule exception not found", 404);
        }

        await model.deleteException(id);
    });
