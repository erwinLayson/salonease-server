ALTER TABLE transactions
    ADD COLUMN event_id BIGINT UNSIGNED NULL AFTER appointment_id;
