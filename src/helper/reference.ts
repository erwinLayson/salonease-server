import { randomBytes } from "node:crypto";

/** Unambiguous alphabet (no 0/O/1/I/L) for human-readable references. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Generates a short public appointment reference, e.g. `APT-8F3K9QRT`
 * (always 12 characters, matching the `appointments.reference` column).
 */
export const generateAppointmentReference = (): string => {
    const bytes = randomBytes(8);
    let code = "";

    for (let i = 0; i < 8; i += 1) {
        code += ALPHABET[bytes[i]! % ALPHABET.length];
    }

    return `APT-${code}`;
};

/** Generates the 64-character unguessable token used by the customer manage link. */
export const generateManageToken = (): string => randomBytes(32).toString("hex");
