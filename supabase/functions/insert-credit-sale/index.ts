// @ts-nocheck — Deno runtime, not Node.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CreditSaleItem {
  allocation_id?: string;
  product_id:     string;
  product_name:   string;
  quantity:       number;
  unit_price:     number;
  subtotal?:      number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS });

  let body: {
    shop_id:         string;
    owner_id:        string;
    items:           CreditSaleItem[];
    amount:          number;
    amount_paid:     number;
    customer_name:   string;
    customer_phone:  string;
    seller_agent_id: string;
    seller_name:     string;
    status:          string;
    initial_payment_method?: string;
    // Legacy single-row template from PosScan — we ignore product_id / quantity /
    // unit_price / base_price / cash_amount / mpesa_amount on it and only keep
    // the payment metadata.
    tx_row?: Record<string, any>;
  };

  try { body = await req.json(); } catch {
    return respond({ success: false, error: "Invalid JSON" });
  }

  const { shop_id, owner_id, items, amount, amount_paid,
          customer_name, customer_phone, seller_agent_id,
          seller_name, status } = body;

  if (!shop_id || !owner_id || !Array.isArray(items) || items.length === 0 || amount == null) {
    return respond({ success: false, error: "Missing required fields" });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: shop, error: shopErr } = await db
    .from("shops").select("id")
    .eq("id", shop_id).eq("owner_id", owner_id).single();

  if (shopErr || !shop) {
    return respond({ success: false, error: "Shop not found or owner mismatch" });
  }

  // ── 1) Insert the credit sale ──────────────────────────────────────
  const { data: creditData, error: creditErr } = await db
    .from("shop_credit_sales")
    .insert({
      shop_id, owner_id, items, amount, amount_paid,
      customer_name, customer_phone,
      seller_agent_id, seller_name, status,
    })
    .select()
    .single();

  if (creditErr) return respond({ success: false, error: creditErr.message });

  // ── 2) Build one shop_transactions row PER ITEM ────────────────────
  //
  // The caller (PosScan) sends a single `tx_row` with product_id = cart[0]
  // and quantity = sum of everything. We throw those two away and emit
  // one row per item — that's what lets the owner-side `fetchProducts`
  // attribute units to the right product.
  const template = body.tx_row ?? {};

  const paidRatio     = amount > 0 ? amount_paid / amount : 0;
  const paymentMethod = body.initial_payment_method
    ?? template.payment_method
    ?? (amount_paid > 0 ? "credit_partial" : "credit");

  // Whole-sale cash / mpesa splits (from caller) — we'll divide them
  // proportionally so per-item rows sum back to the original totals.
  const wholeCash  = Number(template.cash_amount)  || 0;
  const wholeMpesa = Number(template.mpesa_amount) || 0;

  const now = new Date().toISOString();

  let cashLeft  = wholeCash;
  let mpesaLeft = wholeMpesa;
  let amtLeft   = amount_paid;

  const txRows = items.map((it, idx) => {
    const itemTotal = it.subtotal ?? it.quantity * it.unit_price;
    const isLast    = idx === items.length - 1;
    const ratio     = amount > 0 ? itemTotal / amount : 0;

    // Payment-split attribution — last item absorbs rounding residue.
    const rowAmount = isLast
      ? amtLeft
      : Math.round(amount_paid * ratio);
    const rowCash   = isLast
      ? cashLeft
      : Math.round(wholeCash  * ratio);
    const rowMpesa  = isLast
      ? mpesaLeft
      : Math.round(wholeMpesa * ratio);

    amtLeft   -= rowAmount;
    cashLeft  -= rowCash;
    mpesaLeft -= rowMpesa;

    return {
      shop_id,
      owner_id,
      seller_agent_id,
      product_id:     it.product_id,
      quantity:       it.quantity,
      amount:         rowAmount,
      customer_phone,
      payment_method: paymentMethod,
      cash_amount:    rowCash,
      mpesa_amount:   rowMpesa,
      mpesa_ref:      template.mpesa_ref ?? null,
      status:         template.status ?? (amount_paid > 0 ? "credit_partial" : "credit"),
      unit_price:     it.unit_price,
      base_price:     template.base_price ?? it.unit_price,
      commission_rate:   0,
      commission_earned: 0,
      credit_sale_id: creditData.id,
      created_at:     now,
    };
  });

  // Only call insert_shop_transaction if there's *something* to record.
  // Fully-credit sales (amount_paid = 0) still need quantity to leave the
  // system, so we call it regardless — the amount just comes through as 0.
  const { error: txErr } = await db.rpc("insert_shop_transaction", { p_rows: txRows });
  if (txErr) console.error("insert_shop_transaction error (credit):", txErr.message);

    // ── 3) Re-tag the log entry that insert_shop_transaction just created ──
  //
  // The RPC logs a `shop_sale_recorded` row per product on every insert. For
  // credit sales we don't want to add a second row — we want to *relabel*
  // that row so the timeline shows it as a credit sale with the right note.
  //
  // Match window is generous (10 s) to cover the RPC's insert + our round-trip;
  // the (product_id, action) pair is unique enough that we won't clobber a
  // different sale's log.
  const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();

  for (const it of items) {
    const note =
      `Credit sale to ${customer_name || "customer"}: ` +
      `${it.quantity} × ${it.product_name}` +
      (amount_paid > 0
        ? ` (paid ${amount_paid.toLocaleString()} KSh upfront)`
        : " (fully on credit)");

    const { error: patchErr } = await db
      .from("product_activity_log")
      .update({
        action: "shop_credit_sale_recorded",
        note,
        // Keep the RPC's positive sign convention — regular Shop Sales also
        // log positive quantity. Only the action + note change.
      })
      .eq("product_id", it.product_id)
      .eq("action", "shop_sale_recorded")
      .gte("created_at", tenSecondsAgo);

    if (patchErr) {
      console.error("patch credit log error:", patchErr.message);
    }
  }

  return respond({ success: true, data: creditData });
});

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}