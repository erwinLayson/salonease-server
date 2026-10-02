-- customers: guests who book online. No login account is ever created.
-- At least one contact detail (phone or email) is required for notifications.
CREATE TABLE customers (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    first_name VARCHAR(80)     NOT NULL,
    last_name  VARCHAR(80)     NULL,
    phone      VARCHAR(30)     NULL,
    email      VARCHAR(150)    NULL,
    notes      VARCHAR(255)    NULL,
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_customers_phone (phone),
    KEY idx_customers_email (email),
    CONSTRAINT chk_customers_contact CHECK (phone IS NOT NULL OR email IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
