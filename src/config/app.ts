/** Base URL of the customer-facing app, used to build manage links. */
export const publicAppUrl = (): string =>
    (process.env.PUBLIC_APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");

/** Builds the secure manage link a customer uses to view/cancel/reschedule. */
export const buildManageUrl = (token: string): string =>
    `${publicAppUrl()}/manage?token=${encodeURIComponent(token)}`;
