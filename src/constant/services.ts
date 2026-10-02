/** A row from the `services` table. */
export type ServiceRow = {
    id: number;
    name: string;
    description: string | null;
    price: number; // DECIMAL(10,2); the pool returns it as a number
    duration_minutes: number;
    is_active: number;
};

export type CreateServiceInput = {
    name: string;
    description: string | null;
    price: number;
    durationMinutes: number;
};

export type UpdateServiceInput = CreateServiceInput;
