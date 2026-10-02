import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool } from "../config/database.js";
import { loginWith, send } from "./http.js";
import { apiCreateService, apiCreateStaff } from "./fixtures.js";
import {
    cleanupTestAppointments,
    createTestUser,
    deleteTestUser,
    insertTestAppointment,
    TEST_PASSWORD,
} from "./helpers.js";

// Types
import type { TestUser } from "./helpers.js";

let owner: TestUser;
let ownerCookie: string | undefined;
const createdStaff: number[] = [];
const createdServices: number[] = [];

const createStaffAndService = async (): Promise<{ staffId: number; serviceId: number }> => {
    const staffRes = await apiCreateStaff(ownerCookie);
    const serviceRes = await apiCreateService(ownerCookie);
    createdStaff.push(staffRes.body.data.id);
    createdServices.push(serviceRes.body.data.id);
    return { staffId: staffRes.body.data.id, serviceId: serviceRes.body.data.id };
};

before(async () => {
    owner = await createTestUser("owner");
    ownerCookie = (await loginWith(owner.username, TEST_PASSWORD)).cookie;
    assert.ok(ownerCookie);
});

after(async () => {
    await cleanupTestAppointments();
    for (const id of createdStaff) {
        await send("delete", `/api/owner/staff/${id}`, ownerCookie);
    }
    for (const id of createdServices) {
        await send("delete", `/api/owner/services/${id}`, ownerCookie);
    }
    await deleteTestUser(owner.id);
    await closeDatabasePool();
});

test("deactivation impact is zero for a staff member with no future appointments", async () => {
    const { staffId } = await createStaffAndService();

    const res = await send("get", `/api/owner/staff/${staffId}/deactivation-impact`, ownerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.futureAppointments, 0);
    assert.deepEqual(res.body.data.appointments, []);
});

test("deactivating staff with no future appointments succeeds without force", async () => {
    const { staffId } = await createStaffAndService();

    const res = await send("patch", `/api/owner/staff/${staffId}/status`, ownerCookie).send({
        isActive: false,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.is_active, 0);
});

test("deactivation impact counts future pending/confirmed appointments only", async () => {
    const { staffId, serviceId } = await createStaffAndService();

    await insertTestAppointment({ staffId, serviceId, startOffsetDays: 2, status: "pending" });
    await insertTestAppointment({ staffId, serviceId, startOffsetDays: 3, status: "confirmed" });
    await insertTestAppointment({ staffId, serviceId, startOffsetDays: 4, status: "cancelled" });

    const res = await send("get", `/api/owner/staff/${staffId}/deactivation-impact`, ownerCookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.futureAppointments, 2);
    assert.equal(res.body.data.appointments.length, 2);
});

test("deactivating staff with future appointments is refused with a 409 warning", async () => {
    const { staffId, serviceId } = await createStaffAndService();
    await insertTestAppointment({ staffId, serviceId, startOffsetDays: 2, status: "pending" });

    const res = await send("patch", `/api/owner/staff/${staffId}/status`, ownerCookie).send({
        isActive: false,
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.equal(res.body.warning.futureAppointments, 1);
    assert.equal(res.body.warning.staffId, staffId);
    assert.match(res.body.message, /upcoming appointment/);

    // The staff member is still active.
    const get = await send("get", `/api/owner/staff/${staffId}`, ownerCookie);
    assert.equal(get.body.data.is_active, 1);
});

test("force:true deactivates staff with future appointments and blocks their login", async () => {
    const { staffId, serviceId } = await createStaffAndService();
    await insertTestAppointment({ staffId, serviceId, startOffsetDays: 2, status: "pending" });

    const staff = await send("get", `/api/owner/staff/${staffId}`, ownerCookie);
    const username = staff.body.data.username;

    const res = await send("patch", `/api/owner/staff/${staffId}/status`, ownerCookie).send({
        isActive: false,
        force: true,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.is_active, 0);

    const login = await loginWith(username, "StaffPass2026!");
    assert.equal(login.res.status, 401);
});

test("deactivated staff can be reactivated", async () => {
    const { staffId } = await createStaffAndService();

    await send("patch", `/api/owner/staff/${staffId}/status`, ownerCookie).send({
        isActive: false,
    });

    const res = await send("patch", `/api/owner/staff/${staffId}/status`, ownerCookie).send({
        isActive: true,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.is_active, 1);
});
