-- walk_in_queue: one row per walk-in ticket for a business date.
--
-- Tickets are numbered per day. A ticket can be converted into a normal
-- appointment (appointment_id) without losing the queue audit trail.
CREATE TABLE walk_in_queue (
    id                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    queue_date              DATE            NOT NULL,
    ticket_number           INT UNSIGNED    NOT NULL,
    customer_name           VARCHAR(160)    NOT NULL,
    customer_phone          VARCHAR(30)     NULL,
    service_id              BIGINT UNSIGNED NOT NULL,
    preferred_staff_id      BIGINT UNSIGNED NULL,
    assigned_staff_id       BIGINT UNSIGNED NULL,
    status                  ENUM('waiting','called','in_service','completed','cancelled','no_show')
                            NOT NULL DEFAULT 'waiting',
    checked_in_at           DATETIME        NOT NULL,
    called_at               DATETIME        NULL,
    started_at              DATETIME        NULL,
    completed_at            DATETIME        NULL,
    estimated_wait_minutes  SMALLINT UNSIGNED NULL,
    appointment_id          BIGINT UNSIGNED NULL,
    notes                   VARCHAR(255)    NULL,
    created_by              BIGINT UNSIGNED NULL,
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_walk_in_queue_ticket (queue_date, ticket_number),
    KEY idx_walk_in_queue_date_status (queue_date, status),
    KEY idx_walk_in_queue_staff_date (assigned_staff_id, queue_date),
    KEY idx_walk_in_queue_appointment (appointment_id),

    CONSTRAINT fk_walk_in_queue_service FOREIGN KEY (service_id) REFERENCES services(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_walk_in_queue_preferred_staff FOREIGN KEY (preferred_staff_id) REFERENCES staff(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_walk_in_queue_assigned_staff FOREIGN KEY (assigned_staff_id) REFERENCES staff(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_walk_in_queue_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_walk_in_queue_created_by FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
