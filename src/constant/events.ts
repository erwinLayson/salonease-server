export const EVENT_STATUSES = [
    "inquiry",
    "confirmed",
    "in_progress",
    "completed",
    "cancelled",
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_TYPES = [
    "wedding",
    "debut",
    "corporate",
    "photoshoot",
    "other",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_ASSIGNMENT_ROLES = [
    "lead",
    "assistant",
    "makeup",
    "hair",
    "coordinator",
] as const;

export type EventAssignmentRole = (typeof EVENT_ASSIGNMENT_ROLES)[number];

export const EVENT_ASSIGNMENT_STATUSES = [
    "assigned",
    "confirmed",
    "declined",
    "completed",
    "cancelled",
] as const;

export type EventAssignmentStatus = (typeof EVENT_ASSIGNMENT_STATUSES)[number];

export const EVENT_STATUS_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
    inquiry: ["confirmed", "cancelled"],
    confirmed: ["in_progress", "completed", "cancelled"],
    in_progress: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
};

export const canTransitionEvent = (
    from: EventStatus,
    to: EventStatus
): boolean => EVENT_STATUS_TRANSITIONS[from].includes(to);

export const eventStatusLabel = (status: EventStatus): string =>
    status.replace(/_/g, " ");
