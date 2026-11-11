-- Service image for catalog, booking and owner views.
-- Stored as a resized base64 image data URL in MEDIUMTEXT.
ALTER TABLE services
    ADD COLUMN image MEDIUMTEXT NULL AFTER category;

