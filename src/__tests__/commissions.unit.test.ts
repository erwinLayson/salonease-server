import { test } from "node:test";
import assert from "node:assert/strict";
import {
    calculateCommission,
    resolveCommissionRule,
    roundMoney,
    ruleSpecificity,
} from "../service/commissionRules.js";

// Types
import type { CommissionRule } from "../service/commissionRules.js";

const rule = (overrides: Partial<CommissionRule>): CommissionRule => ({
    id: 1,
    staffId: null,
    serviceId: null,
    serviceCategory: null,
    rateType: "percent",
    rateValue: 10,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    priority: 0,
    isActive: true,
    ...overrides,
});

const context = {
    staffId: 7,
    serviceId: 3,
    serviceCategory: "bridal",
    date: "2026-10-18",
};

test("resolution: staff + service beats staff + category", () => {
    const exact = rule({ id: 1, staffId: 7, serviceId: 3, rateValue: 20 });
    const category = rule({ id: 2, staffId: 7, serviceCategory: "bridal", rateValue: 15 });

    assert.equal(resolveCommissionRule([category, exact], context)?.id, 1);
});

test("resolution: staff + category beats staff default", () => {
    const category = rule({ id: 2, staffId: 7, serviceCategory: "bridal", rateValue: 15 });
    const staffDefault = rule({ id: 3, staffId: 7, rateValue: 12 });

    assert.equal(resolveCommissionRule([staffDefault, category], context)?.id, 2);
});

test("resolution: staff default beats a service-only rule", () => {
    const staffDefault = rule({ id: 3, staffId: 7, rateValue: 12 });
    const service = rule({ id: 4, serviceId: 3, rateValue: 25 });

    assert.equal(resolveCommissionRule([service, staffDefault], context)?.id, 3);
});

test("resolution: service-only beats the global default", () => {
    const service = rule({ id: 4, serviceId: 3, rateValue: 25 });
    const global = rule({ id: 5, rateValue: 8 });

    assert.equal(resolveCommissionRule([global, service], context)?.id, 4);
});

test("resolution: global default applies when nothing else matches", () => {
    const otherStaff = rule({ id: 9, staffId: 99, rateValue: 40 });
    const global = rule({ id: 5, rateValue: 8 });

    assert.equal(resolveCommissionRule([otherStaff, global], context)?.id, 5);
});

test("resolution: no active rule returns null", () => {
    assert.equal(resolveCommissionRule([], context), null);
    assert.equal(
        resolveCommissionRule([rule({ id: 6, isActive: false })], context),
        null
    );
});

test("resolution: an unmatched staff member gets no rule", () => {
    assert.equal(
        resolveCommissionRule([rule({ id: 9, staffId: 99 })], context),
        null
    );
});

test("resolution: effective dates are inclusive", () => {
    const expired = rule({
        id: 1,
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-10-17",
    });
    const current = rule({
        id: 2,
        effectiveFrom: "2026-10-18",
        effectiveTo: "2026-10-31",
    });

    assert.equal(resolveCommissionRule([expired, current], context)?.id, 2);
    assert.equal(
        resolveCommissionRule([rule({ id: 3, effectiveFrom: "2026-10-19" })], context),
        null
    );
});

test("resolution: priority breaks a specificity tie", () => {
    const low = rule({ id: 1, staffId: 7, priority: 1, rateValue: 10 });
    const high = rule({ id: 2, staffId: 7, priority: 5, rateValue: 18 });

    assert.equal(resolveCommissionRule([low, high], context)?.id, 2);
});

test("resolution: the latest effective date breaks a priority tie", () => {
    const older = rule({ id: 1, staffId: 7, effectiveFrom: "2026-01-01", rateValue: 10 });
    const newer = rule({ id: 2, staffId: 7, effectiveFrom: "2026-06-01", rateValue: 18 });

    assert.equal(resolveCommissionRule([older, newer], context)?.id, 2);
    assert.equal(resolveCommissionRule([newer, older], context)?.id, 2);
});

test("specificity ranks the documented resolution order", () => {
    assert.equal(ruleSpecificity(rule({ staffId: 1, serviceId: 1 })), 5);
    assert.equal(ruleSpecificity(rule({ staffId: 1, serviceCategory: "hair" })), 4);
    assert.equal(ruleSpecificity(rule({ staffId: 1 })), 3);
    assert.equal(ruleSpecificity(rule({ serviceId: 1 })), 2);
    assert.equal(ruleSpecificity(rule({ serviceCategory: "hair" })), 2);
    assert.equal(ruleSpecificity(rule({})), 1);
});

test("commission: percent is rounded half-up to two decimals", () => {
    assert.equal(calculateCommission(199.99, rule({ rateValue: 10 })), 20);
    assert.equal(calculateCommission(100, rule({ rateValue: 10.005 })), 10.01);
    assert.equal(calculateCommission(1, rule({ rateValue: 33.335 })), 0.33);
});

test("commission: fixed rules ignore the percentage and never exceed the base", () => {
    assert.equal(
        calculateCommission(500, rule({ rateType: "fixed", rateValue: 50 })),
        50
    );
    assert.equal(
        calculateCommission(30, rule({ rateType: "fixed", rateValue: 50 })),
        30
    );
});

test("commission: zero or negative base accrues nothing", () => {
    assert.equal(calculateCommission(0, rule({})), 0);
    assert.equal(calculateCommission(-10, rule({})), 0);
});

test("commission: a missing rule accrues zero", () => {
    assert.equal(calculateCommission(100, null), 0);
});

test("roundMoney normalises floating-point drift", () => {
    assert.equal(roundMoney(0.1 + 0.2), 0.3);
    assert.equal(roundMoney(10.005), 10.01);
});
