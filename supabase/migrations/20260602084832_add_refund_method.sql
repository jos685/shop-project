ALTER TABLE transaction_returns
  ADD COLUMN IF NOT EXISTS refund_method text;
