import { BadRequestError } from "./error.js";
import { DATE_PATTERN, MONTH_PATTERN, TIME_PATTERN } from "./time.js";

/** Deliberately permissive patterns — sanity checks, not strict RFC validators. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE_PATTERN = /^\+?[\d\s\-()]{7,20}$/;
/** A base64 PNG/JPEG/WebP data URL (used for resized avatars). */
export const IMAGE_DATA_URL_PATTERN =
    /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/]+=*$/;

/** Reads a required non-empty string, trimmed, with an optional max length. */
export const requireString = (
    value: unknown,
    field: string,
    maxLength = 255
): string => {
    if (typeof value !== "string" || value.trim() === "") {
        throw new BadRequestError(`${field} is required`);
    }

    const trimmed = value.trim();

    if (trimmed.length > maxLength) {
        throw new BadRequestError(`${field} must be at most ${maxLength} characters`);
    }

    return trimmed;
};

/** Reads an optional string; `null`/`""`/`undefined` all become `null`. */
export const optionalString = (
    value: unknown,
    field: string,
    maxLength = 255
): string | null => {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    if (typeof value !== "string") {
        throw new BadRequestError(`${field} must be a string`);
    }

    const trimmed = value.trim();

    if (trimmed.length > maxLength) {
        throw new BadRequestError(`${field} must be at most ${maxLength} characters`);
    }

    return trimmed === "" ? null : trimmed;
};

/** Reads a required finite number. */
export const requireNumber = (value: unknown, field: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new BadRequestError(`${field} must be a number`);
    }

    return value;
};

/** Reads a required integer. */
export const requireInteger = (value: unknown, field: string): number => {
    const num = requireNumber(value, field);

    if (!Number.isInteger(num)) {
        throw new BadRequestError(`${field} must be a whole number`);
    }

    return num;
};

/** Reads a required boolean. */
export const requireBoolean = (value: unknown, field: string): boolean => {
    if (typeof value !== "boolean") {
        throw new BadRequestError(`${field} must be true or false`);
    }

    return value;
};

/** Reads a required email address. */
export const requireEmail = (value: unknown, field = "email"): string => {
    const text = requireString(value, field, 150);

    if (!EMAIL_PATTERN.test(text)) {
        throw new BadRequestError(`${field} must be a valid email address`);
    }

    return text;
};

/** Reads an optional email address ("" → null). */
export const optionalEmail = (value: unknown, field = "email"): string | null => {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    return requireEmail(value, field);
};

/** Reads a required phone number. */
export const requirePhone = (value: unknown, field = "phone"): string => {
    const text = requireString(value, field, 30);

    if (!PHONE_PATTERN.test(text)) {
        throw new BadRequestError(`${field} must be a valid phone number`);
    }

    return text;
};

/** Reads an optional phone number ("" → null). */
export const optionalPhone = (value: unknown, field = "phone"): string | null => {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    return requirePhone(value, field);
};

/**
 * Reads an optional small image data URL (e.g. an avatar). `""`/null → null.
 * Bounded so a malicious client can't stuff an enormous blob into the row.
 */
export const optionalImageDataUrl = (
    value: unknown,
    field = "image",
    maxLength = 400_000
): string | null => {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    if (typeof value !== "string") {
        throw new BadRequestError(`${field} must be a string`);
    }

    if (value.length > maxLength) {
        throw new BadRequestError(`${field} is too large`);
    }

    if (!IMAGE_DATA_URL_PATTERN.test(value)) {
        throw new BadRequestError(`${field} must be a PNG, JPEG or WebP image`);
    }

    return value;
};

/** Reads a `YYYY-MM-DD` date string. */
export const requireDateString = (value: unknown, field: string): string => {
    const text = requireString(value, field, 10);

    if (!DATE_PATTERN.test(text) || Number.isNaN(new Date(`${text}T00:00:00`).getTime())) {
        throw new BadRequestError(`${field} must be a date in YYYY-MM-DD format`);
    }

    return text;
};

/** Reads a `YYYY-MM` month string. */
export const requireMonth = (value: unknown, field: string): string => {
    const text = requireString(value, field, 7);

    if (!MONTH_PATTERN.test(text)) {
        throw new BadRequestError(`${field} must be a month in YYYY-MM format`);
    }

    return text;
};

/** Reads an `HH:mm` (or `HH:mm:ss`) time string. */
export const requireTimeString = (value: unknown, field: string): string => {
    const text = requireString(value, field, 8);

    if (!TIME_PATTERN.test(text)) {
        throw new BadRequestError(`${field} must be a time in HH:mm format`);
    }

    return text;
};

/** Reads a date-time string and returns a local Date. */
export const requireDateTimeString = (value: unknown, field: string): Date => {
    const text = requireString(value, field, 30);
    const parsed = new Date(text);

    if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestError(`${field} must be a valid date-time`);
    }

    return parsed;
};

/** Reads an optional positive integer (query string or body). */
export const optionalInteger = (value: unknown, field: string): number | null => {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const num = typeof value === "string" ? Number(value) : value;

    if (typeof num !== "number" || !Number.isInteger(num) || num <= 0) {
        throw new BadRequestError(`${field} must be a positive integer`);
    }

    return num;
};

/** Reads a positive integer id from a route param. */
export const requireIdParam = (value: unknown, field = "id"): number => {
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
        throw new BadRequestError(`${field} must be a positive integer`);
    }

    return Number(value);
};

/** Reads an array of unique positive integer ids. */
export const requireIdArray = (value: unknown, field: string): number[] => {
    if (!Array.isArray(value)) {
        throw new BadRequestError(`${field} must be an array of ids`);
    }

    const ids = value.map((item) => {
        if (typeof item !== "number" || !Number.isInteger(item) || item <= 0) {
            throw new BadRequestError(`${field} must contain only positive integer ids`);
        }
        return item;
    });

    return [...new Set(ids)];
};
