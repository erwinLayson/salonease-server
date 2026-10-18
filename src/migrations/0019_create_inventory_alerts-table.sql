-- inventory_alerts: one open alert per supply. The generated column is NULL
-- once the alert is resolved, so a new low-stock event can create a fresh row.
CREATE TABLE inventory_alerts (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    supply_id         BIGINT UNSIGNED NOT NULL,
    alert_type        ENUM('low_stock','out_of_stock') NOT NULL,
    status            ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
    current_quantity  DECIMAL(12,3)   NOT NULL,
    reorder_level     DECIMAL(12,3)   NOT NULL,
    acknowledged_by   BIGINT UNSIGNED NULL,
    acknowledged_at   DATETIME        NULL,
    resolved_at       DATETIME        NULL,
    notes             VARCHAR(255)    NULL,
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    open_supply_id BIGINT UNSIGNED GENERATED ALWAYS AS
        (CASE WHEN status IN ('open','acknowledged') THEN supply_id ELSE NULL END) STORED,

    PRIMARY KEY (id),
    UNIQUE KEY uq_inventory_alerts_open_supply (open_supply_id),
    KEY idx_inventory_alerts_status (status),
    KEY idx_inventory_alerts_supply (supply_id),

    CONSTRAINT fk_inventory_alerts_supply FOREIGN KEY (supply_id) REFERENCES supplies(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_inventory_alerts_acknowledged_by FOREIGN KEY (acknowledged_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
