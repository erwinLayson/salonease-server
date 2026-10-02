import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { signToken, verifyToken } from "../helper/token.js";
import { UnauthorizedError } from "../helper/error.js";

// Types
import type { AuthUser } from "../constant/users.js";

const owner: AuthUser = { id: 42, username: "owner1", role: "owner" };

const secret = (): string => process.env.JWT_SECRET ?? "";

test("sign -> verify round trip returns the same principal", () => {
    assert.deepEqual(verifyToken(signToken(owner)), owner);
});

test("tampered token is rejected", () => {
    const token = signToken(owner);
    const lastChar = token.slice(-1);
    const tampered = token.slice(0, -1) + (lastChar === "a" ? "b" : "a");
    assert.throws(() => verifyToken(tampered), UnauthorizedError);
});

test("token signed with a different secret is rejected", () => {
    const forged = jwt.sign(
        { username: "attacker", role: "owner" },
        "attacker-controlled-secret",
        { subject: "1", algorithm: "HS256" }
    );
    assert.throws(() => verifyToken(forged), UnauthorizedError);
});

test("alg:none token is rejected", () => {
    const none = jwt.sign(
        { username: "attacker", role: "owner" },
        "",
        { subject: "1", algorithm: "none" }
    );
    assert.throws(() => verifyToken(none), UnauthorizedError);
});

test("expired token is rejected", () => {
    const expired = jwt.sign(
        { username: "owner1", role: "owner" },
        secret(),
        { subject: "42", algorithm: "HS256", expiresIn: "-1s" }
    );
    assert.throws(() => verifyToken(expired), UnauthorizedError);
});

test("token with an unknown role is rejected", () => {
    const bad = jwt.sign(
        { username: "x", role: "admin" },
        secret(),
        { subject: "1", algorithm: "HS256" }
    );
    assert.throws(() => verifyToken(bad), UnauthorizedError);
});

test("garbage token is rejected", () => {
    assert.throws(() => verifyToken("not-a-jwt"), UnauthorizedError);
});
