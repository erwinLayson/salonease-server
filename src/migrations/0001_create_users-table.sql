-- users: authenticated accounts for the Owner and Staff roles only.
-- Customers never have a users row (they are stored in `customers`).
CREATE TABLE users (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username      VARCHAR(50)     NOT NULL,
    email         VARCHAR(150)    NULL,
    password      VARCHAR(255)    NOT NULL,                       -- bcrypt/argon2 hash, never plaintext
    role          ENUM('owner','staff') NOT NULL,
    is_active     TINYINT(1)      NOT NULL DEFAULT 1,
    last_login_at TIMESTAMP       NULL DEFAULT NULL,
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
