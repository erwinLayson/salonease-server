ALTER TABLE transactions
    ADD UNIQUE KEY uq_transactions_event_id (event_id);
