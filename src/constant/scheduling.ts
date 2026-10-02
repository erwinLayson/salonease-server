/** A row from `staff_schedules` (regular weekly working hours). */
export type StaffScheduleRow = {
    id: number;
    staff_id: number;
    weekday: number; // 0 = Sunday .. 6 = Saturday
    start_time: string; // "HH:mm:ss"
    end_time: string;
    is_active: number;
};

/** A weekly working block supplied by the owner. */
export type ScheduleBlockInput = {
    weekday: number;
    startTime: string;
    endTime: string;
};

export type ScheduleExceptionType = "leave" | "closure";

/** A row from `schedule_exceptions`. */
export type ScheduleExceptionRow = {
    id: number;
    staff_id: number | null;
    type: ScheduleExceptionType;
    start_at: Date;
    end_at: Date;
    reason: string | null;
    created_by: number | null;
};

export type CreateExceptionInput = {
    staffId: number | null;
    type: ScheduleExceptionType;
    startAt: Date;
    endAt: Date;
    reason: string | null;
    createdBy: number | null;
    /** Skip the overlap check with active appointments (owner override). */
    force?: boolean;
};
