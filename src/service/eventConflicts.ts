import { addMinutes } from "../helper/time.js";

export interface BusyInterval {
    start: Date;
    end: Date;
    kind: "appointment" | "event";
    label: string;
}

export interface AssignmentIntervalInput {
    callTime: Date;
    releaseTime: Date;
    travelRequired: boolean;
    travelBufferMinutes: number;
}

/**
 * The interval an event assignment occupies for a staff member.
 *
 * Travel time is reserved on both sides of the call/release window so a
 * stylist cannot be booked immediately before or after an on-location job.
 */
export const assignmentInterval = (
    input: AssignmentIntervalInput
): { start: Date; end: Date } => {
    const buffer = input.travelRequired ? Math.max(0, input.travelBufferMinutes) : 0;
    return {
        start: addMinutes(input.callTime, -buffer),
        end: addMinutes(input.releaseTime, buffer),
    };
};

/** True when two half-open intervals overlap. */
export const intervalsOverlap = (
    aStart: Date,
    aEnd: Date,
    bStart: Date,
    bEnd: Date
): boolean => aStart < bEnd && bStart < aEnd;

/** Returns every existing interval that overlaps the candidate. */
export const findConflicts = (
    candidate: { start: Date; end: Date },
    existing: BusyInterval[]
): BusyInterval[] =>
    existing.filter((interval) =>
        intervalsOverlap(candidate.start, candidate.end, interval.start, interval.end)
    );

/** Human-readable summary used in a 409 message. */
export const describeConflict = (conflict: BusyInterval): string => {
    const start = conflict.start.toLocaleString();
    const end = conflict.end.toLocaleTimeString();
    return `${conflict.label} (${start} – ${end})`;
};
