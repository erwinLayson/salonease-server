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
const createdEventIds: number[] = [];

let targetDate: string;

const CUSTOMER_PHONE = `0918${String(Date.now()).slice(-7)}`;

const apiCreateSupply = async (
    cookie: string | undefined,
    overrides: Record<string, unknown> = {}
) => {
    const res = await send("post", "/api/owner/supplies", cookie).send({
        sku: `SKU-EVT-${uniqueSuffix()}-${Date.now().toString().slice(-4)}`,
        name: `Event Test Supply ${uniqueSuffix()}`,
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

let eventCounter = 1;

const createEventWithService = async (
    serviceId: number,
    quantity = 1,
    title = "Test Wedding Event"
) => {
    const eventDate = dateInDays(10 + eventCounter++);
    const res = await send("post", "/api/owner/events", ownerCookie).send({
        customer: {
            firstName: "Event",
            lastName: "Tester",
            phone: CUSTOMER_PHONE,
            email: `evt.${uniqueSuffix()}@example.com`,
        },
        venueLocation: {
            name: `Test Venue ${uniqueSuffix()}`,
            address: "123 Event Lane, City",
        },
        title,
        eventType: "wedding",
        startAt: `${eventDate}T10:00:00`,
        endAt: `${eventDate}T16:00:00`,
        travelBufferMinutes: 60,
        services: [{ serviceId, quantity }],
        assignments: [
            {
                staffId,
                role: "lead",
                callTime: `${eventDate}T09:00:00`,
                releaseTime: `${eventDate}T17:00:00`,
                travelRequired: true,
            },
        ],
    });
    if (res.status === 201 && res.body?.data?.id) {
        createdEventIds.push(res.body.data.id);
    }
    return res;
};

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

    const s1 = await apiCreateService(ownerCookie, { durationMinutes: 60 });
    singleSupplyServiceId = s1.body.data.id;
    createdServiceIds.push(singleSupplyServiceId);

    const s2 = await apiCreateService(ownerCookie, { durationMinutes: 90 });
    multiSupplyServiceId = s2.body.data.id;
    createdServiceIds.push(multiSupplyServiceId);

    // Assign services to staff member
    await send("put", `/api/owner/staff/${staffId}/services`, ownerCookie).send({
        serviceIds: [singleSupplyServiceId, multiSupplyServiceId],
    });

    // Configure staff schedule (07:00–22:00) on all days (0=Sunday..6=Saturday)
    await send("put", `/api/owner/staff/${staffId}/schedules`, ownerCookie).send({
        blocks: [
            { weekday: 0, startTime: "07:00", endTime: "22:00" },
            { weekday: 1, startTime: "07:00", endTime: "22:00" },
            { weekday: 2, startTime: "07:00", endTime: "22:00" },
            { weekday: 3, startTime: "07:00", endTime: "22:00" },
            { weekday: 4, startTime: "07:00", endTime: "22:00" },
            { weekday: 5, startTime: "07:00", endTime: "22:00" },
            { weekday: 6, startTime: "07:00", endTime: "22:00" },
        ],
    });
});

after(async () => {
    await cleanupBookingsFor(createdStaffIds, createdServiceIds);

    const connection = await databasePool().getConnection();
    try {
        if (createdEventIds.length > 0) {
            const placeholders = createdEventIds.map(() => "?").join(", ");
            await connection.execute(
                `DELETE FROM commission_entries WHERE event_id IN (${placeholders})`,
                createdEventIds
            );
            await connection.execute(
                `DELETE FROM transactions WHERE event_id IN (${placeholders})`,
                createdEventIds
            );
            await connection.execute(
                `DELETE FROM supply_movements WHERE reference_type = 'event' AND reference_id IN (${placeholders})`,
                createdEventIds
            );
            await connection.execute(
                `DELETE FROM event_staff_assignments WHERE event_id IN (${placeholders})`,
                createdEventIds
            );
            await connection.execute(
                `DELETE FROM event_services WHERE event_id IN (${placeholders})`,
                createdEventIds
            );
            await connection.execute(
                `DELETE FROM event_supplies WHERE event_id IN (${placeholders})`,
                createdEventIds
            );
            await connection.execute(
                `DELETE FROM event_travel_segments WHERE event_id IN (${placeholders})`,
                createdEventIds
            );
            await connection.execute(
                `DELETE FROM events WHERE id IN (${placeholders})`,
                createdEventIds
            );
        }

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

test("creating and progressing an event (inquiry -> confirmed -> in_progress) does NOT deduct supply stock prematurely", async () => {
    // 1. Create a supply with 100 units
    const supplyRes = await apiCreateSupply(ownerCookie, {
        name: "Bridal Setting Spray",
        currentQuantity: 100,
        unit: "ml",
    });
    assert.equal(supplyRes.status, 201);
    const supplyId = supplyRes.body.data.id;

    // 2. Configure service recipe: 15 ml per service
    const recipeRes = await send(
        "put",
        `/api/owner/services/${singleSupplyServiceId}/supplies`,
        ownerCookie
    ).send({
        items: [{ supplyId, quantityPerService: 15, unit: "ml" }],
    });
    assert.equal(recipeRes.status, 200);

    // 3. Create an event with quantity = 2 (needs 30 ml total)
    const eventRes = await createEventWithService(singleSupplyServiceId, 2);
    assert.equal(eventRes.status, 201);
    const eventId = eventRes.body.data.id;

    // 4. Progress event from inquiry -> confirmed
    const confirmRes = await send(
        "patch",
        `/api/owner/events/${eventId}/status`,
        ownerCookie
    ).send({ status: "confirmed" });
    assert.equal(confirmRes.status, 200);

    // Verify stock is still 100
    const stockAfterConfirm = await send(
        "get",
        `/api/owner/supplies/${supplyId}`,
        ownerCookie
    );
    assert.equal(stockAfterConfirm.body.data.currentQuantity, 100);

    // 5. Progress event from confirmed -> in_progress
    const progressRes = await send(
        "patch",
        `/api/owner/events/${eventId}/status`,
        ownerCookie
    ).send({ status: "in_progress" });
    assert.equal(progressRes.status, 200);

    // Verify stock is still 100
    const stockAfterInProgress = await send(
        "get",
        `/api/owner/supplies/${supplyId}`,
        ownerCookie
    );
    assert.equal(stockAfterInProgress.body.data.currentQuantity, 100);
});

test("completing an event deducts the exact recipe quantity for all event services and records an audit movement", async () => {
    // 1. Create a supply with 100 ml
    const supplyRes = await apiCreateSupply(ownerCookie, {
        name: "Hairstyling Pomade",
        currentQuantity: 100,
        unit: "g",
    });
    assert.equal(supplyRes.status, 201);
    const supplyId = supplyRes.body.data.id;

    // 2. Recipe: 20 g per service
    await send(
        "put",
        `/api/owner/services/${singleSupplyServiceId}/supplies`,
        ownerCookie
    ).send({
        items: [{ supplyId, quantityPerService: 20, unit: "g" }],
    });

    // 3. Create event with quantity = 2 (20g * 2 = 40g required)
    const eventRes = await createEventWithService(singleSupplyServiceId, 2);
    assert.equal(eventRes.status, 201);
    const eventId = eventRes.body.data.id;

    // 4. Move through statuses to completed
    await send("patch", `/api/owner/events/${eventId}/status`, ownerCookie).send({
        status: "confirmed",
    });
    await send("patch", `/api/owner/events/${eventId}/status`, ownerCookie).send({
        status: "in_progress",
    });
    const completeRes = await send(
        "patch",
        `/api/owner/events/${eventId}/status`,
        ownerCookie
    ).send({ status: "completed" });
    assert.equal(completeRes.status, 200);
    assert.equal(completeRes.body.data.status, "completed");

    // 5. Verify stock level: 100 - 40 = 60
    const supplyCheck = await send(
        "get",
        `/api/owner/supplies/${supplyId}`,
        ownerCookie
    );
    assert.equal(supplyCheck.status, 200);
    assert.equal(supplyCheck.body.data.currentQuantity, 60);

    // 6. Verify audit movement ledger row
    const movementsRes = await send(
        "get",
        `/api/owner/supplies/${supplyId}/movements`,
        ownerCookie
    );
    assert.equal(movementsRes.status, 200);
    const movements = movementsRes.body.data;
    const usage = movements.find(
        (m: { referenceType: string; referenceId: number }) =>
            m.referenceType === "event" && m.referenceId === eventId
    );
    assert.ok(usage, "An event usage movement must exist");
    assert.equal(usage.movementType, "usage");
    assert.equal(usage.quantityDelta, -40);
    assert.equal(usage.balanceAfter, 60);
});

test("completing an event deducts multiple supplies across multi-ingredient recipes", async () => {
    // 1. Create two supplies
    const s1 = await apiCreateSupply(ownerCookie, {
        name: "Liquid Foundation",
        currentQuantity: 100,
        unit: "ml",
    });
    const s2 = await apiCreateSupply(ownerCookie, {
        name: "Lash Adhesive",
        currentQuantity: 50,
        unit: "tubes",
    });
    const supplyId1 = s1.body.data.id;
    const supplyId2 = s2.body.data.id;

    // 2. Configure multi-supply recipe: 10 ml foundation + 1 tube adhesive per service
    await send(
        "put",
        `/api/owner/services/${multiSupplyServiceId}/supplies`,
        ownerCookie
    ).send({
        items: [
            { supplyId: supplyId1, quantityPerService: 10, unit: "ml" },
            { supplyId: supplyId2, quantityPerService: 1, unit: "tubes" },
        ],
    });

    // 3. Create event with quantity = 3 (needs 30ml foundation, 3 tubes adhesive)
    const eventRes = await createEventWithService(multiSupplyServiceId, 3);
    assert.equal(eventRes.status, 201);
    const eventId = eventRes.body.data.id;

    await send("patch", `/api/owner/events/${eventId}/status`, ownerCookie).send({
        status: "confirmed",
    });
    await send("patch", `/api/owner/events/${eventId}/status`, ownerCookie).send({
        status: "in_progress",
    });
    const completeRes = await send(
        "patch",
        `/api/owner/events/${eventId}/status`,
        ownerCookie
    ).send({ status: "completed" });
    assert.equal(completeRes.status, 200);

    // 4. Verify both balances
    const check1 = await send(
        "get",
        `/api/owner/supplies/${supplyId1}`,
        ownerCookie
    );
    assert.equal(check1.body.data.currentQuantity, 70); // 100 - 30

    const check2 = await send(
        "get",
        `/api/owner/supplies/${supplyId2}`,
        ownerCookie
    );
    assert.equal(check2.body.data.currentQuantity, 47); // 50 - 3
});

test("insufficient supply stock prevents event completion (409 Conflict) and rolls back transaction", async () => {
    // 1. Create a scarce supply with only 10 ml
    const scarceRes = await apiCreateSupply(ownerCookie, {
        name: "Scarce Gold Leaf Shimmer",
        currentQuantity: 10,
        unit: "ml",
    });
    const scarceSupplyId = scarceRes.body.data.id;

    // 2. Recipe requires 25 ml per service
    await send(
        "put",
        `/api/owner/services/${singleSupplyServiceId}/supplies`,
        ownerCookie
    ).send({
        items: [{ supplyId: scarceSupplyId, quantityPerService: 25, unit: "ml" }],
    });

    // 3. Create event with quantity = 1 (needs 25 ml, only 10 ml available)
    const eventRes = await createEventWithService(singleSupplyServiceId, 1);
    const eventId = eventRes.body.data.id;

    await send("patch", `/api/owner/events/${eventId}/status`, ownerCookie).send({
        status: "confirmed",
    });
    await send("patch", `/api/owner/events/${eventId}/status`, ownerCookie).send({
        status: "in_progress",
    });

    // 4. Attempt to complete -> should be rejected with 409 Conflict
    const completeRes = await send(
        "patch",
        `/api/owner/events/${eventId}/status`,
        ownerCookie
    ).send({ status: "completed" });
    assert.equal(completeRes.status, 409);
    assert.match(completeRes.body.message, /Not enough Scarce Gold Leaf Shimmer/i);

    // 5. Verify the event status was NOT completed
    const eventCheck = await send("get", `/api/owner/events/${eventId}`, ownerCookie);
    assert.equal(eventCheck.body.data.status, "in_progress");

    // 6. Verify supply stock was NOT deducted
    const supplyCheck = await send(
        "get",
        `/api/owner/supplies/${scarceSupplyId}`,
        ownerCookie
    );
    assert.equal(supplyCheck.body.data.currentQuantity, 10);
});

test("event completion deduction triggers an automatic low stock alert when balance falls to or below reorder level", async () => {
    // 1. Supply starts with 25 ml, reorderLevel = 20
    const alertSupplyRes = await apiCreateSupply(ownerCookie, {
        name: "Argan Finishing Oil",
        currentQuantity: 25,
        reorderLevel: 20,
        unit: "ml",
    });
    const alertSupplyId = alertSupplyRes.body.data.id;

    // 2. Recipe requires 10 ml -> after deduction balance will be 15 ml (<= 20)
    await send(
        "put",
        `/api/owner/services/${singleSupplyServiceId}/supplies`,
        ownerCookie
    ).send({
        items: [{ supplyId: alertSupplyId, quantityPerService: 10, unit: "ml" }],
    });

    const eventRes = await createEventWithService(singleSupplyServiceId, 1);
    const eventId = eventRes.body.data.id;

    await send("patch", `/api/owner/events/${eventId}/status`, ownerCookie).send({
        status: "confirmed",
    });
    await send("patch", `/api/owner/events/${eventId}/status`, ownerCookie).send({
        status: "in_progress",
    });
    const completeRes = await send(
        "patch",
        `/api/owner/events/${eventId}/status`,
        ownerCookie
    ).send({ status: "completed" });
    assert.equal(completeRes.status, 200);

    // 3. Verify stock is 15
    const supplyCheck = await send(
        "get",
        `/api/owner/supplies/${alertSupplyId}`,
        ownerCookie
    );
    assert.equal(supplyCheck.body.data.currentQuantity, 15);

    // 4. Verify low-stock alert was created
    const alertsRes = await send("get", "/api/owner/inventory/alerts", ownerCookie);
    assert.equal(alertsRes.status, 200);
    const alert = alertsRes.body.data.find(
        (a: { supplyId: number }) => a.supplyId === alertSupplyId
    );
    assert.ok(alert, "A low stock alert must have been generated");
    assert.equal(alert.currentQuantity, 15);
    assert.equal(alert.reorderLevel, 20);
});
