// tsc only emits .js, so the migration .sql files must be copied into dist/
// manually — otherwise the built server (Render: `node dist/server.js`) cannot
// find them at dist/migrations and startup fails with ENOENT.
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = path.join(serverRoot, "src", "migrations");
const to = path.join(serverRoot, "dist", "migrations");

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });

console.log(`Copied migration SQL files to ${path.relative(serverRoot, to)}`);
