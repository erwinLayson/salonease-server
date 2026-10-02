-- notifications: one row per notification attempt (confirmation, reminder,
-- cancellation, reschedule) with its delivery status.
CREATE TABLE notifications (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    appointment_id BIGINT UNSIGNED NULL,
    customer_id    BIGINT UNSIGNED NULL,
    type           ENUM('confirmation','reminder','cancellation','reschedule') NOT NULL,
    recipient_type ENUM('customer','staff','owner') NOT NULL DEFAULT 'customer',
    channel        ENUM('email','sms') NOT NULL,
    to_address     VARCHAR(190)    NOT NULL,
    subject        VARCHAR(190)    NULL,
    body           TEXT            NOT NULL,
    status         ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
    error_message  VARCHAR(255)    NULL,
    sent_at        DATETIME        NULL,
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_notifications_appointment (appointment_id),
    KEY idx_notifications_status (status),
    CONSTRAINT fk_notifications_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_notifications_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
