CREATE TABLE event_staff_assignments (
    id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id                 BIGINT UNSIGNED NOT NULL,
    staff_id                 BIGINT UNSIGNED NOT NULL,
    role                     ENUM('lead','assistant','makeup','hair','coordinator')
                             NOT NULL DEFAULT 'assistant',
    call_time                DATETIME        NOT NULL,
    release_time             DATETIME        NOT NULL,
    travel_required          TINYINT(1)      NOT NULL DEFAULT 1,
    status                   ENUM('assigned','confirmed','declined','completed','cancelled')
                             NOT NULL DEFAULT 'assigned',
    commission_share_percent DECIMAL(5,2)    NULL,
    notes                    VARCHAR(255)    NULL,
    created_at               TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_event_staff_assignments (event_id, staff_id),
    KEY idx_event_staff_assignments_staff_time (staff_id, call_time),
    KEY idx_event_staff_assignments_event_status (event_id, status),

    CONSTRAINT fk_event_staff_assignments_event FOREIGN KEY (event_id) REFERENCES events(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_event_staff_assignments_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_event_staff_assignments_range CHECK (release_time >= call_time),
    CONSTRAINT chk_event_staff_assignments_share CHECK
        (commission_share_percent IS NULL OR
         (commission_share_percent >= 0 AND commission_share_percent <= 100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
