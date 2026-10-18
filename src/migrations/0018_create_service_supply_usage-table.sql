-- service_supply_usage: how much of each supply a service consumes.
-- A service without rows has no recipe; completion does not deduct stock.
CREATE TABLE service_supply_usage (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service_id            BIGINT UNSIGNED NOT NULL,
    supply_id             BIGINT UNSIGNED NOT NULL,
    quantity_per_service  DECIMAL(12,3)   NOT NULL,
    unit                  VARCHAR(20)     NOT NULL,
    is_active             TINYINT(1)      NOT NULL DEFAULT 1,
    created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_service_supply_usage (service_id, supply_id),
    KEY idx_service_supply_usage_supply (supply_id),

    CONSTRAINT fk_service_supply_usage_service FOREIGN KEY (service_id) REFERENCES services(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_service_supply_usage_supply FOREIGN KEY (supply_id) REFERENCES supplies(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_service_supply_usage_quantity CHECK (quantity_per_service > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
