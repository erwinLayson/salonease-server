/** A row from the `staff` table. */
export type StaffRow = {
    id: number;
    user_id: number | null;
    first_name: string;
    last_name: string;
    position: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    /** Resized avatar as an image data URL, or null. */
    profile_photo: string | null;
    is_active: number;
};

/** Staff row joined with its login account (username may be null). */
export type StaffWithAccount = StaffRow & {
    username: string | null;
};

export type CreateStaffInput = {
    firstName: string;
    lastName: string;
    position: string | null;
    phone: string | null;
    email: string | null;
    username: string;
    password: string;
};

export type UpdateStaffInput = {
    firstName: string;
    lastName: string;
    position: string | null;
    phone: string | null;
    email: string | null;
};

/** Fields a staff member may edit on their own profile (position is owner-only). */
export type UpdateStaffProfileInput = {
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    profilePhoto: string | null;
};
