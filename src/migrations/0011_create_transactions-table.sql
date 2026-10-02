-- transactions: created automatically when an appointment is completed.
--
-- One transaction per completed appointment.
-- payment_method can be updated after creation (e.g. owner records cash later).
-- total equals the appointment price snapshot (subtotal); discounts are not part
-- of the model, so there is no discount column.

CREATE TABLE transactions (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reference       VARCHAR(20)     NOT NULL,          -- e.g. "TXN-20261001-0001"
    appointment_id  BIGINT UNSIGNED NOT NULL,
    customer_id     BIGINT UNSIGNED NOT NULL,
    staff_id        BIGINT UNSIGNED NOT NULL,
    service_id      BIGINT UNSIGNED NOT NULL,
    subtotal        DECIMAL(10,2)   NOT NULL,           -- price snapshot from appointment
    total           DECIMAL(10,2)   NOT NULL,           -- equals subtotal
    payment_method  ENUM('cash','gcash','card','other') NOT NULL DEFAULT 'cash',
    payment_status  ENUM('paid','unpaid','waived')       NOT NULL DEFAULT 'unpaid',
    notes           TEXT            NULL,
    completed_at    DATETIME        NOT NULL,           -- when the appointment was completed
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_transactions_reference       (reference),
    UNIQUE KEY uq_transactions_appointment_id  (appointment_id),    -- one txn per appointment
    KEY idx_transactions_customer   (customer_id),
    KEY idx_transactions_staff      (staff_id),
    KEY idx_transactions_created_at (created_at),
    KEY idx_transactions_payment_status (payment_status),

    CONSTRAINT fk_transactions_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_transactions_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_transactions_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_transactions_service FOREIGN KEY (service_id) REFERENCES services(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_transactions_subtotal  CHECK (subtotal  >= 0),
    CONSTRAINT chk_transactions_total     CHECK (total     >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
