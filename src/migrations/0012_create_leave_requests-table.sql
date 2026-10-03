-- leave_requests: staff-submitted time-off requests on an approval workflow.
--
--   pending   -> awaiting an owner decision. Does NOT affect availability.
--   approved  -> the owner approved it; a linked schedule_exceptions row
--                (type 'leave') blocks the requested dates for that staff.
--   rejected  -> the owner declined it; decision_note holds the optional reason.
--   cancelled -> withdrawn by the staff member while still pending, or an
--                approved leave undone by the owner.
--
-- Only approved leave blocks availability, and only because it materialises a
-- schedule_exceptions row that the availability engine already honours.

CREATE TABLE leave_requests (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    staff_id      BIGINT UNSIGNED NOT NULL,
    start_date    DATE         NOT NULL,
    end_date      DATE         NOT NULL,
    reason        VARCHAR(255) NULL,                       -- optional staff reason
    status        ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
    decision_note VARCHAR(255) NULL,                       -- optional owner note (e.g. reject reason)
    decided_by    BIGINT UNSIGNED NULL,                    -- the owner who decided
    decided_at    DATETIME     NULL,
    exception_id  BIGINT UNSIGNED NULL,                    -- schedule_exceptions row created on approval
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_leave_requests_staff_status (staff_id, status),
    KEY idx_leave_requests_status_dates (status, start_date, end_date),
    KEY idx_leave_requests_created_at (created_at),

    CONSTRAINT fk_leave_requests_staff FOREIGN KEY (staff_id) REFERENCES staff(id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_leave_requests_decided_by FOREIGN KEY (decided_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_leave_requests_exception FOREIGN KEY (exception_id) REFERENCES schedule_exceptions(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_leave_requests_range CHECK (end_date >= start_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
