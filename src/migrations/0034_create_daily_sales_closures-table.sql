CREATE TABLE daily_sales_closures (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    business_date         DATE            NOT NULL,
    gross_sales           DECIMAL(12,2)   NOT NULL DEFAULT 0,
    discounts             DECIMAL(12,2)   NOT NULL DEFAULT 0,
    net_sales             DECIMAL(12,2)   NOT NULL DEFAULT 0,
    paid_total            DECIMAL(12,2)   NOT NULL DEFAULT 0,
    unpaid_total          DECIMAL(12,2)   NOT NULL DEFAULT 0,
    waived_total          DECIMAL(12,2)   NOT NULL DEFAULT 0,
    cash_total            DECIMAL(12,2)   NOT NULL DEFAULT 0,
    gcash_total           DECIMAL(12,2)   NOT NULL DEFAULT 0,
    card_total            DECIMAL(12,2)   NOT NULL DEFAULT 0,
    other_total           DECIMAL(12,2)   NOT NULL DEFAULT 0,
    commission_total      DECIMAL(12,2)   NOT NULL DEFAULT 0,
    inventory_cost_total  DECIMAL(12,2)   NOT NULL DEFAULT 0,
    transaction_count     INT UNSIGNED    NOT NULL DEFAULT 0,
    cash_counted          DECIMAL(12,2)   NULL,
    cash_variance         DECIMAL(12,2)   NULL,
    status                ENUM('open','closed','reopened') NOT NULL DEFAULT 'open',
    notes                 VARCHAR(255)    NULL,
    closed_by             BIGINT UNSIGNED NULL,
    closed_at             DATETIME        NULL,
    reopened_by           BIGINT UNSIGNED NULL,
    reopened_at           DATETIME        NULL,
    reopen_reason         VARCHAR(255)    NULL,
    created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP       NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_daily_sales_closures_date (business_date),
    KEY idx_daily_sales_closures_status (status),

    CONSTRAINT fk_daily_sales_closures_closed_by FOREIGN KEY (closed_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_daily_sales_closures_reopened_by FOREIGN KEY (reopened_by) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_daily_sales_closures_totals CHECK
        (gross_sales >= 0 AND net_sales >= 0 AND paid_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
