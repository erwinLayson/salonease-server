import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool, databasePool } from "../config/database.js";
import { loginWith, send } from "./http.js";
import {
    apiCreateService,
    apiCreateStaff,
    dateInDays,
    weekdayOfDate,
    uniqueSuffix,
} from "./fixtures.js";
import {
    createTestUser,
    deleteTestUser,
    cleanupBookingsFor,
    TEST_PASSWORD,
} from "./helpers.js";

// Types
import type { TestUser } from "./helpers.js";

let owner: TestUser;
let ownerCookie: string | undefined;

let staffId: number;
let singleSupplyServiceId: number;
let multiSupplyServiceId: number;

const createdSupplyIds: number[] = [];
const createdServiceIds: number[] = [];
const createdStaffIds: number[] = [];

let targetDate: string;

const CUSTOMER_PHONE = `0917${String(Date.now()).slice(-7)}`;

const apiCreateSupply = async (
    cookie: string | undefined,
    overrides: Record<string, unknown> = {}
) => {
    const res = await send("post", "/api/owner/supplies", cookie).send({
        sku: `SKU-${uniqueSuffix()}-${Date.now().toString().slice(-4)}`,
        name: `Test Supply ${uniqueSuffix()}`,
        category: "chemical",
        unit: "ml",
        currentQuantity: 100,
        reorderLevel: 20,
        unitCost: 25.5,
        ...overrides,
    });
    if (res.status === 201 && res.body?.data?.id) {
        createdSupplyIds.push(res.body.data.id);
    }
    return res;
};

const manualBooking = (
    time: string,
    serviceId: number,
    extra: Record<string, unknown> = {}
) =>
    send("post", "/api/owner/appointments", ownerCookie).send({
        firstName: "Test",
        lastName: "Client",
        phone: CUSTOMER_PHONE,
        serviceId,
        staffId,
        startAt: `${targetDate}T${time}:00`,
        ...extra,
    });

before(async () => {
    // Reopen sales day if left closed by previous runs
    const connection = await databasePool().getConnection();
    try {
        await connection.execute(
            "DELETE FROM daily_sales_closures WHERE business_date = CURDATE()"
        );
    } finally {
        connection.release();
    }

    owner = await createTestUser("owner");
    ownerCookie = (await loginWith(owner.username, TEST_PASSWORD)).cookie;
    assert.ok(ownerCookie, "Owner login cookie must be defined");

    const staffRes = await apiCreateStaff(ownerCookie);
    staffId = staffRes.body.data.id;
    createdStaffIds.push(staffId);

    const s1 = await apiCreateService(ownerCookie, { durationMinutes: 30 });
    singleSupplyServiceId = s1.body.data.id;
    createdServiceIds.push(singleSupplyServiceId);

    const s2 = await apiCreateService(ownerCookie, { durationMinutes: 30 });
    multiSupplyServiceId = s2.body.data.id;
    createdServiceIds.push(multiSupplyServiceId);

    // Assign services to staff member
    await send("put", `/api/owner/staff/${staffId}/services`, ownerCookie).send({
        serviceIds: [singleSupplyServiceId, multiSupplyServiceId],
    });

    // Configure staff schedule (09:00–18:00) on the target date
    targetDate = dateInDays(7);
    const weekday = weekdayOfDate(targetDate);
    await send("put", `/api/owner/staff/${staffId}/schedules`, ownerCookie).send({
        blocks: [{ weekday, startTime: "09:00", endTime: "18:00" }],
    });
});

after(async () => {
    await cleanupBookingsFor(createdStaffIds, createdServiceIds);

    const connection = await databasePool().getConnection();
    try {
        if (createdSupplyIds.length > 0) {
            const placeholders = createdSupplyIds.map(() => "?").join(", ");
            await connection.execute(
                `DELETE FROM inventory_alerts WHERE supply_id IN (${placeholders})`,
                createdSupplyIds
            );
            await connection.execute(
                `DELETE FROM service_supply_usage WHERE supply_id IN (${placeholders})`,
                createdSupplyIds
            );
            await connection.execute(
                `DELETE FROM supply_movements WHERE supply_id IN (${placeholders})`,
                createdSupplyIds
            );
            await connection.execute(
                `DELETE FROM supplies WHERE id IN (${placeholders})`,
                createdSupplyIds
            );
        }
    } finally {
        connection.release();
    }

    for (const id of createdStaffIds) {
        await send("delete", `/api/owner/staff/${id}`, ownerCookie);
    }
    for (const id of createdServiceIds) {
        await send("delete", `/api/owner/services/${id}`, ownerCookie);
    }
    await deleteTestUser(owner.id);
    await closeDatabasePool();
});

test("owner configures a recipe for a service (PUT /api/owner/services/:id/supplies)", async () => {
    const supplyRes = await apiCreateSupply(ownerCookie, {
        name: "Shampoo Concentrate",
        currentQuantity: 100,
        unit: "ml",
    });
    assert.equal(supplyRes.status, 201);
    const supplyId = supplyRes.body.data.id;

    const recipeRes = await send(
        "put",
        `/api/owner/services/${singleSupplyServiceId}/supplies`,
        ownerCookie
    ).send({
        items: [{ supplyId, quantityPerService: 25, unit: "ml" }],
    });
    assert.equal(recipeRes.status, 200);
    assert.equal(recipeRes.body.data.length, 1);
    assert.equal(recipeRes.body.data[0].supplyId, supplyId);
    assert.equal(recipeRes.body.data[0].quantityPerService, 25);

    // Verify GET returns the recipe
    const getRes = await send(
        "get",
        `/api/owner/services/${singleSupplyServiceId}/supplies`,
        ownerCookie
    );
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.length, 1);
    assert.equal(getRes.body.data[0].supplyId, supplyId);
    assert.equal(getRes.body.data[0].quantityPerService, 25);
});

test("booking and confirming an appointment does NOT deduct supply stock prematurely", async () => {
    // 1. Create a supply with 100 ml stock
    const supplyRes = await apiCreateSupply(ownerCookie, {
        name: "Conditioner Premix",
        currentQuantity: 100,
        unit: "ml",
    });
    const supplyId = supplyRes.body.data.id;

    // 2. Attach to service with 30 ml per service
    await send(
        "put",
        `/api/owner/services/${singleSupplyServiceId}/supplies`,
        ownerCookie
    ).send({
        items: [{ supplyId, quantityPerService: 30, unit: "ml" }],
    });

    // 3. Book an appointment (status: pending)
    const bookRes = await manualBooking("09:00", singleSupplyServiceId);
    assert.equal(bookRes.status, 201);
    const appointmentId = bookRes.body.data.id;
    assert.equal(bookRes.body.data.status, "pending");

    // 4. Verify supply stock is still 100
    let supplyCheck = await send("get", `/api/owner/supplies/${supplyId}`, ownerCookie);
    assert.equal(supplyCheck.status, 200);
    assert.equal(supplyCheck.body.data.currentQuantity, 100);

    // 5. Confirm appointment (status: confirmed)
    const confirmRes = await send(
        "patch",
        `/api/owner/appointments/${appointmentId}/status`,
        ownerCookie
    ).send({ status: "confirmed" });
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.data.status, "confirmed");

    // 6. Verify supply stock is STILL 100
    supplyCheck = await send("get", `/api/owner/supplies/${supplyId}`, ownerCookie);
    assert.equal(supplyCheck.status, 200);
    assert.equal(supplyCheck.body.data.currentQuantity, 100);

    // 7. Verify no 'usage' movements exist for this appointment
    const movementsRes = await send(
        "get",
        `/api/owner/supplies/${supplyId}/movements`,
        ownerCookie
    );
    assert.equal(movementsRes.status, 200);
    const usageMovements = movementsRes.body.data.filter(
        (m: { movementType: string; referenceId: number }) =>
            m.movementType === "usage" && m.referenceId === appointmentId
    );
    assert.equal(usageMovements.length, 0);
});

test("completing an appointment deducts the exact recipe quantity and records an audit movement", async () => {
    // 1. Create a supply with 100 ml stock
    const supplyRes = await apiCreateSupply(ownerCookie, {
        name: "Hair Color Base",
        currentQuantity: 100,
        unit: "ml",
    });
    const supplyId = supplyRes.body.data.id;

    // 2. Attach recipe: 40 ml per service
    await send(
        "put",
        `/api/owner/services/${singleSupplyServiceId}/supplies`,
        ownerCookie
    ).send({
        items: [{ supplyId, quantityPerService: 40, unit: "ml" }],
    });

    // 3. Book and confirm appointment
    const bookRes = await manualBooking("10:00", singleSupplyServiceId);
    assert.equal(bookRes.status, 201);
    const appointmentId = bookRes.body.data.id;

    await send(
        "patch",
        `/api/owner/appointments/${appointmentId}/status`,
        ownerCookie
    ).send({ status: "confirmed" });

    // 4. Mark appointment as completed
    const completeRes = await send(
        "patch",
        `/api/owner/appointments/${appointmentId}/status`,
        ownerCookie
    ).send({ status: "completed" });
    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.body.data.status, "completed");

    // 5. Verify stock decreased by 40 ml: 100 - 40 = 60 ml
    const supplyCheck = await send("get", `/api/owner/supplies/${supplyId}`, ownerCookie);
    assert.equal(supplyCheck.status, 200);
    assert.equal(supplyCheck.body.data.currentQuantity, 60);

    // 6. Verify audit movement ledger entry
    const movementsRes = await send(
        "get",
        `/api/owner/supplies/${supplyId}/movements`,
        ownerCookie
    );
    assert.equal(movementsRes.status, 200);

    const usageMovement = movementsRes.body.data.find(
        (m: { movementType: string; referenceId: number }) =>
            m.movementType === "usage" && m.referenceId === appointmentId
    );
    assert.ok(usageMovement, "Usage movement for appointment must be recorded");
    assert.equal(usageMovement.quantityDelta, -40);
    assert.equal(usageMovement.balanceAfter, 60);
    assert.equal(usageMovement.referenceType, "appointment");
    assert.equal(usageMovement.referenceId, appointmentId);
});

test("completing an appointment deducts multiple supplies in a multi-ingredient recipe", async () => {
    // 1. Create two supplies
    const developerRes = await apiCreateSupply(ownerCookie, {
        name: "Developer 20 Vol",
        currentQuantity: 200,
        unit: "ml",
    });
    const developerId = developerRes.body.data.id;

    const powderRes = await apiCreateSupply(ownerCookie, {
        name: "Bleaching Powder",
        currentQuantity: 150,
        unit: "g",
    });
    const powderId = powderRes.body.data.id;

    // 2. Set multi-ingredient recipe: 60 ml developer + 30 g bleaching powder
    await send(
        "put",
        `/api/owner/services/${multiSupplyServiceId}/supplies`,
        ownerCookie
    ).send({
        items: [
            { supplyId: developerId, quantityPerService: 60, unit: "ml" },
            { supplyId: powderId, quantityPerService: 30, unit: "g" },
        ],
    });

    // 3. Book, confirm, and complete
    const bookRes = await manualBooking("11:00", multiSupplyServiceId);
    assert.equal(bookRes.status, 201);
    const appointmentId = bookRes.body.data.id;

    await send(
        "patch",
        `/api/owner/appointments/${appointmentId}/status`,
        ownerCookie
    ).send({ status: "confirmed" });

    const completeRes = await send(
        "patch",
        `/api/owner/appointments/${appointmentId}/status`,
        ownerCookie
    ).send({ status: "completed" });
    assert.equal(completeRes.status, 200);

    // 4. Assert Developer stock: 200 - 60 = 140
    const devCheck = await send("get", `/api/owner/supplies/${developerId}`, ownerCookie);
    assert.equal(devCheck.body.data.currentQuantity, 140);

    // 5. Assert Powder stock: 150 - 30 = 120
    const powderCheck = await send("get", `/api/owner/supplies/${powderId}`, ownerCookie);
    assert.equal(powderCheck.body.data.currentQuantity, 120);

    // 6. Verify movement for Developer
    const devMovements = await send(
        "get",
        `/api/owner/supplies/${developerId}/movements`,
        ownerCookie
    );
    const devUsage = devMovements.body.data.find(
        (m: { referenceId: number }) => m.referenceId === appointmentId
    );
    assert.ok(devUsage);
    assert.equal(devUsage.quantityDelta, -60);
    assert.equal(devUsage.balanceAfter, 140);

    // 7. Verify movement for Powder
    const powderMovements = await send(
        "get",
        `/api/owner/supplies/${powderId}/movements`,
        ownerCookie
    );
    const powderUsage = powderMovements.body.data.find(
        (m: { referenceId: number }) => m.referenceId === appointmentId
    );
    assert.ok(powderUsage);
    assert.equal(powderUsage.quantityDelta, -30);
    assert.equal(powderUsage.balanceAfter, 120);
});

test("insufficient stock prevents completion (409 Conflict) and rolls back transaction", async () => {
    // 1. Create a supply with only 15 ml in stock
    const supplyRes = await apiCreateSupply(ownerCookie, {
        name: "Scarce Keratin Serum",
        currentQuantity: 15,
        unit: "ml",
    });
    const supplyId = supplyRes.body.data.id;

    // 2. Recipe requires 50 ml (more than available 15 ml)
    await send(
        "put",
        `/api/owner/services/${singleSupplyServiceId}/supplies`,
        ownerCookie
    ).send({
        items: [{ supplyId, quantityPerService: 50, unit: "ml" }],
    });

    // 3. Book and confirm appointment
    const bookRes = await manualBooking("12:00", singleSupplyServiceId);
    assert.equal(bookRes.status, 201);
    const appointmentId = bookRes.body.data.id;

    await send(
        "patch",
        `/api/owner/appointments/${appointmentId}/status`,
        ownerCookie
    ).send({ status: "confirmed" });

    // 4. Attempt completion -> must fail with 409 Conflict
    const completeRes = await send(
        "patch",
        `/api/owner/appointments/${appointmentId}/status`,
        ownerCookie
    ).send({ status: "completed" });

    assert.equal(completeRes.status, 409);
    assert.match(
        completeRes.body.message ?? "",
        /Not enough Scarce Keratin Serum in stock/i
    );

    // 5. Verify transaction rollback:
    // a) Appointment status remains 'confirmed'
    const apptCheck = await send(
        "get",
        `/api/owner/appointments/${appointmentId}`,
        ownerCookie
    );
    assert.equal(apptCheck.body.data.status, "confirmed");

    // b) Supply quantity remains completely untouched (15 ml)
    const supplyCheck = await send("get", `/api/owner/supplies/${supplyId}`, ownerCookie);
    assert.equal(supplyCheck.body.data.currentQuantity, 15);

    // c) No usage movements were committed
    const movementsRes = await send(
        "get",
        `/api/owner/supplies/${supplyId}/movements`,
        ownerCookie
    );
    const usageMovements = movementsRes.body.data.filter(
        (m: { movementType: string }) => m.movementType === "usage"
    );
    assert.equal(usageMovements.length, 0);
});

test("deduction triggers an automatic low stock alert when balance falls to or below reorder level", async () => {
    // 1. Create a supply with 25 ml initial stock and reorderLevel = 20
    const supplyRes = await apiCreateSupply(ownerCookie, {
        name: "Rosemary Essential Oil",
        currentQuantity: 25,
        reorderLevel: 20,
        unit: "ml",
    });
    const supplyId = supplyRes.body.data.id;

    // Supply is currently not low stock (25 > 20)
    assert.equal(supplyRes.body.data.lowStock, false);

    // 2. Recipe requires 10 ml -> after deduction balance will be 15 ml (<= 20)
    await send(
        "put",
        `/api/owner/services/${singleSupplyServiceId}/supplies`,
        ownerCookie
    ).send({
        items: [{ supplyId, quantityPerService: 10, unit: "ml" }],
    });

    // 3. Book, confirm, and complete appointment
    const bookRes = await manualBooking("13:00", singleSupplyServiceId);
    assert.equal(bookRes.status, 201);
    const appointmentId = bookRes.body.data.id;

    await send(
        "patch",
        `/api/owner/appointments/${appointmentId}/status`,
        ownerCookie
    ).send({ status: "confirmed" });

    const completeRes = await send(
        "patch",
        `/api/owner/appointments/${appointmentId}/status`,
        ownerCookie
    ).send({ status: "completed" });
    assert.equal(completeRes.status, 200);

    // 4. Verify stock dropped to 15 ml and lowStock flag is now true
    const supplyCheck = await send("get", `/api/owner/supplies/${supplyId}`, ownerCookie);
    assert.equal(supplyCheck.body.data.currentQuantity, 15);
    assert.equal(supplyCheck.body.data.lowStock, true);

    // 5. Verify an open low_stock alert was automatically created
    const alertsRes = await send(
        "get",
        "/api/owner/inventory/alerts?status=open",
        ownerCookie
    );
    assert.equal(alertsRes.status, 200);

    const alert = alertsRes.body.data.find(
        (a: { supplyId: number; alertType: string }) =>
            a.supplyId === supplyId && a.alertType === "low_stock"
    );
    assert.ok(alert, "Automatic low_stock alert must exist in open alerts list");
    assert.equal(alert.currentQuantity, 15);
    assert.equal(alert.reorderLevel, 20);
});

