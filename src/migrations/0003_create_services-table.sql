-- services: bookable salon services with price and duration.
CREATE TABLE services (
    id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    name             VARCHAR(120)     NOT NULL,
    description      TEXT             NULL,
    price            DECIMAL(10,2)    NOT NULL DEFAULT 0.00,
    duration_minutes SMALLINT UNSIGNED NOT NULL,
    is_active        TINYINT(1)       NOT NULL DEFAULT 1,
    created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP        NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_services_name (name),
    KEY idx_services_active (is_active),
    CONSTRAINT chk_services_price    CHECK (price >= 0),
    CONSTRAINT chk_services_duration CHECK (duration_minutes > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
