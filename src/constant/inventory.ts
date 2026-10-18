export const SUPPLY_CATEGORIES = [
    "chemical",
    "tool",
    "event_kit",
    "retail",
    "other",
] as const;

export type SupplyCategory = (typeof SUPPLY_CATEGORIES)[number];

export const STOCK_MOVEMENT_TYPES = [
    "initial",
    "purchase",
    "usage",
    "adjustment",
    "waste",
    "return",
    "event_issue",
    "event_return",
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const MANUAL_MOVEMENT_TYPES = [
    "initial",
    "purchase",
    "adjustment",
    "waste",
    "return",
] as const;

export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export const ALERT_STATUSES = ["open", "acknowledged", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];
