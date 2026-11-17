import "dotenv/config";
import { randomBytes } from "node:crypto";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { ResultSetHeader } from "mysql2/promise";
import { closeDatabasePool, databasePool } from "../config/database.js";
import { loginWith, send } from "./http.js";
import {
    apiCreateService,
    apiCreateStaff,
    dateInDays,
    uniqueSuffix,
} from "./fixtures.js";
import {
    cleanupBookingsFor,
    createTestUser,
    deleteTestUser,
    TEST_PASSWORD,
} from "./helpers.js";

// Types
import type { TestUser } from "./helpers.js";

let owner: TestUser;
let ownerCookie: string | undefined;

let staffId: number;
let staffCookie: string | undefined;
let secondStaffId: number;
let secondStaffCookie: string | undefined;
let serviceId: number;

const today = (): string => dateInDays(0);

/**
 * Inserts an appointment with a `FIN*` reference. The shared `TST*` helper is
 * intentionally avoided: other suites' cleanup deletes every `TST*` row, which
 * would race with this file when the whole test suite runs in parallel.
 */
const insertFinanceAppointment = async (opts: {
    staffId: number;
    serviceId: number;
    status: "confirmed" | "completed";
    price?: number;
}): Promise<number> => {
    const connection = await databasePool().getConnection();
    try {
        const [customer] = await connection.execute<ResultSetHeader>(
            "INSERT INTO customers (first_name, phone) VALUES ('Finance Test Customer', '09170000001')"
        );
        const reference = `FIN${randomBytes(4).toString("hex").toUpperCase()}`.slice(0, 12);
        const [appointment] = await connection.execute<ResultSetHeader>(
            `INSERT INTO appointments
                (reference, manage_token, customer_id, staff_id, service_id,
                 start_at, end_at, buffer_end_at, price, status, source)
             VALUES (?, ?, ?, ?, ?, NOW(),
                 DATE_ADD(NOW(), INTERVAL 30 MINUTE),
                 DATE_ADD(NOW(), INTERVAL 40 MINUTE), ?, ?, 'manual')`,
            [
                reference,
                randomBytes(32).toString("hex"),
                customer.insertId,
                opts.staffId,
                opts.serviceId,
                opts.price ?? 100,
                opts.status,
            ]
        );
        return appointment.insertId;
    } finally {
        connection.release();
    }
};

const apiPath = (path: string, query: Record<string, string> = {}): string => {
    const params = new URLSearchParams(query);
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return `${path}${suffix}`;
};

const complete = (id: number) =>
    send("patch", `/api/owner/appointments/${id}/status`, ownerCookie).send({
        status: "completed",
    });

before(async () => {
    owner = await createTestUser("owner");
    ownerCookie = (await loginWith(owner.username, TEST_PASSWORD)).cookie;
    assert.ok(ownerCookie);

    const suffix = uniqueSuffix();
    const username = `finance.staff.${suffix}`;
    const created = await apiCreateStaff(ownerCookie, {
        username,
        password: TEST_PASSWORD,
        email: `finance.staff.${suffix}@example.local`,
    });
    assert.equal(created.status, 201);
    staffId = created.body.data.id;
    staffCookie = (await loginWith(username, TEST_PASSWORD)).cookie;
    assert.ok(staffCookie);

    const otherUsername = `finance.other.${suffix}`;
    const second = await apiCreateStaff(ownerCookie, {
        username: otherUsername,
        password: TEST_PASSWORD,
        email: `finance.other.${suffix}@example.local`,
    });
    assert.equal(second.status, 201);
    secondStaffId = second.body.data.id;
    secondStaffCookie = (await loginWith(otherUsername, TEST_PASSWORD)).cookie;
    assert.ok(secondStaffCookie);

    const service = await apiCreateService(ownerCookie, { price: 100 });
    serviceId = service.body.data.id;

    for (const id of [staffId, secondStaffId]) {
        const assigned = await send(
            "put",
            `/api/owner/staff/${id}/services`,
            ownerCookie
        ).send({ serviceIds: [serviceId] });
        assert.equal(assigned.status, 200);
    }

    // Remove any close left behind by an interrupted run of this suite.
    const connection = await databasePool().getConnection();
    try {
        await connection.execute(
            "DELETE FROM daily_sales_closures WHERE business_date = ?",
            [today()]
        );
        await connection.execute(
            "DELETE FROM walk_in_queue WHERE customer_name LIKE 'Finance Test%'"
        );
    } finally {
        connection.release();
    }
});

after(async () => {
    const connection = await databasePool().getConnection();
    try {
        await connection.execute(
            "DELETE FROM daily_sales_closures WHERE business_date = ?",
            [today()]
        );
        await connection.execute(
            "DELETE FROM walk_in_queue WHERE customer_name LIKE 'Finance Test%'"
        );
        // Safety net if a staff/service delete below is blocked.
        await connection.execute(
            `DELETE t FROM transactions t
             JOIN appointments a ON a.id = t.appointment_id
             WHERE a.reference LIKE 'FIN%'`
        );
        await connection.execute("DELETE FROM appointments WHERE reference LIKE 'FIN%'");
        await connection.execute(
            "DELETE FROM customers WHERE first_name = 'Finance Test Customer' AND phone = '09170000001'"
        );
    } finally {
        connection.release();
    }

    await cleanupBookingsFor([staffId, secondStaffId], [serviceId]);
    await send("delete", `/api/owner/staff/${staffId}`, ownerCookie);
    await send("delete", `/api/owner/staff/${secondStaffId}`, ownerCookie);
    await send("delete", `/api/owner/services/${serviceId}`, ownerCookie);
    await deleteTestUser(owner.id);
    await closeDatabasePool();
});

test("a completed appointment with no transaction appears in reconciliation", async () => {
    const orphan = await insertFinanceAppointment({
        staffId: secondStaffId,
        serviceId,
        status: "completed",
    });

    const res = await send(
        "get",
        apiPath("/api/owner/reports/reconciliation", { from: today(), to: today() }),
        ownerCookie
    );
    assert.equal(res.status, 200);
    assert.ok(res.body.data.missingTransactions.length >= 1);
    assert.ok(
        res.body.data.missingTransactions.some(
            (row: { kind: string; id: number }) =>
                row.kind === "appointment" && row.id === orphan
        )
    );
});

test("wait-time report aggregates today's queue tickets", async () => {
    const ticket = await send("post", "/api/owner/queue", ownerCookie).send({
        date: today(),
        customerName: "Finance Test Walk-in",
        customerPhone: "09171234567",
        serviceId,
        assignedStaffId: staffId,
    });
    assert.equal(ticket.status, 201);
    const ticketId = ticket.body.data.id;

    assert.equal(
        (await send("patch", `/api/owner/queue/${ticketId}/status`, ownerCookie).send({
            status: "called",
        })).status,
        200
    );
    assert.equal(
        (await send("patch", `/api/owner/queue/${ticketId}/status`, ownerCookie).send({
            status: "in_service",
        })).status,
        200
    );

    const res = await send(
        "get",
        apiPath("/api/owner/reports/wait-times", { from: today(), to: today() }),
        ownerCookie
    );
    assert.equal(res.status, 200);
    const day = res.body.data.days.find(
        (row: { date: string }) => row.date === today()
    );
    assert.ok(day);
    assert.ok(day.tickets >= 1);
    assert.ok(day.served >= 1);
    assert.ok(day.avgWaitMinutes >= 0);
    assert.ok(res.body.data.staff.some((row: { staffId: number }) => row.staffId === staffId));
});

test("sales report reconciles to the ledger", async () => {
    const completedAppointment = await insertFinanceAppointment({
        staffId,
        serviceId,
        status: "confirmed",
    });
    const completed = await complete(completedAppointment);
    assert.equal(completed.status, 200);

    const day = await send(
        "get",
        apiPath("/api/owner/reports/daily-sales", { from: today(), to: today() }),
        ownerCookie
    );
    assert.equal(day.status, 200);
    const dayRow = day.body.data.find(
        (row: { bucket: string; staff_id: number | null }) =>
            String(row.bucket).slice(0, 10) === today() && row.staff_id === staffId
    );
    assert.ok(dayRow);
    assert.ok(Number(dayRow.gross) >= 100);

    for (const groupBy of ["week", "month"]) {
        const grouped = await send(
            "get",
            apiPath("/api/owner/reports/daily-sales", {
                from: today(),
                to: today(),
                groupBy,
            }),
            ownerCookie
        );
        assert.equal(grouped.status, 200);
        assert.ok(grouped.body.data.length >= 1);
    }

    const csv = await send(
        "get",
        apiPath("/api/owner/reports/daily-sales", {
            from: today(),
            to: today(),
            format: "csv",
        }),
        ownerCookie
    );
    assert.equal(csv.status, 200);
    assert.match(String(csv.headers["content-type"]), /text\/csv/);
    assert.match(csv.text, /Bucket/);
});

test("closing a day snapshots totals and locks further completion", async () => {
    const before = await send("get", `/api/owner/closures/${today()}`, ownerCookie);
    assert.equal(before.status, 200);
    assert.equal(before.body.data.status, "open");
    const cashTotal = Number(before.body.data.live.cashTotal);

    const closed = await send("post", "/api/owner/closures", ownerCookie).send({
        date: today(),
        cashCounted: cashTotal + 5,
        notes: "Finance test close",
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.data.status, "closed");
    assert.ok(Math.abs(Number(closed.body.data.cashVariance) - 5) < 0.005);
    // The snapshot's own figures stay internally consistent.
    assert.ok(Math.abs(
        Number(closed.body.data.cashVariance) -
            (Number(closed.body.data.cashCounted) - Number(closed.body.data.cashTotal))
    ) < 0.005);

    // Keep the locked window as short as possible: other suites complete
    // appointments concurrently and would also be blocked by a closed day.
    const blockedAppointment = await insertFinanceAppointment({
        staffId,
        serviceId,
        status: "confirmed",
    });
    try {
        const blocked = await complete(blockedAppointment);
        assert.equal(blocked.status, 409);
    } finally {
        const reopened = await send(
            "post",
            `/api/owner/closures/${today()}/reopen`,
            ownerCookie
        ).send({ reason: "Late payment correction" });
        assert.equal(reopened.status, 200);
        assert.equal(reopened.body.data.status, "reopened");
        assert.equal(reopened.body.data.reopenReason, "Late payment correction");
    }

    const noReason = await send(
        "post",
        `/api/owner/closures/${today()}/reopen`,
        ownerCookie
    ).send({ reason: "" });
    assert.equal(noReason.status, 400);

    const allowed = await complete(blockedAppointment);
    assert.equal(allowed.status, 200);
});

test("owner-only finance routes reject staff", async () => {
    const closures = await send("get", "/api/owner/closures", staffCookie);
    assert.equal(closures.status, 403);

    const reports = await send(
        "get",
        apiPath("/api/owner/reports/wait-times", { from: today(), to: today() }),
        staffCookie
    );
    assert.equal(reports.status, 403);
});
