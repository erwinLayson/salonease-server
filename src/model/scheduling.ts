import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";

// Types
import type {
    CreateExceptionInput,
    ScheduleBlockInput,
    ScheduleExceptionRow,
    StaffScheduleRow,
} from "../constant/scheduling.js";

export default class SchedulingModel {
    constructor(private connection: PoolConnection) {}

    async listSchedules(staffId: number): Promise<StaffScheduleRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT id, staff_id, weekday, start_time, end_time, is_active
                 FROM staff_schedules WHERE staff_id = ? ORDER BY weekday, start_time`,
                [staffId]
            );
            return rows as StaffScheduleRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Replaces all regular working hours for a staff member. */
    async replaceSchedules(staffId: number, blocks: ScheduleBlockInput[]): Promise<void> {
        try {
            await this.connection.execute("DELETE FROM staff_schedules WHERE staff_id = ?", [
                staffId,
            ]);

            for (const block of blocks) {
                await this.connection.execute(
                    `INSERT INTO staff_schedules (staff_id, weekday, start_time, end_time, is_active)
                     VALUES (?, ?, ?, ?, 1)`,
                    [staffId, block.weekday, block.startTime, block.endTime]
                );
            }
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /**
     * Exceptions affecting a staff member in [from, to): their own leave plus
     * salon-wide closures (staff_id IS NULL).
     */
    async listExceptionsForRange(
        staffId: number,
        from: Date,
        to: Date
    ): Promise<ScheduleExceptionRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT id, staff_id, type, start_at, end_at, reason, created_by
                 FROM schedule_exceptions
                 WHERE (staff_id = ? OR staff_id IS NULL)
                   AND start_at < ? AND end_at > ?
                 ORDER BY start_at`,
                [staffId, to, from]
            );
            return rows as ScheduleExceptionRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Lists exceptions by optional staff and date range (owner view). */
    async listExceptions(staffId: number | null, from: Date, to: Date): Promise<ScheduleExceptionRow[]> {
        try {
            const params: Array<string | number | Date | null> = [to, from];
            let sql = `SELECT id, staff_id, type, start_at, end_at, reason, created_by
                       FROM schedule_exceptions
                       WHERE start_at < ? AND end_at > ?`;

            if (staffId !== null) {
                sql += " AND staff_id = ?";
                params.push(staffId);
            }

            sql += " ORDER BY start_at";

            const [rows] = await this.connection.execute<RowDataPacket[]>(sql, params);
            return rows as ScheduleExceptionRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findExceptionById(id: number): Promise<ScheduleExceptionRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT id, staff_id, type, start_at, end_at, reason, created_by
                 FROM schedule_exceptions WHERE id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as ScheduleExceptionRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async createException(input: CreateExceptionInput): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO schedule_exceptions (staff_id, type, start_at, end_at, reason, created_by)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [input.staffId, input.type, input.startAt, input.endAt, input.reason, input.createdBy]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async deleteException(id: number): Promise<void> {
        try {
            await this.connection.execute("DELETE FROM schedule_exceptions WHERE id = ?", [id]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }
}
