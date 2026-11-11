/** Service categories used for reporting, event filtering and commission rules. */
export const SERVICE_CATEGORIES = [
    "hair",
    "makeup",
    "nails",
    "skin",
    "bridal",
    "event",
    "package",
    "other",
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

/** A row from the `services` table. */
export type ServiceRow = {
    id: number;
    name: string;
    description: string | null;
    category: ServiceCategory;
    image: string | null;
    price: number; // DECIMAL(10,2); the pool returns it as a number
    duration_minutes: number;
    is_active: number;
};

export type CreateServiceInput = {
    name: string;
    description: string | null;
    category: ServiceCategory;
    image: string;
    price: number;
    durationMinutes: number;
};

export type UpdateServiceInput = {
    name: string;
    description: string | null;
    category: ServiceCategory;
    image?: string | null;
    price: number;
    durationMinutes: number;
};
