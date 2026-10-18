-- supplies: salon chemicals, tools, retail items and event kits.
CREATE TABLE supplies (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    sku               VARCHAR(60)     NOT NULL,
    name              VARCHAR(160)    NOT NULL,
    category          ENUM('chemical','tool','event_kit','retail','other') NOT NULL DEFAULT 'other',
    unit              VARCHAR(20)     NOT NULL,
    current_quantity  DECIMAL(12,3)   NOT NULL DEFAULT 0,
    reorder_level     DECIMAL(12,3)   NOT NULL DEFAULT 0,
    unit_cost         DECIMAL(10,2)   NULL,
    supplier          VARCHAR(160)    NULL,
    notes             VARCHAR(255)    NULL,
    is_active         TINYINT(1)      NOT NULL DEFAULT 1,
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_supplies_sku (sku),
    KEY idx_supplies_active (is_active),
    KEY idx_supplies_category (category),
    CONSTRAINT chk_supplies_quantity CHECK (current_quantity >= 0),
    CONSTRAINT chk_supplies_reorder CHECK (reorder_level >= 0),
    CONSTRAINT chk_supplies_cost CHECK (unit_cost IS NULL OR unit_cost >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
