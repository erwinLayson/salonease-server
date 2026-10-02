-- Discounts are not used: services have no discount field.
-- DROP CONSTRAINT works on both MariaDB and MySQL 8.
ALTER TABLE transactions DROP CONSTRAINT chk_transactions_discount;
ALTER TABLE transactions DROP COLUMN discount;
