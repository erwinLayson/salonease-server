import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Runs `main` only when this module is the process entry point
 * (e.g. `pnpm migrate` -> src/migration.ts).
 *
 * Importing the module for its exports — the server does exactly that via
 * config/bootstrap.ts — must never trigger the CLI side effects, so the
 * scripts keep working standalone while staying safe to import.
 */
export const runIfMain = (
    moduleUrl: string,
    failureLabel: string,
    main: () => Promise<void>
): void => {
    const entry = process.argv[1];
    if (entry === undefined) return;

    const entryPath = path.resolve(entry);
    const modulePath = fileURLToPath(moduleUrl);
    // Compare case-insensitively: Windows paths can differ in drive casing.
    if (entryPath !== modulePath && entryPath.toLowerCase() !== modulePath.toLowerCase()) {
        return;
    }

    main().catch((error) => {
        console.error(failureLabel, error);
        process.exit(1);
    });
};
