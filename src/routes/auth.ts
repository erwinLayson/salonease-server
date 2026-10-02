import { Router } from "express";
import authenticate from "../middleware/authenticate.js";
import { login, logout, me, updateCredentials } from "../controller/auth.js";

/**
 * Auth routes.
 * Only `POST /login` is public — `logout`, `me` and the credentials update
 * require a valid session.
 */
const router: Router = Router();

router.post("/login", login);
router.post("/logout", authenticate, logout);
router.get("/me", authenticate, me);
router.put("/me", authenticate, updateCredentials);

export default router;
