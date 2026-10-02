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
    { method: "get", path: "/api/owner/schedule-exceptions" },
    { method: "post", path: "/api/owner/schedule-exceptions" },
    { method: "delete", path: "/api/owner/schedule-exceptions/1" },

    { method: "get", path: "/api/owner/services" },
    { method: "post", path: "/api/owner/services" },
    { method: "get", path: "/api/owner/services/1" },
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

    { method: "get", path: "/api/staff/appointments" },
    { method: "get", path: "/api/staff/appointments/1" },
    { method: "patch", path: "/api/staff/appointments/1/status" },
    { method: "get", path: "/api/staff/appointments/1/transaction" },
    { method: "patch", path: "/api/staff/appointments/1/transaction" },
    { method: "get", path: "/api/staff/transactions" },
    { method: "get", path: "/api/staff/schedule" },
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
    "/api/owner/appointments",
    "/api/owner/schedule",
];

export const STAFF_GET_ROUTES: string[] = [
    "/api/staff/appointments",
    "/api/staff/transactions",
    "/api/staff/schedule",
];
