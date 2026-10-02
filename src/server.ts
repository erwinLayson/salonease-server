// Must be the first import: ESM hoists imports, so this runs before app.js
// is evaluated (app.js reads env vars at module scope).
import "dotenv/config";

import app from "./app.js";
import { bootstrapDatabase } from "./config/bootstrap.js";

const port = process.env.PORT;

// Migrations (+ seed on a fresh database) must finish before we accept
// requests, otherwise routes would query tables that do not exist yet.
try {
    await bootstrapDatabase();
} catch (err) {
    console.error("Database bootstrap failed:", err);
    process.exit(1);
}

const server = app.listen(port, () => {
    console.log(`App is running in port:${port}`);
})

server.on('error', (err) => {
    console.log(err);
})
