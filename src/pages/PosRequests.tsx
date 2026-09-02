// pages/PosRequests.tsx
// Requests, Expenses and Credit tabs for shop agents

import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "../context/ThemeContext";
import { useShopAuth } from "../context/ShopAuthContext";
import { useNetwork } from "../context/NetworkContext";
import { supabase } from "../lib/supabase";
import { sanitizeInteger, sanitizeText, sanitizeAmount, sanitizeCode } from "../lib/sanitize";
import { enqueueRequest, enqueueExpense, getMiscQueue, type QueuedRequest, type QueuedExpense } from "../lib/offlineQueue";

const fmt = (n: number) => `KSh ${n.toLocaleString()}`;

function useWindowWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type RequestType = "stock_request" | "damage_report" | "demand_report" | "message";
type RequestStatus = "pending" | "approved" | "rejected";
type ActiveTab = "requests" | "expenses" | "credit";

interface ShopRequest {
  id: string;
  type: RequestType;
  product_id: string | null;
  product_name: string | null;
  quantity: number | null;
  message: string;
  status: RequestStatus;
  owner_reply: string | null;
  created_at: string;
  updated_at: string;
}

interface StockProduct {
  id: string;
  name: string;
  sku: string;
}

interface ShopAgent {
  id: string;
  pin: string;
  active: boolean;
  agent: { id: string; name: string; agent_id: string; avatar: string };
}

interface Expense {
  id: string;
  amount: number;
  description: string;
  payment_method: string;
  cash_amount: number;
  mpesa_amount: number;
  logged_by: string;
  logged_by_name: string;
  created_at: string;
  updated_at: string;
}

interface CreditSaleItem {
  allocation_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

interface CreditPayment {
  id: string;
  amount: number;
  payment_method: "cash" | "mpesa";
  mpesa_ref: string | null;
  collected_by_agent_id: string | null;
  collected_by_name: string | null;
  created_at: string;
}

interface CreditSale {
  id: string;
  amount: number;
  amount_paid: number;
  customer_name: string;
  customer_phone: string;
  seller_name: string;
  seller_agent_id: string;
  status: "pending" | "partial" | "paid" | "returned";
  items: CreditSaleItem[];
  created_at: string;
}

interface CustomerCreditGroup {
  key: string;
  customer_name: string;
  customer_phone: string;
  sales: CreditSale[];
  totalOutstanding: number;
  totalPaid: number;
  totalAmount: number;
  hasOpen: boolean;
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const REQUEST_TYPES: { value: RequestType; label: string; icon: string; desc: string; color: string }[] = [
  { value: "stock_request", label: "Stock Request",   icon: "📦", desc: "Request more stock of a product",         color: "#06b6d4" },
  { value: "damage_report", label: "Damage / Loss",   icon: "⚠️", desc: "Report damaged or lost product",          color: "#f87171" },
  { value: "demand_report", label: "Customer Demand", icon: "📣", desc: "Customers asking for a product you lack", color: "#a78bfa" },
  { value: "message",       label: "General Message", icon: "💬", desc: "Send a message or note to your owner",    color: "#34d399" },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

function statusBadge(status: RequestStatus) {
  const map = {
    pending:  { label: "Pending",  bg: "rgba(234,179,8,0.12)",   border: "rgba(234,179,8,0.3)",   color: "#fbbf24" },
    approved: { label: "Approved", bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.3)",  color: "#34d399" },
    rejected: { label: "Rejected", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)", color: "#f87171" },
  };
  const s = map[status];
  return (
    <span style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color, borderRadius: 6, padding: "2px 8px", fontSize: 10, fontFamily: "DM Mono, monospace", fontWeight: 500 }}>
      {s.label}
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PosRequests() {
  const { theme } = useTheme();
  const { shop, logout } = useShopAuth();
  const { isOnline, pendingCount: offlineQueueCount, refreshPendingCount } = useNetwork();
  const width = useWindowWidth();
  const isMobile = width < 640;
  const isTablet = width < 1024;

  const [activeTab, setActiveTab] = useState<ActiveTab>("requests");

  // Offline queued misc items (requests + expenses)
  const [queuedItems, setQueuedItems] = useState<(QueuedRequest | QueuedExpense)[]>([]);
  useEffect(() => {
    const all = getMiscQueue();
    setQueuedItems(all.map(i => {
      const { kind: _k, ...rest } = i as any;
      return rest as QueuedRequest | QueuedExpense;
    }));
  }, [offlineQueueCount]);

  // ── Requests state ────────────────────────────────────────────────────
  const [requests, setRequests]     = useState<ShopRequest[]>([]);
  const [products, setProducts]     = useState<StockProduct[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [type, setType]             = useState<RequestType>("stock_request");
  const [productId, setProductId]   = useState("");
  const [quantity, setQuantity]     = useState("");
  const [message, setMessage]       = useState("");
  const [formError, setFormError]   = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const needsProduct = type === "stock_request" || type === "damage_report" || type === "demand_report";
  const needsQty     = type === "stock_request" || type === "damage_report";

  // ── Agents state ──────────────────────────────────────────────────────
  const [agents, setAgents] = useState<ShopAgent[]>([]);

  // ── Expenses state ────────────────────────────────────────────────────
  const [expenses,      setExpenses]      = useState<Expense[]>([]);
  const [expLoading,    setExpLoading]    = useState(false);

  const [logOpen,        setLogOpen]        = useState(false);
  const [expDesc,        setExpDesc]        = useState("");
  const [expCashAmount,  setExpCashAmount]  = useState("");
  const [expMpesaAmount, setExpMpesaAmount] = useState("");
  const [expAgent,       setExpAgent]       = useState<ShopAgent | null>(null);
  const [expPin,         setExpPin]         = useState("");
  const [expPinError,    setExpPinError]    = useState("");
  const [expPinShake,    setExpPinShake]    = useState(false);
  const [expProcessing,  setExpProcessing]  = useState(false);
  const [expError,       setExpError]       = useState("");
  const [shopCashTotal,   setShopCashTotal]   = useState<number | null>(null);
  const [shopMpesaTotal,  setShopMpesaTotal]  = useState<number | null>(null);

  const [editTarget,    setEditTarget]    = useState<Expense | null>(null);
  const [editAmount,    setEditAmount]    = useState("");
  const [editDesc,      setEditDesc]      = useState("");
  const [editAgent,     setEditAgent]     = useState<ShopAgent | null>(null);
  const [editPin,       setEditPin]       = useState("");
  const [editPinError,  setEditPinError]  = useState("");
  const [editPinShake,  setEditPinShake]  = useState(false);
  const [editProcessing,setEditProcessing]= useState(false);
  const [editError,     setEditError]     = useState("");

  // ── Credit state ──────────────────────────────────────────────────────
  const [creditSales,    setCreditSales]    = useState<CreditSale[]>([]);
  const [creditLoading,  setCreditLoading]  = useState(false);

  const [payTarget,      setPayTarget]      = useState<CreditSale | null>(null);
  const [payGroupSales,  setPayGroupSales]  = useState<CreditSale[] | null>(null); // group-level payment
  const [payCashAmount,  setPayCashAmount]  = useState("");
  const [payMpesaAmount, setPayMpesaAmount] = useState("");
  const [payMpesaRef,    setPayMpesaRef]    = useState("");
  const [payAgent,       setPayAgent]       = useState<ShopAgent | null>(null);
  const [payPin,         setPayPin]         = useState("");
  const [payPinError,    setPayPinError]    = useState("");
  const [payPinShake,    setPayPinShake]    = useState(false);
  const [payProcessing,  setPayProcessing]  = useState(false);
  const [payError,       setPayError]       = useState("");

  const [returnTarget,       setReturnTarget]       = useState<CreditSale | null>(null);
  const [returnRefundMethod, setReturnRefundMethod] = useState<"cash" | "mpesa" | "split">("cash");
  const [returnCashRefund,   setReturnCashRefund]   = useState("");
  const [returnMpesaRefund,  setReturnMpesaRefund]  = useState("");
  const [returnAgent,        setReturnAgent]        = useState<ShopAgent | null>(null);
  const [returnPin,          setReturnPin]          = useState("");
  const [returnPinError,     setReturnPinError]     = useState("");
  const [returnPinShake,     setReturnPinShake]     = useState(false);
  const [returnProcessing,   setReturnProcessing]   = useState(false);
  const [returnError,        setReturnError]        = useState("");

  const [expandedCreditId,    setExpandedCreditId]    = useState<string | null>(null);
  const [expandedCustomerKey, setExpandedCustomerKey] = useState<string | null>(null);
  const [creditPayments,      setCreditPayments]      = useState<Record<string, CreditPayment[]>>({});
  const [paymentsLoading,     setPaymentsLoading]     = useState<string | null>(null);
  const [creditReturns, setCreditReturns] = useState<Record<string, TransactionReturn[]>>({});

  const [businessName,    setBusinessName]    = useState("");
  const [sendStmtGroup,   setSendStmtGroup]   = useState<CustomerCreditGroup | null>(null);
  const [sendStmtPhone,   setSendStmtPhone]   = useState("");
  const [sendStmtSending, setSendStmtSending] = useState(false);
  const [sendStmtError,   setSendStmtError]   = useState("");
  const [sendStmtSent,    setSendStmtSent]    = useState(false);


  // receipts for credit sales helper function
  const getOutstandingItems = (cs: CreditSale): { name: string; quantity: number; unit_price: number; total: number }[] => {
    const returnsForSale = creditReturns[cs.id] || [];
    const returnedMap: Record<string, number> = {};
    for (const ret of returnsForSale) {
      if (ret.product_id) {
        returnedMap[ret.product_id] = (returnedMap[ret.product_id] || 0) + ret.quantity_returned;
      }
    }
    return cs.items
      .map(item => {
        const returned = returnedMap[item.product_id] || 0;
        const remaining = item.quantity - returned;
        if (remaining <= 0) return null;
        return {
          name: item.product_name,
          quantity: remaining,
          unit_price: item.unit_price,
          total: remaining * item.unit_price,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  };


  // ── Shared PIN lockout ────────────────────────────────────────────────
  const PIN_MAX_FAILS   = 5;
  const PIN_LOCKOUT_MS  = 30_000;
  const [pinModalFails,       setPinModalFails]       = useState(0);
  const [pinModalCountdown,   setPinModalCountdown]   = useState(0);
  const pinLockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [returnItems, setReturnItems] = useState<{ product_id: string; product_name: string; original_qty: number; remaining_qty: number; unit_price: number; return_qty: number }[]>([]);
  const openReturnModal = async (cs: CreditSale) => {
    // Fetch existing returns for this credit sale
    const { data: returnsData } = await supabase.rpc("get_transaction_returns", {
      p_transaction_ids: [cs.id]
    });
  
    // Build map: product_id -> total returned quantity
    const returnedMap: Record<string, number> = {};
    for (const ret of (returnsData || [])) {
      const pid = ret.product_id;
      if (pid) {
        returnedMap[pid] = (returnedMap[pid] || 0) + ret.quantity_returned;
      }
    }
  
    // Build item list with remaining quantities
    const items = cs.items
      .map(item => {
        const alreadyReturned = returnedMap[item.product_id] || 0;
        const remaining = item.quantity - alreadyReturned;
        if (remaining <= 0) return null; // skip fully returned items
        return {
          product_id: item.product_id,
          product_name: item.product_name,
          original_qty: item.quantity,      // keep for reference
          remaining_qty: remaining,          // what's left
          unit_price: item.unit_price,
          return_qty: remaining,             // default: return all remaining
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  
    setReturnTarget(cs);
    setReturnItems(items);
    setReturnRefundMethod("cash");
    setReturnCashRefund("");
    setReturnMpesaRefund("");
    setReturnAgent(null);
    setReturnPin("");
    setReturnPinError("");
    setReturnError("");
  };

  const startPinCountdown = useCallback((until: number) => {
    if (pinLockTimerRef.current) clearInterval(pinLockTimerRef.current);
    const tick = () => {
      const rem = Math.ceil((until - Date.now()) / 1000);
      if (rem <= 0) { setPinModalCountdown(0); if (pinLockTimerRef.current) clearInterval(pinLockTimerRef.current); }
      else setPinModalCountdown(rem);
    };
    tick();
    pinLockTimerRef.current = setInterval(tick, 500);
  }, []);

  useEffect(() => () => { if (pinLockTimerRef.current) clearInterval(pinLockTimerRef.current); }, []);

  const resetPinLockout = useCallback(() => {
    setPinModalFails(0); setPinModalCountdown(0);
    if (pinLockTimerRef.current) { clearInterval(pinLockTimerRef.current); pinLockTimerRef.current = null; }
  }, []);

  const recordPinFail = useCallback(() => {
    const next = pinModalFails + 1;
    setPinModalFails(next);
    if (next >= PIN_MAX_FAILS) {
      const until = Date.now() + PIN_LOCKOUT_MS;
      startPinCountdown(until);
    }
  }, [pinModalFails, startPinCountdown]);

  const pinIsLocked = pinModalCountdown > 0;

  // ── Fetch requests + products ─────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!shop) return;
    // Use SECURITY DEFINER RPC for shop_requests so reads work without an auth session
    const [reqRes, allocRes] = await Promise.all([
      supabase.rpc("get_shop_requests", { p_shop_id: shop.id }),
      supabase.from("shop_allocations").select("product_id").eq("shop_id", shop.id),
    ]);

    setRequests((reqRes.data || []) as ShopRequest[]);

    const productIds = [...new Set((allocRes.data || []).map((a: any) => a.product_id).filter(Boolean))];
    const prods: StockProduct[] = [];
    if (productIds.length > 0) {
      const { data: prodsData } = await supabase.from("products").select("id, name, sku").in("id", productIds);
      for (const p of prodsData ?? []) prods.push({ id: p.id, name: p.name, sku: p.sku ?? "" });
    }
    setProducts(prods);
    setLoading(false);
  }, [shop]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Fetch agents (SECURITY DEFINER — works without auth session) ─────
  const fetchAgents = useCallback(async () => {
    if (!shop) return;
    const { data: shopAgentsRaw } = await supabase.rpc("get_shop_agents", { p_shop_id: shop.id });

    setAgents((shopAgentsRaw || []).map((r: any) => ({
      id: r.id, pin: r.pin, active: r.active,
      agent: {
        id:       r.agent_id,
        name:     r.agent_name ?? "Agent",
        agent_id: r.agent_code ?? "",
        avatar:   r.agent_avatar ?? "",
      },
    })));
  }, [shop]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // ── Fetch expenses (SECURITY DEFINER — works without auth session) ────
  const fetchExpenses = useCallback(async () => {
    if (!shop) return;
    setExpLoading(true);
    const { data } = await supabase.rpc("get_shop_expenses", { p_shop_id: shop.id });
    setExpenses((data || []) as Expense[]);
    setExpLoading(false);
  }, [shop]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  useEffect(() => {
    if (!shop) return;
    const ch = supabase.channel("shop-expenses-live-req")
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_expenses", filter: `shop_id=eq.${shop.id}` }, fetchExpenses)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, fetchExpenses]);

  // ── Fetch credit sales (SECURITY DEFINER — works without auth session) ─
  const fetchCreditSales = useCallback(async () => {
    if (!shop) return;
    setCreditLoading(true);
    const { data } = await supabase.rpc("get_shop_credit_sales", { p_shop_id: shop.id });
    const salesData = (data || []) as CreditSale[];
    setCreditSales(salesData);
    setCreditLoading(false);
  
    // Fetch returns for all sales
    const saleIds = salesData.map((s: CreditSale) => s.id);
    if (saleIds.length > 0) {
      const { data: returnsData } = await supabase.rpc("get_transaction_returns", { p_transaction_ids: saleIds });
      const returnsMap: Record<string, TransactionReturn[]> = {};
      for (const ret of (returnsData || [])) {
        const tid = (ret as TransactionReturn).original_transaction_id;
        if (!returnsMap[tid]) returnsMap[tid] = [];
        returnsMap[tid].push(ret as TransactionReturn);
      }
      setCreditReturns(returnsMap);
    } else {
      setCreditReturns({});
    }
  }, [shop]);


  useEffect(() => { fetchCreditSales(); }, [fetchCreditSales]);

  useEffect(() => {
    if (!shop) return;
    const ch = supabase.channel("shop-credit-live-req")
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_credit_sales", filter: `shop_id=eq.${shop.id}` }, fetchCreditSales)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, fetchCreditSales]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") fetchCreditSales(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", fetchCreditSales);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", fetchCreditSales);
    };
  }, [fetchCreditSales]);

  useEffect(() => {
    if (!shop?.owner_id) return;
    supabase
      .from("profiles")
      .select("business_name")
      .eq("id", shop.owner_id)
      .single()
      .then(({ data }) => { if (data?.business_name) setBusinessName(data.business_name); });
  }, [shop?.owner_id]);

  // ── Fetch credit payments (SECURITY DEFINER) ──────────────────────────
  const fetchPaymentsFor = useCallback(async (creditSaleId: string) => {
    setPaymentsLoading(creditSaleId);
    const { data } = await supabase.rpc("get_credit_payments", { p_credit_sale_id: creditSaleId });
    setCreditPayments(prev => ({ ...prev, [creditSaleId]: (data || []) as CreditPayment[] }));
    setPaymentsLoading(null);
  }, []);

  const toggleCreditCard = (id: string) => {
    if (expandedCreditId === id) { setExpandedCreditId(null); }
    else { setExpandedCreditId(id); if (!creditPayments[id]) fetchPaymentsFor(id); }
  };

  // ── Realtime for requests ─────────────────────────────────────────────
  useEffect(() => {
    if (!shop) return;
    const ch = supabase.channel("shop-requests-live")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "shop_requests", filter: `shop_id=eq.${shop.id}` }, () => fetchData())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shop_requests", filter: `shop_id=eq.${shop.id}` }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, fetchData]);

  // ── Requests form ─────────────────────────────────────────────────────
  const resetForm = () => {
    setType("stock_request"); setProductId(""); setQuantity("");
    setMessage(""); setFormError(""); setSuccessMsg("");
  };

  const handleSubmit = async () => {
    setFormError("");
    if (needsProduct && !productId) { setFormError("Please select a product."); return; }
    if (needsQty && (!quantity || parseInt(quantity) < 1)) { setFormError("Please enter a valid quantity."); return; }
    if (!message.trim()) { setFormError("Please add a message."); return; }
    if (!shop?.owner_id) { setFormError("Owner not found. Contact support."); return; }

    setSubmitting(true);
    const selectedProduct = products.find(p => p.id === productId);
    const payload = {
      owner_id:     shop.owner_id,
      shop_id:      shop.id,
      type,
      product_id:   needsProduct && productId && productId !== "__other__" ? productId : null,
      product_name: needsProduct && selectedProduct ? selectedProduct.name : needsProduct && productId === "__other__" ? "Other" : null,
      quantity:     needsQty && quantity ? parseInt(quantity) : null,
      message:      message.trim(),
      // Note: status is intentionally omitted — the table default sets it to "pending"
    };

    if (!isOnline) {
      enqueueRequest({
        shopId: shop.id, ownerId: shop.owner_id,
        requestType: type,
        productId:   payload.product_id,
        productName: payload.product_name,
        quantity:    payload.quantity,
        message:     payload.message,
      });
      refreshPendingCount();
      setSuccessMsg("Request queued — will send when connection returns ✓");
      setSubmitting(false);
      resetForm();
      setTimeout(() => { setShowForm(false); setSuccessMsg(""); }, 2000);
      return;
    }

    try {
      // Use a SECURITY DEFINER RPC so the insert always succeeds regardless of
      // the shop's JWT state — same pattern as insert_shop_transaction.
      const { error } = await supabase.rpc("insert_shop_request", {
        p_owner_id:     payload.owner_id,
        p_shop_id:      payload.shop_id,
        p_type:         payload.type,
        p_product_id:   payload.product_id ?? null,
        p_product_name: payload.product_name ?? null,
        p_quantity:     payload.quantity ?? null,
        p_message:      payload.message,
      });

      if (error) {
        console.error("Request insert error:", JSON.stringify(error));
        setFormError(`Failed to send: ${error.message || "Unknown error"}`);
        setSubmitting(false);
        return;
      }
    } catch (err) {
      console.error("Unexpected error submitting request:", err);
      setFormError(`Failed to send: ${err instanceof Error ? err.message : String(err)}`);
      setSubmitting(false);
      return;
    }
    setSuccessMsg("Request sent to your owner ✓");
    setSubmitting(false);
    resetForm();
    setTimeout(() => { setShowForm(false); setSuccessMsg(""); fetchData(); }, 1500);
  };

  // ── Fetch shop sales totals (overall + per payment method) when expense modal opens ──
  useEffect(() => {
    if (!logOpen || !shop) return;
    setShopCashTotal(null); setShopMpesaTotal(null);
    supabase
      .from("shop_transactions")
      .select("cash_amount, mpesa_amount")
      .eq("shop_id", shop.id)
      .then(({ data }) => {
        const rows = data ?? [];
        setShopCashTotal(rows.reduce((s: number, t: any) => s + (t.cash_amount ?? 0), 0));
        setShopMpesaTotal(rows.reduce((s: number, t: any) => s + (t.mpesa_amount ?? 0), 0));
      });
  }, [logOpen, shop]);

  // ── Expense handlers ──────────────────────────────────────────────────
  const handleLogExpense = async (agent: ShopAgent) => {
    const expCash  = Math.round(Number(expCashAmount)  || 0);
    const expMpesa = Math.round(Number(expMpesaAmount) || 0);
    const amount   = expCash + expMpesa;
    if (!amount || amount <= 0) { setExpError("Enter a Cash or M-Pesa amount."); return; }
    if (!expDesc.trim()) { setExpError("Describe the expense."); return; }
    const autoMethod = expCash > 0 && expMpesa > 0 ? "split" : expMpesa > 0 ? "mpesa" : "cash";

    const cashExpensed  = expenses.reduce((s, e) => s + (e.cash_amount  ?? (e.payment_method === "cash"  ? e.amount : 0)), 0);
    const mpesaExpensed = expenses.reduce((s, e) => s + (e.mpesa_amount ?? (e.payment_method === "mpesa" ? e.amount : 0)), 0);
    const cashAvail  = shopCashTotal  !== null ? Math.max(0, shopCashTotal  - cashExpensed)  : null;
    const mpesaAvail = shopMpesaTotal !== null ? Math.max(0, shopMpesaTotal - mpesaExpensed) : null;
    if (cashAvail  !== null && expCash  > cashAvail)  { setExpError(`Cash amount exceeds available (${fmt(cashAvail)}).`);  return; }
    if (mpesaAvail !== null && expMpesa > mpesaAvail) { setExpError(`M-Pesa amount exceeds available (${fmt(mpesaAvail)}).`); return; }
    setExpProcessing(true);

    if (!isOnline) {
      enqueueExpense({
        shopId: shop!.id, ownerId: shop!.owner_id, amount,
        description: expDesc.trim(), loggedBy: agent.agent.id, loggedByName: agent.agent.name,
        paymentMethod: autoMethod, cashAmount: expCash, mpesaAmount: expMpesa,
      });
      refreshPendingCount();
      setLogOpen(false);
      setExpDesc(""); setExpCashAmount(""); setExpMpesaAmount(""); setExpAgent(null); setExpPin(""); setExpError(""); setExpProcessing(false);
      return;
    }

    const { error } = await supabase.rpc("insert_shop_expense", {
      p_shop_id:        shop?.id,
      p_owner_id:       shop?.owner_id,
      p_amount:         amount,
      p_description:    expDesc.trim(),
      p_logged_by:      agent.agent.id,
      p_logged_by_name: agent.agent.name,
      p_payment_method: autoMethod,
      p_cash_amount:    expCash,
      p_mpesa_amount:   expMpesa,
    });
    if (error) { console.error("insert_shop_expense error:", error.message, error.code, error.details); setExpProcessing(false); setExpError("Failed to save expense. Try again."); return; }
    setLogOpen(false);
    setExpDesc(""); setExpCashAmount(""); setExpMpesaAmount(""); setExpAgent(null); setExpPin(""); setExpError(""); setExpProcessing(false);
    fetchExpenses();
  };

  const openEdit = (exp: Expense) => {
    setEditTarget(exp);
    setEditAmount(String(exp.amount));
    setEditDesc(exp.description);
    setEditAgent(null); setEditPin(""); setEditPinError(""); setEditError("");
  };

  const handleEditExpense = async (agent: ShopAgent) => {
    if (!editTarget) return;
    if (agent.agent.id !== editTarget.logged_by) {
      setEditPinError(`Only ${editTarget.logged_by_name} can edit this expense.`);
      setEditPinShake(true); setEditPin("");
      setTimeout(() => setEditPinShake(false), 400);
      return;
    }
    const amount = parseFloat(editAmount);
    if (!amount || amount <= 0) { setEditError("Enter a valid amount."); return; }
    if (!editDesc.trim()) { setEditError("Describe the expense."); return; }
    setEditProcessing(true);
    const { error } = await supabase.rpc("update_shop_expense", {
      p_expense_id:  editTarget.id,
      p_amount:      amount,
      p_description: editDesc.trim(),
    });
    if (error) { setEditProcessing(false); setEditError("Failed to update expense."); return; }
    setEditTarget(null);
    setEditAmount(""); setEditDesc(""); setEditAgent(null); setEditPin(""); setEditError(""); setEditProcessing(false);
    fetchExpenses();
  };

  const resetLogModal = () => {
    setLogOpen(false);
    setExpDesc(""); setExpCashAmount(""); setExpMpesaAmount(""); setExpAgent(null);
    setExpPin(""); setExpPinError(""); setExpError(""); setExpProcessing(false);
    resetPinLockout();
  };

  const resetEditModal = () => {
    setEditTarget(null);
    setEditAmount(""); setEditDesc(""); setEditAgent(null);
    setEditPin(""); setEditPinError(""); setEditError(""); setEditProcessing(false);
    resetPinLockout();
  };

  // ── Credit handlers ───────────────────────────────────────────────────
  const handleRecordPayment = async (agent: ShopAgent) => {
    if (!payTarget && !payGroupSales) return;
    if (!isOnline) { setPayError("Recording a credit payment requires an internet connection. Please reconnect and try again."); return; }
    const payCash  = Math.round(Number(payCashAmount)  || 0);
    const payMpesa = Math.round(Number(payMpesaAmount) || 0);
    const amount   = payCash + payMpesa;
    if (!amount || amount <= 0) { setPayError("Enter a Cash or M-Pesa payment amount."); return; }
    const autoMethod = payCash > 0 && payMpesa > 0 ? "split" : payMpesa > 0 ? "mpesa" : "cash";
    const mpesaRef   = payMpesa > 0 ? payMpesaRef.trim() || null : null;

    // ── Group-level: distribute oldest-first across all open sales ──
    if (payGroupSales) {
      const openSales = payGroupSales
        .filter(s => s.status === "pending" || s.status === "partial")
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const totalOwed      = openSales.reduce((s, x) => s + (x.amount - x.amount_paid), 0);
      const totalCreditAmt = openSales.reduce((s, x) => s + x.amount, 0);
      const totalPaidBefore= openSales.reduce((s, x) => s + x.amount_paid, 0);
      if (amount > totalOwed + 0.01) { setPayError(`Amount exceeds total balance of ${fmt(totalOwed)}.`); return; }
      setPayProcessing(true);
      let remaining = amount, allocCash = 0, allocMpesa = 0;
      for (let i = 0; i < openSales.length; i++) {
        if (remaining <= 0.01) break;
        const sale      = openSales[i];
        const applying  = Math.min(remaining, sale.amount - sale.amount_paid);
        const isLast    = i === openSales.length - 1 || remaining - applying <= 0.01;
        const ratio     = amount > 0 ? applying / amount : 0;
        const saleCash  = isLast ? payCash  - allocCash  : Math.round(payCash  * ratio);
        const saleMpesa = isLast ? payMpesa - allocMpesa : Math.round(payMpesa * ratio);
        allocCash += saleCash; allocMpesa += saleMpesa;
        remaining -= applying;
        const { error: insErr } = await supabase.rpc("record_credit_payment", {
          p_credit_sale_id:        sale.id,
          p_shop_id:               shop?.id,
          p_owner_id:              shop?.owner_id,
          p_amount:                applying,
          p_payment_method:        autoMethod,
          p_mpesa_ref:             mpesaRef,
          p_collected_by_agent_id: agent.agent.agent_id,
          p_collected_by_name:     agent.agent.name,
          p_cash_amount:           saleCash,
          p_mpesa_amount:          saleMpesa,
        });
        if (insErr) { setPayProcessing(false); setPayError(insErr.message || "Failed to record payment. Try again."); return; }
        fetchPaymentsFor(sale.id);
      }
      const custPhone = openSales[0]?.customer_phone;
      if (custPhone) {
        supabase.functions.invoke("send-receipt", { body: {
          phone:          custPhone,
          business_name:  shop?.name || "Shop",
          customer_name:  openSales[0].customer_name,
          agent_name:     agent.agent.name,
          message_type:   "credit_payment",
          payment_method: autoMethod,
          mpesa_ref:      mpesaRef,
          initial_payment: amount,
          paid_so_far:    totalPaidBefore + amount,
          balance_due:    Math.max(0, totalOwed - amount),
          total_amount:   totalCreditAmt,
          items:          [],
        }});
      }
      setPayGroupSales(null);
      setPayMpesaRef(""); setPayCashAmount(""); setPayMpesaAmount("");
      setPayAgent(null); setPayPin(""); setPayPinError(""); setPayError(""); setPayProcessing(false);
      fetchCreditSales();
      return;
    }

    // ── Single-sale ──
    const balance = payTarget!.amount - payTarget!.amount_paid;
    if (amount > balance) { setPayError(`Amount exceeds what is owed. Balance is ${fmt(balance)}.`); return; }
    setPayProcessing(true);
    const { error: insErr } = await supabase.rpc("record_credit_payment", {
      p_credit_sale_id:        payTarget!.id,
      p_shop_id:               shop?.id,
      p_owner_id:              shop?.owner_id,
      p_amount:                amount,
      p_payment_method:        autoMethod,
      p_mpesa_ref:             mpesaRef,
      p_collected_by_agent_id: agent.agent.agent_id,
      p_collected_by_name:     agent.agent.name,
      p_cash_amount:           payCash,
      p_mpesa_amount:          payMpesa,
    });
    if (insErr) { setPayProcessing(false); setPayError(insErr.message || "Failed to record payment. Try again."); return; }

    if (payTarget!.customer_phone) {
      supabase.functions.invoke("send-receipt", { body: {
        phone:          payTarget!.customer_phone,
        business_name:  shop?.name || "Shop",
        customer_name:  payTarget!.customer_name,
        agent_name:     agent.agent.name,
        message_type:   "credit_payment",
        payment_method: autoMethod,
        mpesa_ref:      mpesaRef,
        initial_payment: amount,
        paid_so_far:    payTarget!.amount_paid + amount,
        balance_due:    Math.max(0, balance - amount),
        total_amount:   payTarget!.amount,
        items:          [],
      }});
    }

    const saleId = payTarget!.id;
    setPayTarget(null);
    setPayMpesaRef("");
    setPayAgent(null); setPayPin(""); setPayPinError(""); setPayError(""); setPayProcessing(false);
    fetchCreditSales();
    fetchPaymentsFor(saleId);
  };

  const resetPayModal = () => {
    setPayTarget(null);
    setPayGroupSales(null);
    setPayMpesaRef(""); setPayCashAmount(""); setPayMpesaAmount("");
    setPayAgent(null); setPayPin(""); setPayPinError(""); setPayError(""); setPayProcessing(false);
    resetPinLockout();
  };

  const handleMarkReturned = async (_agent: ShopAgent) => {
    if (!returnTarget || !shop) return;
    if (!isOnline) {
      setReturnError("Return requires an internet connection (restores stock on server).");
      return;
    }
  
    // Validate at least one item returned
    const selectedItems = returnItems.filter(it => it.return_qty > 0);
    // Ensure no item exceeds its remaining quantity
    for (const item of selectedItems) {
      if (item.return_qty > item.remaining_qty) {
        setReturnError(`Cannot return more than remaining for ${item.product_name}.`);
        return;
      }
    }
    if (selectedItems.length === 0) {
      setReturnError("Select at least one item to return.");
      return;
    }
  
    const totalRefund = selectedItems.reduce((s, it) => s + it.return_qty * it.unit_price, 0);
    const cash = Math.round(Number(returnCashRefund) || 0);
    const mpesa = Math.round(Number(returnMpesaRefund) || 0);
    const tot = cash + mpesa;
  
    if (tot > 0 && Math.abs(tot - totalRefund) > 0.5) {
      setReturnError(`Refund total (${fmt(tot)}) must equal ${fmt(totalRefund)}.`);
      return;
    }
    
    const method = tot > 0
      ? (cash > 0 && mpesa > 0 ? "split" : mpesa > 0 ? "mpesa" : "cash")
      : "cash"; // no refund given – use cash with 0 amounts
  
  
    // Build items array for RPC
    const itemsForRpc = selectedItems.map(it => ({
      product_id: it.product_id,
      quantity_returned: it.return_qty,
      unit_price: it.unit_price,
    }));
  
    setReturnProcessing(true);
    try {
      const { error } = await supabase.rpc("process_credit_return", {
        p_credit_sale_id: returnTarget.id,
        p_shop_id: shop.id,
        p_owner_id: shop.owner_id,
        p_items: itemsForRpc,
        p_actor_name: _agent.agent.name,
        p_actor_code: _agent.agent.agent_id,
        p_refund_method: method,
        p_cash_amount: cash,
        p_mpesa_amount: mpesa,
        p_reason: "Customer return",
      });
      if (error) {
        console.error("Return error:", error);
        setReturnError(error.message || "Failed to process return.");
        setReturnProcessing(false);
        return;
      }
      // Success: reset and refresh
      resetReturnModal();
      fetchCreditSales();
      // Also refresh payments for this sale if needed
      if (returnTarget.id) fetchPaymentsFor(returnTarget.id);
    } catch (e: any) {
      setReturnError(e.message || "Unknown error");
      setReturnProcessing(false);
    }
  };

  const resetReturnModal = () => {
    setReturnTarget(null);
    setReturnItems([]);
    setReturnRefundMethod("cash"); 
    setReturnCashRefund("");
     setReturnMpesaRefund("");
    setReturnAgent(null);
     setReturnPin(""); 
     setReturnPinError(""); 
     setReturnError(""); 
     setReturnProcessing(false);
    resetPinLockout();
  };

  // ── Computed ──────────────────────────────────────────────────────────
  const pendingCount   = requests.filter(r => r.status === "pending").length;
  const totalExpenses  = expenses.reduce((s, e) => s + e.amount, 0);
  const openCredit     = creditSales.filter(c => c.status === "pending" || c.status === "partial");
  const totalOutstanding = openCredit.reduce((s, c) => s + (c.amount - c.amount_paid), 0);

  const statusColor = (s: string) => s === "paid" ? "#34d399" : s === "returned" ? "#6b7280" : s === "partial" ? "#fbbf24" : "#f87171";
  const statusLabel = (s: string) => s === "paid" ? "Paid" : s === "returned" ? "Returned" : s === "partial" ? "Partial" : "Pending";

  function groupByCustomer(sales: CreditSale[]): CustomerCreditGroup[] {
    const map = new Map<string, CustomerCreditGroup>();
    for (const cs of sales) {
      const key = (cs.customer_phone || cs.customer_name).toLowerCase().trim();
      if (!map.has(key)) {
        map.set(key, { key, customer_name: cs.customer_name, customer_phone: cs.customer_phone, sales: [], totalOutstanding: 0, totalPaid: 0, totalAmount: 0, hasOpen: false });
      }
      const g = map.get(key)!;
      g.sales.push(cs);
      g.totalAmount += cs.amount;
      g.totalPaid   += cs.amount_paid;
      if (cs.status === "pending" || cs.status === "partial") {
        g.totalOutstanding += cs.amount - cs.amount_paid;
        g.hasOpen = true;
      }
    }
    return [...map.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }

  async function handleSendStatement() {
    if (!sendStmtGroup || !shop) return;
    const phone = sendStmtPhone.trim();
    if (!phone) { setSendStmtError("Please enter a phone number."); return; }
  
    setSendStmtSending(true);
    setSendStmtError("");
  
    const openSales = sendStmtGroup.sales.filter(cs => cs.status === "pending" || cs.status === "partial");
    
    // ── Compute outstanding items for each sale ──
    const allItems = openSales.flatMap(cs => getOutstandingItems(cs));
    const totalAmount = allItems.reduce((s, item) => s + item.total, 0);
    const totalPaid = openSales.reduce((s, cs) => s + cs.amount_paid, 0);
    const balanceDue = totalAmount - totalPaid;
  
    try {
      const { data } = await supabase.functions.invoke("send-receipt", {
        body: {
          phone,
          business_name: businessName || shop.name || "Business",
          agent_name:    openSales[0]?.seller_name ?? "",
          customer_name: sendStmtGroup.customer_name,
          items:         allItems,  // now only outstanding items
          total_amount:  totalAmount,
          payment_method: "credit",
          initial_payment: totalPaid,
          balance_due:   balanceDue,
          message_type:  openSales.length > 1 ? "credit_statement" : "credit_sale",
        },
      });
      if (data?.sent) {
        setSendStmtSent(true);
        setTimeout(() => { setSendStmtGroup(null); setSendStmtSent(false); setSendStmtPhone(""); }, 1500);
      } else {
        setSendStmtError("Failed to send. Check the phone number and try again.");
      }
    } catch (e: any) {
      setSendStmtError(e?.message ?? "Unknown error");
    } finally {
      setSendStmtSending(false);
    }
  }

  // ── PIN keypad render helper ──────────────────────────────────────────
  const PinKeypad = ({
    selectedAgent, pin, setPin, pinError, setPinError, pinShake, setPinShake, processing, onVerify,
  }: {
    selectedAgent: ShopAgent; pin: string; setPin: (v: string) => void;
    pinError: string; setPinError: (v: string) => void;
    pinShake: boolean; setPinShake: (v: boolean) => void;
    processing: boolean; onVerify: (agent: ShopAgent) => void;
  }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", textAlign: "center", marginBottom: 12 }}>
        PIN for {selectedAgent.agent.name}
      </div>

      {pinIsLocked && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "11px 14px", marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#ef4444", fontFamily: theme.font.mono }}>Too many wrong PINs</div>
            <div style={{ fontSize: 11, color: "#f87171", marginTop: 2, fontFamily: theme.font.mono }}>Try again in {pinModalCountdown}s</div>
          </div>
        </div>
      )}

      {!pinIsLocked && pinModalFails >= 3 && (
        <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: "#fbbf24", background: "rgba(234,179,8,0.07)", border: "1px solid rgba(234,179,8,0.2)", borderRadius: 8, padding: "8px 12px", marginBottom: 10, textAlign: "center" }}>
          ⚠ {PIN_MAX_FAILS - pinModalFails} attempt{PIN_MAX_FAILS - pinModalFails !== 1 ? "s" : ""} left before lockout
        </div>
      )}

      <div className={pinShake ? "shake" : ""} style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 14, opacity: pinIsLocked ? 0.35 : 1 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ width: 44, height: 54, border: `2px solid ${i < pin.length ? "rgba(6,182,212,0.5)" : "rgba(255,255,255,0.1)"}`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "DM Mono, monospace", fontSize: 24, fontWeight: 700, background: i < pin.length ? "rgba(6,182,212,0.08)" : "transparent", transition: "all 0.15s" }}>
            {i < pin.length ? "●" : ""}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, maxWidth: 280, margin: "0 auto", width: "100%" }}>
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map(k => (
          <button key={k} disabled={!k || processing || pinIsLocked}
            onClick={() => {
              if (pinIsLocked) return;
              if (k === "⌫") { setPin(pin.slice(0, -1)); setPinError(""); }
              else if (k && pin.length < 4) {
                const newPin = pin + k;
                setPin(newPin);
                if (newPin.length === 4) {
                  if (newPin !== selectedAgent.pin) {
                    recordPinFail();
                    setPinError("Incorrect PIN. Try again.");
                    setPinShake(true);
                    setTimeout(() => { setPinShake(false); setPin(""); }, 400);
                  } else {
                    setPinError("");
                    resetPinLockout();
                    onVerify(selectedAgent);
                  }
                }
              }
            }}
            style={{ height: 50, border: `1px solid ${k ? "rgba(255,255,255,0.1)" : "transparent"}`, borderRadius: 10, background: k ? "rgba(255,255,255,0.04)" : "transparent", color: k === "⌫" ? theme.accent.red : theme.text.primary, fontFamily: "DM Mono, monospace", fontSize: k === "⌫" ? 18 : 20, fontWeight: 600, cursor: (k && !pinIsLocked) ? "pointer" : "default", opacity: pinIsLocked ? 0.35 : 1 }}>
            {k}
          </button>
        ))}
      </div>
      {pinError && !pinIsLocked && (
        <div style={{ color: theme.accent.red, fontSize: 11, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px", marginTop: 10, textAlign: "center" }}>
          ⚠ {pinError}
        </div>
      )}
      {processing && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, marginTop: 8, background: "rgba(255,255,255,0.03)", borderRadius: 10, color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 13 }}>
          <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
          Saving...
        </div>
      )}
    </div>
  );

  // ── Agent selector render helper ──────────────────────────────────────
  const AgentList = ({ onSelect }: { onSelect: (sa: ShopAgent) => void }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {agents.map(sa => (
        <button key={sa.id} onClick={() => onSelect(sa)}
          style={{ padding: "11px 14px", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 11, background: "rgba(255,255,255,0.02)", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, textAlign: "left" }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, color: theme.accent.cyan, flexShrink: 0 }}>
            {sa.agent.avatar || sa.agent.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.text.primary }}>{sa.agent.name}</div>
            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 1 }}>{sa.agent.agent_id}</div>
          </div>
        </button>
      ))}
    </div>
  );

  const SelectedAgentRow = ({ agent, onClear }: { agent: ShopAgent; onClear: () => void }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: theme.accent.cyan, flexShrink: 0 }}>
          {agent.agent.avatar || agent.agent.name.charAt(0).toUpperCase()}
        </div>
        <span style={{ fontFamily: theme.font.mono, fontSize: 13, color: theme.accent.cyan }}>{agent.agent.name}</span>
      </div>
      <button onClick={onClear} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, padding: "4px 10px", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 10, cursor: "pointer" }}>
        Change
      </button>
    </div>
  );

  // ── Tab labels ────────────────────────────────────────────────────────
  const tabs: { key: ActiveTab; label: string }[] = [
    { key: "requests", label: `📋 Requests${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
    { key: "expenses", label: `💸 Expenses (${expenses.length})` },
    { key: "credit",   label: `📝 Credit (${openCredit.length})` },
  ];

  return (
    <div style={{ minHeight: "100vh", background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes shake   { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-7px)} 40%,80%{transform:translateX(7px)} }
        .req-card { transition: background 0.15s; }
        .req-card:hover { background: rgba(255,255,255,0.03) !important; }
        .exp-row  { transition: background 0.12s; }
        .exp-row:hover { background: rgba(255,255,255,0.03) !important; }
        .shake { animation: shake 0.35s ease; }
        ${theme.kiCss}
      `}</style>

      {/* ── Header ── */}
      <div style={{ borderBottom: `1px solid ${theme.border.default}`, padding: "16px 16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 16 }}>
          <div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em" }}>Activity</div>
            <div style={{ color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, marginTop: 2 }}>
              {shop?.name}
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", overflowX: "auto", gap: 0 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              style={{ padding: isMobile ? "12px 14px" : "14px 20px", border: "none", borderBottom: `2px solid ${activeTab === t.key ? theme.accent.cyan : "transparent"}`, background: "transparent", color: activeTab === t.key ? theme.accent.cyan : theme.text.muted, fontFamily: theme.font.mono, fontSize: isMobile ? 11 : 12, cursor: "pointer", fontWeight: activeTab === t.key ? 600 : 400, whiteSpace: "nowrap", flexShrink: 0 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Offline banner ── */}
      {!isOnline && (
        <div style={{ margin: "12px 16px 0", background: "rgba(146,64,14,0.15)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>⚡</span>
          <div style={{ fontSize: 12, fontFamily: theme.font.mono, color: "#fbbf24", lineHeight: 1.6 }}>
            <strong>Offline mode</strong> — Requests and expenses will be queued and sent when connection returns.
            Credit payments and returns require a live connection.
            {queuedItems.length > 0 && (
              <div style={{ marginTop: 4, color: theme.text.muted }}>
                {queuedItems.length} item{queuedItems.length !== 1 ? "s" : ""} queued.
              </div>
            )}
          </div>
        </div>
      )}

      {/* All writes use SECURITY DEFINER RPCs — no auth session banner needed */}

      {/* ══ REQUESTS TAB ══ */}
      {activeTab === "requests" && (
        <>
          {/* New Request Form (bottom sheet) */}
          {showForm && (
            <div
              style={{ position: "fixed", inset: 0, background: theme.bg.overlay, backdropFilter: "blur(6px)", zIndex: 100, display: "flex", alignItems: "flex-end" }}
              onClick={() => { setShowForm(false); resetForm(); }}>
              <div
                style={{ width: "100%", background: theme.bg.modal, borderRadius: "20px 20px 0 0", padding: "24px 20px 40px", animation: "slideUp 0.25s ease", maxHeight: "90vh", overflowY: "auto" }}
                onClick={e => e.stopPropagation()}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: theme.border.default, margin: "0 auto 20px" }} />
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 18, marginBottom: 20 }}>New Request</div>

                <div style={{ display: "grid", gridTemplateColumns: isTablet ? "1fr 1fr" : "repeat(4,1fr)", gap: 8, marginBottom: 20 }}>
                  {REQUEST_TYPES.map(rt => (
                    <div key={rt.value} onClick={() => { setType(rt.value); setProductId(""); setQuantity(""); }}
                      style={{ padding: "12px", borderRadius: 12, border: `1px solid ${type === rt.value ? rt.color : "rgba(255,255,255,0.08)"}`, background: type === rt.value ? `${rt.color}14` : "rgba(255,255,255,0.02)", cursor: "pointer", transition: "all 0.15s" }}>
                      <div style={{ fontSize: 20, marginBottom: 4 }}>{rt.icon}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: type === rt.value ? rt.color : theme.text.primary }}>{rt.label}</div>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2, lineHeight: 1.4 }}>{rt.desc}</div>
                    </div>
                  ))}
                </div>

                {needsProduct && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Product</div>
                    <select value={productId} onChange={e => setProductId(e.target.value)}
                      style={{ width: "100%", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 10, padding: "12px 14px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none" } as React.CSSProperties}>
                      <option value="" style={{ background: theme.bg.card, color: theme.text.muted }}>Select a product...</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id} style={{ background: theme.bg.card, color: theme.text.primary }}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>
                      ))}
                      {type === "demand_report" && (
                        <option value="__other__" style={{ background: theme.bg.card, color: theme.text.primary }}>Other (not in my stock)</option>
                      )}
                    </select>
                  </div>
                )}

                {needsQty && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {type === "damage_report" ? "Units Damaged / Lost" : "Quantity Requested"}
                    </div>
                    <input type="text" inputMode="numeric" value={quantity}
                      onChange={e => setQuantity(sanitizeInteger(e.target.value, 9999))}
                      placeholder="Enter quantity..."
                      style={{ width: "100%", background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 10, padding: "12px 14px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                  </div>
                )}

                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {type === "message" ? "Your Message" : "Additional Details"}
                  </div>
                  <textarea value={message} onChange={e => setMessage(sanitizeText(e.target.value, 500))} maxLength={500} rows={3}
                    placeholder={type === "stock_request" ? "e.g. Running very low, customers asking daily..." : type === "damage_report" ? "e.g. Dropped during delivery, packaging broken..." : type === "demand_report" ? "e.g. At least 10 customers asked for this today..." : "Type your message here..."}
                    style={{ width: "100%", background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 10, padding: "12px 14px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", lineHeight: 1.6 }} />
                </div>

                {formError && formError !== "__NO_AUTH__" && (
                  <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 10, padding: "10px 14px", color: "#f87171", fontFamily: theme.font.mono, fontSize: 12, marginBottom: 16 }}>⚠ {formError}</div>
                )}
                {formError === "__NO_AUTH__" && (
                  <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
                    <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, color: "#f87171", marginBottom: 6 }}>🔐 Session expired or shop not provisioned</div>
                    <div style={{ fontFamily: theme.font.mono, fontSize: 11, color: "#fca5a5", lineHeight: 1.6, marginBottom: 12 }}>
                      Your shop's authentication token is missing or has expired.<br />
                      Log out and log back in to restore it. If the problem persists, ask your owner to re-provision this shop from the owner dashboard.
                    </div>
                    <button onClick={() => { setShowForm(false); resetForm(); logout(); }}
                      style={{ width: "100%", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 9, padding: "10px 0", color: "#f87171", fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                      Log Out &amp; Re-login
                    </button>
                  </div>
                )}
                {successMsg && <div style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 10, padding: "10px 14px", color: "#34d399", fontFamily: theme.font.mono, fontSize: 12, marginBottom: 16 }}>✓ {successMsg}</div>}

                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => { setShowForm(false); resetForm(); }} disabled={submitting}
                    style={{ flex: 1, background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 14, color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 13, cursor: "pointer" }}>
                    Cancel
                  </button>
                  <button onClick={handleSubmit} disabled={submitting}
                    style={{ flex: 2, background: submitting ? "rgba(6,182,212,0.3)" : "linear-gradient(135deg,#06b6d4,#0891b2)", border: "none", borderRadius: 12, padding: 14, color: "#fff", fontFamily: theme.font.display, fontWeight: 700, fontSize: 15, cursor: submitting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    {submitting ? <><span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} /> Sending...</> : "Send Request"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div style={{ padding: "16px 16px 100px", display: "flex", flexDirection: "column", gap: 10 }}>

            {/* Centered new request button */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <button
                onClick={() => { setShowForm(true); resetForm(); }}
                style={{ padding: "9px 20px", background: "linear-gradient(135deg,#06b6d4,#0891b2)", border: "none", borderRadius: 50, color: "#fff", fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                + New Request
              </button>
            </div>

            {/* Queued offline requests */}
            {queuedItems.filter(i => "requestType" in i).map(i => {
              const q = i as QueuedRequest;
              const rt = REQUEST_TYPES.find(r => r.value === q.requestType) ?? REQUEST_TYPES[3];
              return (
                <div key={q.id} style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 14, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                      {rt.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#fbbf24" }}>{rt.label}</div>
                        <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 20, padding: "2px 8px" }}>QUEUED</span>
                      </div>
                      {q.productName && (
                        <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 3 }}>
                          📦 {q.productName}{q.quantity != null && <span style={{ color: theme.text.secondary }}> · {q.quantity} units</span>}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: theme.text.secondary, lineHeight: 1.5 }}>{q.message}</div>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 6 }}>Will sync when connection returns</div>
                    </div>
                  </div>
                </div>
              );
            })}

            {loading ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 13 }}>
                <div style={{ width: 24, height: 24, border: "2px solid rgba(6,182,212,0.2)", borderTopColor: "#06b6d4", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                Loading requests...
              </div>
            ) : requests.length === 0 && queuedItems.filter(i => "requestType" in i).length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 16px", color: theme.text.muted }}>
                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>📋</div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 16, marginBottom: 6 }}>No requests yet</div>
                <div style={{ fontFamily: theme.font.mono, fontSize: 12, lineHeight: 1.7 }}>
                  Tap the button above to send stock requests,<br />report damage, or message your owner.
                </div>
              </div>
            ) : requests.map(req => {
              const rt = REQUEST_TYPES.find(r => r.value === req.type)!;
              const isExpanded = expandedId === req.id;
              const hasReply   = !!req.owner_reply;
              return (
                <div key={req.id} className="req-card" onClick={() => setExpandedId(isExpanded ? null : req.id)}
                  style={{ background: theme.bg.card, border: `1px solid ${req.status === "approved" ? "rgba(52,211,153,0.2)" : req.status === "rejected" ? "rgba(248,113,113,0.2)" : "rgba(255,255,255,0.08)"}`, borderRadius: 14, padding: "14px 16px", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: `${rt.color}14`, border: `1px solid ${rt.color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                      {rt.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: rt.color }}>{rt.label}</div>
                        {statusBadge(req.status)}
                      </div>
                      {req.product_name && (
                        <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 3 }}>
                          📦 {req.product_name}
                          {req.quantity != null && <span style={{ color: theme.text.secondary }}> · {req.quantity} units</span>}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: theme.text.secondary, lineHeight: 1.5, overflow: isExpanded ? "visible" : "hidden", textOverflow: "ellipsis", whiteSpace: isExpanded ? "normal" : "nowrap" }}>
                        {req.message}
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                      {hasReply ? (
                        <div style={{ background: req.status === "approved" ? "rgba(52,211,153,0.06)" : "rgba(248,113,113,0.06)", border: `1px solid ${req.status === "approved" ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)"}`, borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                          <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Owner's Reply</div>
                          <div style={{ fontSize: 13, lineHeight: 1.6, color: theme.text.primary }}>{req.owner_reply}</div>
                        </div>
                      ) : req.status === "pending" ? (
                        <div style={{ fontSize: 12, fontFamily: theme.font.mono, color: theme.text.muted, fontStyle: "italic", marginBottom: 10 }}>⏳ Waiting for owner to respond...</div>
                      ) : null}
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                        Sent {timeAgo(req.created_at)}{req.updated_at !== req.created_at && ` · Updated ${timeAgo(req.updated_at)}`}
                      </div>
                    </div>
                  )}
                  {!isExpanded && hasReply && (
                    <div style={{ marginTop: 8, fontSize: 10, fontFamily: theme.font.mono, color: req.status === "approved" ? "#34d399" : "#f87171" }}>
                      💬 Owner replied — tap to read
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ══ EXPENSES TAB ══ */}
      {activeTab === "expenses" && (
        <div style={{ padding: isMobile ? "16px 16px 100px" : "24px 40px 100px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Centered log expense button */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button onClick={() => setLogOpen(true)}
              style={{ padding: "9px 20px", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.35)", borderRadius: 50, color: "#f87171", fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              + Log Expense
            </button>
          </div>

          {/* Summary card */}
          <div style={{ background: theme.bg.card, border: "1px solid rgba(248,113,113,0.2)", borderRadius: 14, padding: "16px 18px" }}>
            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Total Expenses</div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 22 : 26, color: theme.accent.red }}>{fmt(totalExpenses)}</div>
            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 4 }}>{expenses.length} record{expenses.length !== 1 ? "s" : ""}</div>
          </div>

          {/* Queued offline expenses */}
          {queuedItems.filter(i => "loggedBy" in i).map(i => {
            const q = i as QueuedExpense;
            return (
              <div key={q.id} style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>⏳</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.description}</div>
                  <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                    {q.loggedByName} · <span style={{ color: "#fbbf24" }}>queued offline</span>
                  </div>
                </div>
                <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: "#fbbf24", flexShrink: 0 }}>{fmt(q.amount)}</div>
              </div>
            );
          })}

          {expLoading ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ width: 22, height: 22, border: "3px solid rgba(248,113,113,0.2)", borderTopColor: theme.accent.red, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" }} />
            </div>
          ) : expenses.length === 0 && queuedItems.filter(i => "loggedBy" in i).length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16 }}>
              <div style={{ fontSize: 44, opacity: 0.2, marginBottom: 12 }}>💸</div>
              <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono }}>No expenses recorded yet</div>
              <div style={{ color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, marginTop: 5, opacity: 0.6 }}>Tap the button above to add one</div>
            </div>
          ) : (
            <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16, overflow: "hidden" }}>
              {expenses.map((exp, i) => (
                <div key={exp.id} className="exp-row"
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: i < expenses.length - 1 ? `1px solid ${theme.border.default}` : "none" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>💸</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exp.description}</div>
                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                      {exp.logged_by_name} · {new Date(exp.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" })} {new Date(exp.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    {exp.updated_at !== exp.created_at && (
                      <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>edited</div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: theme.accent.red }}>{fmt(exp.amount)}</div>
                    <button onClick={() => openEdit(exp)}
                      style={{ marginTop: 4, background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "3px 8px", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 10, cursor: "pointer" }}>
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══ CREDIT TAB ══ */}
      {activeTab === "credit" && (
        <div style={{ padding: isMobile ? "16px 16px 100px" : "24px 40px 100px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,1fr)", gap: 10 }}>
            <div style={{ background: theme.bg.card, border: "1px solid rgba(248,113,113,0.25)", borderRadius: 14, padding: "16px 18px" }}>
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Outstanding</div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 18 : 22, color: theme.accent.red }}>{fmt(totalOutstanding)}</div>
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 4 }}>{openCredit.length} open sale{openCredit.length !== 1 ? "s" : ""}</div>
            </div>
            <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14, padding: "16px 18px" }}>
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Total Credit Sales</div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 18 : 22, color: theme.accent.gold }}>{creditSales.length}</div>
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 4 }}>{creditSales.filter(c => c.status === "paid").length} paid</div>
            </div>
            {!isMobile && (
              <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14, padding: "16px 18px" }}>
                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Returned</div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 22, color: "#6b7280" }}>{creditSales.filter(c => c.status === "returned").length}</div>
                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 4 }}>sales returned</div>
              </div>
            )}
          </div>

          {creditLoading ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ width: 22, height: 22, border: "3px solid rgba(248,113,113,0.2)", borderTopColor: theme.accent.red, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" }} />
            </div>
          ) : creditSales.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16 }}>
              <div style={{ fontSize: 44, opacity: 0.2, marginBottom: 12 }}>📝</div>
              <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono }}>No credit sales yet</div>
              <div style={{ color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, marginTop: 5, opacity: 0.6 }}>Use "Pay Later" when processing a sale</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {groupByCustomer(creditSales).map(group => {
                const isGroupExpanded = expandedCustomerKey === group.key;
                const openCount = group.sales.filter(cs => cs.status === "pending" || cs.status === "partial").length;
                return (
                  <div key={group.key} style={{ background: theme.bg.card, border: `1px solid ${isGroupExpanded ? "rgba(192,132,252,0.3)" : group.hasOpen ? "rgba(248,113,113,0.2)" : theme.border.default}`, borderRadius: 16, overflow: "hidden", transition: "border-color 0.15s" }}>
                    {/* Customer group header */}
                    <button
                      onClick={() => {
                        const next = isGroupExpanded ? null : group.key;
                        setExpandedCustomerKey(next);
                        if (next) group.sales.forEach(s => { if (!creditPayments[s.id]) fetchPaymentsFor(s.id); });
                      }}
                      style={{ width: "100%", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", color: "inherit" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: theme.text.primary }}>{group.customer_name}</div>
                          {group.hasOpen && (
                            <div style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "2px 8px", fontSize: 9, fontFamily: theme.font.mono, color: "#f87171", fontWeight: 600 }}>
                              {openCount} open
                            </div>
                          )}
                          {group.sales.length > 1 && (
                            <div style={{ background: "rgba(192,132,252,0.12)", border: "1px solid rgba(192,132,252,0.25)", borderRadius: 10, padding: "2px 8px", fontSize: 9, fontFamily: theme.font.mono, color: "#c084fc", fontWeight: 600 }}>
                              {group.sales.length} sales
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                          {group.customer_phone || "No phone"}{group.totalPaid > 0 && group.hasOpen ? ` · ${fmt(group.totalPaid)} paid` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0, marginLeft: 12 }}>
                        {group.hasOpen ? (
                          <>
                            <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 15, color: "#f87171" }}>{fmt(group.totalOutstanding)}</div>
                            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted }}>outstanding</div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 15, color: "#34d399" }}>{fmt(group.totalAmount)}</div>
                            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#34d399" }}>all settled</div>
                          </>
                        )}
                        <div style={{ fontSize: 10, color: theme.text.muted, marginTop: 2 }}>{isGroupExpanded ? "▲" : "▼"}</div>
                      </div>
                    </button>

                    {isGroupExpanded && (
                      <div style={{ borderTop: `1px solid ${theme.border.default}` }}>

                        {/* Action buttons — Record Payment + Send Statement */}
                        {group.hasOpen && (
                          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${theme.border.default}`, display: "flex", gap: 8 }}>
                            <button
                              onClick={() => { setPayGroupSales(group.sales.filter(s => s.status === "pending" || s.status === "partial")); setPayMpesaRef(""); setPayCashAmount(""); setPayMpesaAmount(""); setPayAgent(null); setPayPin(""); setPayPinError(""); setPayError(""); }}
                              style={{ flex: 1, padding: "10px 14px", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 10, color: "#34d399", fontFamily: theme.font.mono, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                              💰 Record Payment
                            </button>
                            <button
                              onClick={() => { setSendStmtGroup(group); setSendStmtPhone(group.customer_phone || ""); setSendStmtError(""); setSendStmtSent(false); }}
                              style={{ flex: 1, padding: "10px 14px", background: "rgba(192,132,252,0.1)", border: "1px solid rgba(192,132,252,0.3)", borderRadius: 10, color: "#c084fc", fontFamily: theme.font.mono, fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                              📱 Send Statement
                            </button>
                          </div>
                        )}

                        {/* ── Unified Payment History ── */}
                        {(() => {
                          const allPmts = group.sales
                            .flatMap(s => (creditPayments[s.id] ?? []))
                            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                          const allLoaded = group.sales.every(s => creditPayments[s.id] !== undefined);
                          const totalCredit = group.totalAmount;
                          return (
                            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${theme.border.default}` }}>
                              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                                Payment History {allLoaded ? `(${allPmts.length})` : ""}
                              </div>
                              {!allLoaded ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div style={{ width: 14, height: 14, border: "2px solid rgba(52,211,153,0.2)", borderTopColor: "#34d399", borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
                                  <span style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted }}>Loading…</span>
                                </div>
                              ) : allPmts.length === 0 ? (
                                <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, fontStyle: "italic" }}>No payments recorded yet</div>
                              ) : (
                                <div style={{ display: "flex", flexDirection: "column", gap: 0, background: "rgba(255,255,255,0.02)", border: `1px solid ${theme.border.default}`, borderRadius: 10, overflow: "hidden" }}>
                                  {allPmts.map((p, idx) => {
                                    const cumulativePaid   = allPmts.slice(0, idx + 1).reduce((s, x) => s + Number(x.amount), 0);
                                    const runningBalance   = Math.max(0, totalCredit - cumulativePaid);
                                    return (
                                      <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: idx < allPmts.length - 1 ? `1px solid ${theme.border.default}` : "none" }}>
                                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontFamily: theme.font.mono, color: "#34d399", fontWeight: 700, flexShrink: 0 }}>{idx + 1}</div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <span style={{ fontSize: 13, fontFamily: theme.font.mono, fontWeight: 700, color: "#34d399" }}>+{fmt(Number(p.amount))}</span>
                                            <span style={{ fontSize: 9, fontFamily: theme.font.mono, color: p.payment_method === "mpesa" ? "#06b6d4" : "#34d399", background: p.payment_method === "mpesa" ? "rgba(6,182,212,0.1)" : "rgba(52,211,153,0.1)", border: `1px solid ${p.payment_method === "mpesa" ? "rgba(6,182,212,0.25)" : "rgba(52,211,153,0.25)"}`, borderRadius: 4, padding: "1px 6px" }}>
                                              {p.payment_method === "mpesa" ? "M-Pesa" : "Cash"}
                                            </span>
                                          </div>
                                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                                            <span style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted }}>
                                              {new Date(p.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })} {new Date(p.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                                              {p.collected_by_name ? ` · ${p.collected_by_name}` : ""}
                                            </span>
                                            <span style={{ fontSize: 9, fontFamily: theme.font.mono, color: runningBalance > 0 ? "rgba(248,113,113,0.7)" : "#34d399" }}>
                                              Bal: {fmt(runningBalance)}
                                            </span>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(255,255,255,0.03)", borderTop: `1px solid ${theme.border.default}` }}>
                                    <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>Total Paid</span>
                                    <span style={{ fontSize: 13, fontFamily: theme.font.mono, fontWeight: 700, color: "#34d399" }}>{fmt(group.totalPaid)}</span>
                                  </div>
                                  {group.hasOpen && (
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "rgba(248,113,113,0.04)" }}>
                                      <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>Still Owed</span>
                                      <span style={{ fontSize: 13, fontFamily: theme.font.mono, fontWeight: 700, color: "#f87171" }}>{fmt(group.totalOutstanding)}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Individual sales — hide fully returned */}
                        {group.sales.filter(cs => cs.status !== "returned").map((cs, csIdx, arr) => {
                          const balance    = cs.amount - cs.amount_paid;
                          const sc         = statusColor(cs.status);
                          const isOpen     = cs.status === "pending" || cs.status === "partial";
                          const isExpanded = expandedCreditId === cs.id;
                          const payments   = creditPayments[cs.id] || [];
                          const loadingPay = paymentsLoading === cs.id;
                          const isLast     = csIdx === arr.length - 1;
                          return (
                            <div key={cs.id} style={{ borderBottom: isLast ? "none" : `1px solid ${theme.border.default}` }}>
                              <button onClick={() => toggleCreditCard(cs.id)}
                                style={{ width: "100%", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: isExpanded ? "rgba(6,182,212,0.03)" : "transparent", border: "none", cursor: "pointer", textAlign: "left", color: "inherit" }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                                    <div style={{ background: `${sc}20`, border: `1px solid ${sc}50`, borderRadius: 10, padding: "2px 8px", fontSize: 9, fontFamily: theme.font.mono, color: sc, fontWeight: 600 }}>
                                      {statusLabel(cs.status)}
                                    </div>
                                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                                      {new Date(cs.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })} · {cs.seller_name}
                                    </div>
                                  </div>
                                  <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.secondary }}>
                                      {(() => {
                                        const returnsForSale = creditReturns[cs.id] || [];
                                        const returnedMap: Record<string, number> = {};
                                        for (const ret of returnsForSale) {
                                          if (ret.product_id) {
                                            returnedMap[ret.product_id] = (returnedMap[ret.product_id] || 0) + ret.quantity_returned;
                                          }
                                        }
                                        return cs.items
                                          .map(item => {
                                            const returned = returnedMap[item.product_id] || 0;
                                            const remaining = item.quantity - returned;
                                            return `${item.product_name} ×${remaining}`;
                                          })
                                          .join(", ");
                                      })()}
                                    </div>
                                  <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>CR-{cs.id.slice(0, 8).toUpperCase()}</div>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0, marginLeft: 12 }}>
                                  <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 13, color: isOpen ? "#f87171" : "#34d399" }}>
                                    {isOpen ? fmt(balance) : fmt(cs.amount)}
                                  </div>
                                  <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted }}>{isOpen ? "balance" : "total"}</div>
                                  {cs.amount_paid > 0 && isOpen && (
                                    <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#34d399" }}>{fmt(cs.amount_paid)} paid</div>
                                  )}
                                  <div style={{ fontSize: 10, color: theme.text.muted, marginTop: 1 }}>{isExpanded ? "▲" : "▼"}</div>
                                </div>
                              </button>

                              {isExpanded && (
                                <div style={{ borderTop: `1px solid ${theme.border.default}` }}>
                                <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 4, background: "rgba(255,255,255,0.01)" }}>
                                      <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Items</div>
                                      {(() => {
                                        const returnsForSale = creditReturns[cs.id] || [];
                                        const returnedMap: Record<string, number> = {};
                                        for (const ret of returnsForSale) {
                                          if (ret.product_id) {
                                            returnedMap[ret.product_id] = (returnedMap[ret.product_id] || 0) + ret.quantity_returned;
                                          }
                                        }
                                        return cs.items.map((item, idx) => {
                                          const returned = returnedMap[item.product_id] || 0;
                                          const remaining = item.quantity - returned;
                                          return (
                                            <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: theme.font.mono, color: theme.text.secondary }}>
                                              <span>{remaining}× {item.product_name}</span>
                                              <span>{fmt(item.subtotal)}</span>
                                            </div>
                                          );
                                        });
                                      })()}
                                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: theme.font.mono, borderTop: `1px solid ${theme.border.default}`, paddingTop: 6, marginTop: 4 }}>
                                        <span style={{ color: theme.text.muted }}>Total</span>
                                        <span style={{ color: theme.accent.gold, fontWeight: 700 }}>{fmt(cs.amount)}</span>
                                      </div>
                                    </div>

                                  <div style={{ padding: "10px 16px 12px", borderTop: `1px solid ${theme.border.default}` }}>
                                    <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                                      Payment History {payments.length > 0 && `(${payments.length})`}
                                    </div>
                                    {loadingPay ? (
                                      <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}>
                                        <div style={{ width: 16, height: 16, border: "2px solid rgba(52,211,153,0.2)", borderTopColor: "#34d399", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                                      </div>
                                    ) : payments.length === 0 ? (
                                      <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, fontStyle: "italic" }}>No payments recorded yet</div>
                                    ) : (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                        {payments.map((p, idx) => (
                                          <div key={p.id} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                                            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0, fontFamily: theme.font.mono, color: "#34d399", fontWeight: 700, marginTop: 1 }}>{idx + 1}</div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                              <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.primary, fontWeight: 600 }}>{fmt(p.amount)}</div>
                                              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted }}>
                                                {p.payment_method === "cash" ? "💵 Cash" : "📱 M-Pesa"}{p.mpesa_ref ? ` · ${p.mpesa_ref}` : ""}
                                              </div>
                                              {p.collected_by_name && (
                                                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#60a5fa", marginTop: 2 }}>
                                                  Collected by {p.collected_by_name}{p.collected_by_agent_id && ` (${p.collected_by_agent_id})`}
                                                </div>
                                              )}
                                            </div>
                                            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, flexShrink: 0 }}>
                                              {new Date(p.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}
                                            </div>
                                          </div>
                                        ))}
                                        <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${theme.border.default}`, paddingTop: 6, marginTop: 2, fontSize: 11, fontFamily: theme.font.mono }}>
                                          <span style={{ color: theme.text.muted }}>Total paid</span>
                                          <span style={{ color: "#34d399", fontWeight: 700 }}>{fmt(cs.amount_paid)}</span>
                                        </div>
                                        {isOpen && (
                                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: theme.font.mono }}>
                                            <span style={{ color: theme.text.muted }}>Remaining</span>
                                            <span style={{ color: "#f87171", fontWeight: 700 }}>{fmt(balance)}</span>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {isOpen && (
                                    <div style={{ padding: "10px 16px 14px", borderTop: `1px solid ${theme.border.default}` }}>
                           <button
                                  onClick={() => openReturnModal(cs)}
                                  style={{
                                    width: "100%",
                                    padding: "10px 14px",
                                    background: "rgba(248,113,113,0.08)",
                                    border: "1px solid rgba(248,113,113,0.3)",
                                    borderRadius: 10,
                                    color: "#f87171",
                                    fontFamily: theme.font.mono,
                                    fontSize: 12,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 8,
                                    transition: "all 0.15s",
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.background = "rgba(248,113,113,0.15)";
                                    e.currentTarget.style.borderColor = "rgba(248,113,113,0.5)";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.background = "rgba(248,113,113,0.08)";
                                    e.currentTarget.style.borderColor = "rgba(248,113,113,0.3)";
                                  }}
                                >
                                  ↩ Return Items
                                </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ SEND STATEMENT MODAL ══ */}
      {sendStmtGroup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 60, display: "flex", alignItems: "flex-end", backdropFilter: "blur(4px)" }}
          onClick={e => { if (e.target === e.currentTarget && !sendStmtSending) setSendStmtGroup(null); }}>
          <div style={{ width: "100%", background: theme.bg.card, borderRadius: "20px 20px 0 0", border: `1px solid ${theme.border.default}`, borderBottom: "none", padding: "20px 18px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 17, color: "#c084fc" }}>📱 Send Statement</div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                  {sendStmtGroup.customer_name} · {fmt(sendStmtGroup.totalOutstanding)} outstanding
                </div>
              </div>
              <button onClick={() => setSendStmtGroup(null)} disabled={sendStmtSending}
                style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${theme.border.default}`, borderRadius: 10, width: 36, height: 36, cursor: "pointer", color: theme.text.muted, fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", opacity: sendStmtSending ? 0.4 : 1 }}>
                ×
              </button>
            </div>

            {/* Preview of what will be sent */}
            <div style={{ background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>SMS Preview</div>
              <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.secondary, lineHeight: 1.6, whiteSpace: "pre-line" }}>
                {(() => {
                  const openSales = sendStmtGroup.sales.filter(cs => cs.status === "pending" || cs.status === "partial");
                  const allItems = openSales.flatMap(cs => getOutstandingItems(cs));
                  const total = allItems.reduce((s, item) => s + item.total, 0);
                  const paid = openSales.reduce((s, cs) => s + cs.amount_paid, 0);
                  const balance = total - paid;
                  const label = openSales.length > 1 ? "[ CREDIT STATEMENT ]" : "[ CREDIT SALE ]";
                  const itemLines = allItems.map(i => `${i.name} x${i.quantity} - ${fmt(i.total)}`).join("\n");
                  return [
                    `Thank you for choosing ${businessName || shop?.name || "Business"}!`,
                    label,
                    "────────────",
                    itemLines || "(No outstanding items)",
                    "────────────",
                    `Total: ${fmt(total)}`,
                    ...(paid > 0 ? [`${openSales.length > 1 ? "Paid So Far" : "Paid Now"}: ${fmt(paid)}`] : []),
                    `Amount to Pay: ${fmt(balance)}`,
                    "────────────",
                    `Please pay ${fmt(balance)} to clear your balance. Thank you!`,
                  ].join("\n");
                })()}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Phone Number
              </div>
              <input
                type="tel"
                value={sendStmtPhone}
                onChange={e => { setSendStmtPhone(e.target.value); setSendStmtError(""); }}
                placeholder="e.g. 0712345678"
                disabled={sendStmtSending}
                style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", background: theme.bg.input, border: `1px solid ${sendStmtError ? "rgba(248,113,113,0.5)" : theme.border.default}`, borderRadius: 12, color: theme.text.primary, fontSize: 15, fontFamily: theme.font.mono, outline: "none" }}
              />
              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 5 }}>
                You can edit this number before sending
              </div>
            </div>

            {sendStmtError && (
              <div style={{ padding: "10px 14px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, fontSize: 12, fontFamily: theme.font.mono, color: "#f87171" }}>
                ⚠ {sendStmtError}
              </div>
            )}

            {sendStmtSent && (
              <div style={{ padding: "10px 14px", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 10, fontSize: 12, fontFamily: theme.font.mono, color: "#34d399", textAlign: "center" }}>
                ✓ Statement sent successfully
              </div>
            )}

            <button
              onClick={handleSendStatement}
              disabled={!sendStmtPhone.trim() || sendStmtSending || sendStmtSent}
              style={{ padding: "14px 20px", background: sendStmtSent ? "rgba(52,211,153,0.15)" : "rgba(192,132,252,0.15)", border: `1px solid ${sendStmtSent ? "rgba(52,211,153,0.4)" : "rgba(192,132,252,0.4)"}`, borderRadius: 14, color: sendStmtSent ? "#34d399" : "#c084fc", fontFamily: theme.font.mono, fontSize: 14, fontWeight: 700, cursor: (!sendStmtPhone.trim() || sendStmtSending || sendStmtSent) ? "not-allowed" : "pointer", opacity: (!sendStmtPhone.trim() || sendStmtSending) ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {sendStmtSending
                ? <><span style={{ width: 14, height: 14, border: "2px solid rgba(192,132,252,0.3)", borderTopColor: "#c084fc", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} /> Sending...</>
                : sendStmtSent ? "✓ Sent" : `📱 Send to ${sendStmtPhone.trim() || "..."}`}
            </button>
          </div>
        </div>
      )}

      {/* ══ LOG EXPENSE MODAL ══ */}
      {logOpen && (
        <div style={{ position: "fixed", inset: 0, background: theme.bg.overlay, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}
          onClick={e => { if (e.target === e.currentTarget) resetLogModal(); }}>
          <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 20, padding: "24px 20px 28px", width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 16, animation: "slideUp 0.22s ease", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 17 }}>Log Expense</div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>PIN required to record</div>
              </div>
              <button onClick={resetLogModal} style={{ background: "transparent", border: "none", color: theme.text.muted, fontSize: 20, cursor: "pointer", padding: "4px 8px" }}>✕</button>
            </div>

            {/* Available balance strips */}
            {(() => {
              const cashExpensed  = expenses.reduce((s, e) => s + (e.cash_amount  ?? (e.payment_method === "cash"  ? e.amount : 0)), 0);
              const mpesaExpensed = expenses.reduce((s, e) => s + (e.mpesa_amount ?? (e.payment_method === "mpesa" ? e.amount : 0)), 0);
              const cashAvail  = shopCashTotal  !== null ? Math.max(0, shopCashTotal  - cashExpensed)  : null;
              const mpesaAvail = shopMpesaTotal !== null ? Math.max(0, shopMpesaTotal - mpesaExpensed) : null;
              const isLoading  = shopCashTotal === null || shopMpesaTotal === null;
              const enteredC   = Math.round(Number(expCashAmount)  || 0);
              const enteredM   = Math.round(Number(expMpesaAmount) || 0);
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    { icon: "💵", label: "Cash available",   avail: cashAvail,  entered: enteredC },
                    { icon: "📱", label: "M-Pesa available", avail: mpesaAvail, entered: enteredM },
                  ].map(r => {
                    const over = r.avail !== null && r.entered > 0 && r.entered > r.avail;
                    return (
                      <div key={r.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 13px", background: over ? "rgba(248,113,113,0.07)" : "rgba(255,255,255,0.03)", border: `1px solid ${over ? "rgba(248,113,113,0.3)" : theme.border.default}`, borderRadius: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ fontSize: 14 }}>{over ? "⚠️" : r.icon}</span>
                          <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: over ? "#f87171" : theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{r.label}</span>
                        </div>
                        {isLoading
                          ? <span style={{ width: 12, height: 12, border: "2px solid rgba(255,255,255,0.15)", borderTopColor: theme.accent.cyan, borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }} />
                          : <span style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 15, color: over ? "#f87171" : (r.avail ?? 0) === 0 ? theme.text.muted : "#34d399" }}>{fmt(r.avail ?? 0)}</span>
                        }
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>What was it for?</label>
              <textarea className="ki" value={expDesc}
                onChange={e => { setExpDesc(sanitizeText(e.target.value, 200)); setExpError(""); }}
                placeholder="e.g. Lunch for agents, Transport to warehouse..."
                rows={2} maxLength={200} style={{ resize: "none", lineHeight: 1.5 }} />
            </div>

            {/* Expense amounts — dual fields, method auto-detected */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em" }}>How was it paid?</label>
              <div>
                <label style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#34d399", display: "block", marginBottom: 4, textTransform: "uppercase" }}>💵 Cash</label>
                <input className="ki" type="text" inputMode="numeric" value={expCashAmount}
                  onChange={e => { setExpCashAmount(sanitizeAmount(e.target.value)); setExpError(""); }}
                  placeholder="0" />
              </div>
              <div>
                <label style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.accent.cyan, display: "block", marginBottom: 4, textTransform: "uppercase" }}>📱 M-Pesa</label>
                <input className="ki" type="text" inputMode="numeric" value={expMpesaAmount}
                  onChange={e => { setExpMpesaAmount(sanitizeAmount(e.target.value)); setExpError(""); }}
                  placeholder="0" />
              </div>
              {(() => {
                const c = Math.round(Number(expCashAmount) || 0);
                const m = Math.round(Number(expMpesaAmount) || 0);
                const tot = c + m;
                if (!tot) return null;
                return (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(255,255,255,0.03)", border: `1px solid ${theme.border.default}`, borderRadius: 9 }}>
                    <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                      {c > 0 && m > 0 ? "⚡ Split" : c > 0 ? "💵 Cash" : "📱 M-Pesa"}
                    </span>
                    <span style={{ fontSize: 13, fontFamily: theme.font.mono, fontWeight: 700, color: theme.accent.gold }}>{fmt(tot)}</span>
                  </div>
                );
              })()}
            </div>

            {expError && <div style={{ color: theme.accent.red, fontSize: 11, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px" }}>⚠ {expError}</div>}

            {!expAgent ? (
              <div>
                <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Who is logging this?</label>
                <AgentList onSelect={sa => { setExpAgent(sa); setExpPin(""); setExpPinError(""); }} />
              </div>
            ) : (
              <div>
                <SelectedAgentRow agent={expAgent} onClear={() => { setExpAgent(null); setExpPin(""); setExpPinError(""); }} />
                <PinKeypad selectedAgent={expAgent} pin={expPin} setPin={setExpPin} pinError={expPinError} setPinError={setExpPinError} pinShake={expPinShake} setPinShake={setExpPinShake} processing={expProcessing} onVerify={handleLogExpense} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ EDIT EXPENSE MODAL ══ */}
      {editTarget && (
        <div style={{ position: "fixed", inset: 0, background: theme.bg.overlay, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}
          onClick={e => { if (e.target === e.currentTarget) resetEditModal(); }}>
          <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 20, padding: "24px 20px 28px", width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 16, animation: "slideUp 0.22s ease", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 17 }}>Edit Expense</div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.accent.red, marginTop: 2 }}>Only {editTarget.logged_by_name} can edit this</div>
              </div>
              <button onClick={resetEditModal} style={{ background: "transparent", border: "none", color: theme.text.muted, fontSize: 20, cursor: "pointer", padding: "4px 8px" }}>✕</button>
            </div>

            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>Amount (KSh)</label>
              <input className="ki" type="text" inputMode="numeric" value={editAmount}
                onChange={e => { setEditAmount(sanitizeAmount(e.target.value)); setEditError(""); }}
                placeholder="e.g. 500" />
            </div>

            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>What was it for?</label>
              <textarea className="ki" value={editDesc}
                onChange={e => { setEditDesc(sanitizeText(e.target.value, 200)); setEditError(""); }}
                placeholder="e.g. Lunch for agents..." rows={2} maxLength={200} style={{ resize: "none", lineHeight: 1.5 }} />
            </div>

            {editError && <div style={{ color: theme.accent.red, fontSize: 11, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px" }}>⚠ {editError}</div>}

            {!editAgent ? (
              <div>
                <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Confirm your identity</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {agents.map(sa => (
                    <button key={sa.id} onClick={() => { setEditAgent(sa); setEditPin(""); setEditPinError(""); }}
                      style={{ padding: "11px 14px", border: `1px solid ${sa.agent.id === editTarget.logged_by ? "rgba(6,182,212,0.3)" : "rgba(255,255,255,0.06)"}`, borderRadius: 11, background: sa.agent.id === editTarget.logged_by ? "rgba(6,182,212,0.06)" : "rgba(255,255,255,0.02)", cursor: sa.agent.id === editTarget.logged_by ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: 12, textAlign: "left", opacity: sa.agent.id === editTarget.logged_by ? 1 : 0.35 }}>
                      <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, color: theme.accent.cyan, flexShrink: 0 }}>
                        {sa.agent.avatar || sa.agent.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text.primary }}>{sa.agent.name}</div>
                        <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 1 }}>{sa.agent.agent_id}</div>
                      </div>
                      {sa.agent.id === editTarget.logged_by && (
                        <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.accent.cyan, background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 6, padding: "2px 7px", flexShrink: 0 }}>Owner</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <SelectedAgentRow agent={editAgent} onClear={() => { setEditAgent(null); setEditPin(""); setEditPinError(""); }} />
                <PinKeypad selectedAgent={editAgent} pin={editPin} setPin={setEditPin} pinError={editPinError} setPinError={setEditPinError} pinShake={editPinShake} setPinShake={setEditPinShake} processing={editProcessing} onVerify={handleEditExpense} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ RECORD PAYMENT MODAL ══ */}
      {(payTarget || payGroupSales) && (() => {
        const custName  = payGroupSales ? payGroupSales[0].customer_name : payTarget!.customer_name;
        const totalOwed = payGroupSales
          ? payGroupSales.reduce((s, x) => s + (x.amount - x.amount_paid), 0)
          : payTarget!.amount - payTarget!.amount_paid;
        return (
        <div style={{ position: "fixed", inset: 0, background: theme.bg.overlay, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}
          onClick={e => { if (e.target === e.currentTarget) resetPayModal(); }}>
          <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 20, padding: "24px 20px 28px", width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 16, animation: "slideUp 0.22s ease", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 17 }}>Record Payment</div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                  {custName} · {payGroupSales ? `${payGroupSales.length} open sale${payGroupSales.length !== 1 ? "s" : ""}` : "Single sale"} · Owes {fmt(totalOwed)}
                </div>
              </div>
              <button onClick={resetPayModal} style={{ background: "transparent", border: "none", color: theme.text.muted, fontSize: 20, cursor: "pointer", padding: "4px 8px" }}>✕</button>
            </div>

            {/* Payment amounts — dual fields, method auto-detected */}
            {(() => {
              const c   = Math.round(Number(payCashAmount)  || 0);
              const m   = Math.round(Number(payMpesaAmount) || 0);
              const tot = c + m;
              const over = tot > totalOwed + 0.01;
              const balColor = over ? "#f87171" : tot > 0 ? "#34d399" : theme.text.muted;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    Payment amounts · Owes {fmt(totalOwed)}
                  </label>
                  <div>
                    <label style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#34d399", display: "block", marginBottom: 4, textTransform: "uppercase" }}>💵 Cash</label>
                    <input className="ki" type="text" inputMode="numeric" value={payCashAmount}
                      onChange={e => { setPayCashAmount(sanitizeAmount(e.target.value)); setPayError(""); }}
                      placeholder="0" />
                    {m > 0 && c === 0 && (
                      <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#34d399", opacity: 0.6, marginTop: 3 }}>
                        💡 Type {fmt(Math.max(0, totalOwed - m))} to balance
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.accent.cyan, display: "block", marginBottom: 4, textTransform: "uppercase" }}>📱 M-Pesa</label>
                    <input className="ki" type="text" inputMode="numeric" value={payMpesaAmount}
                      onChange={e => { setPayMpesaAmount(sanitizeAmount(e.target.value)); setPayError(""); }}
                      placeholder="0" />
                    {c > 0 && m === 0 && (
                      <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#06b6d4", opacity: 0.6, marginTop: 3 }}>
                        💡 Type {fmt(Math.max(0, totalOwed - c))} to balance
                      </div>
                    )}
                  </div>
                  {/* M-Pesa ref — only when M-Pesa has a value */}
                  {m > 0 && (
                    <div>
                      <label style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.accent.cyan, display: "block", marginBottom: 4, textTransform: "uppercase" }}>M-Pesa Ref (optional)</label>
                      <input className="ki" value={payMpesaRef} onChange={e => setPayMpesaRef(sanitizeCode(e.target.value, 20))} placeholder="e.g. QHX7K3LM2P" maxLength={20} spellCheck={false} />
                    </div>
                  )}
                  {/* Running total */}
                  {tot > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", background: over ? "rgba(248,113,113,0.06)" : "rgba(255,255,255,0.03)", border: `1px solid ${over ? "rgba(248,113,113,0.3)" : theme.border.default}`, borderRadius: 9 }}>
                      <span style={{ fontSize: 11, fontFamily: theme.font.mono, color: balColor }}>
                        {over ? `⚠ KSh ${(tot - totalOwed).toLocaleString()} over` : `${c > 0 && m > 0 ? "⚡ Split" : c > 0 ? "💵 Cash" : "📱 M-Pesa"}`}
                      </span>
                      <span style={{ fontSize: 13, fontFamily: theme.font.mono, fontWeight: 700, color: balColor }}>{fmt(tot)}</span>
                    </div>
                  )}
                </div>
              );
            })()}

            {payError && <div style={{ color: theme.accent.red, fontSize: 11, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px" }}>⚠ {payError}</div>}

            {!payAgent ? (
              <div>
                <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Who is collecting?</label>
                <AgentList onSelect={sa => { setPayAgent(sa); setPayPin(""); setPayPinError(""); }} />
              </div>
            ) : (
              <div>
                <SelectedAgentRow agent={payAgent} onClear={() => { setPayAgent(null); setPayPin(""); setPayPinError(""); }} />
                <PinKeypad selectedAgent={payAgent} pin={payPin} setPin={setPayPin} pinError={payPinError} setPinError={setPayPinError} pinShake={payPinShake} setPinShake={setPayPinShake} processing={payProcessing} onVerify={handleRecordPayment} />
              </div>
            )}
          </div>
        </div>
        );
      })()}
     {/* ══ MARK RETURNED MODAL ══ */}
{returnTarget && (() => {
  const totalRefund = returnItems.reduce((sum, it) => sum + it.return_qty * it.unit_price, 0);
  return (
    <div style={{ position: "fixed", inset: 0, background: theme.bg.overlay, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}
      onClick={e => { if (e.target === e.currentTarget) resetReturnModal(); }}>
      <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 20, padding: "24px 20px 28px", width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 16, animation: "slideUp 0.22s ease", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 17 }}>Partial Return</div>
            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
              {returnTarget.customer_name} · Select items to return
            </div>
          </div>
          <button onClick={resetReturnModal} style={{ background: "transparent", border: "none", color: theme.text.muted, fontSize: 20, cursor: "pointer", padding: "4px 8px" }}>✕</button>
        </div>

        {/* Item list with quantity controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {returnItems.map((item, idx) => {
            const maxQ = item.remaining_qty;
            const refund = item.return_qty * item.unit_price;
            return (
              <div key={idx} style={{ background: theme.bg.input, borderRadius: 12, padding: "12px 14px", border: item.return_qty > 0 ? "1px solid rgba(248,113,113,0.4)" : `1px solid ${theme.border.default}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{item.product_name}</div>
                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                       {fmt(item.unit_price)}/unit · Remaining: {item.remaining_qty}
                    </div>
                  </div>
                  {item.return_qty > 0 && (
                    <div style={{ fontSize: 12, fontFamily: theme.font.mono, fontWeight: 700, color: "#f87171", flexShrink: 0 }}>
                      -{fmt(refund)}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <span style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted }}>Return:</span>
                  <button onClick={() => setReturnItems(prev => prev.map((it, i) => i === idx ? { ...it, return_qty: Math.max(0, it.return_qty - 1) } : it))}
                    style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: `1px solid ${theme.border.default}`, color: theme.text.primary, fontSize: 16, cursor: "pointer" }}>
                    −
                  </button>
                  <input
                    type="text" inputMode="numeric" value={item.return_qty}
                    onChange={e => {
                      const val = parseInt(e.target.value) || 0;
                      setReturnItems(prev => prev.map((it, i) => i === idx ? { ...it, return_qty: Math.min(maxQ, Math.max(0, val)) } : it));
                    }}
                    style={{ width: 54, textAlign: "center", padding: "6px 8px", background: theme.bg.base, border: `1px solid ${theme.border.default}`, borderRadius: 8, color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 14, outline: "none" }}
                  />
                  <button onClick={() => setReturnItems(prev => prev.map((it, i) => i === idx ? { ...it, return_qty: Math.min(maxQ, it.return_qty + 1) } : it))}
                    style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.06)", border: `1px solid ${theme.border.default}`, color: theme.text.primary, fontSize: 16, cursor: "pointer" }}>
                    +
                  </button>
                  <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>of {maxQ}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Refund summary */}
        {totalRefund > 0 && (
          <div style={{ padding: "12px 14px", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 12, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontFamily: theme.font.mono, color: theme.text.muted }}>Total Refund</span>
            <span style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 15, color: "#f87171" }}>{fmt(totalRefund)}</span>
          </div>
        )}

        {/* Refund method and amounts */}
        {totalRefund > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>
                Refund Method
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {([{ key: "cash", icon: "💵", label: "Cash", col: "#34d399" }, { key: "mpesa", icon: "📱", label: "M-Pesa", col: theme.accent.cyan }, { key: "split", icon: "⚡", label: "Split", col: "#fbbf24" }] as const).map(({ key, icon, label, col }) => (
                  <button key={key} type="button" onClick={() => { setReturnRefundMethod(key); setReturnCashRefund(""); setReturnMpesaRefund(""); }}
                    style={{ padding: "10px 8px", border: `1px solid ${returnRefundMethod === key ? col + "80" : theme.border.default}`, borderRadius: 12, background: returnRefundMethod === key ? col + "18" : "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 18 }}>{icon}</span>
                    <span style={{ fontSize: 11, fontFamily: theme.font.mono, fontWeight: 600, color: returnRefundMethod === key ? col : theme.text.muted }}>{label}</span>
                  </button>
                ))}
              </div>
            </div>
            {returnRefundMethod === "split" ? (
              <div style={{ background: "rgba(251,191,36,0.05)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: "#fbbf24" }}>⚡ Split refund — Total: {fmt(totalRefund)}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#34d399", display: "block", marginBottom: 4, textTransform: "uppercase" }}>💵 Cash</label>
                    <input className="ki" type="text" inputMode="numeric" value={returnCashRefund}
                      onChange={e => { const v = sanitizeAmount(e.target.value); setReturnCashRefund(v); setReturnMpesaRefund(String(Math.max(0, Math.round(totalRefund - (Number(v) || 0))))); }}
                      placeholder="0" />
                  </div>
                  <div>
                    <label style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.accent.cyan, display: "block", marginBottom: 4, textTransform: "uppercase" }}>📱 M-Pesa</label>
                    <input className="ki" type="text" inputMode="numeric" value={returnMpesaRefund}
                      onChange={e => { const v = sanitizeAmount(e.target.value); setReturnMpesaRefund(v); setReturnCashRefund(String(Math.max(0, Math.round(totalRefund - (Number(v) || 0))))); }}
                      placeholder="0" />
                  </div>
                </div>
              </div>
            ) : returnRefundMethod === "cash" ? (
              <div>
                <label style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#34d399", display: "block", marginBottom: 4, textTransform: "uppercase" }}>💵 Cash Amount</label>
                <input className="ki" type="text" inputMode="numeric" value={returnCashRefund}
                  onChange={e => { setReturnCashRefund(sanitizeAmount(e.target.value)); setReturnMpesaRefund("0"); }}
                  placeholder={String(totalRefund)} />
              </div>
            ) : (
              <div>
                <label style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.accent.cyan, display: "block", marginBottom: 4, textTransform: "uppercase" }}>📱 M-Pesa Amount</label>
                <input className="ki" type="text" inputMode="numeric" value={returnMpesaRefund}
                  onChange={e => { setReturnMpesaRefund(sanitizeAmount(e.target.value)); setReturnCashRefund("0"); }}
                  placeholder={String(totalRefund)} />
              </div>
            )}
            {totalRefund > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "rgba(255,255,255,0.03)", border: `1px solid ${theme.border.default}`, borderRadius: 9 }}>
                <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                  {(() => {
                    const c = Math.round(Number(returnCashRefund) || 0);
                    const m = Math.round(Number(returnMpesaRefund) || 0);
                    const tot = c + m;
                    if (tot === 0) return "Enter amounts";
                    if (Math.abs(tot - totalRefund) < 0.5) return "✓ Balanced";
                    if (tot > totalRefund) return "⚠ Over";
                    return `⚠ Under by ${fmt(totalRefund - tot)}`;
                  })()}
                </span>
                <span style={{ fontSize: 13, fontFamily: theme.font.mono, fontWeight: 700, color: theme.accent.gold }}>
                  {fmt(Math.round(Number(returnCashRefund) || 0) + Math.round(Number(returnMpesaRefund) || 0))}
                </span>
              </div>
            )}
          </div>
        )}

        <div style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 14px", fontSize: 11, fontFamily: theme.font.mono, color: theme.accent.red, lineHeight: 1.6 }}>
          ⚠ This will restore stock for the returned items and reduce the customer’s balance. This cannot be undone.
        </div>

        {returnError && <div style={{ color: theme.accent.red, fontSize: 11, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px" }}>⚠ {returnError}</div>}

        {!returnAgent ? (
          <div>
            <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Confirm your identity</label>
            <AgentList onSelect={sa => { setReturnAgent(sa); setReturnPin(""); setReturnPinError(""); }} />
          </div>
        ) : (
          <div>
            <SelectedAgentRow agent={returnAgent} onClear={() => { setReturnAgent(null); setReturnPin(""); setReturnPinError(""); }} />
            <PinKeypad selectedAgent={returnAgent} pin={returnPin} setPin={setReturnPin} pinError={returnPinError} setPinError={setReturnPinError} pinShake={returnPinShake} setPinShake={setReturnPinShake} processing={returnProcessing} onVerify={handleMarkReturned} />
          </div>
        )}
      </div>
    </div>
  );
  })()}
    </div>
  );
}
