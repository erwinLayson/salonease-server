-- staff_schedules: regular weekly working hours, one row per working block.
CREATE TABLE staff_schedules (
    id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    staff_id   BIGINT UNSIGNED  NOT NULL,
    weekday    TINYINT UNSIGNED NOT NULL,   -- 0 = Sunday .. 6 = Saturday
    start_time TIME             NOT NULL,
    end_time   TIME             NOT NULL,
    is_active  TINYINT(1)       NOT NULL DEFAULT 1,
    created_at TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP        NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_staff_schedule_block (staff_id, weekday, start_time),
    KEY idx_staff_schedules_staff (staff_id),
    CONSTRAINT fk_staff_schedules_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_staff_schedules_weekday CHECK (weekday BETWEEN 0 AND 6),
    CONSTRAINT chk_staff_schedules_time    CHECK (end_time > start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
