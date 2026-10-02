/**
 * Coerces a caller-supplied row limit into a plain non-negative integer.
 *
 * TiDB rejects a `?` placeholder in `LIMIT` when the query runs as a prepared
 * statement (which `mysql2`'s `execute()` uses): it returns
 * `ER_WRONG_ARGUMENTS` / errno 1210 "Incorrect arguments to LIMIT". MySQL and
 * MariaDB accept the placeholder, so this only shows up against TiDB.
 *
 * Row limits are therefore interpolated into the SQL string instead of passed
 * as parameters. This helper guarantees the interpolated value is an integer,
 * so the interpolation can never carry injection or a malformed value.
 */
export const safeRowLimit = (value: number | undefined, fallback = 200): number => {
    const numeric = Math.trunc(Number(value));
    if (!Number.isFinite(numeric) || numeric < 0) return fallback;
    return numeric;
};
