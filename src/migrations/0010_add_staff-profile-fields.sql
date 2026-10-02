-- staff self-service profile: mailing address and an optional avatar stored as a
-- resized image data URL (kept in the DB so no external file storage is needed).
ALTER TABLE staff
    ADD COLUMN address       VARCHAR(255) NULL AFTER email,
    ADD COLUMN profile_photo MEDIUMTEXT   NULL AFTER address;
