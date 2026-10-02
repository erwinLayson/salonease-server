import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSlots, subtractIntervals } from "../service/availabilityEngine.js";

// Types
import type { AvailabilityInput, Interval } from "../service/availabilityEngine.js";

const DAY = "2026-11-02"; // fixed date so results are deterministic

const at = (time: string): Date => new Date(`${DAY}T${time}:00`);

const window = (start: string, end: string): Interval => ({ start: at(start), end: at(end) });
const busy = (start: string, end: string): Interval => ({ start: at(start), end: at(end) });

/** Base input: 09:00–18:00 working day, 30-min service, 10-min buffer, 15-min grid. */
const baseInput = (overrides: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
    serviceDurationMinutes: 30,
    workingWindows: [window("09:00", "18:00")],
    blocked: [],
    busy: [],
    bufferMinutes: 10,
    granularityMinutes: 15,
    earliestStart: at("00:00"),
    latestStart: at("23:59"),
    ...overrides,
});

const startsAsStrings = (input: AvailabilityInput): string[] =>
    computeSlots(input).map((slot) => {
        const hh = String(slot.getHours()).padStart(2, "0");
        const mm = String(slot.getMinutes()).padStart(2, "0");
        return `${hh}:${mm}`;
    });

/** The first generated slot on an otherwise-free day. */
const firstSlot = (input: AvailabilityInput): string => startsAsStrings(input)[0]!;

// ---------------------------------------------------------------- acceptance

test("overlap 01: a busy appointment fully BEFORE the candidate accepts it", () => {
    // busy occupied 09:00–09:40; candidate 10:00 occupies 10:00–10:40
    const slots = startsAsStrings(baseInput({ busy: [busy("09:00", "09:40")] }));
    assert.ok(slots.includes("10:00"));
});

test("overlap 02: a busy appointment fully AFTER the candidate accepts it", () => {
    const slots = startsAsStrings(baseInput({ busy: [busy("11:00", "11:40")] }));
    assert.ok(slots.includes("09:00"));
});

test("overlap 03: slots inside the busy occupied interval are rejected", () => {
    // busy occupied 09:00–09:40 (30-min service + 10-min buffer)
    const slots = startsAsStrings(baseInput({ busy: [busy("09:00", "09:40")] }));
    assert.ok(!slots.includes("09:15"));
    assert.ok(!slots.includes("09:30"));
});

test("overlap 04: the first aligned slot after the occupied interval is accepted", () => {
    const slots = startsAsStrings(baseInput({ busy: [busy("09:00", "09:40")] }));
    assert.equal(slots[0], "09:45");
});

// ---------------------------------------------------------------- rejection

test("overlap 05: an identical interval is rejected", () => {
    // busy 10:00–10:40 (30 min + 10 buffer) vs candidate 10:00
    const slots = startsAsStrings(baseInput({ busy: [busy("10:00", "10:40")] }));
    assert.ok(!slots.includes("10:00"));
});

test("overlap 06: candidate starting inside a busy interval is rejected", () => {
    const slots = startsAsStrings(baseInput({ busy: [busy("10:00", "10:40")] }));
    assert.ok(!slots.includes("10:15"));
    assert.ok(!slots.includes("10:30"));
});

test("overlap 07: candidate ending inside a busy interval is rejected", () => {
    // busy 10:15–11:00; candidate at 10:00 occupies 10:00–10:40 -> overlaps
    const slots = startsAsStrings(baseInput({ busy: [busy("10:15", "11:00")] }));
    assert.ok(!slots.includes("10:00"));
});

test("overlap 08: candidate fully inside a long busy interval is rejected", () => {
    const slots = startsAsStrings(baseInput({ busy: [busy("09:00", "12:00")] }));
    assert.ok(!slots.includes("10:00"));
    assert.ok(!slots.includes("11:00"));
    assert.ok(slots.includes("12:00"));
});

test("overlap 09: a busy interval fully inside the candidate interval is rejected", () => {
    // 90-min service at 09:00 occupies 09:00–10:40, swallowing busy 09:30–09:40
    const slots = startsAsStrings(
        baseInput({ serviceDurationMinutes: 90, busy: [busy("09:30", "09:40")] })
    );
    assert.ok(!slots.includes("09:00"));
});

test("overlap 10: the buffer time blocks the next slot inside the gap", () => {
    // 30-min service at 09:00 -> occupied 09:00–09:40, so 09:30 must be rejected
    const slots = startsAsStrings(
        baseInput({
            serviceDurationMinutes: 30,
            busy: [busy("09:00", "09:40")],
        })
    );
    assert.ok(!slots.includes("09:30"));
});

// ---------------------------------------------------------------- exceptions

test("overlap 11: a leave block removes slots that overlap it", () => {
    const slots = startsAsStrings(baseInput({ blocked: [busy("12:00", "13:00")] }));
    assert.ok(!slots.includes("12:00"));
    assert.ok(!slots.includes("12:45"));
    assert.ok(slots.includes("13:00"));
});

test("overlap 12: a full-day closure removes every slot", () => {
    const slots = startsAsStrings(
        baseInput({ blocked: [window("00:00", "23:59")] })
    );
    assert.deepEqual(slots, []);
});

test("overlap 13: subtractIntervals splits a window around a block", () => {
    const result = subtractIntervals(
        [window("09:00", "18:00")],
        [window("12:00", "13:00")]
    );
    assert.equal(result.length, 2);
    assert.equal(result[0]!.end.getHours(), 12);
    assert.equal(result[1]!.start.getHours(), 13);
});

// ---------------------------------------------------------------- boundaries

test("overlap 14: no slots when the service cannot fit in the window", () => {
    const slots = computeSlots(
        baseInput({
            serviceDurationMinutes: 120,
            workingWindows: [window("09:00", "10:00")],
        })
    );
    assert.deepEqual(slots, []);
});

test("overlap 15: slots respect the minimum lead time", () => {
    const slots = startsAsStrings(baseInput({ earliestStart: at("12:00") }));
    assert.equal(firstSlot(baseInput({ earliestStart: at("12:00") })), "12:00");
    assert.ok(!slots.includes("11:45"));
});

test("overlap 16: slots respect the advance-booking window (latestStart)", () => {
    const slots = startsAsStrings(baseInput({ latestStart: at("10:00") }));
    assert.ok(slots.includes("10:00"));
    assert.ok(!slots.includes("10:15"));
});

test("overlap 17: the first candidate aligns to the working-window start", () => {
    assert.equal(firstSlot(baseInput()), "09:00");
});

test("overlap 18: busy slots outside the window do not affect the day", () => {
    const slots = startsAsStrings(baseInput({ busy: [busy("07:00", "08:00")] }));
    assert.equal(slots[0], "09:00");
    assert.ok(slots.length > 0);
});
