import { intervalsOverlap } from "../helper/time.js";

/** A half-open time interval [start, end). */
export interface Interval {
    start: Date;
    end: Date;
}

export interface AvailabilityInput {
    /** Duration of the requested service, in minutes. */
    serviceDurationMinutes: number;
    /** Regular working windows for the day. */
    workingWindows: Interval[];
    /** Leave / closure intervals that block booking. */
    blocked: Interval[];
    /**
     * Existing active appointments expressed as their **occupied** interval
     * [start_at, buffer_end_at).
     */
    busy: Interval[];
    /** Cleanup time reserved after each appointment. */
    bufferMinutes: number;
    /** Smallest bookable increment. */
    granularityMinutes: number;
    /** Earliest allowed start (now + lead time). */
    earliestStart: Date;
    /** Latest allowed start (now + advance booking window). */
    latestStart: Date;
}

/** Removes `block` from a single window, returning 0, 1, or 2 remaining windows. */
const subtractOne = (window: Interval, block: Interval): Interval[] => {
    if (block.end <= window.start || block.start >= window.end) {
        return [window];
    }

    const remaining: Interval[] = [];
    if (block.start > window.start) {
        remaining.push({ start: window.start, end: block.start });
    }
    if (block.end < window.end) {
        remaining.push({ start: block.end, end: window.end });
    }
    return remaining;
};

/** Subtracts every blocked interval from every working window. */
export const subtractIntervals = (windows: Interval[], blocked: Interval[]): Interval[] => {
    let result = [...windows];

    for (const block of blocked) {
        result = result.flatMap((window) => subtractOne(window, block));
    }

    return result;
};

/** Aligns a timestamp up to the next granularity boundary. */
const alignUp = (timestamp: number, stepMs: number): number =>
    Math.ceil(timestamp / stepMs) * stepMs;

/**
 * Computes the bookable start times for a single day.
 *
 * A candidate start is accepted when:
 *   - it aligns to the granularity,
 *   - the service fits inside a free working window,
 *   - the start is within [earliestStart, latestStart],
 *   - and its occupied interval [start, start + duration + buffer) does not
 *     overlap any busy appointment.
 */
export const computeSlots = (input: AvailabilityInput): Date[] => {
    const stepMs = input.granularityMinutes * 60_000;
    const durationMs = input.serviceDurationMinutes * 60_000;
    const bufferMs = input.bufferMinutes * 60_000;

    const freeWindows = subtractIntervals(input.workingWindows, input.blocked);

    const slots: Date[] = [];
    const seen = new Set<number>();

    for (const window of freeWindows) {
        for (
            let timestamp = alignUp(window.start.getTime(), stepMs);
            timestamp + durationMs <= window.end.getTime();
            timestamp += stepMs
        ) {
            const start = new Date(timestamp);

            if (start < input.earliestStart) {
                continue;
            }
            if (start > input.latestStart) {
                break;
            }

            const occupiedEnd = new Date(timestamp + durationMs + bufferMs);
            const clashes = input.busy.some((busy) =>
                intervalsOverlap(start, occupiedEnd, busy.start, busy.end)
            );

            if (clashes || seen.has(timestamp)) {
                continue;
            }

            seen.add(timestamp);
            slots.push(start);
        }
    }

    slots.sort((a, b) => a.getTime() - b.getTime());
    return slots;
};
