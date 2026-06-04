import { supabase } from "./supabase";

export interface QueuedCartItem {
  allocationId: string;
  productId: string;
  productName: string;
  quantity: number;
  sellPrice: number;
  basePrice: number;
}

export interface QueuedSale {
  id: string;
  queuedAt: number;
  shopId: string;
  ownerId: string;
  type: "regular" | "credit";
  cart: QueuedCartItem[];
  payMethod: "cash" | "mpesa" | "split" | "credit";
  cashAmount: number;
  mpesaAmount: number;
  mpesaRef: string;
  customerName: string;
  customerPhone: string;
  initialPayment: number;
  initialPayMethod: "cash" | "mpesa";
  verifiedAgent: { agent_id: string; name: string };
  commissionConfig: { enabled: boolean; rate: number };
  grandTotal: number;
}

const QUEUE_KEY = "pos_offline_queue";

export function getQueue(): QueuedSale[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function enqueue(sale: Omit<QueuedSale, "id" | "queuedAt">): QueuedSale {
  const item: QueuedSale = { ...sale, id: crypto.randomUUID(), queuedAt: Date.now() };
  const queue = getQueue();
  queue.push(item);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return item;
}

function dequeue(id: string) {
  const updated = getQueue().filter(s => s.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(updated));
}

async function syncOne(sale: QueuedSale): Promise<"success" | "stock_error" | "db_error"> {
  const deducted: { id: string; quantity: number }[] = [];
  for (const item of sale.cart) {
    const { error } = await supabase.rpc("deduct_shop_stock", {
      p_shop_allocation_id: item.allocationId,
      p_quantity: item.quantity,
    });
    if (error) {
      for (const d of deducted) {
        await supabase.rpc("deduct_shop_stock", { p_shop_allocation_id: d.id, p_quantity: -d.quantity });
      }
      return "stock_error";
    }
    deducted.push({ id: item.allocationId, quantity: item.quantity });
  }

  if (sale.type === "credit") {
    const creditItems = sale.cart.map(item => ({
      allocation_id: item.allocationId,
      product_id:    item.productId,
      product_name:  item.productName,
      quantity:      item.quantity,
      unit_price:    item.basePrice,
      subtotal:      item.basePrice * item.quantity,
    }));
    const initPaid   = Math.min(Math.max(0, sale.initialPayment), sale.grandTotal);
    const initStatus = initPaid >= sale.grandTotal - 0.5 ? "paid" : initPaid > 0 ? "partial" : "pending";

    const { data: creditData, error: creditErr } = await supabase
      .from("shop_credit_sales")
      .insert({
        shop_id:         sale.shopId,
        owner_id:        sale.ownerId,
        items:           creditItems,
        amount:          sale.grandTotal,
        amount_paid:     initPaid,
        customer_name:   sale.customerName,
        customer_phone:  sale.customerPhone,
        seller_agent_id: sale.verifiedAgent.agent_id,
        seller_name:     sale.verifiedAgent.name,
        status:          initStatus,
      })
      .select()
      .single();

    if (creditErr) {
      for (const d of deducted) {
        await supabase.rpc("deduct_shop_stock", { p_shop_allocation_id: d.id, p_quantity: -d.quantity });
      }
      return "db_error";
    }

    if (initPaid > 0 && creditData?.id) {
      await supabase.from("shop_credit_payments").insert({
        credit_sale_id: creditData.id,
        shop_id:        sale.shopId,
        owner_id:       sale.ownerId,
        amount:         initPaid,
        payment_method: sale.initialPayMethod,
        mpesa_ref:      null,
      });
    }
  } else {
    const commRate = sale.commissionConfig.enabled ? sale.commissionConfig.rate : 0;
    const txRows = sale.cart.map(item => {
      const itemTotal  = item.sellPrice * item.quantity;
      const markup     = Math.max(0, item.sellPrice - item.basePrice);
      const commEarned = Math.round(markup * item.quantity * commRate / 100);
      const ratio      = sale.grandTotal > 0 ? itemTotal / sale.grandTotal : 0;
      return {
        shop_id:           sale.shopId,
        owner_id:          sale.ownerId,
        seller_agent_id:   sale.verifiedAgent.agent_id,
        product_id:        item.productId,
        quantity:          item.quantity,
        amount:            itemTotal,
        customer_phone:    sale.customerPhone,
        payment_method:    sale.payMethod,
        cash_amount:  sale.payMethod === "cash"  ? itemTotal : sale.payMethod === "mpesa" ? 0 : Math.round(sale.cashAmount  * ratio),
        mpesa_amount: sale.payMethod === "mpesa" ? itemTotal : sale.payMethod === "cash"  ? 0 : Math.round(sale.mpesaAmount * ratio),
        mpesa_ref:    (sale.payMethod === "mpesa" || sale.payMethod === "split") ? sale.mpesaRef || null : null,
        status:            "ok",
        unit_price:        item.sellPrice,
        base_price:        item.basePrice,
        commission_rate:   commRate,
        commission_earned: commEarned,
      };
    });

    const { error: txErr } = await supabase.from("shop_transactions").insert(txRows);
    if (txErr) {
      for (const d of deducted) {
        await supabase.rpc("deduct_shop_stock", { p_shop_allocation_id: d.id, p_quantity: -d.quantity });
      }
      return "db_error";
    }
    window.dispatchEvent(new CustomEvent("shop:new_sale", { detail: { shopId: sale.shopId } }));
  }

  dequeue(sale.id);
  return "success";
}

export async function syncAll(): Promise<{ synced: number; failed: number }> {
  const queue = getQueue();
  let synced = 0, failed = 0;
  for (const sale of queue) {
    const result = await syncOne(sale);
    if (result === "success") synced++;
    else failed++;
  }
  // Also sync misc items (requests + expenses)
  const miscResult = await syncAllMisc();
  synced += miscResult.synced;
  failed += miscResult.failed;
  return { synced, failed };
}

// ── Misc queue (requests + expenses) ─────────────────────────────────────────

export interface QueuedRequest {
  id: string;
  queuedAt: number;
  shopId: string;
  ownerId: string;
  requestType: string;
  productId: string | null;
  productName: string | null;
  quantity: number | null;
  message: string;
}

export interface QueuedExpense {
  id: string;
  queuedAt: number;
  shopId: string;
  ownerId: string;
  amount: number;
  description: string;
  loggedBy: string;
  loggedByName: string;
  paymentMethod: "cash" | "mpesa" | "split";
  cashAmount?: number;
  mpesaAmount?: number;
}

type MiscQueueItem = ({ kind: "request" } & QueuedRequest) | ({ kind: "expense" } & QueuedExpense);

const MISC_KEY = "pos_offline_misc_queue";

export function getMiscQueue(): MiscQueueItem[] {
  try { return JSON.parse(localStorage.getItem(MISC_KEY) ?? "[]"); } catch { return []; }
}

export function enqueueRequest(r: Omit<QueuedRequest, "id" | "queuedAt">): QueuedRequest {
  const item: MiscQueueItem = { kind: "request", ...r, id: crypto.randomUUID(), queuedAt: Date.now() };
  const q = getMiscQueue();
  q.push(item);
  localStorage.setItem(MISC_KEY, JSON.stringify(q));
  return item as QueuedRequest;
}

export function enqueueExpense(e: Omit<QueuedExpense, "id" | "queuedAt">): QueuedExpense {
  const item: MiscQueueItem = { kind: "expense", ...e, id: crypto.randomUUID(), queuedAt: Date.now() };
  const q = getMiscQueue();
  q.push(item);
  localStorage.setItem(MISC_KEY, JSON.stringify(q));
  return item as QueuedExpense;
}

function dequeueMisc(id: string) {
  const updated = getMiscQueue().filter(i => i.id !== id);
  localStorage.setItem(MISC_KEY, JSON.stringify(updated));
}

async function syncAllMisc(): Promise<{ synced: number; failed: number }> {
  const items = getMiscQueue();
  let synced = 0, failed = 0;
  for (const item of items) {
    let err = null;
    if (item.kind === "request") {
      const { error } = await supabase.from("shop_requests").insert({
        owner_id:     item.ownerId,
        shop_id:      item.shopId,
        type:         item.requestType,
        product_id:   item.productId,
        product_name: item.productName,
        quantity:     item.quantity,
        message:      item.message,
        status:       "pending",
      });
      err = error;
    } else {
      const pm    = item.paymentMethod ?? "cash";
      const vCash = item.cashAmount  ?? (pm === "cash"  ? item.amount : 0);
      const vMpesa= item.mpesaAmount ?? (pm === "mpesa" ? item.amount : 0);
      const { error } = await supabase.from("shop_expenses").insert({
        shop_id:        item.shopId,
        owner_id:       item.ownerId,
        amount:         item.amount,
        description:    item.description,
        logged_by:      item.loggedBy,
        logged_by_name: item.loggedByName,
        payment_method: pm,
        cash_amount:    vCash,
        mpesa_amount:   vMpesa,
      });
      err = error;
    }
    if (err) failed++;
    else { dequeueMisc(item.id); synced++; }
  }
  return { synced, failed };
}
