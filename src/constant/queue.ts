export const QUEUE_STATUSES = [
    "waiting",
    "called",
    "in_service",
    "completed",
    "cancelled",
    "no_show",
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

/**
 * Allowed queue transitions.
 *
 * waiting  -> called | in_service | cancelled | no_show
 * called   -> waiting | in_service | cancelled | no_show
 * in_service -> completed | cancelled
 * terminal -> no transitions
 */
export const QUEUE_TRANSITIONS: Record<QueueStatus, QueueStatus[]> = {
    waiting: ["called", "in_service", "cancelled", "no_show"],
    called: ["waiting", "in_service", "cancelled", "no_show"],
    in_service: ["completed", "cancelled"],
    completed: [],
    cancelled: [],
    no_show: [],
};

export const canTransitionQueue = (from: QueueStatus, to: QueueStatus): boolean =>
    QUEUE_TRANSITIONS[from].includes(to);

export const queueStatusLabel = (status: QueueStatus): string =>
    status.replace(/_/g, " ");
