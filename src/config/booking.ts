/**
 * Booking-rule defaults.
 *
 * These mirror the "owner-confirmable defaults" documented in
 * `docs/03-booking-and-scheduling-rules.md` §7. They live in one place so the
 * availability engine, validation, and booking flow stay consistent.
 */
export const BOOKING_RULES = {
    /** Smallest bookable increment, in minutes. Service durations must be a multiple. */
    slotGranularityMinutes: 15,
    /** Cleanup/turnaround reserved after each appointment, in minutes. */
    bufferMinutes: 10,
    /** Minimum notice before a slot can be booked, in minutes. */
    minimumLeadTimeMinutes: 60,
    /** How far ahead customers may book, in days. */
    advanceBookingWindowDays: 30,
    /** Customer cancellation cutoff before the appointment, in minutes. */
    cancellationCutoffMinutes: 120,
    /** How many alternative slots to suggest when a requested slot is taken. */
    alternativeSlotCount: 5,
} as const;

/** Spam-protection limits for the public booking endpoints (FR-GB7). */
export const RATE_LIMITS = {
    /** Creating a booking: 5 attempts per 15 minutes per client. */
    booking: { windowMs: 15 * 60 * 1000, max: 5 },
    /** Manage-link actions (view/cancel/reschedule): 20 per 15 minutes. */
    manage: { windowMs: 15 * 60 * 1000, max: 20 },
} as const;
