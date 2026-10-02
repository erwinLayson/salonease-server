import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool } from "../config/database.js";
import { loginWith, send } from "./http.js";
import { createTestUser, deleteTestUser, TEST_PASSWORD } from "./helpers.js";
import {
    PROTECTED_ROUTES,
    PUBLIC_ROUTES,
    OWNER_GET_ROUTES,
    STAFF_GET_ROUTES,
} from "../routes/registry.js";

// Types
import type { TestUser } from "./helpers.js";

let owner: TestUser;
let staff: TestUser;
let ownerCookie: string | undefined;
let staffCookie: string | undefined;

before(async () => {
    owner = await createTestUser("owner");
    staff = await createTestUser("staff");
    ownerCookie = (await loginWith(owner.username, TEST_PASSWORD)).cookie;
    staffCookie = (await loginWith(staff.username, TEST_PASSWORD)).cookie;

    assert.ok(ownerCookie, "owner login must return a cookie");
    assert.ok(staffCookie, "staff login must return a cookie");
});

after(async () => {
    await deleteTestUser(owner.id);
    await deleteTestUser(staff.id);
    await closeDatabasePool();
});

test("100% of registered protected routes reject unauthenticated requests with 401", async () => {
    assert.ok(PROTECTED_ROUTES.length > 0, "registry must list protected routes");

    for (const route of PROTECTED_ROUTES) {
        const res = await send(route.method, route.path);
        assert.equal(
            res.status,
            401,
            `${route.method.toUpperCase()} ${route.path} should be 401 without a session, got ${res.status}`
        );
    }
});

test("registered public routes are reachable without a session", async () => {
    for (const route of PUBLIC_ROUTES) {
        const res = await send(route.method, route.path);
        assert.notEqual(
            res.status,
            401,
            `${route.method.toUpperCase()} ${route.path} should not require a session`
        );
        assert.notEqual(res.status, 403);
    }
});

test("owner-only routes allow the owner and forbid staff (403)", async () => {
    for (const path of OWNER_GET_ROUTES) {
        const asOwner = await send("get", path, ownerCookie);
        const asStaff = await send("get", path, staffCookie);

        assert.equal(asOwner.status, 200, `owner should access ${path}`);
        assert.equal(asStaff.status, 403, `staff must be forbidden from ${path}`);
    }
});

test("staff-only routes allow staff and forbid the owner (403)", async () => {
    for (const path of STAFF_GET_ROUTES) {
        const asStaff = await send("get", path, staffCookie);
        const asOwner = await send("get", path, ownerCookie);

        assert.equal(asStaff.status, 200, `staff should access ${path}`);
        assert.equal(asOwner.status, 403, `owner must be forbidden from ${path}`);
    }
});

test("every protected route is covered by a documented access rule", () => {
    const authOnly = new Set(["/api/auth/me", "/api/auth/logout"]);

    for (const route of PROTECTED_ROUTES) {
        const roleScoped =
            route.path.startsWith("/api/owner") || route.path.startsWith("/api/staff");

        assert.ok(
            roleScoped || authOnly.has(route.path),
            `${route.method.toUpperCase()} ${route.path} has no documented access rule`
        );
    }
});
