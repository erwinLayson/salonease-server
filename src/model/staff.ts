import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";
import { safeRowLimit } from "../helper/sql.js";

// Types
import type {
    CreateStaffInput,
    StaffRow,
    StaffWithAccount,
    UpdateStaffInput,
    UpdateStaffProfileInput,
} from "../constant/staff.js";

const SELECT_WITH_ACCOUNT = `
    SELECT s.id, s.user_id, s.first_name, s.last_name, s.position, s.phone, s.email,
           s.address, s.profile_photo, s.is_active, u.username
    FROM staff s
    LEFT JOIN users u ON u.id = s.user_id
`;

export default class StaffModel {
    constructor(private connection: PoolConnection) {}

    /** Lists staff (optionally including deactivated ones). */
    async list(includeInactive: boolean): Promise<StaffWithAccount[]> {
        try {
            const where = includeInactive ? "" : "WHERE s.is_active = 1";
            const [rows] = await this.connection.query<RowDataPacket[]>(
                `${SELECT_WITH_ACCOUNT} ${where} ORDER BY s.first_name, s.last_name`
            );
            return rows as StaffWithAccount[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findById(id: number): Promise<StaffWithAccount | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${SELECT_WITH_ACCOUNT} WHERE s.id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as StaffWithAccount | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async create(userId: number, input: CreateStaffInput): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO staff (user_id, first_name, last_name, position, phone, email, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, 1)`,
                [
                    userId,
                    input.firstName,
                    input.lastName,
                    input.position,
                    input.phone,
                    input.email,
                ]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updateProfile(id: number, input: UpdateStaffInput): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE staff SET first_name = ?, last_name = ?, position = ?, phone = ?, email = ?
                 WHERE id = ?`,
                [input.firstName, input.lastName, input.position, input.phone, input.email, id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Updates the profile fields a staff member owns (no position/status). */
    async updateSelfProfile(id: number, input: UpdateStaffProfileInput): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE staff
                 SET first_name = ?, last_name = ?, phone = ?, email = ?, address = ?, profile_photo = ?
                 WHERE id = ?`,
                [
                    input.firstName,
                    input.lastName,
                    input.phone,
                    input.email,
                    input.address,
                    input.profilePhoto,
                    id,
                ]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async setActive(id: number, isActive: boolean): Promise<void> {
        try {
            await this.connection.execute("UPDATE staff SET is_active = ? WHERE id = ?", [
                isActive ? 1 : 0,
                id,
            ]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async delete(id: number): Promise<void> {
        try {
            await this.connection.execute("DELETE FROM staff WHERE id = ?", [id]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Service ids currently assigned to a staff member. */
    async getServiceIds(staffId: number): Promise<number[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                "SELECT service_id FROM staff_services WHERE staff_id = ? ORDER BY service_id",
                [staffId]
            );
            return rows.map((row) => row.service_id as number);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Replaces a staff member's service assignments. */
    async setServiceIds(staffId: number, serviceIds: number[]): Promise<void> {
        try {
            await this.connection.execute("DELETE FROM staff_services WHERE staff_id = ?", [
                staffId,
            ]);

            for (const serviceId of serviceIds) {
                await this.connection.execute(
                    "INSERT INTO staff_services (staff_id, service_id) VALUES (?, ?)",
                    [staffId, serviceId]
                );
            }
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Number of active (pending/confirmed) appointments still in the future. */
    async countFutureAppointments(staffId: number): Promise<number> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT COUNT(*) AS total FROM appointments
                 WHERE staff_id = ? AND status IN ('pending','confirmed') AND start_at > NOW()`,
                [staffId]
            );
            return Number(rows[0]?.total ?? 0);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Preview of the future appointments that deactivation would affect. */
    async listFutureAppointments(staffId: number, limit = 20): Promise<RowDataPacket[]> {
        try {
            // Inlined (not a `?` parameter): TiDB rejects placeholders in LIMIT.
            const safeLimit = safeRowLimit(limit, 20);
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT id, reference, start_at, status
                 FROM appointments
                 WHERE staff_id = ? AND status IN ('pending','confirmed') AND start_at > NOW()
                 ORDER BY start_at
                 LIMIT ${safeLimit}`,
                [staffId]
            );
            return rows;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Total appointments ever booked with this staff member (any status). */
    async countAppointments(staffId: number): Promise<number> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                "SELECT COUNT(*) AS total FROM appointments WHERE staff_id = ?",
                [staffId]
            );
            return Number(rows[0]?.total ?? 0);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Active staff members that can perform a given service. */
    async listActiveByService(serviceId: number): Promise<StaffRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT s.id, s.user_id, s.first_name, s.last_name, s.position, s.phone, s.email,
                        s.address, s.profile_photo, s.is_active
                 FROM staff s
                 JOIN staff_services ss ON ss.staff_id = s.id
                 WHERE ss.service_id = ? AND s.is_active = 1
                 ORDER BY s.id`,
                [serviceId]
            );
            return rows as StaffRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** True when the staff member is assigned to the service. */
    async isEligible(staffId: number, serviceId: number): Promise<boolean> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                "SELECT 1 FROM staff_services WHERE staff_id = ? AND service_id = ? LIMIT 1",
                [staffId, serviceId]
            );
            return rows.length > 0;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Used by the guest booking flow later: active staff eligible for a service. */
    async findByUserId(userId: number): Promise<StaffRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                "SELECT id, user_id, first_name, last_name, position, phone, email, address, profile_photo, is_active FROM staff WHERE user_id = ? LIMIT 1",
                [userId]
            );
            return (rows[0] as StaffRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }
}
