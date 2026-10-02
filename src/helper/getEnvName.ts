import {InternalServerError} from "./error.js"

/**
 * Reads a required environment variable and returns its value.
 * Throws a 500 (server misconfiguration) when the variable is not defined.
 * An empty string is allowed (e.g. a local DB with no password).
 */
export const getEnvName = (name: string):string => {
    const value = process.env[name];

    if(value === undefined) {
        throw new InternalServerError(`Missing required environment variable: ${name}`, 500)
    };

    return value
}