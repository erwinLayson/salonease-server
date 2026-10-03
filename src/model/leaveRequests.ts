import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";

// Types
import type {
    CreateLeaveRequestInput,
    LeaveCoverageRow,
    LeaveRequestRow,
    LeaveRequestStatus,
} from "../constant/leaveRequests.js";

/** Selects the request together with its staff member's name. */
const SELECT_REQUEST = `
    SELECT lr.id, lr.staff_id,
           DATE_FORMAT(lr.start_date, '%Y-%m-%d') AS start_date,
           DATE_FORMAT(lr.end_date, '%Y-%m-%d')   AS end_date,
           lr.reason, lr.status, lr.decision_note, lr.decided_by, lr.decided_at,
           lr.exception_id, lr.created_at,
           s.first_name AS staff_first_name, s.last_name AS staff_last_name,
           s.is_active  AS staff_is_active
    FROM leave_requests lr
    JOIN staff s ON s.id = lr.staff_id
`;

/** Columns written by a status decision (approve / reject / cancel). */
export interface LeaveDecisionPatch {
    status: LeaveRequestStatus;
    decisionNote: string | null;
    decidedBy: number | null;
    decidedAt: Date;
    exceptionId: number | null;
}

export default class LeaveRequestModel {
    constructor(private connection: PoolConnection) {}

    /** Every request for one staff member, newest first. */
    async listByStaff(staffId: number): Promise<LeaveRequestRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${SELECT_REQUEST} WHERE lr.staff_id = ? ORDER BY lr.created_at DESC, lr.id DESC`,
                [staffId]
            );
            return rows as LeaveRequestRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Owner view: all requests, optionally filtered by status and/or staff. */
    async listAll(status: LeaveRequestStatus | null, staffId: number | null): Promise<LeaveRequestRow[]> {
        try {
            const params: Array<string | number> = [];
            let sql = SELECT_REQUEST;

            const clauses: string[] = [];
            if (status !== null) {
                clauses.push("lr.status = ?");
                params.push(status);
            }
            if (staffId !== null) {
                clauses.push("lr.staff_id = ?");
                params.push(staffId);
            }
            if (clauses.length > 0) {
                sql += ` WHERE ${clauses.join(" AND ")}`;
            }

            sql += " ORDER BY lr.created_at DESC, lr.id DESC";

            const [rows] = await this.connection.execute<RowDataPacket[]>(sql, params);
            return rows as LeaveRequestRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /**
     * Pending/approved leave from **any** staff member overlapping
     * `[from, to]` — the request-leave calendar overlay. Rejected and
     * cancelled requests are settled and never tint a calendar.
     */
    async listCoverage(from: string, to: string): Promise<LeaveCoverageRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT lr.id, lr.staff_id,
                        DATE_FORMAT(lr.start_date, '%Y-%m-%d') AS start_date,
                        DATE_FORMAT(lr.end_date, '%Y-%m-%d')   AS end_date,
                        lr.status,
                        s.first_name AS staff_first_name, s.last_name AS staff_last_name
                 FROM leave_requests lr
                 JOIN staff s ON s.id = lr.staff_id
                 WHERE lr.status IN ('pending', 'approved')
                   AND lr.start_date <= ? AND lr.end_date >= ?
                 ORDER BY lr.start_date ASC, lr.id ASC`,
                [to, from]
            );
            return rows as LeaveCoverageRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findById(id: number): Promise<LeaveRequestRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${SELECT_REQUEST} WHERE lr.id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as LeaveRequestRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /**
     * An overlapping **approved** leave for the same staff member, if any.
     * Date ranges overlap when `a.start <= b.end && b.start <= a.end`.
     */
    async findApprovedOverlap(
        staffId: number,
        startDate: string,
        endDate: string,
        excludeId: number | null = null
    ): Promise<LeaveRequestRow | null> {
        try {
            const params: Array<string | number> = [staffId, endDate, startDate];
            let sql = `${SELECT_REQUEST}
                       WHERE lr.staff_id = ? AND lr.status = 'approved'
                         AND lr.start_date <= ? AND lr.end_date >= ?`;

            if (excludeId !== null) {
                sql += " AND lr.id <> ?";
                params.push(excludeId);
            }

            sql += " LIMIT 1";

            const [rows] = await this.connection.execute<RowDataPacket[]>(sql, params);
            return (rows[0] as LeaveRequestRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async create(input: CreateLeaveRequestInput): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO leave_requests (staff_id, start_date, end_date, reason, status)
                 VALUES (?, ?, ?, ?, 'pending')`,
                [input.staffId, input.startDate, input.endDate, input.reason]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Applies a status decision to a request. */
    async applyDecision(id: number, patch: LeaveDecisionPatch): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE leave_requests
                 SET status = ?, decision_note = ?, decided_by = ?, decided_at = ?,
                     exception_id = ?
                 WHERE id = ?`,
                [
                    patch.status,
                    patch.decisionNote,
                    patch.decidedBy,
                    patch.decidedAt,
                    patch.exceptionId,
                    id,
                ]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }
}
