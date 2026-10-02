import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { closeDatabasePool } from "../config/database.js";
import { app, loginWith, send } from "./http.js";
import {
    createInactiveTestUser,
    createTestUser,
    deleteTestUser,
    TEST_PASSWORD,
} from "./helpers.js";

// Types
import type { TestUser } from "./helpers.js";

let owner: TestUser;
let inactive: TestUser;

before(async () => {
    owner = await createTestUser("owner");
    inactive = await createInactiveTestUser("owner");
});

after(async () => {
    await deleteTestUser(owner.id);
    await deleteTestUser(inactive.id);
    await closeDatabasePool();
});

test("valid credentials log in and set an httpOnly session cookie", async () => {
    const res = await request(app)
        .post("/api/auth/login")
        .send({ username: owner.username, password: TEST_PASSWORD });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.username, owner.username);
    assert.equal(res.body.user.role, "owner");

    const raw = res.headers["set-cookie"] as unknown as string[];
    assert.ok(Array.isArray(raw) && raw.length > 0, "expected a Set-Cookie header");
    const cookie = raw[0]!;
    assert.match(cookie, /salonease_token=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
});

test("login response never includes the password hash", async () => {
    const res = await request(app)
        .post("/api/auth/login")
        .send({ username: owner.username, password: TEST_PASSWORD });

    assert.equal(res.body.user.password, undefined);
});

test("wrong password is rejected with 401", async () => {
    const res = await request(app)
        .post("/api/auth/login")
        .send({ username: owner.username, password: "not-the-password" });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
});

test("unknown username is rejected with 401 (same message as wrong password)", async () => {
    const wrongPassword = await request(app)
        .post("/api/auth/login")
        .send({ username: owner.username, password: "nope" });
    const unknownUser = await request(app)
        .post("/api/auth/login")
        .send({ username: "does-not-exist-xyz", password: "nope" });

    assert.equal(unknownUser.status, 401);
    assert.equal(unknownUser.body.message, wrongPassword.body.message);
});

test("deactivated account is rejected with 401", async () => {
    const res = await request(app)
        .post("/api/auth/login")
        .send({ username: inactive.username, password: TEST_PASSWORD });

    assert.equal(res.status, 401);
});

test("missing credentials are rejected with 400", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "" });
    assert.equal(res.status, 400);
});

test("GET /api/auth/me without a cookie is rejected with 401", async () => {
    const res = await send("get", "/api/auth/me");
    assert.equal(res.status, 401);
});

test("GET /api/auth/me with a valid cookie returns the current principal", async () => {
    const { cookie } = await loginWith(owner.username, TEST_PASSWORD);
    assert.ok(cookie);

    const res = await send("get", "/api/auth/me", cookie);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, owner.username);
    assert.equal(res.body.user.role, "owner");
});

test("POST /api/auth/logout clears the session cookie", async () => {
    const { cookie } = await loginWith(owner.username, TEST_PASSWORD);
    const res = await send("post", "/api/auth/logout", cookie);

    assert.equal(res.status, 200);
    const raw = res.headers["set-cookie"] as unknown as string[];
    assert.ok(Array.isArray(raw) && raw.length > 0);
    assert.match(raw[0]!, /salonease_token=;/);
});

/** Rotates username + password on a throwaway account of the given role. */
const assertCredentialRotation = async (role: "owner" | "staff"): Promise<void> => {
    const user = await createTestUser(role);

    try {
        const { cookie } = await loginWith(user.username, user.password);
        assert.ok(cookie, "login must return a cookie");

        const newUsername = `renamed_${user.username}`;
        const newPassword = "BrandNew#2026";

        const res = await send("put", "/api/auth/me", cookie).send({
            currentPassword: user.password,
            username: newUsername,
            password: newPassword,
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.user.username, newUsername);
        assert.equal(res.body.user.role, role);
        assert.equal(res.body.user.password, undefined);

        // A fresh session cookie is re-issued with the updated principal.
        const raw = res.headers["set-cookie"] as unknown as string[];
        assert.ok(Array.isArray(raw) && raw.length > 0, "expected a re-issued cookie");

        const me = await send("get", "/api/auth/me", cookie);
        assert.equal(me.status, 200);
        assert.equal(me.body.user.username, newUsername);

        // New credentials work; the old username and password no longer do.
        const rotated = await loginWith(newUsername, newPassword);
        assert.equal(rotated.res.status, 200);

        const oldUsername = await loginWith(user.username, newPassword);
        assert.equal(oldUsername.res.status, 401);

        const oldPassword = await loginWith(newUsername, user.password);
        assert.equal(oldPassword.res.status, 401);
    } finally {
        await deleteTestUser(user.id);
    }
};

test("an owner can change their username and password and log in with them", async () => {
    await assertCredentialRotation("owner");
});

test("a staff member can change their username and password and log in with them", async () => {
    await assertCredentialRotation("staff");
});

test("PUT /api/auth/me without a cookie is rejected with 401", async () => {
    const res = await send("put", "/api/auth/me");
    assert.equal(res.status, 401);
});

test("PUT /api/auth/me requires the correct current password (401, no changes)", async () => {
    const { cookie } = await loginWith(owner.username, TEST_PASSWORD);

    const res = await send("put", "/api/auth/me", cookie).send({
        currentPassword: "not-the-password",
        username: "would-be-taken-over",
    });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);

    // The account must be untouched.
    const stillOld = await loginWith(owner.username, TEST_PASSWORD);
    assert.equal(stillOld.res.status, 200);
});

test("a credentials update with nothing to change is rejected with 400", async () => {
    const { cookie } = await loginWith(owner.username, TEST_PASSWORD);
    const res = await send("put", "/api/auth/me", cookie).send({
        currentPassword: TEST_PASSWORD,
    });

    assert.equal(res.status, 400);
});

test("a missing current password is rejected with 400", async () => {
    const { cookie } = await loginWith(owner.username, TEST_PASSWORD);
    const res = await send("put", "/api/auth/me", cookie).send({
        password: "Whatever#2026",
    });

    assert.equal(res.status, 400);
});

test("a too-short new password is rejected with 400", async () => {
    const { cookie } = await loginWith(owner.username, TEST_PASSWORD);
    const res = await send("put", "/api/auth/me", cookie).send({
        currentPassword: TEST_PASSWORD,
        password: "short",
    });

    assert.equal(res.status, 400);
});

test("taking another account's username is rejected with 409", async () => {
    const other = await createTestUser("staff");

    try {
        const { cookie } = await loginWith(owner.username, TEST_PASSWORD);
        const res = await send("put", "/api/auth/me", cookie).send({
            currentPassword: TEST_PASSWORD,
            username: other.username,
        });

        assert.equal(res.status, 409);
        assert.equal(res.body.success, false);
    } finally {
        await deleteTestUser(other.id);
    }
});

test("an unknown route returns 404", async () => {
    const res = await send("get", "/api/does-not-exist");
    assert.equal(res.status, 404);
});
