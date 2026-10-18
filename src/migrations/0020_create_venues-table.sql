CREATE TABLE venues (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name           VARCHAR(160)    NOT NULL,
    address        VARCHAR(255)    NOT NULL,
    contact_name   VARCHAR(120)    NULL,
    contact_phone  VARCHAR(30)     NULL,
    notes          VARCHAR(255)    NULL,
    is_active      TINYINT(1)      NOT NULL DEFAULT 1,
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_venues_name (name),
    KEY idx_venues_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
