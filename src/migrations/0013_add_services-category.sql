-- Service taxonomy. Used by commission rules, event filtering and reports.
-- One ALTER operation only: TiDB rejects multi-operation ALTER TABLE statements.
ALTER TABLE services
    ADD COLUMN category ENUM('hair','makeup','nails','skin','bridal','event','package','other')
        NOT NULL DEFAULT 'other' AFTER description;
