/**
 * Time helpers.
 *
 * Scheduling uses wall-clock local time: the Node process and the database run in
 * the same timezone (Asia/Manila), and DATETIME values are treated as local
 * wall-clock. `new Date("YYYY-MM-DDTHH:mm:ss")` parses as local time in JS.
 */

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

/** Combines a `YYYY-MM-DD` date and a `HH:mm[:ss]` time into a local Date. */
export const combineDateTime = (date: string, time: string): Date => {
    const normalized = time.length === 5 ? `${time}:00` : time;
    return new Date(`${date}T${normalized}`);
};

/** Adds minutes to a Date, returning a new Date. */
export const addMinutes = (date: Date, minutes: number): Date =>
    new Date(date.getTime() + minutes * 60_000);

/** Whole minutes between two dates (b - a). */
export const minutesBetween = (a: Date, b: Date): number =>
    Math.round((b.getTime() - a.getTime()) / 60_000);

/** Local midnight at the start of the given date. */
export const startOfDay = (date: Date): Date =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Local midnight at the end of the given date (start of the next day). */
export const endOfDay = (date: Date): Date =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

/** Weekday for a `YYYY-MM-DD` string: 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (date: string): number => combineDateTime(date, "00:00:00").getDay();

/** Formats a Date as `HH:mm` in local time. */
export const formatTime = (date: Date): string => {
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
};

/** Formats a Date as `YYYY-MM-DD` in local time. */
export const formatDate = (date: Date): string => {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
};

/** True when two half-open intervals [aStart,aEnd) and [bStart,bEnd) overlap. */
export const intervalsOverlap = (
    aStart: Date,
    aEnd: Date,
    bStart: Date,
    bEnd: Date
): boolean => aStart < bEnd && bStart < aEnd;
