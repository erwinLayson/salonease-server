ALTER TABLE transactions
    ADD COLUMN inventory_cost_total DECIMAL(12,2) NOT NULL DEFAULT 0.00
        AFTER commission_total;
