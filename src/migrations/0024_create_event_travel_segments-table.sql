CREATE TABLE event_travel_segments (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id    BIGINT UNSIGNED NOT NULL,
    staff_id    BIGINT UNSIGNED NULL,
    sequence    SMALLINT UNSIGNED NOT NULL,
    from_label  VARCHAR(160)    NOT NULL,
    to_label    VARCHAR(160)    NOT NULL,
    depart_at   DATETIME        NOT NULL,
    arrive_at   DATETIME        NOT NULL,
    mode        ENUM('own_vehicle','ride_hailing','van','public','other')
                NOT NULL DEFAULT 'other',
    notes       VARCHAR(255)    NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_event_travel_segments (event_id, staff_id, sequence),
    KEY idx_event_travel_segments_event (event_id, sequence),
    KEY idx_event_travel_segments_staff (staff_id),

    CONSTRAINT fk_event_travel_segments_event FOREIGN KEY (event_id) REFERENCES events(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_event_travel_segments_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_event_travel_segments_range CHECK (arrive_at >= depart_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
