import StaffModel from "../model/staff.js";
import UserModel from "../model/users.js";
import ServiceModel from "../model/services.js";
import { withConnection, withTransaction } from "../helper/withConnection.js";
import { createUserService } from "./user.js";
import { hashPassword } from "../helper/password.js";
import { BadRequestError, ConflictError, NotFoundError } from "../helper/error.js";

// Types
import type {
    CreateStaffInput,
    StaffWithAccount,
    UpdateStaffInput,
    UpdateStaffProfileInput,
} from "../constant/staff.js";

const fullName = (staff: StaffWithAccount): string =>
    `${staff.first_name} ${staff.last_name}`.trim();

export const listStaff = (includeInactive: boolean): Promise<StaffWithAccount[]> =>
    withConnection((connection) => new StaffModel(connection).list(includeInactive));

/** A team member as shown on the public landing page. */
export interface PublicTeamMember {
    id: number;
    name: string;
    position: string | null;
    /** Resized avatar data URL, or null when the staff member has none. */
    profilePhoto: string | null;
}

/** Active staff roster for the landing page "Meet the team" section. */
export const listPublicTeam = (): Promise<PublicTeamMember[]> =>
    withConnection((connection) => new StaffModel(connection).list(false)).then(
        (staff) =>
            staff.map((member) => ({
                id: member.id,
                name: fullName(member),
                position: member.position,
                profilePhoto: member.profile_photo,
            }))
    );

/** The signed-in staff member's own profile (404 when no profile is linked). */
export const getStaffProfileForUser = async (userId: number): Promise<StaffWithAccount> => {
    const staff = await withConnection((connection) =>
        new StaffModel(connection).findByUserId(userId)
    );

    if (!staff) {
        throw new NotFoundError("Staff profile not found", 404);
    }

    return getStaff(staff.id);
};

/** Updates the signed-in staff member's own profile (position stays owner-managed). */
export const updateStaffProfileForUser = (
    userId: number,
    input: UpdateStaffProfileInput
): Promise<StaffWithAccount> =>
    withTransaction(async (connection) => {
        const model = new StaffModel(connection);
        const current = await model.findByUserId(userId);

        if (!current) {
            throw new NotFoundError("Staff profile not found", 404);
        }

        await model.updateSelfProfile(current.id, input);

        // Keep the login account's email in sync with the profile.
        if (current.user_id !== null) {
            await new UserModel(connection).updateEmail(current.user_id, input.email);
        }

        return (await model.findById(current.id))!;
    });

/** Loads a staff member or throws a 404. */
export const getStaff = async (id: number): Promise<StaffWithAccount> => {
    const staff = await withConnection((connection) =>
        new StaffModel(connection).findById(id)
    );

    if (!staff) {
        throw new NotFoundError("Staff not found", 404);
    }

    return staff;
};

/** Creates the login account and the staff profile in one transaction. */
export const createStaff = (input: CreateStaffInput): Promise<StaffWithAccount> =>
    withTransaction(async (connection) => {
        const userModel = new UserModel(connection);

        if (await userModel.findByUsername(input.username)) {
            throw new ConflictError("That username is already taken");
        }

        const userId = await createUserService(
            {
                username: input.username,
                email: input.email,
                password: input.password,
                role: "staff",
            },
            connection
        );

        const staffModel = new StaffModel(connection);
        const staffId = await staffModel.create(userId, input);
        return (await staffModel.findById(staffId))!;
    });

export const updateStaff = (
    id: number,
    input: UpdateStaffInput,
    options: { password?: string } = {}
): Promise<StaffWithAccount> =>
    withTransaction(async (connection) => {
        const staffModel = new StaffModel(connection);
        const current = await staffModel.findById(id);

        if (!current) {
            throw new NotFoundError("Staff not found", 404);
        }

        await staffModel.updateProfile(id, input);

        // Keep the login account in sync (email, optional password reset).
        if (current.user_id !== null) {
            const userModel = new UserModel(connection);
            await userModel.updateEmail(current.user_id, input.email);

            if (options.password) {
                await userModel.updatePassword(current.user_id, hashPassword(options.password));
            }
        }

        return (await staffModel.findById(id))!;
    });

export interface DeactivationImpact {
    staffId: number;
    staffName: string;
    futureAppointments: number;
    appointments: Array<{ id: number; reference: string; start_at: string; status: string }>;
}

/** Counts and lists the future appointments that deactivation would affect. */
export const getDeactivationImpact = async (staffId: number): Promise<DeactivationImpact> => {
    const staff = await getStaff(staffId);

    return withConnection(async (connection) => {
        const model = new StaffModel(connection);
        const futureAppointments = await model.countFutureAppointments(staffId);
        const appointments =
            futureAppointments > 0
                ? ((await model.listFutureAppointments(staffId)) as DeactivationImpact["appointments"])
                : [];

        return {
            staffId,
            staffName: fullName(staff),
            futureAppointments,
            appointments,
        };
    });
};

/**
 * Activates or deactivates a staff member.
 *
 * Deactivating someone who still has future appointments is refused with a 409
 * unless `force` is true, so the owner must acknowledge the warning. The login
 * account is deactivated alongside the profile.
 */
export const setStaffActive = (
    id: number,
    isActive: boolean,
    force = false
): Promise<StaffWithAccount> =>
    withTransaction(async (connection) => {
        const staffModel = new StaffModel(connection);
        const current = await staffModel.findById(id);

        if (!current) {
            throw new NotFoundError("Staff not found", 404);
        }

        if (!isActive && !force) {
            const futureCount = await staffModel.countFutureAppointments(id);
            if (futureCount > 0) {
                throw new ConflictError(
                    `${fullName(current)} has ${futureCount} upcoming appointment(s). ` +
                        "Confirm deactivation to proceed."
                );
            }
        }

        await staffModel.setActive(id, isActive);

        if (current.user_id !== null) {
            await new UserModel(connection).setActive(current.user_id, isActive);
        }

        return (await staffModel.findById(id))!;
    });

/** Deletes a staff member, unless appointment history references them. */
export const deleteStaff = (id: number): Promise<void> =>
    withTransaction(async (connection) => {
        const staffModel = new StaffModel(connection);
        const current = await staffModel.findById(id);

        if (!current) {
            throw new NotFoundError("Staff not found", 404);
        }

        const appointmentCount = await staffModel.countAppointments(id);
        if (appointmentCount > 0) {
            throw new ConflictError(
                "This staff member has appointment history and cannot be deleted. Deactivate them instead."
            );
        }

        // Deleting the staff row cascades to schedules and service assignments.
        await staffModel.delete(id);

        if (current.user_id !== null) {
            await new UserModel(connection).deleteById(current.user_id);
        }
    });

/** Service ids assigned to a staff member. */
export const getStaffServices = async (staffId: number): Promise<number[]> => {
    await getStaff(staffId);
    return withConnection((connection) => new StaffModel(connection).getServiceIds(staffId));
};

/** Replaces a staff member's service assignments. */
export const setStaffServices = (
    staffId: number,
    serviceIds: number[]
): Promise<number[]> =>
    withTransaction(async (connection) => {
        const staffModel = new StaffModel(connection);

        if (!(await staffModel.findById(staffId))) {
            throw new NotFoundError("Staff not found", 404);
        }

        const serviceModel = new ServiceModel(connection);
        const unknownIds: number[] = [];
        for (const serviceId of serviceIds) {
            if (!(await serviceModel.findById(serviceId))) {
                unknownIds.push(serviceId);
            }
        }

        if (unknownIds.length > 0) {
            throw new BadRequestError(`Unknown service id(s): ${unknownIds.join(", ")}`);
        }

        await staffModel.setServiceIds(staffId, serviceIds);
        return serviceIds;
    });
