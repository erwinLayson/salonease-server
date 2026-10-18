import EventModel from "../model/events.js";
import { withConnection } from "../helper/withConnection.js";
import { assignmentInterval, intervalsOverlap } from "./eventConflicts.js";

// Types
import type { BusyInterval } from "./eventConflicts.js";

/**
 * Event assignments that occupy a staff member's time in [from, to),
 * including travel buffers. Used by the salon availability engine so an
 * event-assigned stylist is never offered for an overlapping salon slot.
 */
export const listEventBusyIntervals = async (
    staffId: number,
    from: Date,
    to: Date
): Promise<BusyInterval[]> => {
    const rows = await withConnection((connection) =>
        new EventModel(connection).listBusyEventAssignments(staffId, from, to)
    );

    return rows
        .map((row) => {
            const interval = assignmentInterval({
                callTime: new Date(row.call_time),
                releaseTime: new Date(row.release_time),
                travelRequired: row.travel_required === 1,
                travelBufferMinutes: Number(row.travel_buffer_minutes),
            });
            return {
                start: interval.start,
                end: interval.end,
                kind: "event" as const,
                label: `Event: ${row.event_title}`,
            };
        })
        .filter((interval) =>
            intervalsOverlap(interval.start, interval.end, from, to)
        );
};
