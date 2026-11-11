/**
 * Route access registry.
 *
 * Single source of truth describing which routes are public and which require
 * authentication. The route-protection test suite iterates this registry, so
 * adding a new route here (and registering it in `routes/index.ts`) is enough to
 * bring it under 100% protection coverage.
 */

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface RouteMeta {
    method: HttpMethod;
    /** Path as mounted on the app, e.g. "/api/owner/staff/1". */
    path: string;
}

/** Routes reachable without a session. */
export const PUBLIC_ROUTES: RouteMeta[] = [
    { method: "get", path: "/api/public/health" },
    { method: "post", path: "/api/auth/login" },
    { method: "get", path: "/api/public/services" },
    { method: "get", path: "/api/public/staff" },
    { method: "get", path: "/api/public/team" },
    { method: "get", path: "/api/public/availability" },
    { method: "get", path: "/api/public/availability-month" },
    { method: "post", path: "/api/public/bookings" },
    { method: "get", path: "/api/public/bookings/notatoken" },
    { method: "post", path: "/api/public/bookings/notatoken/cancel" },
    { method: "post", path: "/api/public/bookings/notatoken/reschedule-request" },
];

/** Routes that must reject unauthenticated requests with 401. */
export const PROTECTED_ROUTES: RouteMeta[] = [
    { method: "post", path: "/api/auth/logout" },
    { method: "get", path: "/api/auth/me" },
    { method: "put", path: "/api/auth/me" },

    { method: "get", path: "/api/owner/dashboard" },

    { method: "get", path: "/api/owner/staff" },
    { method: "post", path: "/api/owner/staff" },
    { method: "get", path: "/api/owner/staff/1" },
    { method: "put", path: "/api/owner/staff/1" },
    { method: "patch", path: "/api/owner/staff/1/status" },
    { method: "get", path: "/api/owner/staff/1/deactivation-impact" },
    { method: "get", path: "/api/owner/staff/1/services" },
    { method: "put", path: "/api/owner/staff/1/services" },
    { method: "get", path: "/api/owner/staff/1/schedules" },
    { method: "put", path: "/api/owner/staff/1/schedules" },
    { method: "delete", path: "/api/owner/staff/1" },

    { method: "get", path: "/api/owner/availability" },
    { method: "get", path: "/api/owner/availability-month" },
    { method: "get", path: "/api/owner/schedule-exceptions" },
    { method: "post", path: "/api/owner/schedule-exceptions" },
    { method: "delete", path: "/api/owner/schedule-exceptions/1" },

    { method: "get", path: "/api/owner/leave-requests" },
    { method: "get", path: "/api/owner/leave-requests/1/conflicts" },
    { method: "post", path: "/api/owner/leave-requests/1/approve" },
    { method: "post", path: "/api/owner/leave-requests/1/reject" },
    { method: "post", path: "/api/owner/leave-requests/1/cancel" },

    { method: "get", path: "/api/owner/services" },
    { method: "post", path: "/api/owner/services" },
    { method: "get", path: "/api/owner/services/1" },
    { method: "get", path: "/api/owner/services/1/staff" },
    { method: "put", path: "/api/owner/services/1" },
    { method: "patch", path: "/api/owner/services/1/status" },
    { method: "delete", path: "/api/owner/services/1" },

    { method: "get", path: "/api/owner/appointments" },
    { method: "post", path: "/api/owner/appointments" },
    { method: "get", path: "/api/owner/appointments/1" },
    { method: "patch", path: "/api/owner/appointments/1" },
    { method: "patch", path: "/api/owner/appointments/1/status" },
    { method: "post", path: "/api/owner/appointments/1/reschedule" },
    { method: "get", path: "/api/owner/schedule" },

    { method: "get", path: "/api/owner/queue" },
    { method: "post", path: "/api/owner/queue" },
    { method: "get", path: "/api/owner/queue/1" },
    { method: "patch", path: "/api/owner/queue/1/status" },
    { method: "post", path: "/api/owner/queue/1/convert" },
    { method: "get", path: "/api/owner/queue/1/assignment-check" },

    { method: "get", path: "/api/owner/supplies" },
    { method: "post", path: "/api/owner/supplies" },
    { method: "get", path: "/api/owner/supplies/1" },
    { method: "put", path: "/api/owner/supplies/1" },
    { method: "patch", path: "/api/owner/supplies/1/status" },
    { method: "get", path: "/api/owner/supplies/1/movements" },
    { method: "post", path: "/api/owner/supplies/1/movements" },
    { method: "get", path: "/api/owner/services/1/supplies" },
    { method: "put", path: "/api/owner/services/1/supplies" },
    { method: "get", path: "/api/owner/inventory/alerts" },
    { method: "patch", path: "/api/owner/inventory/alerts/1/acknowledge" },
    { method: "patch", path: "/api/owner/inventory/alerts/1/resolve" },
    { method: "get", path: "/api/owner/inventory/summary" },
    { method: "get", path: "/api/owner/inventory/recipes" },
    { method: "get", path: "/api/owner/reports/inventory" },

    { method: "get", path: "/api/owner/venues" },
    { method: "post", path: "/api/owner/venues" },
    { method: "put", path: "/api/owner/venues/1" },
    { method: "get", path: "/api/owner/events" },
    { method: "post", path: "/api/owner/events" },
    { method: "get", path: "/api/owner/events/1" },
    { method: "put", path: "/api/owner/events/1" },
    { method: "patch", path: "/api/owner/events/1/status" },
    { method: "put", path: "/api/owner/events/1/itinerary" },
    { method: "put", path: "/api/owner/events/1/supplies" },
    { method: "post", path: "/api/owner/events/1/supplies/issue" },
    { method: "post", path: "/api/owner/events/1/supplies/settle" },

    { method: "get", path: "/api/owner/commission-rules" },
    { method: "post", path: "/api/owner/commission-rules" },
    { method: "post", path: "/api/owner/commission-rules/preview" },
    { method: "put", path: "/api/owner/commission-rules/1" },
    { method: "delete", path: "/api/owner/commission-rules/1" },
    { method: "get", path: "/api/owner/commissions/entries" },
    { method: "get", path: "/api/owner/commission-payouts" },
    { method: "post", path: "/api/owner/commission-payouts" },
    { method: "patch", path: "/api/owner/commission-payouts/1/status" },
    { method: "get", path: "/api/owner/closures" },
    { method: "get", path: "/api/owner/closures/2026-01-01" },
    { method: "post", path: "/api/owner/closures" },
    { method: "post", path: "/api/owner/closures/2026-01-01/reopen" },
    { method: "get", path: "/api/owner/reports/daily-sales" },
    { method: "get", path: "/api/owner/reports/commissions" },
    { method: "get", path: "/api/owner/reports/wait-times" },
    { method: "get", path: "/api/owner/reports/reconciliation" },

    { method: "get", path: "/api/notifications" },
    { method: "patch", path: "/api/notifications/1/read" },

    { method: "get", path: "/api/staff/appointments" },
    { method: "get", path: "/api/staff/appointments/1" },
    { method: "patch", path: "/api/staff/appointments/1/status" },
    { method: "get", path: "/api/staff/appointments/1/transaction" },
    { method: "patch", path: "/api/staff/appointments/1/transaction" },
    { method: "get", path: "/api/staff/transactions" },
    { method: "get", path: "/api/staff/schedule" },
    { method: "get", path: "/api/staff/events" },
    { method: "get", path: "/api/staff/commissions" },
    { method: "get", path: "/api/staff/commission-payouts" },
    { method: "get", path: "/api/staff/leave-requests/coverage" },
];

/**
 * Representative GET routes used to assert role enforcement. All paths under
 * `/api/owner` are owner-only and all paths under `/api/staff` are staff-only
 * (enforced by the routers), so these GETs return 200 for the permitted role and
 * 403 for the other.
 */
export const OWNER_GET_ROUTES: string[] = [
    "/api/owner/dashboard",
    "/api/owner/staff",
    "/api/owner/services",
    "/api/owner/schedule-exceptions",
    "/api/owner/leave-requests",
    "/api/owner/appointments",
    "/api/owner/schedule",
    "/api/owner/queue",
    "/api/owner/supplies",
    "/api/owner/inventory/alerts",
    "/api/owner/inventory/summary",
    "/api/owner/events",
    "/api/owner/venues",
    "/api/owner/commission-rules",
    "/api/owner/commission-payouts",
    "/api/owner/closures",
];

export const STAFF_GET_ROUTES: string[] = [
    "/api/staff/appointments",
    "/api/staff/transactions",
    "/api/staff/leave-requests",
    "/api/staff/leave-requests/coverage",
    "/api/staff/schedule",
    "/api/staff/events",
    "/api/staff/commissions",
];
