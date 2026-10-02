import dotenv from "dotenv"
dotenv.config();

import app from "./app.js";

const port = process.env.PORT;

const server = app.listen(port, () => {
    console.log(`App is running in port:${port}`);
})

server.on('error', (err) => {
    console.log(err);
})