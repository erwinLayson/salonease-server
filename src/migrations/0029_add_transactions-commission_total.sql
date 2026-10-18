ALTER TABLE transactions
    ADD COLUMN commission_total DECIMAL(12,2) NOT NULL DEFAULT 0.00
        AFTER total;
