-- appointments: a booked service for a customer with a staff member.
--
--   start_at      = appointment start
--   end_at        = start + service duration
--   buffer_end_at = end_at + configured buffer time  (used for overlap checks)
--
-- Double-booking protection (defence in depth):
--   1. Application/transaction layer locks the staff row (SELECT ... FOR UPDATE)
--      and re-checks overlap before inserting.
--   2. active_staff_id / active_start_at are generated columns that are NULL for
--      inactive statuses, so the unique key uq_appointments_active_slot blocks two
--      ACTIVE appointments for the same staff member at the same start time while
--      still allowing many cancelled/completed rows at that time.
--
-- NOTE: staff_id is the base column of the STORED generated column active_staff_id,
-- and MySQL 8 / TiDB forbid a foreign key on the base column of a stored generated
-- column from using CASCADE, SET NULL, or SET DEFAULT referential actions
-- ("Cannot add foreign key constraint", errno 1215). fk_appointments_staff therefore
-- uses ON UPDATE RESTRICT. This is safe — staff ids are auto-increment and never
-- updated — and MariaDB does not enforce the rule, so it never surfaced locally.
CREATE TABLE appointments (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reference       CHAR(12)        NOT NULL,             -- short public reference, e.g. "APT-8F3K9Q"
    manage_token    CHAR(64)        NOT NULL,             -- unguessable token for the customer's manage link
    customer_id     BIGINT UNSIGNED NOT NULL,
    staff_id        BIGINT UNSIGNED NOT NULL,
    service_id      BIGINT UNSIGNED NOT NULL,
    start_at        DATETIME        NOT NULL,
    end_at          DATETIME        NOT NULL,
    buffer_end_at   DATETIME        NOT NULL,
    price           DECIMAL(10,2)   NOT NULL DEFAULT 0.00, -- snapshot of service price at booking time
    status          ENUM('pending','confirmed','completed','cancelled','no_show') NOT NULL DEFAULT 'pending',
    source          ENUM('online','manual') NOT NULL DEFAULT 'online',
    notes           TEXT            NULL,
    created_by      BIGINT UNSIGNED NULL,                 -- users.id when booked manually by the owner
    cancelled_at    DATETIME        NULL,
    cancelled_reason VARCHAR(255)   NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    active_staff_id BIGINT UNSIGNED GENERATED ALWAYS AS
        (CASE WHEN status IN ('pending','confirmed') THEN staff_id ELSE NULL END) STORED,
    active_start_at DATETIME GENERATED ALWAYS AS
        (CASE WHEN status IN ('pending','confirmed') THEN start_at ELSE NULL END) STORED,

    PRIMARY KEY (id),
    UNIQUE KEY uq_appointments_reference (reference),
    UNIQUE KEY uq_appointments_manage_token (manage_token),
    UNIQUE KEY uq_appointments_active_slot (active_staff_id, active_start_at),
    KEY idx_appointments_staff_start (staff_id, start_at),
    KEY idx_appointments_start (start_at),
    KEY idx_appointments_status (status),
    KEY idx_appointments_customer (customer_id),
    CONSTRAINT fk_appointments_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_appointments_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_appointments_service FOREIGN KEY (service_id) REFERENCES services(id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_appointments_created_by FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_appointments_range CHECK (end_at > start_at),
    CONSTRAINT chk_appointments_buffer CHECK (buffer_end_at >= end_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
