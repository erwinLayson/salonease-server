import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";

// Types
import type {
    CreateServiceInput,
    ServiceRow,
    UpdateServiceInput,
} from "../constant/services.js";

const SELECT_COLUMNS =
    "SELECT id, name, description, price, duration_minutes, is_active FROM services";

export default class ServiceModel {
    constructor(private connection: PoolConnection) {}

    async list(includeInactive: boolean): Promise<ServiceRow[]> {
        try {
            const where = includeInactive ? "" : "WHERE is_active = 1";
            const [rows] = await this.connection.query<RowDataPacket[]>(
                `${SELECT_COLUMNS} ${where} ORDER BY name`
            );
            return rows as ServiceRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findById(id: number): Promise<ServiceRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${SELECT_COLUMNS} WHERE id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as ServiceRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Case-insensitive name lookup used for a clear duplicate-name error. */
    async findByName(name: string): Promise<ServiceRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${SELECT_COLUMNS} WHERE name = ? LIMIT 1`,
                [name]
            );
            return (rows[0] as ServiceRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async create(input: CreateServiceInput): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO services (name, description, price, duration_minutes, is_active)
                 VALUES (?, ?, ?, ?, 1)`,
                [input.name, input.description, input.price, input.durationMinutes]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async update(id: number, input: UpdateServiceInput): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE services SET name = ?, description = ?, price = ?, duration_minutes = ?
                 WHERE id = ?`,
                [input.name, input.description, input.price, input.durationMinutes, id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async setActive(id: number, isActive: boolean): Promise<void> {
        try {
            await this.connection.execute("UPDATE services SET is_active = ? WHERE id = ?", [
                isActive ? 1 : 0,
                id,
            ]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async delete(id: number): Promise<void> {
        try {
            await this.connection.execute("DELETE FROM services WHERE id = ?", [id]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async countAppointments(serviceId: number): Promise<number> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                "SELECT COUNT(*) AS total FROM appointments WHERE service_id = ?",
                [serviceId]
            );
            return Number(rows[0]?.total ?? 0);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }
}
