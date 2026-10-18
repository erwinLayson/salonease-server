-- supply_movements: immutable stock ledger. Every quantity change is a row.
-- `balance_after` is the stock level immediately after the movement.
CREATE TABLE supply_movements (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    supply_id       BIGINT UNSIGNED NOT NULL,
    movement_type   ENUM('initial','purchase','usage','adjustment','waste','return','event_issue','event_return')
                    NOT NULL,
    quantity_delta  DECIMAL(12,3)   NOT NULL,
    balance_after   DECIMAL(12,3)   NOT NULL,
    unit_cost       DECIMAL(10,2)   NULL,
    reference_type  ENUM('appointment','event','manual','purchase') NULL,
    reference_id    BIGINT UNSIGNED NULL,
    notes           VARCHAR(255)    NULL,
    created_by      BIGINT UNSIGNED NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_supply_movements_reference
        (reference_type, reference_id, supply_id, movement_type),
    KEY idx_supply_movements_supply_created (supply_id, created_at),
    KEY idx_supply_movements_reference (reference_type, reference_id),

    CONSTRAINT fk_supply_movements_supply FOREIGN KEY (supply_id) REFERENCES supplies(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_supply_movements_created_by FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_supply_movements_balance CHECK (balance_after >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
