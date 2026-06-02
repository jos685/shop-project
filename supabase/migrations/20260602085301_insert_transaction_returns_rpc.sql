-- SECURITY DEFINER function to insert transaction_returns rows.
-- Bypasses RLS so shop agents (no Supabase auth session) can record returns.
CREATE OR REPLACE FUNCTION insert_transaction_returns(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO transaction_returns (
    owner_id,
    source,
    original_transaction_id,
    shop_id,
    agent_id,
    product_id,
    product_name,
    quantity_returned,
    unit_price,
    amount_refunded,
    reason,
    actor_name,
    actor_code,
    refund_method
  )
  SELECT
    (r->>'owner_id')::uuid,
    r->>'source',
    (r->>'original_transaction_id')::uuid,
    (r->>'shop_id')::uuid,
    r->>'agent_id',
    (r->>'product_id')::uuid,
    r->>'product_name',
    (r->>'quantity_returned')::integer,
    (r->>'unit_price')::numeric,
    (r->>'amount_refunded')::numeric,
    r->>'reason',
    r->>'actor_name',
    r->>'actor_code',
    r->>'refund_method'
  FROM jsonb_array_elements(p_rows) AS r;
END;
$$;
