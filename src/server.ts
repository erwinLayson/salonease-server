// Must be the first import: ESM hoists imports, so this runs before app.js
// is evaluated (app.js reads env vars at module scope).
import "dotenv/config";

import app from "./app.js";
import {checkDBConnection} from "./config/database.js";

const port = process.env.PORT;

try {
    await checkDBConnection();
} catch (err) {
    console.error(err);
    process.exit(1);
}

const server = app.listen(port, () => {
    console.log(`App is running in port:${port}`);
})

server.on('error', (err) => {
    console.log(err);
})