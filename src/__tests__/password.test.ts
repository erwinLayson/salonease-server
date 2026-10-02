import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../helper/password.js";

test("hashPassword never stores the plaintext", () => {
    const hash = hashPassword("secret123");
    assert.notEqual(hash, "secret123");
    assert.match(hash, /^\$2[aby]\$/); // bcrypt hash format
});

test("verifyPassword accepts the correct password", () => {
    assert.equal(verifyPassword("secret123", hashPassword("secret123")), true);
});

test("verifyPassword rejects a wrong password", () => {
    assert.equal(verifyPassword("wrong-password", hashPassword("secret123")), false);
});

test("hashing the same password twice yields different salts", () => {
    assert.notEqual(hashPassword("secret123"), hashPassword("secret123"));
});
