import ServiceModel from "../model/services.js";
import StaffModel from "../model/staff.js";
import SchedulingModel from "../model/scheduling.js";
import AppointmentModel from "../model/appointments.js";
import { computeSlots } from "./availabilityEngine.js";
import { withConnection } from "../helper/withConnection.js";
import { BOOKING_RULES } from "../config/booking.js";
import {
    addMinutes,
    combineDateTime,
    endOfDay,
    formatTime,
    weekdayOf,
} from "../helper/time.js";
import { BadRequestError, NotFoundError } from "../helper/error.js";

// Types
import type { Interval } from "./availabilityEngine.js";
import type { ServiceRow } from "../constant/services.js";
import type { StaffRow } from "../constant/staff.js";

export interface StaffSlots {
    staffId: number;
    staffName: string;
    slots: string[];
}

export interface AvailabilityResult {
    date: string;
    serviceId: number;
    serviceName: string;
    durationMinutes: number;
    bufferMinutes: number;
    staff: StaffSlots[];
}

export interface AvailabilityQuery {
    serviceId: number;
    date: string; // YYYY-MM-DD
    staffId?: number | null;
    /**
     * Omits this appointment from the busy set so it does not block itself
     * (used when re-checking availability for a reschedule).
     */
    excludeAppointmentId?: number | null;
    /** Injectable for deterministic tests; defaults to the current time. */
    now?: Date;
}

const fullName = (staff: StaffRow): string =>
    `${staff.first_name} ${staff.last_name}`.trim();

/**
 * Loads the requested service plus the staff candidates to compute slots for:
 * a single (eligible, active) staff member when `staffId` is given, otherwise
 * every active staff member offering the service.
 */
const resolveBookable = async (
    serviceModel: ServiceModel,
    staffModel: StaffModel,
    serviceId: number,
    staffId: number | null | undefined
): Promise<{ service: ServiceRow; candidates: StaffRow[] }> => {
    const service = await serviceModel.findById(serviceId);
    if (!service || service.is_active !== 1) {
        throw new NotFoundError("Service not available", 404);
    }

    if (staffId !== undefined && staffId !== null) {
        const staff = await staffModel.findById(staffId);
        if (!staff || staff.is_active !== 1) {
            throw new NotFoundError("Staff member not available", 404);
        }
        if (!(await staffModel.isEligible(staff.id, service.id))) {
            throw new BadRequestError("This staff member does not offer the selected service");
        }
        return { service, candidates: [staff] };
    }

    return { service, candidates: await staffModel.listActiveByService(service.id) };
};

/**
 * Computes bookable slots for a service on a date.
 *
 * Slots are derived from the service duration, staff eligibility, regular working
 * hours, schedule exceptions (leave/closures), buffer time, the lead time and
 * advance-booking window, and existing active appointments. Inactive or
 * ineligible staff are never included.
 */
export const getAvailability = async (
    query: AvailabilityQuery
): Promise<AvailabilityResult> =>
    withConnection(async (connection) => {
        const now = query.now ?? new Date();

        const { service, candidates } = await resolveBookable(
            new ServiceModel(connection),
            new StaffModel(connection),
            query.serviceId,
            query.staffId
        );

        const dayStart = combineDateTime(query.date, "00:00:00");
        const dayEnd = endOfDay(dayStart);
        const weekday = weekdayOf(query.date);

        const earliestStart = addMinutes(now, BOOKING_RULES.minimumLeadTimeMinutes);
        const latestStart = addMinutes(
            now,
            BOOKING_RULES.advanceBookingWindowDays * 24 * 60
        );

        const scheduling = new SchedulingModel(connection);
        const appointments = new AppointmentModel(connection);

        const result: StaffSlots[] = [];

        for (const staff of candidates) {
            const schedules = (await scheduling.listSchedules(staff.id)).filter(
                (row) => row.weekday === weekday && row.is_active === 1
            );

            const workingWindows: Interval[] = schedules.map((row) => ({
                start: combineDateTime(query.date, row.start_time),
                end: combineDateTime(query.date, row.end_time),
            }));

            const exceptions = await scheduling.listExceptionsForRange(staff.id, dayStart, dayEnd);
            const blocked: Interval[] = exceptions.map((row) => ({
                start: new Date(row.start_at),
                end: new Date(row.end_at),
            }));

            const busyRows = await appointments.listBusy(
                staff.id,
                dayStart,
                dayEnd,
                query.excludeAppointmentId ?? undefined
            );
            const busy: Interval[] = busyRows.map((row) => ({
                start: new Date(row.start_at),
                end: new Date(row.buffer_end_at),
            }));

            const slots = computeSlots({
                serviceDurationMinutes: service.duration_minutes,
                workingWindows,
                blocked,
                busy,
                bufferMinutes: BOOKING_RULES.bufferMinutes,
                granularityMinutes: BOOKING_RULES.slotGranularityMinutes,
                earliestStart,
                latestStart,
            });

            result.push({
                staffId: staff.id,
                staffName: fullName(staff),
                slots: slots.map(formatTime),
            });
        }

        return {
            date: query.date,
            serviceId: service.id,
            serviceName: service.name,
            durationMinutes: service.duration_minutes,
            bufferMinutes: BOOKING_RULES.bufferMinutes,
            staff: result,
        };
    });

// ---------------------------------------------------------------------------
// Month availability (calendar markers for the booking flow)
// ---------------------------------------------------------------------------

export interface MonthAvailabilityQuery {
    serviceId: number;
    /** `YYYY-MM` */
    month: string;
    staffId?: number | null;
    /** Injectable for deterministic tests; defaults to the current time. */
    now?: Date;
}

export interface MonthStaffAvailability {
    staffId: number;
    staffName: string;
    /** `YYYY-MM-DD` -> number of bookable starts. Only open dates are listed. */
    dates: Record<string, number>;
}

export interface MonthAvailabilityResult {
    month: string;
    staff: MonthStaffAvailability[];
}

/**
 * Computes, for every date in a month, how many slots each candidate staff
 * member has open — the same rules as `getAvailability` (regular hours,
 * leave/closures, existing appointments, buffer, lead time, advance window),
 * but batched: schedules, exceptions and appointments are read once per staff
 * for the whole month instead of once per day.
 *
 * Dates with zero slots are omitted so the booking calendar can disable them.
 */
export const getMonthAvailability = async (
    query: MonthAvailabilityQuery
): Promise<MonthAvailabilityResult> =>
    withConnection(async (connection) => {
        const now = query.now ?? new Date();

        const { service, candidates } = await resolveBookable(
            new ServiceModel(connection),
            new StaffModel(connection),
            query.serviceId,
            query.staffId
        );

        const year = Number(query.month.slice(0, 4));
        const month = Number(query.month.slice(5, 7));
        const daysInMonth = new Date(year, month, 0).getDate();
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 1);

        const earliestStart = addMinutes(now, BOOKING_RULES.minimumLeadTimeMinutes);
        const latestStart = addMinutes(
            now,
            BOOKING_RULES.advanceBookingWindowDays * 24 * 60
        );

        const scheduling = new SchedulingModel(connection);
        const appointments = new AppointmentModel(connection);
        const staff: MonthStaffAvailability[] = [];

        for (const member of candidates) {
            const schedules = (await scheduling.listSchedules(member.id)).filter(
                (row) => row.is_active === 1
            );

            const exceptions = await scheduling.listExceptionsForRange(
                member.id,
                monthStart,
                monthEnd
            );
            const blocked: Interval[] = exceptions.map((row) => ({
                start: new Date(row.start_at),
                end: new Date(row.end_at),
            }));

            const busyRows = await appointments.listBusy(member.id, monthStart, monthEnd);
            const busy: Interval[] = busyRows.map((row) => ({
                start: new Date(row.start_at),
                end: new Date(row.buffer_end_at),
            }));

            const dates: Record<string, number> = {};

            for (let day = 1; day <= daysInMonth; day += 1) {
                const dateKey = `${query.month}-${String(day).padStart(2, "0")}`;
                const weekday = weekdayOf(dateKey);
                const daySchedules = schedules.filter((row) => row.weekday === weekday);
                if (daySchedules.length === 0) {
                    continue;
                }

                const workingWindows: Interval[] = daySchedules.map((row) => ({
                    start: combineDateTime(dateKey, row.start_time),
                    end: combineDateTime(dateKey, row.end_time),
                }));

                const slots = computeSlots({
                    serviceDurationMinutes: service.duration_minutes,
                    workingWindows,
                    blocked,
                    busy,
                    bufferMinutes: BOOKING_RULES.bufferMinutes,
                    granularityMinutes: BOOKING_RULES.slotGranularityMinutes,
                    earliestStart,
                    latestStart,
                });

                if (slots.length > 0) {
                    dates[dateKey] = slots.length;
                }
            }

            staff.push({ staffId: member.id, staffName: fullName(member), dates });
        }

        return { month: query.month, staff };
    });

// ---------------------------------------------------------------------------
// Guest booking flow helpers
// ---------------------------------------------------------------------------

export interface PublicStaffOption {
    staffId: number;
    staffName: string;
    position: string | null;
    /** Active weekly working hours (compact, `HH:mm`), for staff cards. */
    schedule: Array<{ weekday: number; startTime: string; endTime: string }>;
}

/** Active staff eligible for a service (used by the guest booking flow). */
export const listStaffForService = (serviceId: number): Promise<PublicStaffOption[]> =>
    withConnection(async (connection) => {
        const service = await new ServiceModel(connection).findById(serviceId);
        if (!service || service.is_active !== 1) {
            throw new NotFoundError("Service not available", 404);
        }

        const staff = await new StaffModel(connection).listActiveByService(serviceId);
        const scheduling = new SchedulingModel(connection);

        const result: PublicStaffOption[] = [];
        for (const member of staff) {
            const schedule = (await scheduling.listSchedules(member.id))
                .filter((row) => row.is_active === 1)
                .map((row) => ({
                    weekday: row.weekday,
                    startTime: row.start_time.slice(0, 5),
                    endTime: row.end_time.slice(0, 5),
                }));

            result.push({
                staffId: member.id,
                staffName: fullName(member),
                position: member.position,
                schedule,
            });
        }
        return result;
    });
