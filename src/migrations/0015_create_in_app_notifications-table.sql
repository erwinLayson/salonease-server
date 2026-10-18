-- in_app_notifications: operational alerts shown inside the admin UI.
-- Customer email/SMS notifications remain in the existing `notifications` table.
CREATE TABLE in_app_notifications (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     BIGINT UNSIGNED NOT NULL,
    type        ENUM('low_stock','event_assigned','event_changed','commission_ready','system')
                NOT NULL DEFAULT 'system',
    severity    ENUM('info','warning','critical') NOT NULL DEFAULT 'info',
    title       VARCHAR(190)    NOT NULL,
    body        TEXT            NOT NULL,
    link        VARCHAR(255)    NULL,
    read_at     DATETIME        NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_in_app_notifications_user_read (user_id, read_at),
    KEY idx_in_app_notifications_type_created (type, created_at),

    CONSTRAINT fk_in_app_notifications_user FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
