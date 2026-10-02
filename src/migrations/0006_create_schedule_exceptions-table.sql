-- schedule_exceptions: date-specific overrides of regular working hours.
--   staff_id NULL  => salon-wide closure (affects all staff)
--   type 'leave'   => staff leave / time-off
--   type 'closure' => salon closed
CREATE TABLE schedule_exceptions (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    staff_id   BIGINT UNSIGNED NULL,
    type       ENUM('leave','closure') NOT NULL,
    start_at   DATETIME        NOT NULL,
    end_at     DATETIME        NOT NULL,
    reason     VARCHAR(255)    NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_exceptions_staff_time (staff_id, start_at, end_at),
    KEY idx_exceptions_time (start_at, end_at),
    CONSTRAINT fk_exceptions_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_exceptions_created_by FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_exceptions_range CHECK (end_at > start_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
