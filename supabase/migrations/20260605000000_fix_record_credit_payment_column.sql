-- Fix typo: INSERT used column name "collected_name" which does not exist.
-- The correct column is "collected_by_name".

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
  v_cash  := COALESCE(p_cash_amount,  CASE WHEN p_payment_method = 'cash'  THEN p_amount ELSE 0 END);
  v_mpesa := COALESCE(p_mpesa_amount, CASE WHEN p_payment_method = 'mpesa' THEN p_amount ELSE 0 END);

  INSERT INTO shop_credit_payments (
    credit_sale_id, shop_id, owner_id, amount, payment_method,
    cash_amount, mpesa_amount, mpesa_ref, collected_by_name
  ) VALUES (
    p_credit_sale_id, p_shop_id, p_owner_id, p_amount, p_payment_method,
    v_cash, v_mpesa, p_mpesa_ref, p_collected_by_name
  );

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
