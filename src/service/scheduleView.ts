import AppointmentModel from "../model/appointments.js";
import SchedulingModel from "../model/scheduling.js";
import StaffModel from "../model/staff.js";
import { withConnection } from "../helper/withConnection.js";
import {
    combineDateTime,
    endOfDay,
    formatDate,
    formatTime,
    startOfDay,
    weekdayOf,
} from "../helper/time.js";
import { NotFoundError } from "../helper/error.js";

// Types
import type { ManagedAppointmentRow } from "../model/appointments.js";
import type { StaffRow } from "../constant/staff.js";
import type { ScheduleExceptionRow, StaffScheduleRow } from "../constant/scheduling.js";

export type ScheduleViewKind = "day" | "week" | "month";

export interface ScheduleAppointment {
    id: number;
    reference: string;
    status: string;
    source: "online" | "manual";
    startAt: Date;
    endAt: Date;
    startTime: string;
    endTime: string;
    customerName: string;
    serviceName: string;
    price: number;
    notes: string | null;
}

export interface ScheduleWindow {
    startTime: string;
    endTime: string;
}

export interface ScheduleDayException {
    type: string;
    startTime: string;
    endTime: string;
    reason: string | null;
}

export interface ScheduleDay {
    date: string;
    weekday: number;
    isWorkingDay: boolean;
    windows: ScheduleWindow[];
    exceptions: ScheduleDayException[];
    appointments: ScheduleAppointment[];
}

export interface ScheduleStaff {
    staffId: number;
    staffName: string;
    position: string | null;
    days: ScheduleDay[];
}

export interface ScheduleView {
    view: ScheduleViewKind;
    from: string;
    to: string;
    staff: ScheduleStaff[];
}

export interface ScheduleViewQuery {
    view: ScheduleViewKind;
    /** Anchor date (YYYY-MM-DD); the day itself, or the week containing it. */
    date: string;
    /** Limit to one staff member. Omit for all active staff. */
    staffId?: number | null;
}

const shortTime = (value: string | Date): string =>
    value instanceof Date ? formatTime(value) : formatTime(combineDateTime("2000-01-01", value));

const fullName = (staff: StaffRow): string =>
    `${staff.first_name} ${staff.last_name}`.trim();

const toAppointment = (row: ManagedAppointmentRow): ScheduleAppointment => ({
    id: row.id,
    reference: row.reference,
    status: row.status,
    source: row.source,
    startAt: row.start_at,
    endAt: row.end_at,
    startTime: formatTime(new Date(row.start_at)),
    endTime: formatTime(new Date(row.end_at)),
    customerName: [row.customer_first_name, row.customer_last_name]
        .filter(Boolean)
        .join(" ")
        .trim(),
    serviceName: row.service_name,
    price: row.price,
    notes: row.notes,
});

/** Day boundaries for a schedule view, plus the list of dates it covers. */
const buildRange = (
    query: ScheduleViewQuery
): { from: Date; to: Date; dates: string[] } => {
    const anchor = combineDateTime(query.date, "00:00:00");

    if (query.view === "day") {
        return { from: startOfDay(anchor), to: endOfDay(anchor), dates: [formatDate(anchor)] };
    }

    // A month view covers the whole calendar month containing the anchor date.
    if (query.view === "month") {
        const first = startOfDay(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
        const nextMonth = startOfDay(
            new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)
        );

        const monthDates: string[] = [];
        for (
            let day = new Date(first);
            day < nextMonth;
            day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
        ) {
            monthDates.push(formatDate(day));
        }

        return { from: first, to: nextMonth, dates: monthDates };
    }

    // Weeks start on Monday.
    const diffToMonday = (anchor.getDay() + 6) % 7;
    const from = startOfDay(
        new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - diffToMonday)
    );

    const dates: string[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
        dates.push(
            formatDate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset))
        );
    }

    const to = startOfDay(
        new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7)
    );

    return { from, to, dates };
};

const buildDay = (
    date: string,
    schedules: StaffScheduleRow[],
    exceptions: ScheduleExceptionRow[],
    appointments: ManagedAppointmentRow[]
): ScheduleDay => {
    const weekday = weekdayOf(date);
    const dayStart = combineDateTime(date, "00:00:00");
    const dayEnd = endOfDay(dayStart);

    const windows = schedules
        .filter((row) => row.weekday === weekday && row.is_active === 1)
        .map((row) => ({ startTime: shortTime(row.start_time), endTime: shortTime(row.end_time) }))
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

    const dayExceptions = exceptions
        .filter((row) => new Date(row.start_at) < dayEnd && new Date(row.end_at) > dayStart)
        .map((row) => ({
            type: row.type,
            startTime: formatTime(new Date(row.start_at)),
            endTime: formatTime(new Date(row.end_at)),
            reason: row.reason,
        }));

    const dayAppointments = appointments
        .filter((row) => {
            const start = new Date(row.start_at);
            return start >= dayStart && start < dayEnd;
        })
        .map(toAppointment);

    return {
        date,
        weekday,
        isWorkingDay: windows.length > 0,
        windows,
        exceptions: dayExceptions,
        appointments: dayAppointments,
    };
};

/**
 * Builds a daily or weekly staff schedule view: regular hours, leave/closures,
 * and appointments, per staff member (FR-AP6).
 *
 * When `staffId` is provided only that staff member is returned (used by the
 * staff portal so a staff member sees only their own schedule).
 */
export const getScheduleView = (query: ScheduleViewQuery): Promise<ScheduleView> =>
    withConnection(async (connection) => {
        const staffModel = new StaffModel(connection);
        const schedulingModel = new SchedulingModel(connection);
        const appointments = new AppointmentModel(connection);

        const { from, to, dates } = buildRange(query);

        let staffList: StaffRow[];
        if (query.staffId !== undefined && query.staffId !== null) {
            const staff = await staffModel.findById(query.staffId);
            if (!staff) {
                throw new NotFoundError("Staff not found", 404);
            }
            staffList = [staff];
        } else {
            staffList = await staffModel.list(false);
        }

        const result: ScheduleStaff[] = [];

        for (const staff of staffList) {
            const schedules = await schedulingModel.listSchedules(staff.id);
            const exceptions = await schedulingModel.listExceptionsForRange(staff.id, from, to);
            const rows = await appointments.listForStaffBetween(staff.id, from, to);

            result.push({
                staffId: staff.id,
                staffName: fullName(staff),
                position: staff.position,
                days: dates.map((date) => buildDay(date, schedules, exceptions, rows)),
            });
        }

        return {
            view: query.view,
            from: formatDate(from),
            to: formatDate(new Date(to.getTime() - 86_400_000)),
            staff: result,
        };
    });
