import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { closeDatabasePool } from "../config/database.js";
import { loginWith, send } from "./http.js";
import { createTestUser, deleteTestUser, TEST_PASSWORD } from "./helpers.js";
import { PROTECTED_ROUTES } from "../routes/registry.js";

// Types
import type { TestUser } from "./helpers.js";

let owner: TestUser;
let disabled: TestUser;
let disabledCookie: string | undefined;

before(async () => {
    owner = await createTestUser("owner");
    disabled = await createTestUser("owner");

    // Get a token for the account, THEN deactivate it — the token stays valid,
    // but the server must refuse it because the account is no longer active.
    disabledCookie = (await loginWith(disabled.username, TEST_PASSWORD)).cookie;
    assert.ok(disabledCookie);

    const { databasePool } = await import("../config/database.js");
    const connection = await databasePool().getConnection();
    try {
        await connection.execute("UPDATE users SET is_active = 0 WHERE id = ?", [disabled.id]);
    } finally {
        connection.release();
    }
});

after(async () => {
    await deleteTestUser(owner.id);
    await deleteTestUser(disabled.id);
    await closeDatabasePool();
});

/**
 * Tokens that must never grant access:
 *  - `alg: none` (algorithm confusion)
 *  - signed with an attacker-controlled secret
 *  - correctly signed but for a user id that does not exist
 */
const forgedTokens = (): string[] => {
    const secret = process.env.JWT_SECRET ?? "";
    const none = jwt.sign({ username: "attacker", role: "owner" }, "", {
        subject: "1",
        algorithm: "none",
    });
    const wrongSecret = jwt.sign(
        { username: "attacker", role: "owner" },
        "attacker-secret",
        { subject: "1", algorithm: "HS256" }
    );
    const unknownUser = jwt.sign({ username: "ghost", role: "owner" }, secret, {
        subject: "999999",
        algorithm: "HS256",
    });
    return [none, wrongSecret, unknownUser];
};

test("0 successful unauthorized attempts across every protected route", async () => {
    const cookies: Array<string | undefined> = [
        undefined, // no cookie
        "salonease_token=", // empty token
        "salonease_token=not-a-jwt", // garbage
        ...forgedTokens().map((t) => `salonease_token=${t}`),
        disabledCookie, // valid signature but deactivated account
    ];

    let attempts = 0;
    let successes = 0;

    for (const route of PROTECTED_ROUTES) {
        for (const cookie of cookies) {
            attempts += 1;
            const res = await send(route.method, route.path, cookie);
            if (res.status < 400) {
                successes += 1;
                console.error(
                    `UNAUTHORIZED ACCESS: ${route.method.toUpperCase()} ${route.path} -> ${res.status}`
                );
            }
        }
    }

    assert.ok(attempts > 0);
    assert.equal(successes, 0, `${successes} of ${attempts} unauthorized attempts succeeded`);
});

test("a deactivated account cannot reuse a token issued while it was active", async () => {
    for (const route of PROTECTED_ROUTES) {
        const res = await send(route.method, route.path, disabledCookie);
        assert.equal(
            res.status,
            401,
            `${route.method.toUpperCase()} ${route.path} must reject a deactivated account`
        );
    }
});

test("a valid staff session cannot reach owner-only routes", async () => {
    const staff = await createTestUser("staff");
    try {
        const cookie = (await loginWith(staff.username, TEST_PASSWORD)).cookie;
        const res = await send("get", "/api/owner/dashboard", cookie);
        assert.equal(res.status, 403);
    } finally {
        await deleteTestUser(staff.id);
    }
});
