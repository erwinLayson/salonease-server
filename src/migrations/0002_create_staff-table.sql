-- staff: salon staff profiles. A staff member optionally has a login account
-- (users.role = 'staff'); user_id is NULL for staff without a login.
--
-- The self-service profile fields live in this CREATE TABLE rather than being
-- added by later ALTER TABLE statements: TiDB rejects a single ALTER that
-- performs several column operations, so the full staff shape is created at
-- once. profile_photo stores a resized image data URL (kept in the DB so no
-- external file storage is needed).
CREATE TABLE staff (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id       BIGINT UNSIGNED NULL,
    first_name    VARCHAR(80)     NOT NULL,
    last_name     VARCHAR(80)     NOT NULL,
    position      VARCHAR(80)     NULL,
    phone         VARCHAR(30)     NULL,
    email         VARCHAR(150)    NULL,
    address       VARCHAR(255)    NULL,
    profile_photo MEDIUMTEXT      NULL,
    is_active     TINYINT(1)      NOT NULL DEFAULT 1,
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_staff_user (user_id),
    KEY idx_staff_active (is_active),
    CONSTRAINT fk_staff_user FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
