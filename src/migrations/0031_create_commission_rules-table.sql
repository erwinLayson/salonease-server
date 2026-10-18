CREATE TABLE commission_rules (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    staff_id          BIGINT UNSIGNED NULL,
    service_id        BIGINT UNSIGNED NULL,
    service_category  VARCHAR(40)     NULL,
    rate_type         ENUM('percent','fixed') NOT NULL DEFAULT 'percent',
    rate_value        DECIMAL(10,4)   NOT NULL,
    effective_from    DATE            NOT NULL,
    effective_to      DATE            NULL,
    priority          INT             NOT NULL DEFAULT 0,
    is_active         TINYINT(1)      NOT NULL DEFAULT 1,
    notes             VARCHAR(255)    NULL,
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_commission_rules_staff (staff_id, is_active),
    KEY idx_commission_rules_service (service_id, is_active),
    KEY idx_commission_rules_category (service_category, is_active),

    CONSTRAINT fk_commission_rules_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_commission_rules_service FOREIGN KEY (service_id) REFERENCES services(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_commission_rules_rate CHECK (rate_value >= 0),
    CONSTRAINT chk_commission_rules_percent CHECK
        (rate_type <> 'percent' OR rate_value <= 100),
    CONSTRAINT chk_commission_rules_dates CHECK
        (effective_to IS NULL OR effective_to >= effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
