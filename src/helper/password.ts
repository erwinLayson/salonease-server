import bcrypt from "bcryptjs";

/** Work factor for bcrypt. Higher is slower to brute-force; 10 is a good default. */
const BCRYPT_ROUNDS = 10;

/** Hashes a plaintext password with a per-password random salt. */
export const hashPassword = (plain: string): string => bcrypt.hashSync(plain, BCRYPT_ROUNDS);

/** Constant-time comparison of a plaintext password against a stored bcrypt hash. */
export const verifyPassword = (plain: string, hash: string): boolean =>
    bcrypt.compareSync(plain, hash);
