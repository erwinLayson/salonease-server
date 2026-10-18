CREATE TABLE commission_payouts (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    staff_id        BIGINT UNSIGNED NOT NULL,
    period_start    DATE            NOT NULL,
    period_end      DATE            NOT NULL,
    total_amount    DECIMAL(12,2)   NOT NULL DEFAULT 0,
    status          ENUM('draft','approved','paid','void') NOT NULL DEFAULT 'draft',
    payment_method  ENUM('cash','gcash','card','other') NULL,
    paid_at         DATETIME        NULL,
    notes           VARCHAR(255)    NULL,
    created_by      BIGINT UNSIGNED NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_commission_payouts_period (staff_id, period_start, period_end),
    KEY idx_commission_payouts_status (status),

    CONSTRAINT fk_commission_payouts_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_commission_payouts_created_by FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_commission_payouts_period CHECK (period_end >= period_start),
    CONSTRAINT chk_commission_payouts_total CHECK (total_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
