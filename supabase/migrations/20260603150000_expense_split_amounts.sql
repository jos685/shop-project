-- MIGRATION — Add cash_amount / mpesa_amount to shop_expenses
-- Safe to run multiple times.

-- 1. Add columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='shop_expenses' AND column_name='cash_amount') THEN
    ALTER TABLE shop_expenses ADD COLUMN cash_amount NUMERIC NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='shop_expenses' AND column_name='mpesa_amount') THEN
    ALTER TABLE shop_expenses ADD COLUMN mpesa_amount NUMERIC NOT NULL DEFAULT 0;
  END IF;
END;
$$;

-- 2. Back-fill existing rows
UPDATE shop_expenses SET
  cash_amount  = CASE WHEN payment_method = 'cash'  THEN amount ELSE 0 END,
  mpesa_amount = CASE WHEN payment_method = 'mpesa' THEN amount ELSE 0 END
WHERE cash_amount = 0 AND mpesa_amount = 0;

-- 3. Drop ALL overloads of insert_shop_expense (old uuid version + any partial new one)
DROP FUNCTION IF EXISTS insert_shop_expense(uuid, uuid, numeric, text, uuid, text, text);
DROP FUNCTION IF EXISTS insert_shop_expense(uuid, uuid, numeric, text, text, text, text);
DROP FUNCTION IF EXISTS insert_shop_expense(uuid, uuid, numeric, text, uuid, text, text, numeric, numeric);
DROP FUNCTION IF EXISTS insert_shop_expense(uuid, uuid, numeric, text, text, text, text, numeric, numeric);

CREATE FUNCTION insert_shop_expense(
  p_shop_id        uuid,
  p_owner_id       uuid,
  p_amount         numeric,
  p_description    text,
  p_logged_by      uuid,
  p_logged_by_name text,
  p_payment_method text    DEFAULT 'cash',
  p_cash_amount    numeric DEFAULT NULL,
  p_mpesa_amount   numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash  numeric;
  v_mpesa numeric;
BEGIN
  v_cash  := COALESCE(p_cash_amount,  CASE WHEN p_payment_method = 'cash'  THEN p_amount ELSE 0 END);
  v_mpesa := COALESCE(p_mpesa_amount, CASE WHEN p_payment_method = 'mpesa' THEN p_amount ELSE 0 END);

  INSERT INTO shop_expenses (
    shop_id, owner_id, amount, description,
    logged_by, logged_by_name, payment_method,
    cash_amount, mpesa_amount
  ) VALUES (
    p_shop_id, p_owner_id, p_amount, p_description,
    p_logged_by, p_logged_by_name, p_payment_method,
    v_cash, v_mpesa
  );
END;
$$;

-- 4. Replace get_shop_expenses to return the new columns.
DROP FUNCTION IF EXISTS get_shop_expenses(uuid);

CREATE FUNCTION get_shop_expenses(p_shop_id uuid)
RETURNS TABLE (
  id             uuid,
  amount         numeric,
  description    text,
  payment_method text,
  cash_amount    numeric,
  mpesa_amount   numeric,
  logged_by      uuid,
  logged_by_name text,
  created_at     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, amount, description, payment_method,
         cash_amount, mpesa_amount,
         logged_by, logged_by_name, created_at
  FROM shop_expenses
  WHERE shop_id = p_shop_id
  ORDER BY created_at DESC;
$$;
