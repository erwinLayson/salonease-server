import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError, UnauthorizedError } from "../helper/error.js";
import {
    optionalEmail,
    optionalImageDataUrl,
    optionalPhone,
    optionalString,
    requireBoolean,
    requireIdArray,
    requireIdParam,
    requireString,
} from "../helper/validation.js";
import * as staffService from "../service/staff.js";

// Types
import type {
    CreateStaffInput,
    UpdateStaffInput,
    UpdateStaffProfileInput,
} from "../constant/staff.js";

const MIN_PASSWORD_LENGTH = 8;

const parseStaffProfile = (body: Record<string, unknown>): UpdateStaffInput => ({
    firstName: requireString(body.firstName, "firstName", 80),
    lastName: requireString(body.lastName, "lastName", 80),
    position: optionalString(body.position, "position", 80),
    phone: optionalString(body.phone, "phone", 30),
    email: optionalString(body.email, "email", 150),
});

/** Fields a staff member may change on their own profile. */
const parseOwnProfile = (body: Record<string, unknown>): UpdateStaffProfileInput => ({
    firstName: requireString(body.firstName, "firstName", 80),
    lastName: requireString(body.lastName, "lastName", 80),
    phone: optionalPhone(body.phone, "phone"),
    email: optionalEmail(body.email, "email"),
    address: optionalString(body.address, "address", 255),
    profilePhoto: optionalImageDataUrl(body.profilePhoto, "profilePhoto"),
});

const parsePassword = (value: unknown, field = "password"): string => {
    const password = requireString(value, field, 128);

    if (password.length < MIN_PASSWORD_LENGTH) {
        throw new BadRequestError(`${field} must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    return password;
};

/** GET /api/staff/profile — the signed-in staff member's own profile. */
export const getOwnProfile = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    const data = await staffService.getStaffProfileForUser(req.user.id);
    res.status(200).json({ success: true, data });
});

/** PUT /api/staff/profile — updates the signed-in staff member's own profile. */
export const updateOwnProfile = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await staffService.updateStaffProfileForUser(
        req.user.id,
        parseOwnProfile(body)
    );
    res.status(200).json({ success: true, data });
});

/** GET /api/public/team — active staff for the landing page roster. */
export const listPublicTeam = asyncHandler(async (_req, res) => {
    const team = await staffService.listPublicTeam();
    res.status(200).json({ success: true, data: team });
});

/** GET /api/owner/staff?includeInactive=true */
export const listStaff = asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === "true";
    const staff = await staffService.listStaff(includeInactive);
    res.status(200).json({ success: true, data: staff });
});

/** GET /api/owner/staff/:id */
export const getStaff = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    res.status(200).json({ success: true, data: await staffService.getStaff(id) });
});

/** POST /api/owner/staff */
export const createStaff = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const profile = parseStaffProfile(body);

    const input: CreateStaffInput = {
        ...profile,
        username: requireString(body.username, "username", 50),
        password: parsePassword(body.password),
    };

    const created = await staffService.createStaff(input);
    res.status(201).json({ success: true, data: created });
});

/** PUT /api/owner/staff/:id */
export const updateStaff = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const profile = parseStaffProfile(body);

    // Password reset is optional on update.
    const options: { password?: string } = {};
    if (body.password !== undefined && body.password !== "") {
        options.password = parsePassword(body.password);
    }

    const updated = await staffService.updateStaff(id, profile, options);
    res.status(200).json({ success: true, data: updated });
});

/** GET /api/owner/staff/:id/deactivation-impact */
export const getDeactivationImpact = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    const impact = await staffService.getDeactivationImpact(id);
    res.status(200).json({ success: true, data: impact });
});

/**
 * PATCH /api/owner/staff/:id/status  { isActive, force? }
 *
 * When deactivating a staff member who still has future appointments, responds
 * 409 with a `warning` payload unless `force: true` is supplied.
 */
export const setStaffStatus = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const isActive = requireBoolean(body.isActive, "isActive");
    const force = body.force === undefined ? false : requireBoolean(body.force, "force");

    if (!isActive && !force) {
        const impact = await staffService.getDeactivationImpact(id);

        if (impact.futureAppointments > 0) {
            res.status(409).json({
                success: false,
                message:
                    `${impact.staffName} has ${impact.futureAppointments} upcoming ` +
                    "appointment(s). Confirm deactivation to proceed.",
                warning: impact,
            });
            return;
        }
    }

    const updated = await staffService.setStaffActive(id, isActive, force);
    res.status(200).json({ success: true, data: updated });
});

/** GET /api/owner/staff/:id/services */
export const getStaffServices = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    const serviceIds = await staffService.getStaffServices(id);
    res.status(200).json({ success: true, data: { staffId: id, serviceIds } });
});

/** PUT /api/owner/staff/:id/services  { serviceIds: number[] } */
export const setStaffServices = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const serviceIds = requireIdArray(body.serviceIds, "serviceIds");

    const saved = await staffService.setStaffServices(id, serviceIds);
    res.status(200).json({ success: true, data: { staffId: id, serviceIds: saved } });
});

/** DELETE /api/owner/staff/:id */
export const deleteStaff = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    await staffService.deleteStaff(id);
    res.status(204).send();
});
