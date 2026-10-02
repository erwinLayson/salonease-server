import request from "supertest";
import type { Response, Test } from "supertest";
import app from "../app.js";

// Types
import type { HttpMethod } from "../routes/registry.js";

export { app };

/** Extracts the `name=value` part of the session Set-Cookie header, if present. */
export const getSessionCookie = (res: Response): string | undefined => {
    const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
    if (!Array.isArray(raw) || raw.length === 0) {
        return undefined;
    }
    return raw[0]!.split(";")[0];
};

/** Issues a request, optionally with a raw `Cookie` header. */
export const send = (method: HttpMethod, path: string, cookie?: string): Test => {
    const req = request(app)[method](path);

    if (cookie) {
        req.set("Cookie", cookie);
    }

    return req;
};

/** Logs in with username/password and returns the raw session cookie. */
export const loginWith = async (
    username: string,
    password: string
): Promise<{ res: Response; cookie: string | undefined }> => {
    const res = await request(app).post("/api/auth/login").send({ username, password });
    return { res, cookie: getSessionCookie(res) };
};
