import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import { useNetwork } from "../context/NetworkContext";
import { supabase } from "../lib/supabase";
import { getQueue, type QueuedSale } from "../lib/offlineQueue";

const fmt = (n: number) => `KSh ${n.toLocaleString()}`;

interface LocalTransaction {
  id: string;
  amount: number;
  quantity: number;
  payment_method: string;
  cash_amount: number | null;
  mpesa_amount: number | null;
  mpesa_ref: string | null;
  created_at: string;
  product_name: string | null;
  product_sku: string | null;
  product_id: string | null;
  product_image_url: string | null;
  seller_name: string | null;
  seller_code: string | null;
  seller_agent_id: string | null;
  customer_phone: string | null;
  unit_price: number | null;
  receipt_sent: boolean | null;
  receipt_phone: string | null;
  status: string | null;
  commission_rate: number | null;
  commission_earned: number | null;
  credit_sale_id: string | null;
}

interface SaleGroup {
  key: string;
  created_at: string;
  seller_name: string | null;
  payment_method: string;
  status: string | null;
  items: LocalTransaction[];
  total: number;
}

interface TransactionReturn {
  id: string;
  original_transaction_id: string;
  product_id: string | null;
  product_name: string;
  quantity_returned: number;
  unit_price: number;
  amount_refunded: number;
  reason: string;
  created_at: string;
  refund_method?: string | null;
  refund_cash_amount?: number;
  refund_mpesa_amount?: number;
}

interface ReturnItem {
  txn_id: string;
  product_id: string | null;
  product_name: string;
  original_qty: number;
  already_returned: number;
  unit_price: number;
  tx_amount: number;
  status: string | null;
  credit_sale_id: string | null;
  outstanding: number | null; // outstanding credit balance at time of return modal open
  return_qty: number;
}

function groupTransactions(txns: LocalTransaction[]): SaleGroup[] {
  const map = new Map<string, SaleGroup>();
  for (const tx of txns) {
    const key = `${tx.seller_name ?? ""}__${tx.created_at}`;
    if (!map.has(key)) {
      map.set(key, { key, created_at: tx.created_at, seller_name: tx.seller_name, payment_method: tx.payment_method, status: tx.status, items: [], total: 0 });
    }
    const g = map.get(key)!;
    g.items.push(tx);
    g.total += tx.amount;
  }
  return [...map.values()];
}

type DateFilter  = "today" | "week" | "month" | "all" | "custom";
type CustomMode  = "day" | "month" | "year";

const PAGE_SIZE = 25;

const FILTER_LABELS: Record<DateFilter, string> = {
  today:  "Today",
  week:   "This Week",
  month:  "This Month",
  all:    "All Time",
  custom: "📅 Custom",
};

function getStartDate(filter: DateFilter): Date | null {
  const d = new Date();
  if (filter === "today") { d.setHours(0, 0, 0, 0); return d; }
  if (filter === "week")  { d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d; }
  if (filter === "month") { d.setDate(1); d.setHours(0, 0, 0, 0); return d; }
  return null;
}

function getCustomRange(mode: CustomMode, value: string): { start: Date; end: Date } | null {
  if (!value) return null;
  if (mode === "day") {
    const start = new Date(value + "T00:00:00");
    const end   = new Date(value + "T23:59:59.999");
    if (isNaN(start.getTime())) return null;
    return { start, end };
  }
  if (mode === "month") {
    const [y, m] = value.split("-").map(Number);
    if (!y || !m) return null;
    const start = new Date(y, m - 1, 1);
    const end   = new Date(y, m, 0, 23, 59, 59, 999);
    return { start, end };
  }
  if (mode === "year") {
    const y = parseInt(value);
    if (isNaN(y)) return null;
    const start = new Date(y,  0,  1,  0,  0,  0,   0);
    const end   = new Date(y, 11, 31, 23, 59, 59, 999);
    return { start, end };
  }
  return null;
}

export default function PosTransactionsPage() {
  const { shop } = useShopAuth();
  const { theme } = useTheme();
  const { pendingCount } = useNetwork();
  const navigate = useNavigate();

  const [queuedSales, setQueuedSales]   = useState<QueuedSale[]>([]);
  const [expandedQ,   setExpandedQ]     = useState<string | null>(null);

  type CreditPaymentRow = { id: string; credit_sale_id: string; amount: number; payment_method: string; cash_amount: number; mpesa_amount: number; mpesa_ref: string | null; customer_name: string | null; customer_phone: string | null; created_at: string };
  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [shopExpenses, setShopExpenses] = useState<{ id: string; amount: number; description: string; payment_method: string; cash_amount: number; mpesa_amount: number; logged_by: string; logged_by_name: string; created_at: string }[]>([]);
  const [creditPaymentRows, setCreditPaymentRows] = useState<CreditPaymentRow[]>([]);
  const [fetchError, setFetchError]     = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [hasMore, setHasMore]           = useState(false);
  const [offset, setOffset]             = useState(0);
  const [filter, setFilter]             = useState<DateFilter>("today");
  const [customMode,  setCustomMode]    = useState<CustomMode>("day");
  const [customValue, setCustomValue]   = useState("");
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [search, setSearch]             = useState("");
  const [methodFilter, setMethodFilter] = useState<"all" | "cash" | "mpesa" | "split">("all");
  const [typeFilter,   setTypeFilter]   = useState<"all" | "sales" | "expenses" | "returns">("all");
  const [expanded, setExpanded]         = useState<string | null>(null);
  const [resendingId, setResendingId]   = useState<string | null>(null);
  const [resendModal,  setResendModal]  = useState<LocalTransaction | null>(null);
  const [resendPhone,  setResendPhone]  = useState("");
  const [businessName, setBusinessName] = useState("");
  const [returnsMap,       setReturnsMap]       = useState<Record<string, TransactionReturn[]>>({});
  const [returnModal,        setReturnModal]        = useState<{ group: SaleGroup; items: ReturnItem[] } | null>(null);
  const [returnReason,       setReturnReason]       = useState("");
  const [returnCashRefund,   setReturnCashRefund]   = useState("");
  const [returnMpesaRefund,  setReturnMpesaRefund]  = useState("");
  const [returnProcessing,   setReturnProcessing]   = useState(false);
  const [returnError,        setReturnError]        = useState("");
  const [returnSuccess,    setReturnSuccess]    = useState(false);

  // Reload queued sales whenever the queue changes
  useEffect(() => { setQueuedSales(getQueue()); }, [pendingCount]);

  const productMapRef = useRef<Record<string, { name: string; sku: string }>>({});
  const sellerMapRef  = useRef<Record<string, { name: string; code: string }>>({});

  // ── Fetch business name once ──────────────────────────────────────────
  useEffect(() => {
    if (!shop?.owner_id) return;
    supabase
      .from("profiles")
      .select("business_name")
      .eq("id", shop.owner_id)
      .single()
      .then(({ data }) => { if (data?.business_name) setBusinessName(data.business_name); });
  }, [shop?.owner_id]);

  // ── Fetch returns for loaded transactions (SECURITY DEFINER — bypasses RLS) ──
  useEffect(() => {
    if (!shop || transactions.length === 0) return;
    const ids = transactions.map(t => t.id);
    supabase.rpc("get_transaction_returns", { p_transaction_ids: ids })
      .then(({ data }) => {
        const map: Record<string, TransactionReturn[]> = {};
        for (const r of data ?? []) {
          if (!map[r.original_transaction_id]) map[r.original_transaction_id] = [];
          map[r.original_transaction_id].push(r as TransactionReturn);
        }
        setReturnsMap(map);
      });
  }, [transactions, shop]);

  // ── Realtime: catch returns inserted from other pages (e.g. Credit tab) ─
  useEffect(() => {
    if (!shop || transactions.length === 0) return;
    const txnIds = new Set(transactions.map(t => t.id));
    const ch = supabase.channel(`txn-returns-rt-${shop.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "transaction_returns" }, (payload) => {
        const r = payload.new as TransactionReturn;
        if (!r?.original_transaction_id || !txnIds.has(r.original_transaction_id)) return;
        setReturnsMap(prev => {
          const bucket = prev[r.original_transaction_id] ?? [];
          if (bucket.some(x => x.id === r.id)) return prev; // already have it (optimistic)
          return { ...prev, [r.original_transaction_id]: [...bucket, r] };
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, transactions]);

  // ── Return helpers ───────────────────────────────────────────────────
  function getReturnStatus(group: SaleGroup): "none" | "partial" | "full" {
    const returnable = group.items.filter(t => t.product_id && t.unit_price != null);
    if (returnable.length === 0) return "none";
    let fullyReturned = 0;
    let hasAny = false;
    for (const tx of returnable) {
      const rets = returnsMap[tx.id] ?? [];
      const total = rets.reduce((s, r) => s + r.quantity_returned, 0);
      if (total > 0) hasAny = true;
      if (total >= tx.quantity) fullyReturned++;
    }
    if (!hasAny) return "none";
    return fullyReturned === returnable.length ? "full" : "partial";
  }

  async function openReturnModal(group: SaleGroup) {
    const txnIds = group.items.map(t => t.id);
    const { data } = await supabase.rpc("get_transaction_returns", { p_transaction_ids: txnIds });
    const existing = (data ?? []) as TransactionReturn[];

    let items: ReturnItem[] = group.items
      .filter(tx => tx.product_id && tx.unit_price != null)
      .map(tx => {
        const alreadyReturned = existing
          .filter(r => r.original_transaction_id === tx.id)
          .reduce((s, r) => s + r.quantity_returned, 0);
        return {
          txn_id:           tx.id,
          product_id:       tx.product_id,
          product_name:     tx.product_name ?? "Product",
          original_qty:     tx.quantity,
          already_returned: alreadyReturned,
          unit_price:       tx.unit_price!,
          tx_amount:        tx.amount,
          status:           tx.status,
          credit_sale_id:   tx.credit_sale_id ?? null,
          outstanding:      null,
          return_qty:       0,
        };
      })
      .filter(item => item.original_qty - item.already_returned > 0);

    // Fetch outstanding balance for any credit items
    const creditSaleIds = [...new Set(items.map(i => i.credit_sale_id).filter(Boolean))] as string[];
    if (creditSaleIds.length > 0) {
      const { data: creditRows } = await supabase
        .from("shop_credit_sales")
        .select("id, amount, amount_paid")
        .in("id", creditSaleIds);
      const balanceMap: Record<string, number> = {};
      for (const cs of creditRows ?? []) {
        balanceMap[cs.id] = Math.max(0, (cs.amount ?? 0) - (cs.amount_paid ?? 0));
      }
      items = items.map(item =>
        item.credit_sale_id && balanceMap[item.credit_sale_id] !== undefined
          ? { ...item, outstanding: balanceMap[item.credit_sale_id] }
          : item
      );
    }

    setReturnModal({ group, items });
    setReturnReason("");
    setReturnCashRefund(""); setReturnMpesaRefund("");
    setReturnError("");
    setReturnSuccess(false);
  }

  function updateReturnQty(txn_id: string, qty: number) {
    setReturnModal(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map(item =>
          item.txn_id === txn_id
            ? { ...item, return_qty: Math.max(0, Math.min(qty, item.original_qty - item.already_returned)) }
            : item
        ),
      };
    });
  }

  async function handleReturn() {
    if (!returnModal || !shop) return;
    if (!returnReason.trim()) { setReturnError("Please provide a reason for the return."); return; }
    const toReturn = returnModal.items.filter(i => i.return_qty > 0);
    if (toReturn.length === 0) { setReturnError("Select at least one item to return (qty > 0)."); return; }
    const totalRefund = toReturn.reduce((s, i) => s + i.return_qty * i.unit_price, 0);
    const refundCashTotal  = Math.round(Number(returnCashRefund)  || 0);
    const refundMpesaTotal = Math.round(Number(returnMpesaRefund) || 0);
    if (refundCashTotal === 0 && refundMpesaTotal === 0) {
      setReturnError("Enter a Cash or M-Pesa refund amount.");
      return;
    }

    setReturnProcessing(true);
    setReturnError("");
    try {
      const firstItem  = returnModal.group.items[0];
      const totalRefundAmt = totalRefund;
      // Auto-detect method from what was actually entered
      const autoMethod = refundCashTotal > 0 && refundMpesaTotal > 0 ? "split"
                       : refundMpesaTotal > 0 ? "mpesa" : "cash";
      let allocCash = 0, allocMpesa = 0;
      const rows = toReturn.map((item, idx) => {
        const amountRefunded = (item.status === "credit" || item.status === "credit_partial")
          ? Math.round((item.return_qty / item.original_qty) * item.tx_amount)
          : Math.round(item.unit_price * item.return_qty);
        const isLast = idx === toReturn.length - 1;
        let itemCash: number, itemMpesa: number;
        if (isLast) {
          itemCash  = refundCashTotal  - allocCash;
          itemMpesa = refundMpesaTotal - allocMpesa;
        } else {
          const ratio = totalRefundAmt > 0 ? amountRefunded / totalRefundAmt : 0;
          itemCash  = Math.round(refundCashTotal  * ratio);
          itemMpesa = Math.round(refundMpesaTotal * ratio);
          allocCash  += itemCash;
          allocMpesa += itemMpesa;
        }
        return {
          owner_id:                shop.owner_id,
          source:                  "shop",
          original_transaction_id: item.txn_id,
          shop_id:                 shop.id,
          agent_id:                firstItem.seller_agent_id ?? null,
          product_id:              item.product_id,
          product_name:            item.product_name,
          quantity_returned:       item.return_qty,
          unit_price:              item.unit_price,
          amount_refunded:         amountRefunded,
          reason:                  returnReason.trim(),
          actor_name:              firstItem.seller_name ?? null,
          actor_code:              firstItem.seller_code ?? null,
          refund_method:           autoMethod,
          refund_payment_method:   autoMethod,
          refund_cash_amount:      itemCash,
          refund_mpesa_amount:     itemMpesa,
        };
      });
      const { error } = await supabase.rpc("insert_transaction_returns", { p_rows: rows });
      if (error) { setReturnError(error.message); setReturnProcessing(false); return; }

      // Update shop_credit_sales balance for credit items so customer no longer owes for returned goods
      const creditItems = toReturn.filter(i => (i.status === "credit" || i.status === "credit_partial") && i.credit_sale_id);
      for (const item of creditItems) {
        const { data: cs } = await supabase
          .from("shop_credit_sales")
          .select("id, amount, amount_paid")
          .eq("id", item.credit_sale_id!)
          .single();
        if (cs) {
          const returnedFullValue = item.return_qty * item.unit_price;
          const newTotal  = Math.max(0, cs.amount - returnedFullValue);
          const newPaid   = Math.min(cs.amount_paid ?? 0, newTotal);
          const newStatus = newTotal <= 0      ? "returned"
                          : newPaid >= newTotal ? "paid"
                          : newPaid > 0        ? "partial"
                          : "pending";
          await supabase.from("shop_credit_sales")
            .update({ amount: newTotal, amount_paid: newPaid, status: newStatus })
            .eq("id", cs.id);
        }
      }

      // Update local returnsMap — reuse rows so cash/mpesa amounts match what was sent to DB
      setReturnsMap(prev => {
        const next = { ...prev };
        for (const row of rows) {
          const tid = row.original_transaction_id;
          if (!next[tid]) next[tid] = [];
          next[tid] = [...next[tid], {
            id:                      crypto.randomUUID(),
            original_transaction_id: tid,
            product_id:              row.product_id,
            product_name:            row.product_name,
            quantity_returned:       row.quantity_returned,
            unit_price:              row.unit_price,
            amount_refunded:         row.amount_refunded,
            reason:                  row.reason,
            created_at:              new Date().toISOString(),
            refund_method:           row.refund_method,
            refund_cash_amount:      row.refund_cash_amount,
            refund_mpesa_amount:     row.refund_mpesa_amount,
          }];
        }
        return next;
      });
      setReturnSuccess(true);
      setTimeout(() => {
        setReturnModal(null);
        setReturnSuccess(false);
      }, 1500);
    } catch (e: any) {
      setReturnError(e.message ?? "Unknown error");
    } finally {
      setReturnProcessing(false);
    }
  }

  const enrichRows = useCallback(async (
    txData: any[],
    existingProductMap: Record<string, { name: string; sku: string; image_url?: string | null }>,
    existingSellerMap: Record<string, { name: string; code: string }>,
  ): Promise<LocalTransaction[]> => {
    if (!shop) return [];

    const newProductIds = [...new Set(txData.map((t: any) => t.product_id).filter((id: string) => id && !existingProductMap[id]))];
    const newAgentIds   = [...new Set(txData.map((t: any) => t.seller_agent_id).filter((id: string) => id && !existingSellerMap[id]))];

    if (newProductIds.length > 0) {
      const { data: prodsData } = await supabase
        .from("products")
        .select("id, name, sku, image_url")
        .in("id", newProductIds);
      for (const p of prodsData ?? []) {
        existingProductMap[p.id] = { name: p.name, sku: p.sku ?? "", image_url: p.image_url ?? null };
      }
    }

    if (newAgentIds.length > 0) {
      const { data: agentData } = await supabase
        .from("shop_agents")
        .select("agent_id, agent_name, agent_code")
        .eq("shop_id", shop.id)
        .in("agent_id", newAgentIds);
      for (const a of agentData ?? []) {
        if (a.agent_name) existingSellerMap[a.agent_id] = { name: a.agent_name, code: a.agent_code ?? "" };
      }
    }

    return txData.map((t: any) => ({
      id:             t.id,
      amount:         t.amount,
      quantity:       t.quantity,
      payment_method: t.payment_method,
      cash_amount:    t.cash_amount,
      mpesa_amount:   t.mpesa_amount,
      mpesa_ref:      t.mpesa_ref ?? null,
      created_at:     t.created_at,
      product_name:      t.status === "credit_partial" ? "Credit Sale (Partial Payment)" : t.status === "credit" ? "Credit Sale (Unpaid)" : (existingProductMap[t.product_id]?.name ?? "—"),
      product_sku:       existingProductMap[t.product_id]?.sku       ?? "",
      product_image_url: existingProductMap[t.product_id]?.image_url ?? null,
      product_id:        t.product_id ?? null,
      seller_name:    existingSellerMap[t.seller_agent_id]?.name ?? "Unknown",
      seller_code:    existingSellerMap[t.seller_agent_id]?.code ?? "",
      seller_agent_id: t.seller_agent_id ?? null,
      customer_phone: t.customer_phone ?? null,
      unit_price:        t.unit_price ?? null,
      receipt_sent:      t.receipt_sent ?? null,
      receipt_phone:     t.receipt_phone ?? null,
      status:            t.status ?? null,
      commission_rate:   t.commission_rate ?? null,
      commission_earned: t.commission_earned ?? null,
      credit_sale_id:    t.credit_sale_id ?? null,
    }));
  }, [shop]);

  const fetchTransactions = useCallback(async (silent = false) => {
    if (!shop) return;
    if (!silent) setLoading(true);
    productMapRef.current = {};
    sellerMapRef.current  = {};

    let pStart: string | undefined;
    let pEnd:   string | undefined;
    if (filter === "custom") {
      const range = getCustomRange(customMode, customValue);
      if (range) { pStart = range.start.toISOString(); pEnd = range.end.toISOString(); }
    } else {
      const startDate = getStartDate(filter);
      if (startDate) pStart = startDate.toISOString();
    }

    // All queries use SECURITY DEFINER RPCs — bypass RLS regardless of JWT state
    // Promise.allSettled so a blipping fetch never kills the transaction load
    const [txResult, expResult, cpResult] = await Promise.allSettled([
      supabase.rpc("get_shop_transactions", {
        p_shop_id: shop.id,
        p_start:   pStart ?? null,
        p_end:     pEnd   ?? null,
        p_limit:   PAGE_SIZE,
        p_offset:  0,
      }),
      supabase.rpc("get_shop_expenses", { p_shop_id: shop.id }),
      supabase.rpc("get_shop_credit_payments_all", { p_shop_id: shop.id }),
    ]);

    // Auto-retry transactions once on transient network failure
    let txData: any[] | null = null;
    let txError: any = null;
    if (txResult.status === "fulfilled") {
      txData  = txResult.value.data;
      txError = txResult.value.error;
    } else {
      // First attempt failed — retry once after 800ms
      await new Promise(r => setTimeout(r, 800));
      const retry = await supabase.rpc("get_shop_transactions", {
        p_shop_id: shop.id, p_start: pStart ?? null, p_end: pEnd ?? null, p_limit: PAGE_SIZE, p_offset: 0,
      });
      txData  = retry.data;
      txError = retry.error;
    }
    const expData = expResult.status === "fulfilled" ? expResult.value.data : null;
    const cpData  = cpResult.status  === "fulfilled" ? cpResult.value.data  : null;

    if (txError) { console.error("shop_transactions fetch error:", txError); setFetchError(txError.message); setLoading(false); return; }
    if (!txData) { setFetchError("No data returned"); setLoading(false); return; }
    setFetchError(null);

    // Filter expenses client-side to match the active date window
    const allExps: { id: string; amount: number; description: string; payment_method: string; cash_amount: number; mpesa_amount: number; logged_by: string; logged_by_name: string; created_at: string }[] =
      (expData || []).map((e: any) => ({
        id:             e.id,
        amount:         Number(e.amount) || 0,
        description:    e.description || "Expense",
        payment_method: e.payment_method || "cash",
        cash_amount:    Number(e.cash_amount)  || 0,
        mpesa_amount:   Number(e.mpesa_amount) || 0,
        logged_by:      e.logged_by      || "",
        logged_by_name: e.logged_by_name || "",
        created_at:     e.created_at,
      }));

    const filteredExps = allExps.filter(e => {
      const d = new Date(e.created_at);
      if (filter === "custom") {
        const range = getCustomRange(customMode, customValue);
        if (!range) return true;
        return d >= range.start && d <= range.end;
      }
      const startDate = getStartDate(filter);
      return startDate ? d >= startDate : true;
    });

    const allCPs = (cpData || []).map((c: any) => ({
      id:               c.id,
      credit_sale_id:   c.credit_sale_id,
      amount:           Number(c.amount) || 0,
      payment_method:   c.payment_method || "cash",
      cash_amount:      Number(c.cash_amount)  || 0,
      mpesa_amount:     Number(c.mpesa_amount) || 0,
      mpesa_ref:        c.mpesa_ref        || null,
      customer_name:    c.customer_name    || null,
      customer_phone:   c.customer_phone   || null,
      created_at:       c.created_at,
    }));

    const filteredCPs = allCPs.filter((c: CreditPaymentRow) => {
      const d = new Date(c.created_at);
      if (filter === "custom") {
        const range = getCustomRange(customMode, customValue);
        if (!range) return true;
        return d >= range.start && d <= range.end;
      }
      const startDate = getStartDate(filter);
      return startDate ? d >= startDate : true;
    });

    const enriched = await enrichRows(txData, productMapRef.current, sellerMapRef.current);
    setTransactions(enriched);
    setShopExpenses(filteredExps);
    setCreditPaymentRows(filteredCPs);
    setOffset(PAGE_SIZE);
    setHasMore(txData.length === PAGE_SIZE);
    setLoading(false);
  }, [shop, filter, customMode, customValue, enrichRows]);

  const loadMore = useCallback(async () => {
    if (!shop || loadingMore) return;
    setLoadingMore(true);

    let pStart: string | undefined;
    let pEnd:   string | undefined;
    if (filter === "custom") {
      const range = getCustomRange(customMode, customValue);
      if (range) { pStart = range.start.toISOString(); pEnd = range.end.toISOString(); }
    } else {
      const startDate = getStartDate(filter);
      if (startDate) pStart = startDate.toISOString();
    }

    const { data: txData, error } = await supabase.rpc("get_shop_transactions", {
      p_shop_id: shop.id,
      p_start:   pStart ?? null,
      p_end:     pEnd   ?? null,
      p_limit:   PAGE_SIZE,
      p_offset:  offset,
    });
    if (error || !txData) { setLoadingMore(false); return; }

    const enriched = await enrichRows(txData, productMapRef.current, sellerMapRef.current);
    setTransactions(prev => [...prev, ...enriched]);
    setOffset(prev => prev + PAGE_SIZE);
    setHasMore(txData.length === PAGE_SIZE);
    setLoadingMore(false);
  }, [shop, filter, customMode, customValue, offset, loadingMore, enrichRows]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  useEffect(() => {
    if (!shop) return;

    // window event: fired by PosScan/offlineQueue after a successful insert (same process, no JWT needed)
    const onNewSale = (e: Event) => {
      if ((e as CustomEvent).detail?.shopId === shop.id) fetchTransactions(true);
    };
    window.addEventListener("shop:new_sale", onNewSale);

    // visibilitychange: refetch when user navigates back to this tab/page
    const onVisible = () => { if (document.visibilityState === "visible") fetchTransactions(true); };
    document.addEventListener("visibilitychange", onVisible);

    // 30 s polling as a safety net (mirrors owner dashboard behaviour)
    const poll = setInterval(() => fetchTransactions(true), 30_000);

    // expenses + credit_payments: postgres_changes is fine here since fetch is via SECURITY DEFINER RPC
    const expCh = supabase.channel(`shop-exp-changes-${shop.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "shop_expenses",
        filter: `shop_id=eq.${shop.id}`,
      }, () => fetchTransactions(true))
      .on("postgres_changes", {
        event: "*", schema: "public", table: "credit_payments",
        filter: `shop_id=eq.${shop.id}`,
      }, () => fetchTransactions(true))
      .subscribe();

    return () => {
      window.removeEventListener("shop:new_sale", onNewSale);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(poll);
      supabase.removeChannel(expCh);
    };
  }, [shop, fetchTransactions]);

  // ── Realtime: owner flags/unflags shop transactions ─────────────────────
  useEffect(() => {
    if (!shop?.id) return;
    const ch = supabase
      .channel(`shop-flags-${shop.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "shop_transactions", filter: `shop_id=eq.${shop.id}` },
        (payload) => {
          const updated = payload.new as { id: string; status: string | null };
          setTransactions(prev =>
            prev.map(t => t.id === updated.id ? { ...t, status: updated.status } : t)
          );
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop?.id]);

  // Refetch returnsMap when user comes back to this page (catches returns done on Credit tab)
  useEffect(() => {
    const refetchReturns = () => {
      if (document.visibilityState !== "visible" || transactions.length === 0 || !shop) return;
      const ids = transactions.map(t => t.id);
      supabase.rpc("get_transaction_returns", { p_transaction_ids: ids })
        .then(({ data }) => {
          const map: Record<string, TransactionReturn[]> = {};
          for (const r of data ?? []) {
            if (!map[r.original_transaction_id]) map[r.original_transaction_id] = [];
            map[r.original_transaction_id].push(r as TransactionReturn);
          }
          setReturnsMap(map);
        });
    };
    document.addEventListener("visibilitychange", refetchReturns);
    window.addEventListener("focus", refetchReturns);
    return () => {
      document.removeEventListener("visibilitychange", refetchReturns);
      window.removeEventListener("focus", refetchReturns);
    };
  }, [shop, transactions]);

  // ── Resend receipt ────────────────────────────────────────────────────
  function openResendModal(tx: LocalTransaction) {
    setResendModal(tx);
    setResendPhone(tx.receipt_phone ?? tx.customer_phone ?? "");
  }

  async function handleResend(tx: LocalTransaction, phoneOverride?: string) {
    const phone = phoneOverride ?? tx.receipt_phone ?? tx.customer_phone ?? "";
    if (!phone) return;
    setResendingId(tx.id);
    try {
      const { data } = await supabase.functions.invoke("send-receipt", {
        body: {
          phone,
          business_name:  businessName || shop?.name || "Business",
          agent_name:     tx.seller_name ?? "Agent",
          items: [{
            name:       tx.product_name ?? "Product",
            quantity:   tx.quantity,
            unit_price: tx.unit_price ?? (tx.quantity > 0 ? Math.round(tx.amount / tx.quantity) : 0),
            total:      tx.amount,
          }],
          total_amount:   tx.amount,
          payment_method: tx.payment_method ?? "cash",
          mpesa_ref:      tx.mpesa_ref ?? undefined,
        },
      });
      const sent = !!data?.sent;
      await supabase
        .from("shop_transactions")
        .update({ receipt_sent: sent, receipt_phone: phone })
        .eq("id", tx.id);
      setTransactions(prev =>
        prev.map(t => t.id === tx.id ? { ...t, receipt_sent: sent, receipt_phone: phone } : t)
      );
    } finally {
      setResendingId(null);
    }
  }

  const methodBadge = (method: string, status?: string | null) => {
    if (status === "credit" || status === "credit_partial") return { icon: "📝", color: "#c084fc", label: "Credit" };
    if (method === "cash")  return { icon: "💵", color: "#34d399", label: "Cash"   };
    if (method === "mpesa") return { icon: "📱", color: "#60a5fa", label: "M-Pesa" };
    return                         { icon: "⚡", color: "#fbbf24", label: "Split"  };
  };

  const flaggedCount = transactions.filter(t => t.status === "review").length;

  const displayed = transactions.filter(tx => {
    const isCredit = tx.status === "credit" || tx.status === "credit_partial";
    const isUnpaidCredit = tx.status === "credit";
    const matchesMethod = methodFilter === "all"
      ? !isUnpaidCredit
      : (tx.payment_method === methodFilter && !isCredit);
    const q = search.toLowerCase();
    const matchesSearch = !q
      || (tx.product_name   ?? "").toLowerCase().includes(q)
      || (tx.seller_name    ?? "").toLowerCase().includes(q)
      || (tx.product_sku    ?? "").toLowerCase().includes(q)
      || (tx.customer_phone ?? "").toLowerCase().includes(q)
      || (tx.mpesa_ref      ?? "").toLowerCase().includes(q);
    return matchesMethod && matchesSearch;
  });

  const expensesSum   = shopExpenses.reduce((s, e) => s + e.amount, 0);
  const cpTotal       = creditPaymentRows.reduce((s, c) => s + c.amount, 0);
  const grossRevenue  = displayed.reduce((s, t) => s + t.amount, 0) + cpTotal;
  const totalRevenue  = Math.max(0, grossRevenue - expensesSum);
  const cashExpenses  = shopExpenses.reduce((s, e) => s + (e.cash_amount  || (e.payment_method === "cash"  ? e.amount : 0)), 0);
  const mpesaExpenses = shopExpenses.reduce((s, e) => s + (e.mpesa_amount || (e.payment_method === "mpesa" ? e.amount : 0)), 0);
  const cpCash        = creditPaymentRows.reduce((s, c) => s + c.cash_amount,  0);
  const cpMpesa       = creditPaymentRows.reduce((s, c) => s + c.mpesa_amount, 0);
  const totalCash     = Math.max(0, displayed.reduce((s, t) => s + (t.cash_amount  ?? 0), 0) + cpCash  - cashExpenses);
  const totalMpesa    = Math.max(0, displayed.reduce((s, t) => s + (t.mpesa_amount ?? 0), 0) + cpMpesa - mpesaExpenses);
  const queuedTotal   = queuedSales.reduce((s, q) => s + q.grandTotal, 0);

  // Cap each return deduction at t.amount — credit sales (amount=0) contribute nothing to revenue
  const effectiveRefund = (t: LocalTransaction) =>
    (returnsMap[t.id] ?? []).reduce((s, r) => s + Math.min(r.amount_refunded, t.amount), 0);

  const totalRefunded = displayed.reduce((s, t) => s + effectiveRefund(t), 0);
  const cashRefunded = Math.round(displayed.reduce((s, t) => {
    for (const r of (returnsMap[t.id] ?? [])) {
      const method = r.refund_method ?? t.payment_method;
      if (method === "cash") {
        s += r.amount_refunded;
      } else if (method === "split") {
        const ca = r.refund_cash_amount ?? 0;
        const ma = r.refund_mpesa_amount ?? 0;
        if (ca > 0 || ma > 0) {
          s += ca; // use stored exact value
        } else if (t.amount > 0) {
          s += r.amount_refunded * ((t.cash_amount ?? 0) / t.amount); // proportional fallback for old records
        }
      }
    }
    return s;
  }, 0));
  const mpesaRefunded = Math.round(displayed.reduce((s, t) => {
    for (const r of (returnsMap[t.id] ?? [])) {
      const method = r.refund_method ?? t.payment_method;
      if (method === "mpesa") {
        s += r.amount_refunded;
      } else if (method === "split") {
        const ca = r.refund_cash_amount ?? 0;
        const ma = r.refund_mpesa_amount ?? 0;
        if (ca > 0 || ma > 0) {
          s += ma; // use stored exact value
        } else if (t.amount > 0) {
          s += r.amount_refunded * ((t.mpesa_amount ?? 0) / t.amount); // proportional fallback for old records
        }
      }
    }
    return s;
  }, 0));

  // Derive clawback from return qty vs original commission — no DB column needed
  const calcClawback = (t: LocalTransaction) => {
    if (!t.commission_earned || !t.quantity) return 0;
    const returnedQty = (returnsMap[t.id] ?? []).reduce((s, r) => s + r.quantity_returned, 0);
    return returnedQty > 0 ? Math.round((returnedQty / t.quantity) * t.commission_earned) : 0;
  };
  const totalCommissionClawed = displayed.reduce((s, t) => s + calcClawback(t), 0);

  // Helper: collapse multi-item queued sale to a readable label
  const queuedLabel = (q: QueuedSale) =>
    q.cart.length === 1
      ? q.cart[0].productName
      : `${q.cart[0].productName} +${q.cart.length - 1} more`;

  const payLabel = (m: string) =>
    m === "cash" ? "💵 Cash" : m === "mpesa" ? "📱 M-Pesa" : m === "split" ? "⚡ Split" : "📝 Credit";

  const timeAgo = (ts: number) => {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  };

  // Use YYYY-MM-DD (local date) as the group key — sorts correctly as a string
  const dateKey = (iso: string) => {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const formatDateHeader = (key: string) =>
    new Date(key + "T12:00:00").toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  const groupByDate = (txns: LocalTransaction[]) => {
    const groups: Record<string, LocalTransaction[]> = {};
    for (const tx of txns) {
      const key = dateKey(tx.created_at);
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    }
    return groups;
  };

  // When showing returns only, narrow to transactions that have at least one return entry
  const displayedForType = typeFilter === "returns"
    ? displayed.filter(tx => (returnsMap[tx.id] ?? []).length > 0)
    : displayed;

  const grouped = groupByDate(displayedForType);

  // Build unified date-keyed list — typeFilter controls which kinds appear
  type UnifiedItem = { kind: "tx"; data: LocalTransaction } | { kind: "exp"; data: typeof shopExpenses[number] } | { kind: "cp"; data: CreditPaymentRow };
  const unifiedByDate: Record<string, UnifiedItem[]> = {};
  if (typeFilter !== "expenses") {
    for (const [date, txns] of Object.entries(grouped)) {
      unifiedByDate[date] = txns.map(t => ({ kind: "tx" as const, data: t }));
    }
  }
  if (typeFilter !== "sales" && typeFilter !== "returns") {
    for (const exp of shopExpenses) {
      const key = dateKey(exp.created_at);
      if (!unifiedByDate[key]) unifiedByDate[key] = [];
      unifiedByDate[key].push({ kind: "exp" as const, data: exp });
    }
    for (const cp of creditPaymentRows) {
      const key = dateKey(cp.created_at);
      if (!unifiedByDate[key]) unifiedByDate[key] = [];
      unifiedByDate[key].push({ kind: "cp" as const, data: cp });
    }
  }
  // YYYY-MM-DD keys sort correctly as strings — newest first
  const sortedDateKeys = Object.keys(unifiedByDate).sort((a, b) => b.localeCompare(a));
  for (const key of sortedDateKeys) {
    unifiedByDate[key].sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime());
  }

  // Receipt badge config
  const receiptBadge = (tx: LocalTransaction) => {
    if (tx.receipt_sent === true)  return { label: "📱 Receipt Sent",   color: "#34d399", bg: "rgba(52,211,153,0.10)",  border: "rgba(52,211,153,0.25)"  };
    if (tx.receipt_sent === false) return { label: "📵 Receipt Failed", color: "#fbbf24", bg: "rgba(234,179,8,0.10)",   border: "rgba(234,179,8,0.25)"   };
    if (tx.customer_phone)         return { label: "📄 No Receipt",     color: "rgba(255,255,255,0.3)", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)" };
    return null;
  };

  return (
    <div style={{ minHeight: "100vh", background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp  { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes slideDown { from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)} }
        .tx-row { transition: background 0.12s; cursor: pointer; }
        .tx-row:hover { background: rgba(6,182,212,0.04) !important; }
        .filter-pill { transition: all 0.15s; cursor: pointer; }
        .filter-pill:hover { opacity: 0.85; }
        .expand-panel { animation: slideDown 0.18s ease; }
      `}</style>

      {/* Header */}
      <div style={{
        borderBottom: `1px solid ${theme.border.default}`,
        padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 14,
        position: "sticky", top: 58, background: theme.bg.base, zIndex: 40,
      }}>
        <button onClick={() => navigate("/pos")}
          style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${theme.border.default}`, borderRadius: 10, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: theme.text.primary, fontSize: 18, flexShrink: 0 }}>
          ‹
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>Transactions</div>
          <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 1 }}>{shop?.name} · {shop?.shop_code}</div>
        </div>
      </div>

      <div style={{ padding: "16px 16px 100px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Flag banner — shown when owner has flagged transactions */}
        {flaggedCount > 0 && (
          <div style={{
            background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 12, padding: "14px 18px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22 }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#f87171", fontFamily: theme.font.body }}>
                  {flaggedCount} {flaggedCount === 1 ? "transaction has" : "transactions have"} been flagged for review
                </div>
                <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                  Your manager has marked {flaggedCount === 1 ? "this sale" : "these sales"}. Check each one below.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Type filter pills */}
        <div style={{ display: "flex", gap: 7 }}>
          {(["all", "sales", "expenses", "returns"] as const).map(t => {
            const labels: Record<string, string> = { all: "All", sales: "Sales", expenses: "Expenses", returns: "Returns" };
            const active = typeFilter === t;
            return (
              <button key={t} className="filter-pill" onClick={() => setTypeFilter(t)}
                style={{
                  padding: "7px 14px", borderRadius: 50,
                  border: `1px solid ${active ? theme.accent.gold : theme.border.default}`,
                  background: active ? "rgba(251,191,36,0.12)" : "transparent",
                  color: active ? theme.accent.gold : theme.text.muted,
                  fontFamily: theme.font.mono, fontSize: 11, fontWeight: active ? 600 : 400,
                  cursor: "pointer",
                }}>
                {labels[t]}
              </button>
            );
          })}
        </div>

        {/* Date filter pills */}
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {(Object.keys(FILTER_LABELS) as DateFilter[]).map(f => (
            <button key={f} className="filter-pill"
              onClick={() => {
                setFilter(f);
                if (f === "custom") setShowCustomPicker(true);
                else setShowCustomPicker(false);
              }}
              style={{
                padding: "7px 14px", borderRadius: 50,
                border: `1px solid ${filter === f ? theme.accent.cyan : theme.border.default}`,
                background: filter === f ? "rgba(6,182,212,0.15)" : "transparent",
                color: filter === f ? theme.accent.cyan : theme.text.muted,
                fontFamily: theme.font.mono, fontSize: 11, fontWeight: filter === f ? 600 : 400,
                whiteSpace: "nowrap",
              }}>
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>

        {/* Custom date picker — shown when "Custom" is active */}
        {filter === "custom" && showCustomPicker && (
          <div style={{
            background: theme.bg.card, border: `1px solid ${theme.border.default}`,
            borderRadius: 14, padding: "14px 16px",
            display: "flex", flexDirection: "column", gap: 12,
            animation: "slideDown 0.18s ease",
          }}>
            {/* Mode tabs */}
            <div style={{ display: "flex", gap: 6 }}>
              {(["day", "month", "year"] as CustomMode[]).map(m => (
                <button key={m} onClick={() => { setCustomMode(m); setCustomValue(""); }}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 8,
                    border: `1px solid ${customMode === m ? theme.accent.cyan : theme.border.default}`,
                    background: customMode === m ? "rgba(6,182,212,0.12)" : "transparent",
                    color: customMode === m ? theme.accent.cyan : theme.text.muted,
                    fontFamily: theme.font.mono, fontSize: 11, fontWeight: customMode === m ? 700 : 400,
                    cursor: "pointer", textTransform: "capitalize",
                  }}>
                  {m === "day" ? "📆 Day" : m === "month" ? "📅 Month" : "🗓 Year"}
                </button>
              ))}
            </div>

            {/* Input */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {customMode === "day" && (
                <input type="date"
                  value={customValue}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={e => setCustomValue(e.target.value)}
                  style={{ flex: 1, padding: "10px 12px", background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 10, color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none" }}
                />
              )}
              {customMode === "month" && (
                <input type="month"
                  value={customValue}
                  max={new Date().toISOString().slice(0, 7)}
                  onChange={e => setCustomValue(e.target.value)}
                  style={{ flex: 1, padding: "10px 12px", background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 10, color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none" }}
                />
              )}
              {customMode === "year" && (
                <select
                  value={customValue}
                  onChange={e => setCustomValue(e.target.value)}
                  style={{ flex: 1, padding: "10px 12px", background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 10, color: customValue ? theme.text.primary : theme.text.muted, fontFamily: theme.font.mono, fontSize: 13, outline: "none" }}>
                  <option value="">Select year…</option>
                  {Array.from({ length: new Date().getFullYear() - 2022 + 1 }, (_, i) => 2023 + i).reverse().map(y => (
                    <option key={y} value={String(y)}>{y}</option>
                  ))}
                </select>
              )}
              <button
                onClick={() => { if (customValue) setShowCustomPicker(false); }}
                disabled={!customValue}
                style={{
                  padding: "10px 18px", borderRadius: 10,
                  background: customValue ? "linear-gradient(135deg,#0891b2,#06b6d4)" : "rgba(255,255,255,0.06)",
                  border: "none", color: customValue ? "#fff" : theme.text.muted,
                  fontFamily: theme.font.mono, fontSize: 12, fontWeight: 700,
                  cursor: customValue ? "pointer" : "not-allowed", whiteSpace: "nowrap",
                }}>
                Apply ↵
              </button>
            </div>

            {/* Active filter label */}
            {customValue && !showCustomPicker && (
              <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.accent.cyan }}>
                Showing: {customMode === "day" ? new Date(customValue + "T00:00:00").toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "long", year: "numeric" }) : customMode === "month" ? new Date(customValue + "-01").toLocaleDateString("en-KE", { month: "long", year: "numeric" }) : customValue}
              </div>
            )}
          </div>
        )}

        {/* Active custom filter chip */}
        {filter === "custom" && customValue && !showCustomPicker && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.3)", borderRadius: 50 }}>
              <span style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.accent.cyan, fontWeight: 600 }}>
                {customMode === "day"   ? `📆 ${new Date(customValue + "T00:00:00").toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}`
                : customMode === "month" ? `📅 ${new Date(customValue + "-01").toLocaleDateString("en-KE", { month: "long", year: "numeric" })}`
                : `🗓 ${customValue}`}
              </span>
              <button onClick={() => setShowCustomPicker(true)}
                style={{ background: "none", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: 11, padding: 0, fontFamily: theme.font.mono }}>
                ✎
              </button>
            </div>
          </div>
        )}

        {/* Search bar */}
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.4 }}>🔍</span>
          <input
            placeholder="Product, seller, phone, M-Pesa ref…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "10px 12px 10px 36px",
              background: theme.bg.card, border: `1px solid ${theme.border.default}`,
              borderRadius: 12, color: theme.text.primary, fontSize: 13,
              fontFamily: theme.font.mono, outline: "none",
            }}
          />
        </div>

        {/* Payment method filter pills */}
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {([
            { key: "all",   icon: "",   label: "Methods"  },
            { key: "cash",  icon: "💵", label: "Cash"     },
            { key: "mpesa", icon: "📱", label: "M-Pesa"   },
            { key: "split", icon: "⚡", label: "Split"    },
          ] as const).map(({ key, icon, label }) => {
            const active = methodFilter === key;
            const colors: Record<string, string> = {
              all: theme.accent.cyan, cash: "#34d399", mpesa: theme.accent.cyan,
              split: "#fbbf24", credit: "#f87171",
            };
            const col = colors[key];
            return (
              <button key={key} className="filter-pill"
                onClick={() => setMethodFilter(key)}
                style={{
                  padding: "7px 14px", borderRadius: 50, whiteSpace: "nowrap",
                  border: `1px solid ${active ? col : theme.border.default}`,
                  background: active ? `${col}22` : "transparent",
                  color: active ? col : theme.text.muted,
                  fontFamily: theme.font.mono, fontSize: 11, fontWeight: active ? 600 : 400,
                  display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
                }}>
                {icon && <span style={{ fontSize: 13 }}>{icon}</span>}
                {label}
              </button>
            );
          })}
        </div>

        {/* Summary strip — auto-fit so 3 cards stay in one row on normal phones
            and 4 cards (with queue) wrap to 2×2 on narrow screens */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))", gap: 8 }}>
          {[
            { label: "Net Total", value: fmt(totalRevenue - totalRefunded), color: theme.accent.gold },
            { label: "Cash",      value: fmt(totalCash - cashRefunded),     color: "#34d399"         },
            { label: "M-Pesa",    value: fmt(totalMpesa - mpesaRefunded),   color: "#60a5fa"         },
            ...(queuedSales.length > 0
              ? [{ label: "Queued", value: fmt(queuedTotal), color: "#fbbf24" }]
              : []),
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: label === "Queued" ? "rgba(251,191,36,0.06)" : theme.bg.card, border: `1px solid ${label === "Queued" ? "rgba(251,191,36,0.25)" : theme.border.default}`, borderRadius: 12, padding: "11px 12px" }}>
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: label === "Queued" ? "#fbbf24" : theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>{label}</div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 14, color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
            </div>
          ))}
        </div>
        {totalRefunded > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>↩</span>
              <div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: "#f87171", textTransform: "uppercase", letterSpacing: "0.07em" }}>Returns Deducted</div>
                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "rgba(248,113,113,0.6)", marginTop: 1 }}>Gross sales: {fmt(totalRevenue)}</div>
              </div>
            </div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 15, color: "#f87171" }}>-{fmt(totalRefunded)}</div>
          </div>
        )}
        {totalCommissionClawed > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "rgba(251,146,60,0.05)", border: "1px solid rgba(251,146,60,0.2)", borderRadius: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14 }}>💸</span>
              <div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: "#fb923c", textTransform: "uppercase", letterSpacing: "0.07em" }}>Commission Clawed Back</div>
                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "rgba(251,146,60,0.6)", marginTop: 1 }}>Cancelled or reduced due to returns</div>
              </div>
            </div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 15, color: "#fb923c" }}>-{fmt(totalCommissionClawed)}</div>
          </div>
        )}

        {/* Queued offline sales */}
        {queuedSales.length > 0 && (
          <div style={{ background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 18, overflow: "hidden" }}>
            <div style={{ padding: "12px 18px", borderBottom: "1px solid rgba(251,191,36,0.15)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>⏳</span>
                <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, color: "#fbbf24" }}>
                  Queued Offline
                </div>
              </div>
              <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: "#fbbf24", opacity: 0.7 }}>
                {queuedSales.length} sale{queuedSales.length !== 1 ? "s" : ""} · will sync on reconnect
              </div>
            </div>

            {queuedSales.map((q, i) => {
              const isOpen = expandedQ === q.id;
              const isLast = i === queuedSales.length - 1;
              return (
                <div key={q.id}>
                  <div
                    onClick={() => setExpandedQ(isOpen ? null : q.id)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: (!isOpen && isLast) ? "none" : "1px solid rgba(251,191,36,0.1)", cursor: "pointer", background: isOpen ? "rgba(251,191,36,0.04)" : undefined }}>
                    <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
                      ⏳
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: theme.text.primary }}>
                        {queuedLabel(q)}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                        {q.verifiedAgent.name} · {timeAgo(q.queuedAt)}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 20, padding: "2px 8px" }}>
                          QUEUED
                        </span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: "#fbbf24" }}>{fmt(q.grandTotal)}</div>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{payLabel(q.payMethod)}</div>
                      <div style={{ fontSize: 10, color: theme.text.muted, marginTop: 3 }}>{isOpen ? "▲" : "▼"}</div>
                    </div>
                  </div>

                  {isOpen && (
                    <div style={{ borderBottom: isLast ? "none" : "1px solid rgba(251,191,36,0.1)", background: "rgba(251,191,36,0.02)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {[
                          { label: "Status",  value: "Pending sync", color: "#fbbf24", full: true },
                          { label: "Seller",  value: q.verifiedAgent.name },
                          { label: "Payment", value: payLabel(q.payMethod) },
                          ...(q.customerName  ? [{ label: "Customer", value: q.customerName }] : []),
                          ...(q.customerPhone ? [{ label: "Phone",    value: q.customerPhone }] : []),
                          { label: "Queued",  value: new Date(q.queuedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) },
                          { label: "Total",   value: fmt(q.grandTotal), color: "#fbbf24" },
                        ].map(({ label, value, color, full }: { label: string; value: string; color?: string; full?: boolean }) => (
                          <div key={label} style={{ background: theme.bg.input, borderRadius: 8, padding: "9px 12px", gridColumn: full ? "1 / -1" : undefined }}>
                            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: color ?? theme.text.primary }}>{value}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Items</div>
                        {q.cart.map((item, idx) => (
                          <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", background: theme.bg.input, borderRadius: 8 }}>
                            <span style={{ fontSize: 12, color: theme.text.secondary }}>{item.quantity}× {item.productName}</span>
                            <span style={{ fontSize: 12, fontFamily: theme.font.mono, color: theme.text.primary }}>{fmt(item.sellPrice * item.quantity)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Transaction list */}
        <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 18, overflow: "hidden", animation: "fadeUp 0.3s ease" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${theme.border.default}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 14 }}>Records</div>
            <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted }}>
              {displayed.length} shown{hasMore ? " · more available" : ""}
            </div>
          </div>

          {loading ? (
            <div style={{ padding: "48px 20px", textAlign: "center" }}>
              <div style={{ width: 24, height: 24, border: "3px solid rgba(6,182,212,0.2)", borderTopColor: theme.accent.cyan, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 10px" }} />
              <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono }}>Loading transactions...</div>
            </div>
          ) : fetchError ? (
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
              <div style={{ color: "#f87171", fontSize: 13, fontFamily: theme.font.mono, marginBottom: 6 }}>Failed to load transactions</div>
              <div style={{ color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, marginBottom: 14, wordBreak: "break-all" }}>{fetchError}</div>
              <button onClick={() => fetchTransactions()} style={{ padding: "8px 18px", background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)", borderRadius: 10, color: theme.accent.cyan, fontFamily: theme.font.mono, fontSize: 12, cursor: "pointer" }}>
                Retry
              </button>
            </div>
          ) : sortedDateKeys.length === 0 ? (
            <div style={{ padding: "60px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 40, opacity: 0.2, marginBottom: 12 }}>🧾</div>
              <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono }}>
                {typeFilter === "returns" ? "No returned transactions" : typeFilter === "expenses" ? "No expenses recorded" : "No transactions found"}
              </div>
              {search && <div style={{ color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, marginTop: 4 }}>Try clearing your search</div>}
            </div>
          ) : (
            <div>
              {sortedDateKeys.map(date => {
                const items = unifiedByDate[date];
                const txnsForDate = items.filter(i => i.kind === "tx").map(i => i.data as LocalTransaction);
                const expsForDate = items.filter(i => i.kind === "exp").map(i => i.data as typeof shopExpenses[number]);
                const cpsForDate  = items.filter(i => i.kind === "cp").map(i => i.data as CreditPaymentRow);
                const dayNet = txnsForDate.reduce((s, t) => s + t.amount, 0) + cpsForDate.reduce((s, c) => s + c.amount, 0) - expsForDate.reduce((s, e) => s + e.amount, 0);
                // Merge all item types into one time-sorted list so the render order matches real time
                type DayItem =
                  | { kind: "exp";   data: typeof expsForDate[number] }
                  | { kind: "cp";    data: CreditPaymentRow }
                  | { kind: "group"; data: SaleGroup };
                const txGroups = groupTransactions(txnsForDate);
                const dayItems: DayItem[] = [
                  ...expsForDate.map(d => ({ kind: "exp"   as const, data: d })),
                  ...cpsForDate .map(d => ({ kind: "cp"    as const, data: d })),
                  ...txGroups   .map(d => ({ kind: "group" as const, data: d })),
                ].sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime());
                return (
                <div key={date}>
                  {/* Date group header */}
                  <div style={{ padding: "8px 18px", background: "rgba(255,255,255,0.02)", borderBottom: `1px solid ${theme.border.default}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{formatDateHeader(date)}</div>
                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.accent.gold }}>{fmt(dayNet)}</div>
                  </div>

                  {/* All rows merged and sorted strictly by time */}
                  {dayItems.map((item, _di) => {
                    if (item.kind === "exp") {
                      const exp = item.data;
                      const pmLabel: Record<string, string> = { cash: "💵 Cash", mpesa: "📱 M-Pesa", split: "⚡ Split" };
                      return (
                        <div key={`exp-${exp.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: `1px solid ${theme.border.default}`, background: "rgba(248,113,113,0.03)" }}>
                          <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>💸</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: "#f87171", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exp.description}</div>
                            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                              {pmLabel[exp.payment_method] ?? exp.payment_method} · {new Date(exp.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                            {exp.payment_method === "split" && exp.cash_amount > 0 && exp.mpesa_amount > 0 && (
                              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                                <span style={{ color: "#34d399" }}>💵 {fmt(exp.cash_amount)}</span>
                                <span style={{ margin: "0 6px", color: theme.border.default }}>·</span>
                                <span style={{ color: "#06b6d4" }}>📱 {fmt(exp.mpesa_amount)}</span>
                              </div>
                            )}
                            <div style={{ display: "inline-block", marginTop: 4, background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 20, padding: "2px 8px", fontSize: 9, fontWeight: 700, color: "#f87171", fontFamily: theme.font.mono, letterSpacing: "0.06em" }}>EXPENSE</div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: "#f87171" }}>−{fmt(exp.amount)}</div>
                          </div>
                        </div>
                      );
                    }
                    if (item.kind === "cp") {
                      const cp = item.data;
                      const pmLabel: Record<string, string> = { cash: "💵 Cash", mpesa: "📱 M-Pesa", split: "⚡ Split" };
                      return (
                        <div key={`cp-${cp.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: `1px solid ${theme.border.default}`, background: "rgba(192,132,252,0.03)" }}>
                          <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(192,132,252,0.12)", border: "1px solid rgba(192,132,252,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>💳</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: "#c084fc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cp.customer_name ?? "Credit Payment"}</div>
                            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                              {pmLabel[cp.payment_method] ?? cp.payment_method}{" · "}{new Date(cp.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                            {cp.payment_method === "split" && cp.cash_amount > 0 && cp.mpesa_amount > 0 && (
                              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                                <span style={{ color: "#34d399" }}>💵 {fmt(cp.cash_amount)}</span>
                                <span style={{ margin: "0 6px" }}>·</span>
                                <span style={{ color: "#06b6d4" }}>📱 {fmt(cp.mpesa_amount)}</span>
                              </div>
                            )}
                            {cp.mpesa_ref && <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>Ref: {cp.mpesa_ref}</div>}
                            <div style={{ display: "inline-block", marginTop: 4, background: "rgba(192,132,252,0.15)", border: "1px solid rgba(192,132,252,0.3)", borderRadius: 20, padding: "2px 8px", fontSize: 9, fontWeight: 700, color: "#c084fc", fontFamily: theme.font.mono, letterSpacing: "0.06em" }}>CREDIT PAYMENT</div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: "#c084fc" }}>+{fmt(cp.amount)}</div>
                          </div>
                        </div>
                      );
                    }
                    // kind === "group"
                    const group        = item.data;
                    const isMulti      = group.items.length > 1;
                    const isOpen       = expanded === group.key;
                    const isCredit     = group.items.some(t => t.status === "credit_partial" || t.status === "credit");
                    const badge        = methodBadge(group.payment_method, isCredit ? (group.items[0].status) : null);
                    const returnStatus = getReturnStatus(group);
                    const isLast = _di === dayItems.length - 1;

                    if (isMulti) {
                      const label = `${group.items[0].product_name ?? "Item"} +${group.items.length - 1} more`;
                      return (
                        <div key={group.key} className="tx-row" onClick={() => setExpanded(isOpen ? null : group.key)} style={{ cursor: "pointer" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: (!isOpen && isLast) ? "none" : `1px solid ${theme.border.default}`, background: isOpen ? "rgba(6,182,212,0.03)" : undefined }}>
                            <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
                              🛒
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
                              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{group.seller_name} · {new Date(group.created_at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5 }}>
                                <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: theme.accent.cyan, background: "rgba(6,182,212,0.10)", border: "1px solid rgba(6,182,212,0.25)", borderRadius: 20, padding: "2px 8px" }}>
                                  {group.items.length} items
                                </span>
                                {isCredit && (
                                  <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: "#c084fc", background: "rgba(192,132,252,0.10)", border: "1px solid rgba(192,132,252,0.30)", borderRadius: 20, padding: "2px 8px" }}>
                                    {group.items.some(t => t.status === "credit_partial") ? "📝 Credit · Partial Payment" : "📝 Credit · Unpaid"}
                                  </span>
                                )}
                                {returnStatus !== "none" && (
                                  <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.30)", borderRadius: 20, padding: "2px 8px" }}>
                                    {returnStatus === "full" ? "↩ Returned" : "↩ Partial Return"}
                                  </span>
                                )}
                                {group.items.some(t => t.status === "review") && (
                                  <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: "#fbbf24", background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 20, padding: "2px 8px" }}>
                                    🚩 Flagged for Review
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: theme.accent.gold }}>{fmt(group.total)}</div>
                              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: badge.color, marginTop: 2 }}>{badge.label}</div>
                              <div style={{ fontSize: 10, color: theme.text.muted, marginTop: 3 }}>{isOpen ? "▲" : "▼"}</div>
                            </div>
                          </div>
                          {isOpen && (
                            <div className="expand-panel" onClick={e => e.stopPropagation()} style={{ cursor: "default", borderBottom: isLast ? "none" : `1px solid ${theme.border.default}`, background: "rgba(255,255,255,0.01)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
                              <div style={{ background: theme.bg.input, borderRadius: 8, padding: "9px 12px" }}>
                                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Date &amp; Time</div>
                                <div style={{ fontSize: 12, fontWeight: 600, fontFamily: theme.font.mono, color: theme.text.primary }}>{new Date(group.created_at).toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                              </div>
                              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Items in this sale</div>
                              {group.items.map(tx => (
                                <div key={tx.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: theme.bg.input, borderRadius: 10 }}>
                                  <div style={{ width: 32, height: 32, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.05)", border: `1px solid ${theme.border.default}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, position: "relative" }}>
                                    <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>📦</span>
                                    {tx.product_image_url && (
                                      <img src={tx.product_image_url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                                    )}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.product_name ?? "—"}</div>
                                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{tx.quantity}× · {tx.unit_price != null ? fmt(tx.unit_price) : "—"}/unit</div>
                                    <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>TXN-{tx.id.slice(0, 8).toUpperCase()}</div>
                                  </div>
                                  <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 13, color: theme.accent.gold, flexShrink: 0 }}>{fmt(tx.amount)}</div>
                                </div>
                              ))}
                              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.15)", borderRadius: 10, marginTop: 2 }}>
                                <span style={{ fontSize: 12, fontFamily: theme.font.mono, color: theme.text.muted }}>Sale Total · {badge.label}</span>
                                <span style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: theme.accent.gold }}>{fmt(group.total)}</span>
                              </div>
                              {/* Group commission summary */}
                              {(() => {
                                const groupCommissionEarned = group.items.reduce((s, t) => s + (t.commission_earned ?? 0), 0);
                                const groupCommissionClawed = group.items.reduce((s, t) => s + calcClawback(t), 0);
                                if (groupCommissionEarned === 0) return null;
                                return (
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: groupCommissionClawed > 0 ? "rgba(251,146,60,0.06)" : "rgba(52,211,153,0.06)", border: `1px solid ${groupCommissionClawed > 0 ? "rgba(251,146,60,0.25)" : "rgba(52,211,153,0.2)"}`, borderRadius: 10 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ fontSize: 14 }}>{groupCommissionClawed > 0 ? "💸" : "✨"}</span>
                                      <div>
                                        <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: groupCommissionClawed > 0 ? "#fb923c" : "#34d399", fontWeight: 700 }}>
                                          Commission {groupCommissionClawed > 0 ? (groupCommissionClawed >= groupCommissionEarned ? "Cancelled" : "Reduced") : "Earned"}
                                        </div>
                                        {groupCommissionClawed > 0 && (
                                          <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "rgba(251,146,60,0.65)", marginTop: 1 }}>
                                            Was {fmt(groupCommissionEarned)} · -{fmt(groupCommissionClawed)} clawed back
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 13, color: groupCommissionClawed > 0 ? "#fb923c" : "#34d399" }}>
                                      {groupCommissionClawed > 0 ? fmt(groupCommissionEarned - groupCommissionClawed) : fmt(groupCommissionEarned)}
                                    </div>
                                  </div>
                                );
                              })()}
                              {returnStatus !== "full" && (
                                <button
                                  onClick={e => { e.stopPropagation(); openReturnModal(group); }}
                                  style={{ width: "100%", padding: "11px 16px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, color: "#f87171", fontFamily: theme.font.mono, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                                  ↩ Return Products
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }

                    // Single-item group — same display as before
                    const tx        = group.items[0];
                    const rcpt      = receiptBadge(tx);
                    const phone     = tx.receipt_phone ?? tx.customer_phone;

                    return (
                      <div key={group.key} className="tx-row" onClick={() => setExpanded(isOpen ? null : group.key)} style={{ cursor: "pointer" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: (!isOpen && isLast) ? "none" : `1px solid ${theme.border.default}`, background: isOpen ? "rgba(6,182,212,0.03)" : undefined }}>
                          <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0, overflow: "hidden", position: "relative" }}>
                            <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{badge.icon}</span>
                            {tx.product_image_url && (
                              <img src={tx.product_image_url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                                onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.product_name ?? "—"}</div>
                            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{tx.seller_name} · {new Date(tx.created_at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>TXN-{tx.id.slice(0, 8).toUpperCase()}</div>
                            {(tx.status === "credit_partial" || tx.status === "credit") && (
                              <div style={{ marginTop: 5 }}>
                                <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: "#c084fc", background: "rgba(192,132,252,0.10)", border: "1px solid rgba(192,132,252,0.30)", borderRadius: 20, padding: "2px 8px" }}>
                                  {tx.status === "credit_partial" ? "📝 Credit · Partial Payment" : "📝 Credit · Unpaid"}
                                </span>
                              </div>
                            )}
                            {rcpt && (
                              <div style={{ marginTop: 5 }}>
                                <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 600, color: rcpt.color, background: rcpt.bg, border: `1px solid ${rcpt.border}`, borderRadius: 20, padding: "2px 8px" }}>
                                  {rcpt.label}
                                </span>
                              </div>
                            )}
                            {returnStatus !== "none" && (
                              <div style={{ marginTop: 5 }}>
                                <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.10)", border: "1px solid rgba(248,113,113,0.30)", borderRadius: 20, padding: "2px 8px" }}>
                                  {returnStatus === "full" ? "↩ Returned" : "↩ Partial Return"}
                                </span>
                              </div>
                            )}
                            {tx.status === "review" && (
                              <div style={{ marginTop: 5 }}>
                                <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: "#fbbf24", background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 20, padding: "2px 8px" }}>
                                  🚩 Flagged for Review
                                </span>
                              </div>
                            )}
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: theme.accent.gold }}>{fmt(tx.amount)}</div>
                            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: badge.color, marginTop: 2 }}>{tx.quantity}× · {badge.label}</div>
                            <div style={{ fontSize: 10, color: theme.text.muted, marginTop: 3 }}>{isOpen ? "▲" : "▼"}</div>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="expand-panel" onClick={e => e.stopPropagation()} style={{ cursor: "default", borderBottom: isLast ? "none" : `1px solid ${theme.border.default}`, background: "rgba(255,255,255,0.01)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                              {([
                                { label: "Transaction ID", value: "TXN-" + tx.id.slice(0, 8).toUpperCase(), full: true, mono: true },
                                { label: "Date & Time", value: new Date(tx.created_at).toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }), full: true, mono: true },
                                ...(tx.status === "credit_partial" ? [{ label: "Sale Type", value: "Credit Sale · Partial Payment", full: true, color: "#c084fc" }] : []),
                                ...(tx.status === "credit" ? [{ label: "Sale Type", value: "Credit Sale · No Payment Yet", full: true, color: "#c084fc" }] : []),
                                { label: "Product",    value: tx.product_name ?? "—" },
                                { label: "SKU",        value: tx.product_sku  || "—", mono: true },
                                { label: "Unit Price", value: tx.unit_price != null ? fmt(tx.unit_price) : "—" },
                                { label: "Qty",        value: String(tx.quantity) },
                                { label: "Total",      value: fmt(tx.amount), color: theme.accent.gold },
                                ...(tx.commission_earned && tx.commission_earned > 0 ? [{ label: "Commission Earned", value: fmt(tx.commission_earned), color: "#34d399" }] : []),
                                { label: "Payment",    value: tx.payment_method === "mpesa" ? "📱 M-Pesa" : tx.payment_method === "split" ? "⚡ Split" : "💵 Cash" },
                                ...(tx.cash_amount  && tx.cash_amount  > 0 ? [{ label: "Cash",       value: fmt(tx.cash_amount)  }] : []),
                                ...(tx.mpesa_amount && tx.mpesa_amount > 0 ? [{ label: "M-Pesa",     value: fmt(tx.mpesa_amount) }] : []),
                                ...(tx.mpesa_ref                            ? [{ label: "M-Pesa Ref", value: tx.mpesa_ref, mono: true }] : []),
                                { label: "Seller",     value: tx.seller_name ?? "—" },
                                ...(tx.customer_phone ? [{ label: "Customer Phone", value: tx.customer_phone }] : []),
                                {
                                  label: "Receipt",
                                  value: tx.receipt_sent === true ? `📱 Sent to ${tx.receipt_phone ?? tx.customer_phone}` : tx.receipt_sent === false ? "📵 Failed to send" : phone ? "📄 Not sent yet" : "— No phone on file",
                                  full: true,
                                  color: tx.receipt_sent === true ? "#34d399" : tx.receipt_sent === false ? "#fbbf24" : theme.text.muted,
                                },
                              ] as { label: string; value: string; full?: boolean; mono?: boolean; color?: string }[]).map(({ label, value, full, mono, color }) => (
                                <div key={label} style={{ background: theme.bg.input, borderRadius: 8, padding: "9px 12px", gridColumn: full ? "1 / -1" : undefined }}>
                                  <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: color ?? theme.text.primary, fontFamily: mono ? theme.font.mono : theme.font.body }}>{value}</div>
                                </div>
                              ))}
                            </div>
                            {/* Commission clawback detail */}
                            {(() => {
                              const totalClawed = calcClawback(tx);
                              if (totalClawed === 0) return null;
                              const isFullReturn = returnStatus === "full";
                              return (
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "rgba(251,146,60,0.06)", border: "1px solid rgba(251,146,60,0.25)", borderRadius: 10 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 16 }}>💸</span>
                                    <div>
                                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: "#fb923c", fontWeight: 700 }}>
                                        Commission {isFullReturn ? "Cancelled" : "Reduced"}
                                      </div>
                                      <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "rgba(251,146,60,0.65)", marginTop: 1 }}>
                                        Due to product return · was {fmt(tx.commission_earned ?? 0)}
                                      </div>
                                    </div>
                                  </div>
                                  <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 13, color: "#fb923c" }}>-{fmt(totalClawed)}</div>
                                </div>
                              );
                            })()}
                            <div onClick={e => e.stopPropagation()}>
                              {tx.receipt_sent === true ? (
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 10 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span>📱</span>
                                    <span style={{ fontSize: 12, fontFamily: theme.font.mono, color: "#34d399" }}>Sent to <strong>{tx.receipt_phone ?? tx.customer_phone}</strong></span>
                                  </div>
                                  <button onClick={() => openResendModal(tx)} style={{ padding: "5px 14px", background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 8, color: "#34d399", fontFamily: theme.font.mono, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                                    Resend
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => openResendModal(tx)}
                                  style={{ width: "100%", padding: "12px 16px", background: tx.receipt_sent === false ? "rgba(234,179,8,0.08)" : "rgba(6,182,212,0.08)", border: `1px solid ${tx.receipt_sent === false ? "rgba(234,179,8,0.3)" : "rgba(6,182,212,0.25)"}`, borderRadius: 10, color: tx.receipt_sent === false ? "#fbbf24" : theme.accent.cyan, fontFamily: theme.font.mono, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                                  {tx.receipt_sent === false ? "📵 Retry Receipt" : "📄 Send Receipt"}
                                </button>
                              )}
                            </div>
                            {!phone && (
                              <button
                                onClick={e => { e.stopPropagation(); openResendModal(tx); }}
                                style={{ width: "100%", padding: "12px 16px", background: "rgba(255,255,255,0.04)", border: `1px solid ${theme.border.default}`, borderRadius: 10, color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                                📄 Send Receipt (enter number)
                              </button>
                            )}
                            {returnStatus !== "full" && tx.product_id && (
                              <button
                                onClick={e => { e.stopPropagation(); openReturnModal(group); }}
                                style={{ width: "100%", padding: "11px 16px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, color: "#f87171", fontFamily: theme.font.mono, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                                ↩ {returnStatus === "partial" ? "Return More" : "Return Product"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                );
              })}
            </div>
          )}

          {hasMore && !loading && (
            <div style={{ padding: "14px 18px", borderTop: `1px solid ${theme.border.default}`, textAlign: "center" }}>
              <button onClick={loadMore} disabled={loadingMore}
                style={{
                  padding: "10px 28px", background: "rgba(6,182,212,0.1)",
                  border: "1px solid rgba(6,182,212,0.25)", borderRadius: 10,
                  color: theme.accent.cyan, fontFamily: theme.font.mono, fontSize: 12,
                  cursor: loadingMore ? "not-allowed" : "pointer", opacity: loadingMore ? 0.6 : 1,
                  display: "inline-flex", alignItems: "center", gap: 8,
                }}>
                {loadingMore
                  ? <><span style={{ width: 12, height: 12, border: "2px solid rgba(6,182,212,0.3)", borderTopColor: theme.accent.cyan, borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} /> Loading...</>
                  : `Load next ${PAGE_SIZE}`}
              </button>
            </div>
          )}
        </div>

      </div>

      {/* ── Resend / Send Receipt Modal ──────────────────────────────────── */}
    {resendModal && (
      <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "flex-end", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
        onClick={e => { if (e.target === e.currentTarget) setResendModal(null); }}>
        <div style={{ width: "100%", background: theme.bg.card, borderRadius: "20px 20px 0 0", border: `1px solid ${theme.border.default}`, borderBottom: "none", padding: "20px 18px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 17 }}>📄 Send Receipt</div>
              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                {resendModal.product_name ?? "Transaction"} · {fmt(resendModal.amount)}
              </div>
            </div>
            <button onClick={() => setResendModal(null)} style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${theme.border.default}`, borderRadius: 10, width: 36, height: 36, cursor: "pointer", color: theme.text.muted, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
              ×
            </button>
          </div>

          <div>
            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Phone Number
            </div>
            <input
              type="tel"
              value={resendPhone}
              onChange={e => setResendPhone(e.target.value)}
              placeholder="e.g. 0712345678"
              style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 12, color: theme.text.primary, fontSize: 15, fontFamily: theme.font.mono, outline: "none" }}
            />
            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 5 }}>
              You can edit this number before sending
            </div>
          </div>

          <button
            onClick={async () => {
              if (!resendPhone.trim()) return;
              await handleResend(resendModal, resendPhone.trim());
              setResendModal(null);
            }}
            disabled={!resendPhone.trim() || resendingId === resendModal.id}
            style={{ padding: "14px 20px", background: "linear-gradient(135deg,#0891b2,#06b6d4)", border: "none", borderRadius: 14, color: "#fff", fontFamily: theme.font.mono, fontSize: 14, fontWeight: 700, cursor: (!resendPhone.trim() || resendingId === resendModal.id) ? "not-allowed" : "pointer", opacity: (!resendPhone.trim() || resendingId === resendModal.id) ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {resendingId === resendModal.id
              ? <><span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} /> Sending...</>
              : `📱 Send to ${resendPhone.trim() || "..."}`}
          </button>
        </div>
      </div>
    )}

      {/* ── Return Modal ─────────────────────────────────────────────────── */}
    {returnModal && (
      <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "flex-end", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
        onClick={e => { if (e.target === e.currentTarget) setReturnModal(null); }}>
        <div style={{ width: "100%", maxHeight: "90vh", overflowY: "auto", background: theme.bg.card, borderRadius: "20px 20px 0 0", border: `1px solid ${theme.border.default}`, borderBottom: "none", padding: "20px 18px 40px", display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Modal header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 18, color: "#f87171" }}>↩ Return Products</div>
              <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                {returnModal.group.seller_name} · {new Date(returnModal.group.created_at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
            <button onClick={() => setReturnModal(null)} style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${theme.border.default}`, borderRadius: 10, width: 36, height: 36, cursor: "pointer", color: theme.text.muted, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
              ×
            </button>
          </div>

          {/* Items */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Select items &amp; quantities to return
            </div>
            {returnModal.items.map(item => {
              const max = item.original_qty - item.already_returned;
              const refund = item.return_qty * item.unit_price;
              return (
                <div key={item.txn_id} style={{ background: theme.bg.input, borderRadius: 12, padding: "12px 14px", border: item.return_qty > 0 ? "1px solid rgba(248,113,113,0.4)" : `1px solid ${theme.border.default}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.product_name}</div>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                        {fmt(item.unit_price)}/unit · Sold: {item.original_qty}
                        {item.already_returned > 0 && ` · Already returned: ${item.already_returned}`}
                        {" · Max: "}{max}
                      </div>
                    </div>
                    {item.return_qty > 0 && (
                      <div style={{ fontSize: 12, fontFamily: theme.font.mono, fontWeight: 700, color: "#f87171", flexShrink: 0 }}>
                        -{fmt(refund)}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                    <span style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted }}>Return qty:</span>
                    <button onClick={() => updateReturnQty(item.txn_id, item.return_qty - 1)}
                      style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: `1px solid ${theme.border.default}`, color: theme.text.primary, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      −
                    </button>
                    <input
                      type="text" inputMode="numeric" value={item.return_qty}
                      onChange={e => updateReturnQty(item.txn_id, parseInt(e.target.value) || 0)}
                      style={{ width: 54, textAlign: "center", padding: "6px 8px", background: theme.bg.base, border: `1px solid ${theme.border.default}`, borderRadius: 8, color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 14, outline: "none" }}
                    />
                    <button onClick={() => updateReturnQty(item.txn_id, item.return_qty + 1)}
                      style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: `1px solid ${theme.border.default}`, color: theme.text.primary, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      +
                    </button>
                    <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>of {max} max</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Refund + commission impact summary */}
          {returnModal.items.some(i => i.return_qty > 0) && (() => {
            // Compute per-item breakdown: credit items reduce balance first, excess is cash
            let totalBalanceReduction = 0;
            let totalCashRefund = 0;
            for (const item of returnModal.items) {
              if (item.return_qty <= 0) continue;
              const returnValue = item.return_qty * item.unit_price;
              const isCredit = item.status === "credit" || item.status === "credit_partial";
              if (isCredit && item.outstanding !== null) {
                const balanceDeduction = Math.min(returnValue, item.outstanding);
                totalBalanceReduction += balanceDeduction;
                totalCashRefund       += returnValue - balanceDeduction;
              } else {
                totalCashRefund += returnValue;
              }
            }
            const commissionImpact = returnModal.items.reduce((s, item) => {
              const origTx = returnModal.group.items.find(t => t.id === item.txn_id);
              if (!origTx?.commission_earned || !item.original_qty) return s;
              return s + Math.round((item.return_qty / item.original_qty) * origTx.commission_earned);
            }, 0);
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {totalBalanceReduction > 0 && (
                  <div style={{ padding: "12px 16px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 12, fontFamily: theme.font.mono, color: "#f87171", fontWeight: 700 }}>📉 Credit Balance Reduced</div>
                        <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: "rgba(248,113,113,0.6)", marginTop: 2 }}>
                          Customer's outstanding debt reduced by this amount
                        </div>
                      </div>
                      <span style={{ fontSize: 16, fontFamily: theme.font.mono, fontWeight: 800, color: "#f87171" }}>-{fmt(totalBalanceReduction)}</span>
                    </div>
                  </div>
                )}
                {totalCashRefund > 0 && (
                  <div style={{ padding: "12px 16px", background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 12, fontFamily: theme.font.mono, color: "#34d399", fontWeight: 700 }}>💵 Cash Refund to Customer</div>
                        <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: "rgba(52,211,153,0.6)", marginTop: 2 }}>
                          {totalBalanceReduction > 0 ? "Excess after clearing outstanding balance" : "Agent hands this cash back to customer"}
                        </div>
                      </div>
                      <span style={{ fontSize: 16, fontFamily: theme.font.mono, fontWeight: 800, color: "#34d399" }}>{fmt(totalCashRefund)}</span>
                    </div>
                  </div>
                )}
                {commissionImpact > 0 && (
                  <div style={{ padding: "10px 14px", background: "rgba(251,146,60,0.07)", border: "1px solid rgba(251,146,60,0.25)", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: "#fb923c", fontWeight: 700 }}>💸 Commission Impact</div>
                      <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "rgba(251,146,60,0.6)", marginTop: 2 }}>Agent commission will be reduced by this amount</div>
                    </div>
                    <span style={{ fontSize: 14, fontFamily: theme.font.mono, fontWeight: 800, color: "#fb923c" }}>-{fmt(commissionImpact)}</span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Refund amounts — always-visible dual fields, method auto-detected from what is entered */}
          {(() => {
            const totalRefund = returnModal.items.filter(i => i.return_qty > 0).reduce((s, i) => s + i.return_qty * i.unit_price, 0);
            if (totalRefund <= 0) return null;
            const c   = Math.round(Number(returnCashRefund)  || 0);
            const m   = Math.round(Number(returnMpesaRefund) || 0);
            const tot = c + m;
            const diff     = tot > 0 ? tot - totalRefund : null;
            const balanced = diff !== null && diff === 0;
            const balColor = diff === null ? theme.text.muted : balanced ? "#34d399" : diff > 0 ? "#f87171" : "#fbbf24";
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Refund amounts · Suggested: {fmt(totalRefund)}
                </label>

                {/* Cash field */}
                <div>
                  <label style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#34d399", display: "block", marginBottom: 4, textTransform: "uppercase" }}>💵 Cash</label>
                  <input type="text" inputMode="numeric" value={returnCashRefund}
                    onChange={e => { setReturnCashRefund(e.target.value.replace(/[^0-9]/g, "")); setReturnError(""); }}
                    placeholder="0"
                    style={{ width: "100%", boxSizing: "border-box" as const, background: theme.bg.input, border: "1px solid rgba(52,211,153,0.4)", borderRadius: 10, padding: "11px 14px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 14, fontWeight: 700, outline: "none" }} />
                  {m > 0 && c === 0 && (
                    <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#34d399", opacity: 0.6, marginTop: 3 }}>
                      💡 Type {fmt(Math.max(0, totalRefund - m))} to balance
                    </div>
                  )}
                </div>

                {/* M-Pesa field */}
                <div>
                  <label style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.accent.cyan, display: "block", marginBottom: 4, textTransform: "uppercase" }}>📱 M-Pesa</label>
                  <input type="text" inputMode="numeric" value={returnMpesaRefund}
                    onChange={e => { setReturnMpesaRefund(e.target.value.replace(/[^0-9]/g, "")); setReturnError(""); }}
                    placeholder="0"
                    style={{ width: "100%", boxSizing: "border-box" as const, background: theme.bg.input, border: `1px solid rgba(6,182,212,0.4)`, borderRadius: 10, padding: "11px 14px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 14, fontWeight: 700, outline: "none" }} />
                  {c > 0 && m === 0 && (
                    <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#06b6d4", opacity: 0.6, marginTop: 3 }}>
                      💡 Type {fmt(Math.max(0, totalRefund - c))} to balance
                    </div>
                  )}
                </div>

                {/* Running total */}
                {tot > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", background: balanced ? "rgba(52,211,153,0.06)" : "rgba(255,255,255,0.03)", border: `1px solid ${balanced ? "rgba(52,211,153,0.25)" : theme.border.default}`, borderRadius: 9 }}>
                    <span style={{ fontSize: 11, fontFamily: theme.font.mono, color: balColor }}>
                      {balanced ? "✓ Balanced" : diff !== null && diff > 0 ? `⚠ KSh ${diff.toLocaleString()} over` : diff !== null ? `⚠ KSh ${Math.abs(diff).toLocaleString()} under` : ""}
                    </span>
                    <span style={{ fontSize: 13, fontFamily: theme.font.mono, fontWeight: 700, color: balColor }}>{fmt(tot)}</span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Reason */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Reason for return <span style={{ color: "#f87171" }}>*</span>
            </div>
            <textarea
              placeholder="e.g. Customer changed mind, defective product, wrong item…"
              value={returnReason}
              onChange={e => setReturnReason(e.target.value)}
              rows={3}
              style={{ padding: "10px 12px", background: theme.bg.input, border: `1px solid ${returnReason.trim() ? "rgba(248,113,113,0.4)" : theme.border.default}`, borderRadius: 12, color: theme.text.primary, fontSize: 13, fontFamily: theme.font.body, resize: "vertical", outline: "none", width: "100%", boxSizing: "border-box" }}
            />
          </div>

          {returnError && (
            <div style={{ padding: "10px 14px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, fontSize: 12, fontFamily: theme.font.mono, color: "#f87171" }}>
              {returnError}
            </div>
          )}

          {returnSuccess && (
            <div style={{ padding: "10px 14px", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 10, fontSize: 12, fontFamily: theme.font.mono, color: "#34d399", textAlign: "center" }}>
              ✓ Return recorded successfully
            </div>
          )}

          <button
            onClick={handleReturn}
            disabled={returnProcessing || returnSuccess}
            style={{ padding: "14px 20px", background: returnSuccess ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)", border: `1px solid ${returnSuccess ? "rgba(52,211,153,0.4)" : "rgba(248,113,113,0.4)"}`, borderRadius: 14, color: returnSuccess ? "#34d399" : "#f87171", fontFamily: theme.font.mono, fontSize: 14, fontWeight: 700, cursor: returnProcessing || returnSuccess ? "not-allowed" : "pointer", opacity: returnProcessing ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {returnProcessing
              ? <><span style={{ width: 14, height: 14, border: "2px solid rgba(248,113,113,0.3)", borderTopColor: "#f87171", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} /> Processing...</>
              : returnSuccess ? "✓ Done" : "↩ Confirm Return"}
          </button>
        </div>
      </div>
    )}
    </div>
  );
}
