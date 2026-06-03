-- MIGRATION — New RPC: get_shop_credit_payments_all
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
    CASE WHEN cp.payment_method = 'cash'  THEN cp.amount ELSE 0 END AS cash_amount,
    CASE WHEN cp.payment_method = 'mpesa' THEN cp.amount ELSE 0 END AS mpesa_amount,
    cp.mpesa_ref,
    cs.customer_name,
    cs.customer_phone,
    cp.created_at
  FROM shop_credit_payments cp
  JOIN shop_credit_sales cs ON cs.id = cp.credit_sale_id
  WHERE cs.shop_id = p_shop_id
  ORDER BY cp.created_at DESC;
$$;
