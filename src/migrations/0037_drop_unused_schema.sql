DROP TABLE IF EXISTS notifications;
ALTER TABLE customers DROP COLUMN notes;
ALTER TABLE in_app_notifications MODIFY type ENUM('low_stock','event_assigned','event_changed','system') NOT NULL DEFAULT 'system';
