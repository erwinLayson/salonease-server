CREATE TABLE event_supplies (
    id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id           BIGINT UNSIGNED NOT NULL,
    supply_id          BIGINT UNSIGNED NOT NULL,
    planned_quantity   DECIMAL(12,3)   NOT NULL DEFAULT 0,
    issued_quantity    DECIMAL(12,3)   NOT NULL DEFAULT 0,
    returned_quantity  DECIMAL(12,3)   NOT NULL DEFAULT 0,
    consumed_quantity  DECIMAL(12,3)   NOT NULL DEFAULT 0,
    status             ENUM('planned','issued','returned','consumed','short')
                       NOT NULL DEFAULT 'planned',
    created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_event_supplies (event_id, supply_id),
    KEY idx_event_supplies_supply (supply_id),

    CONSTRAINT fk_event_supplies_event FOREIGN KEY (event_id) REFERENCES events(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_event_supplies_supply FOREIGN KEY (supply_id) REFERENCES supplies(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_event_supplies_planned CHECK (planned_quantity >= 0),
    CONSTRAINT chk_event_supplies_issued CHECK (issued_quantity >= 0),
    CONSTRAINT chk_event_supplies_returned CHECK (returned_quantity >= 0),
    CONSTRAINT chk_event_supplies_consumed CHECK (consumed_quantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
