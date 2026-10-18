CREATE TABLE event_services (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id          BIGINT UNSIGNED NOT NULL,
    service_id        BIGINT UNSIGNED NOT NULL,
    quantity          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    price             DECIMAL(10,2)   NOT NULL,
    duration_minutes  SMALLINT UNSIGNED NULL,
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_event_services (event_id, service_id),
    KEY idx_event_services_service (service_id),

    CONSTRAINT fk_event_services_event FOREIGN KEY (event_id) REFERENCES events(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_event_services_service FOREIGN KEY (service_id) REFERENCES services(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_event_services_quantity CHECK (quantity > 0),
    CONSTRAINT chk_event_services_price CHECK (price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
