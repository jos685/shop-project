-- ============================================================
-- MIGRATION — Fix split payment tracking across all tables
-- ============================================================

-- ── 1. transaction_returns: add refund split columns ────────
ALTER TABLE transaction_returns
  ADD COLUMN IF NOT EXISTS refund_cash_amount  NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_mpesa_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_payment_method TEXT;

-- Back-fill from existing refund_method (POS rows) or refund_payment_method
UPDATE transaction_returns SET
  refund_payment_method = COALESCE(refund_payment_method, refund_method),
  refund_cash_amount  = CASE WHEN COALESCE(refund_payment_method, refund_method) = 'cash'  THEN amount_refunded ELSE 0 END,
  refund_mpesa_amount = CASE WHEN COALESCE(refund_payment_method, refund_method) = 'mpesa' THEN amount_refunded ELSE 0 END
WHERE refund_cash_amount = 0 AND refund_mpesa_amount = 0
  AND COALESCE(refund_payment_method, refund_method) IN ('cash', 'mpesa');

-- ── 2. Update insert_transaction_returns RPC ─────────────────
CREATE OR REPLACE FUNCTION insert_transaction_returns(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  v_refund_method text;
  v_amount_refunded numeric;
  v_cash  numeric;
  v_mpesa numeric;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_refund_method   := COALESCE(r->>'refund_payment_method', r->>'refund_method');
    v_amount_refunded := (r->>'amount_refunded')::numeric;

    -- Derive split breakdown if not explicitly provided
    v_cash  := COALESCE(
      NULLIF((r->>'refund_cash_amount')::numeric, 0),
      CASE WHEN v_refund_method = 'cash'  THEN v_amount_refunded ELSE 0 END
    );
    v_mpesa := COALESCE(
      NULLIF((r->>'refund_mpesa_amount')::numeric, 0),
      CASE WHEN v_refund_method = 'mpesa' THEN v_amount_refunded ELSE 0 END
    );

    INSERT INTO transaction_returns (
      owner_id, source, original_transaction_id, shop_id, agent_id,
      product_id, product_name, quantity_returned, unit_price, amount_refunded,
      reason, actor_name, actor_code,
      refund_method, refund_payment_method,
      refund_cash_amount, refund_mpesa_amount
    ) VALUES (
      (r->>'owner_id')::uuid,
      r->>'source',
      (r->>'original_transaction_id')::uuid,
      (r->>'shop_id')::uuid,
      (r->>'agent_id')::uuid,
      (r->>'product_id')::uuid,
      r->>'product_name',
      (r->>'quantity_returned')::integer,
      (r->>'unit_price')::numeric,
      v_amount_refunded,
      r->>'reason',
      r->>'actor_name',
      r->>'actor_code',
      v_refund_method,
      v_refund_method,
      v_cash,
      v_mpesa
    );
  END LOOP;
END;
$$;

-- ── 3. shop_credit_payments: add cash/mpesa columns ─────────
ALTER TABLE shop_credit_payments
  ADD COLUMN IF NOT EXISTS cash_amount  NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mpesa_amount NUMERIC NOT NULL DEFAULT 0;

-- Back-fill existing rows
UPDATE shop_credit_payments SET
  cash_amount  = CASE WHEN payment_method = 'cash'  THEN amount ELSE 0 END,
  mpesa_amount = CASE WHEN payment_method = 'mpesa' THEN amount ELSE 0 END
WHERE cash_amount = 0 AND mpesa_amount = 0
  AND payment_method IN ('cash', 'mpesa');

-- ── 4. Update record_credit_payment RPC ──────────────────────
-- Drop all existing overloads first
DROP FUNCTION IF EXISTS record_credit_payment(uuid, uuid, uuid, numeric, text, text, text, text);
DROP FUNCTION IF EXISTS record_credit_payment(uuid, uuid, uuid, numeric, text, text, text, text, numeric, numeric);

CREATE OR REPLACE FUNCTION record_credit_payment(
  p_credit_sale_id        uuid,
  p_shop_id               uuid,
  p_owner_id              uuid,
  p_amount                numeric,
  p_payment_method        text,
  p_mpesa_ref             text    DEFAULT NULL,
  p_collected_by_agent_id text    DEFAULT NULL,
  p_collected_by_name     text    DEFAULT NULL,
  p_cash_amount           numeric DEFAULT NULL,
  p_mpesa_amount          numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash  numeric;
  v_mpesa numeric;
  v_old_amount_paid numeric;
  v_total_amount    numeric;
  v_new_paid        numeric;
  v_new_status      text;
BEGIN
  -- Derive cash/mpesa split if not explicitly provided
  v_cash  := COALESCE(p_cash_amount,  CASE WHEN p_payment_method = 'cash'  THEN p_amount ELSE 0 END);
  v_mpesa := COALESCE(p_mpesa_amount, CASE WHEN p_payment_method = 'mpesa' THEN p_amount ELSE 0 END);

  INSERT INTO shop_credit_payments (
    credit_sale_id, shop_id, owner_id, amount, payment_method,
    cash_amount, mpesa_amount, mpesa_ref, collected_name
  ) VALUES (
    p_credit_sale_id, p_shop_id, p_owner_id, p_amount, p_payment_method,
    v_cash, v_mpesa, p_mpesa_ref, p_collected_by_name
  );

  -- Update amount_paid and status on shop_credit_sales
  SELECT amount_paid, amount
    INTO v_old_amount_paid, v_total_amount
    FROM shop_credit_sales
    WHERE id = p_credit_sale_id;

  v_new_paid   := COALESCE(v_old_amount_paid, 0) + p_amount;
  v_new_status := CASE
    WHEN v_new_paid >= v_total_amount - 0.01 THEN 'paid'
    WHEN v_new_paid > 0                       THEN 'partial'
    ELSE 'pending'
  END;

  UPDATE shop_credit_sales
    SET amount_paid = v_new_paid, status = v_new_status
    WHERE id = p_credit_sale_id;
END;
$$;

-- ── 5. Update get_transaction_returns to return refund split columns ──
CREATE OR REPLACE FUNCTION get_transaction_returns(p_transaction_ids uuid[])
RETURNS TABLE (
  id                      uuid,
  original_transaction_id uuid,
  product_id              uuid,
  product_name            text,
  quantity_returned       integer,
  unit_price              numeric,
  amount_refunded         numeric,
  reason                  text,
  created_at              timestamptz,
  refund_method           text,
  refund_cash_amount      numeric,
  refund_mpesa_amount     numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id,
    original_transaction_id,
    product_id,
    product_name,
    quantity_returned,
    unit_price,
    amount_refunded,
    reason,
    created_at,
    COALESCE(refund_payment_method, refund_method)  AS refund_method,
    COALESCE(refund_cash_amount,  0)                AS refund_cash_amount,
    COALESCE(refund_mpesa_amount, 0)                AS refund_mpesa_amount
  FROM transaction_returns
  WHERE original_transaction_id = ANY(p_transaction_ids)
  ORDER BY created_at DESC;
$$;

-- ── 6. Update get_shop_credit_payments_all to use stored values ──
CREATE OR REPLACE FUNCTION get_shop_credit_payments_all(p_shop_id uuid)
RETURNS TABLE (
  id             uuid,
  credit_sale_id uuid,
  amount         numeric,
  payment_method text,
  cash_amount    numeric,
  mpesa_amount   numeric,
  mpesa_ref      text,
  customer_name  text,
  customer_phone text,
  created_at     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cp.id,
    cp.credit_sale_id,
    cp.amount,
    cp.payment_method,
    cp.cash_amount,
    cp.mpesa_amount,
    cp.mpesa_ref,
    cs.customer_name,
    cs.customer_phone,
    cp.created_at
  FROM shop_credit_payments cp
  JOIN shop_credit_sales cs ON cs.id = cp.credit_sale_id
  WHERE cs.shop_id = p_shop_id
  ORDER BY cp.created_at DESC;
$$;
