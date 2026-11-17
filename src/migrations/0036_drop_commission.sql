DROP TABLE IF EXISTS commission_entries;
DROP TABLE IF EXISTS commission_payouts;
DROP TABLE IF EXISTS commission_rules;
ALTER TABLE transactions DROP COLUMN commission_total;
ALTER TABLE daily_sales_closures DROP COLUMN commission_total;
ALTER TABLE event_staff_assignments DROP COLUMN commission_share_percent;
