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

interface ReturnItem {
  product_id:        string;
  quantity_returned: number;
  unit_price:        number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS });

  let body: {
    credit_sale_id:  string;
    shop_id:         string;
    owner_id:        string;
    items:           ReturnItem[];
    actor_name:      string;
    actor_code:      string;
    actor_id:        string;
    refund_method:   string;
    cash_amount:     number;
    mpesa_amount:    number;
    reason?:         string;
    product_names?:  Record<string, string>;
    customer_name?:  string;
  };

  try { body = await req.json(); } catch {
    return respond({ success: false, error: "Invalid JSON" });
  }

  const {
    credit_sale_id, shop_id, owner_id, items,
    actor_name, actor_code, actor_id, refund_method,
    cash_amount, mpesa_amount,
  } = body;

  if (!credit_sale_id || !shop_id || !owner_id || !items?.length) {
    return respond({ success: false, error: "Missing required fields" });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 0) Mark the moment BEFORE any writes ──────────────────────────────
  //
  // Every log row that lands for these products with created_at >= this
  // instant is either:
  //   - the shop_transactions trigger firing on our own insert, or
  //   - a side-effect of the process_credit_return RPC,
  // and must be cleaned up. 3 s of leeway on the lower bound covers
  // client/server clock skew.
  const nowMs       = Date.now();
  const nowIso      = new Date(nowMs).toISOString();
  const windowStart = new Date(nowMs - 3_000).toISOString();
  const productIds  = items.map(it => it.product_id);

  // ── 1) Run the existing return RPC (restores stock, adjusts balance) ──
  const { error: rpcErr } = await db.rpc("process_credit_return", {
    p_credit_sale_id: credit_sale_id,
    p_shop_id:        shop_id,
    p_owner_id:       owner_id,
    p_items:          items,
    p_actor_name:     actor_name,
    p_actor_code:     actor_code,
    p_refund_method:  refund_method,
    p_cash_amount:    cash_amount,
    p_mpesa_amount:   mpesa_amount,
    p_reason:         body.reason ?? "Customer return",
  });

  if (rpcErr) return respond({ success: false, error: rpcErr.message });

  // ── 2) Mirror into shop_transactions with NEGATIVE quantity ──────────
  //
  // The owner's fetchProducts sums `quantity` → a negative row reduces
  // "shopSold", which is what a return should do.
  //
  // We insert DIRECTLY rather than via insert_shop_transaction because the
  // RPC rejects quantity <= 0 and also auto-logs a `shop_sale_recorded`
  // entry (which we don't want — the trigger does it anyway).
  // Total value of the returned items — used only for proportional distribution
const totalItemValue = items.reduce(
    (s, it) => s + it.quantity_returned * it.unit_price,
    0,
  );
  
  // Money actually returned to the customer (0 for a fully unpaid credit sale)
  const totalCash  = cash_amount  || 0;
  const totalMpesa = mpesa_amount || 0;
  const totalRefund = totalCash + totalMpesa;
  
  const txRows = items.map(it => {
    const itemValue = it.quantity_returned * it.unit_price;
    const share     = totalItemValue > 0 ? itemValue / totalItemValue : 0;
  
    // Distribute the actual refund across items. When nothing was refunded
    // (unpaid credit return), every money field is 0 and only the negative
    // quantity survives — which is exactly the intent: stock goes back,
    // no cash changes hands.
    const itemRefund = Math.round(totalRefund * share);
    const itemCash   = Math.round(totalCash   * share);
    const itemMpesa  = Math.round(totalMpesa  * share);
  
    return {
      shop_id,
      owner_id,
      seller_agent_id:   actor_id,
      product_id:        it.product_id,
      quantity:          -it.quantity_returned,   // stock: always negative
      amount:            -itemRefund,             // money: 0 if unpaid
      customer_phone:    null,
      payment_method:    "return",
      cash_amount:       -itemCash,
      mpesa_amount:      -itemMpesa,
      mpesa_ref:         null,
      status:            "ok",
      unit_price:        it.unit_price,
      base_price:        it.unit_price,
      commission_rate:   0,
      commission_earned: 0,
      credit_sale_id,
      created_at:        nowIso,
    };
  });

  const { error: txErr } = await db.from("shop_transactions").insert(txRows);
  if (txErr) {
    console.error("shop_transactions insert error (return):", txErr.message);
    return respond({ success: false, error: `return tx insert failed: ${txErr.message}` });
  }

  // ── 3) Sweep away whatever the trigger just wrote ─────────────────────
  //
  // Every insert into shop_transactions fires a trigger that logs an
  // entry (typically `shop_sale_recorded`). For a return that entry is
  // wrong-shaped, so we delete anything that landed for our products
  // inside the window.
  //
  // This catches:
  //   - the trigger's own log row,
  //   - any log row the process_credit_return RPC wrote,
  //   - any stale in-flight write from a previous retry.
  //
  // Then step 4 inserts the single authoritative row.
  const { error: sweepErr } = await db
    .from("product_activity_log")
    .delete()
    .in("product_id", productIds)
    .gte("created_at", windowStart);

  if (sweepErr) {
    console.error("log sweep error:", sweepErr.message);
    // Not fatal — we're about to insert our own row regardless. Duplicates
    // are recoverable; a missing transaction row is not.
  }

  // ── 4) Insert the authoritative return log entry ──────────────────────
  const logRows = items.map(it => {
    const name = body.product_names?.[it.product_id] ?? "item";
    return {
      product_id: it.product_id,
      action:     "shop_return_recorded",
      quantity:   it.quantity_returned,                 // positive = stock back
      note:       `Return from ${body.customer_name || "customer"}: ` +
                  `${it.quantity_returned} × ${name}`,
      created_at: nowIso,
    };
  });

  const { error: logErr } = await db.from("product_activity_log").insert(logRows);
  if (logErr) {
    // Fatal — no log entry means the owner's timeline won't reflect the return.
    console.error("product_activity_log insert error:", logErr.message);
    return respond({
      success: false,
      error: `return log insert failed: ${logErr.message}`,
    });
  }

  return respond({ success: true });
});

function respond(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}