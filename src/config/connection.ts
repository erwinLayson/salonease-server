import { getEnvName } from "../helper/getEnvName.js";

interface SslOptions {
    minVersion: "TLSv1.2";
    rejectUnauthorized: boolean;
}

/**
 * TLS decision for a host. TiDB Cloud rejects plain connections outright
 * ("Connections using insecure transport are prohibited"), so TLS is on for
 * `*.tidbcloud.com` hosts, for `NODE_ENV=production`, or when `DB_SSL=true`.
 * `DB_SSL=false` forces a plain connection (e.g. local MySQL without TLS).
 *
 * Certificates are verified against Node's built-in Mozilla CA store, which
 * TiDB Cloud chains to — no CA file is required (see TiDB's mysql2 example).
 * Set `DB_SSL_REJECT_UNAUTHORIZED=false` only for self-signed local servers.
 */
const sslFor = (host: string): SslOptions | undefined => {
    const flag = process.env.DB_SSL?.trim().toLowerCase();
    const enabled =
        flag === "true" || flag === "1" || flag === "on"
            ? true
            : flag === "false" || flag === "0" || flag === "off"
              ? false
              : process.env.NODE_ENV === "production" || /\.tidbcloud\.com$/i.test(host);

    if (!enabled) return undefined;

    return {
        minVersion: "TLSv1.2",
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
    };
};

/**
 * Connection settings shared by the pool, the migration runner and the seed
 * script, so TLS behaviour can never drift between them (it previously did:
 * only the pool ever enabled TLS, and only in production).
 */
export const databaseCredentials = () => {
    const host = getEnvName("DB_HOST");
    const ssl = sslFor(host);

    return {
        host,
        user: getEnvName("DB_USER"),
        password: getEnvName("DB_PASSWORD"),
        database: getEnvName("DB_NAME"),
        port: Number(getEnvName("DB_PORT")),
        ...(ssl ? { ssl } : {}),
    };
};
