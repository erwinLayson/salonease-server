CREATE TABLE commission_entries (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    source_type     ENUM('appointment','event') NOT NULL,
    source_id       BIGINT UNSIGNED NOT NULL,
    transaction_id  BIGINT UNSIGNED NULL,
    event_id        BIGINT UNSIGNED NULL,
    staff_id        BIGINT UNSIGNED NOT NULL,
    service_id      BIGINT UNSIGNED NULL,
    base_amount     DECIMAL(10,2)   NOT NULL,
    rate_type       ENUM('percent','fixed') NOT NULL,
    rate_value      DECIMAL(10,4)   NOT NULL,
    commission_amount DECIMAL(10,2) NOT NULL,
    status          ENUM('accrued','approved','paid','void') NOT NULL DEFAULT 'accrued',
    payout_id       BIGINT UNSIGNED NULL,
    accrued_at      DATETIME        NOT NULL,
    notes           VARCHAR(255)    NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_commission_entries_source_staff (source_type, source_id, staff_id),
    KEY idx_commission_entries_staff_date (staff_id, accrued_at),
    KEY idx_commission_entries_status (status),
    KEY idx_commission_entries_payout (payout_id),

    CONSTRAINT fk_commission_entries_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_commission_entries_event FOREIGN KEY (event_id) REFERENCES events(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_commission_entries_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_commission_entries_service FOREIGN KEY (service_id) REFERENCES services(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_commission_entries_base CHECK (base_amount >= 0),
    CONSTRAINT chk_commission_entries_amount CHECK (commission_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
