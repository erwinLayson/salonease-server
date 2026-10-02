import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";

export type CustomerRow = {
    id: number;
    first_name: string;
    last_name: string | null;
    phone: string | null;
    email: string | null;
};

export type CreateCustomerInput = {
    firstName: string;
    lastName: string | null;
    phone: string | null;
    email: string | null;
};

export default class CustomerModel {
    constructor(private connection: PoolConnection) {}

    /** Finds an existing customer by phone or email (so repeat guests aren't duplicated). */
    async findMatch(phone: string | null, email: string | null): Promise<CustomerRow | null> {
        if (!phone && !email) {
            return null;
        }

        try {
            const clauses: string[] = [];
            const params: Array<string | number | Date | null> = [];

            if (phone) {
                clauses.push("phone = ?");
                params.push(phone);
            }
            if (email) {
                clauses.push("email = ?");
                params.push(email);
            }

            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT id, first_name, last_name, phone, email FROM customers
                 WHERE ${clauses.join(" OR ")} ORDER BY id LIMIT 1`,
                params
            );
            return (rows[0] as CustomerRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async create(input: CreateCustomerInput): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO customers (first_name, last_name, phone, email)
                 VALUES (?, ?, ?, ?)`,
                [input.firstName, input.lastName, input.phone, input.email]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }
}
