CREATE TABLE events (
    id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reference              VARCHAR(20)     NOT NULL,
    customer_id            BIGINT UNSIGNED NOT NULL,
    venue_id               BIGINT UNSIGNED NULL,
    title                  VARCHAR(160)    NOT NULL,
    event_type             ENUM('wedding','debut','corporate','photoshoot','other')
                           NOT NULL DEFAULT 'other',
    event_date             DATE            NOT NULL,
    start_at               DATETIME        NOT NULL,
    end_at                 DATETIME        NOT NULL,
    status                 ENUM('inquiry','confirmed','in_progress','completed','cancelled')
                           NOT NULL DEFAULT 'inquiry',
    travel_buffer_minutes  SMALLINT UNSIGNED NOT NULL DEFAULT 60,
    notes                  TEXT            NULL,
    created_by             BIGINT UNSIGNED NULL,
    created_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_events_reference (reference),
    KEY idx_events_date_status (event_date, status),
    KEY idx_events_customer (customer_id),
    KEY idx_events_venue (venue_id),

    CONSTRAINT fk_events_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_events_venue FOREIGN KEY (venue_id) REFERENCES venues(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_events_created_by FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_events_range CHECK (end_at > start_at),
    CONSTRAINT chk_events_travel_buffer CHECK (travel_buffer_minutes >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
