// pages/PosRequests.tsx
// Requests, Expenses and Credit tabs for shop agents

import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme } from "../context/ThemeContext";
import { useShopAuth } from "../context/ShopAuthContext";
import { supabase } from "../lib/supabase";
import { sanitizeInteger, sanitizeText, sanitizeAmount, sanitizeCode } from "../lib/sanitize";

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
type ActiveTab = "requests" | "expenses" | "credit" | "customers";

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
  const { shop } = useShopAuth();
  const width = useWindowWidth();
  const isMobile = width < 640;
  const isTablet = width < 1024;

  const [activeTab, setActiveTab] = useState<ActiveTab>("requests");

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

  const [logOpen,       setLogOpen]       = useState(false);
  const [expAmount,     setExpAmount]     = useState("");
  const [expDesc,       setExpDesc]       = useState("");
  const [expAgent,      setExpAgent]      = useState<ShopAgent | null>(null);
  const [expPin,        setExpPin]        = useState("");
  const [expPinError,   setExpPinError]   = useState("");
  const [expPinShake,   setExpPinShake]   = useState(false);
  const [expProcessing, setExpProcessing] = useState(false);
  const [expError,      setExpError]      = useState("");

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
  const [payAmount,      setPayAmount]      = useState("");
  const [payMethod2,     setPayMethod2]     = useState<"cash" | "mpesa">("cash");
  const [payMpesaRef,    setPayMpesaRef]    = useState("");
  const [payAgent,       setPayAgent]       = useState<ShopAgent | null>(null);
  const [payPin,         setPayPin]         = useState("");
  const [payPinError,    setPayPinError]    = useState("");
  const [payPinShake,    setPayPinShake]    = useState(false);
  const [payProcessing,  setPayProcessing]  = useState(false);
  const [payError,       setPayError]       = useState("");

  const [returnTarget,     setReturnTarget]     = useState<CreditSale | null>(null);
  const [returnAgent,      setReturnAgent]      = useState<ShopAgent | null>(null);
  const [returnPin,        setReturnPin]        = useState("");
  const [returnPinError,   setReturnPinError]   = useState("");
  const [returnPinShake,   setReturnPinShake]   = useState(false);
  const [returnProcessing, setReturnProcessing] = useState(false);
  const [returnError,      setReturnError]      = useState("");

  const [expandedCreditId, setExpandedCreditId] = useState<string | null>(null);
  const [creditPayments,   setCreditPayments]   = useState<Record<string, CreditPayment[]>>({});
  const [paymentsLoading,  setPaymentsLoading]  = useState<string | null>(null);

  // ── Shared PIN lockout ────────────────────────────────────────────────
  const PIN_MAX_FAILS   = 5;
  const PIN_LOCKOUT_MS  = 30_000;
  const [pinModalFails,       setPinModalFails]       = useState(0);
  const [pinModalCountdown,   setPinModalCountdown]   = useState(0);
  const pinLockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    const [reqRes, allocRes] = await Promise.all([
      supabase.from("shop_requests").select("*").eq("shop_id", shop.id).order("created_at", { ascending: false }),
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

  // ── Fetch agents ──────────────────────────────────────────────────────
  const fetchAgents = useCallback(async () => {
    if (!shop) return;
    const { data: shopAgentsRaw } = await supabase
      .from("shop_agents")
      .select("id, pin, active, agent_id, agent_name, agent_code, agent_avatar")
      .eq("shop_id", shop.id).eq("active", true);

    let hydratedAgents: ShopAgent[] = (shopAgentsRaw || []).map((r: any) => ({
      id: r.id, pin: r.pin, active: r.active,
      agent: { id: r.agent_id, name: r.agent_name ?? "Agent", agent_id: r.agent_code ?? "", avatar: r.agent_avatar ?? "" },
    }));

    const needsFallback = hydratedAgents.some(a => a.agent.name === "Agent");
    if (needsFallback) {
      const agentIds = hydratedAgents.map(a => a.agent.id).filter(Boolean);
      if (agentIds.length > 0) {
        const { data: profilesData } = await supabase
          .from("profiles").select("id, name, agent_id, avatar")
          .in("id", agentIds).eq("owner_id", shop.owner_id);
        if (profilesData && profilesData.length > 0) {
          const pMap: Record<string, any> = {};
          for (const p of profilesData) pMap[p.id] = p;
          hydratedAgents = hydratedAgents.map(a => ({
            ...a,
            agent: pMap[a.agent.id]
              ? { id: pMap[a.agent.id].id, name: pMap[a.agent.id].name, agent_id: pMap[a.agent.id].agent_id, avatar: pMap[a.agent.id].avatar }
              : a.agent,
          }));
        }
      }
    }
    setAgents(hydratedAgents);
  }, [shop]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // ── Fetch expenses ────────────────────────────────────────────────────
  const fetchExpenses = useCallback(async () => {
    if (!shop) return;
    setExpLoading(true);
    const { data } = await supabase.from("shop_expenses")
      .select("id, amount, description, logged_by, logged_by_name, created_at, updated_at")
      .eq("shop_id", shop.id).order("created_at", { ascending: false });
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

  // ── Fetch credit sales ────────────────────────────────────────────────
  const fetchCreditSales = useCallback(async () => {
    if (!shop) return;
    setCreditLoading(true);
    const { data } = await supabase.from("shop_credit_sales")
      .select("id, amount, amount_paid, customer_name, customer_phone, seller_name, seller_agent_id, status, items, created_at")
      .eq("shop_id", shop.id).order("created_at", { ascending: false });
    setCreditSales((data || []) as CreditSale[]);
    setCreditLoading(false);
  }, [shop]);

  useEffect(() => { fetchCreditSales(); }, [fetchCreditSales]);

  useEffect(() => {
    if (!shop) return;
    const ch = supabase.channel("shop-credit-live-req")
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_credit_sales", filter: `shop_id=eq.${shop.id}` }, fetchCreditSales)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, fetchCreditSales]);

  const fetchPaymentsFor = useCallback(async (creditSaleId: string) => {
    setPaymentsLoading(creditSaleId);
    const { data } = await supabase.from("shop_credit_payments")
      .select("id, amount, payment_method, mpesa_ref, created_at")
      .eq("credit_sale_id", creditSaleId).order("created_at", { ascending: true });
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
    const { error } = await supabase.from("shop_requests").insert({
      owner_id:     shop.owner_id,
      shop_id:      shop.id,
      type,
      product_id:   needsProduct && productId && productId !== "__other__" ? productId : null,
      product_name: needsProduct && selectedProduct ? selectedProduct.name : needsProduct && productId === "__other__" ? "Other" : null,
      quantity:     needsQty && quantity ? parseInt(quantity) : null,
      message:      message.trim(),
      status:       "pending",
    });
    if (error) { setFormError(`Failed to send: ${error.message}`); setSubmitting(false); return; }
    setSuccessMsg("Request sent to your owner ✓");
    setSubmitting(false);
    resetForm();
    setTimeout(() => { setShowForm(false); setSuccessMsg(""); fetchData(); }, 1500);
  };

  // ── Expense handlers ──────────────────────────────────────────────────
  const handleLogExpense = async (agent: ShopAgent) => {
    const amount = parseFloat(expAmount);
    if (!amount || amount <= 0) { setExpError("Enter a valid amount."); return; }
    if (!expDesc.trim()) { setExpError("Describe the expense."); return; }
    setExpProcessing(true);
    const { error } = await supabase.from("shop_expenses").insert({
      shop_id: shop?.id, owner_id: shop?.owner_id, amount,
      description: expDesc.trim(), logged_by: agent.agent.id, logged_by_name: agent.agent.name,
    });
    if (error) { setExpProcessing(false); setExpError("Failed to save expense. Try again."); return; }
    setLogOpen(false);
    setExpAmount(""); setExpDesc(""); setExpAgent(null); setExpPin(""); setExpError(""); setExpProcessing(false);
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
    const { error } = await supabase.from("shop_expenses")
      .update({ amount, description: editDesc.trim(), updated_at: new Date().toISOString() })
      .eq("id", editTarget.id);
    if (error) { setEditProcessing(false); setEditError("Failed to update expense."); return; }
    setEditTarget(null);
    setEditAmount(""); setEditDesc(""); setEditAgent(null); setEditPin(""); setEditError(""); setEditProcessing(false);
    fetchExpenses();
  };

  const resetLogModal = () => {
    setLogOpen(false);
    setExpAmount(""); setExpDesc(""); setExpAgent(null);
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
  const handleRecordPayment = async (_agent: ShopAgent) => {
    if (!payTarget) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) { setPayError("Enter a valid payment amount."); return; }
    const balance = payTarget.amount - payTarget.amount_paid;
    if (amount > balance) { setPayError(`Amount exceeds what is owed. Balance is ${fmt(balance)}.`); return; }
    setPayProcessing(true);

    const { error: insErr } = await supabase.from("shop_credit_payments").insert({
      credit_sale_id: payTarget.id, shop_id: shop?.id, owner_id: shop?.owner_id,
      amount, payment_method: payMethod2,
      mpesa_ref: payMethod2 === "mpesa" ? payMpesaRef.trim() || null : null,
    });
    if (insErr) { setPayProcessing(false); setPayError(insErr.message || "Failed to record payment. Try again."); return; }

    const newPaid   = payTarget.amount_paid + amount;
    const newStatus = newPaid >= payTarget.amount - 0.5 ? "paid" : "partial";
    await supabase.from("shop_credit_sales")
      .update({ amount_paid: newPaid, status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", payTarget.id);

    const saleId = payTarget.id;
    setPayTarget(null);
    setPayAmount(""); setPayMethod2("cash"); setPayMpesaRef("");
    setPayAgent(null); setPayPin(""); setPayPinError(""); setPayError(""); setPayProcessing(false);
    fetchCreditSales();
    fetchPaymentsFor(saleId);
  };

  const resetPayModal = () => {
    setPayTarget(null);
    setPayAmount(""); setPayMethod2("cash"); setPayMpesaRef("");
    setPayAgent(null); setPayPin(""); setPayPinError(""); setPayError(""); setPayProcessing(false);
    resetPinLockout();
  };

  const handleMarkReturned = async (_agent: ShopAgent) => {
    if (!returnTarget) return;
    setReturnProcessing(true);
    for (const item of returnTarget.items) {
      const { data: allocData } = await supabase.from("shop_allocations").select("remaining").eq("id", item.allocation_id).single();
      if (allocData) {
        const { error: restoreErr } = await supabase.from("shop_allocations")
          .update({ remaining: allocData.remaining + item.quantity }).eq("id", item.allocation_id);
        if (restoreErr) {
          setReturnProcessing(false);
          setReturnError(`Failed to restore stock for ${item.product_name}.`);
          return;
        }
      }
    }
    await supabase.from("shop_credit_sales")
      .update({ status: "returned", updated_at: new Date().toISOString() })
      .eq("id", returnTarget.id);

    setReturnTarget(null);
    setReturnAgent(null); setReturnPin(""); setReturnPinError(""); setReturnError(""); setReturnProcessing(false);
    fetchCreditSales();
  };

  const resetReturnModal = () => {
    setReturnTarget(null);
    setReturnAgent(null); setReturnPin(""); setReturnPinError(""); setReturnError(""); setReturnProcessing(false);
    resetPinLockout();
  };

  // ── Computed ──────────────────────────────────────────────────────────
  const pendingCount   = requests.filter(r => r.status === "pending").length;
  const totalExpenses  = expenses.reduce((s, e) => s + e.amount, 0);
  const openCredit     = creditSales.filter(c => c.status === "pending" || c.status === "partial");
  const totalOutstanding = openCredit.reduce((s, c) => s + (c.amount - c.amount_paid), 0);

  const statusColor = (s: string) => s === "paid" ? "#34d399" : s === "returned" ? "#6b7280" : s === "partial" ? "#fbbf24" : "#f87171";
  const statusLabel = (s: string) => s === "paid" ? "Paid" : s === "returned" ? "Returned" : s === "partial" ? "Partial" : "Pending";

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

  // ── Customer directory ────────────────────────────────────────────────
  const [customerSearch, setCustomerSearch] = useState("");

  const customerGroups = (() => {
    const map: Record<string, { name: string; phone: string; sales: CreditSale[] }> = {};
    for (const s of creditSales) {
      const key = s.customer_phone || s.customer_name;
      if (!map[key]) map[key] = { name: s.customer_name, phone: s.customer_phone, sales: [] };
      map[key].sales.push(s);
    }
    return Object.values(map).sort((a, b) => {
      const balA = a.sales.reduce((t, s) => t + (s.amount - s.amount_paid), 0);
      const balB = b.sales.reduce((t, s) => t + (s.amount - s.amount_paid), 0);
      return balB - balA;
    });
  })();

  const filteredCustomers = customerSearch
    ? customerGroups.filter(c =>
        c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.phone.toLowerCase().includes(customerSearch.toLowerCase())
      )
    : customerGroups;

  // ── Tab labels ────────────────────────────────────────────────────────
  const tabs: { key: ActiveTab; label: string }[] = [
    { key: "requests",  label: `📋 Requests${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
    { key: "expenses",  label: `💸 Expenses (${expenses.length})` },
    { key: "credit",    label: `📝 Credit (${openCredit.length})` },
    { key: "customers", label: `👤 Customers (${customerGroups.length})` },
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
          {activeTab === "requests" && (
            <button
              onClick={() => { setShowForm(true); resetForm(); }}
              style={{ background: "linear-gradient(135deg,#06b6d4,#0891b2)", border: "none", borderRadius: 12, padding: "10px 18px", color: "#fff", fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              + New
            </button>
          )}
          {activeTab === "expenses" && (
            <button onClick={() => setLogOpen(true)}
              style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 12, padding: "10px 18px", color: "#f87171", fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              + Log
            </button>
          )}
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
                    <input type="number" min="1" max="9999" value={quantity}
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

                {formError && <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 10, padding: "10px 14px", color: "#f87171", fontFamily: theme.font.mono, fontSize: 12, marginBottom: 16 }}>⚠ {formError}</div>}
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
            {loading ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 13 }}>
                <div style={{ width: 24, height: 24, border: "2px solid rgba(6,182,212,0.2)", borderTopColor: "#06b6d4", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
                Loading requests...
              </div>
            ) : requests.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 16px", color: theme.text.muted }}>
                <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>📋</div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 16, marginBottom: 6 }}>No requests yet</div>
                <div style={{ fontFamily: theme.font.mono, fontSize: 12, lineHeight: 1.7 }}>
                  Use the button above to send stock requests,<br />report damage, or message your owner.
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
          {/* Summary card */}
          <div style={{ background: theme.bg.card, border: "1px solid rgba(248,113,113,0.2)", borderRadius: 14, padding: "16px 18px" }}>
            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Total Expenses</div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 22 : 26, color: theme.accent.red }}>{fmt(totalExpenses)}</div>
            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 4 }}>{expenses.length} record{expenses.length !== 1 ? "s" : ""}</div>
          </div>

          {expLoading ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ width: 22, height: 22, border: "3px solid rgba(248,113,113,0.2)", borderTopColor: theme.accent.red, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" }} />
            </div>
          ) : expenses.length === 0 ? (
            <div style={{ textAlign: "center", padding: "50px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16 }}>
              <div style={{ fontSize: 44, opacity: 0.2, marginBottom: 12 }}>💸</div>
              <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono }}>No expenses recorded yet</div>
              <div style={{ color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, marginTop: 5, opacity: 0.6 }}>Tap "+ Log" to add one</div>
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
              {creditSales.map(cs => {
                const balance    = cs.amount - cs.amount_paid;
                const sc         = statusColor(cs.status);
                const isOpen     = cs.status === "pending" || cs.status === "partial";
                const isExpanded = expandedCreditId === cs.id;
                const payments   = creditPayments[cs.id] || [];
                const loadingPay = paymentsLoading === cs.id;
                return (
                  <div key={cs.id} style={{ background: theme.bg.card, border: `1px solid ${isExpanded ? "rgba(6,182,212,0.25)" : theme.border.default}`, borderRadius: 16, overflow: "hidden", transition: "border-color 0.15s" }}>
                    <button onClick={() => toggleCreditCard(cs.id)}
                      style={{ width: "100%", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", color: "inherit" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, color: theme.text.primary }}>{cs.customer_name}</div>
                          <div style={{ background: `${sc}20`, border: `1px solid ${sc}50`, borderRadius: 10, padding: "2px 8px", fontSize: 9, fontFamily: theme.font.mono, color: sc, fontWeight: 600 }}>
                            {statusLabel(cs.status)}
                          </div>
                        </div>
                        <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                          {cs.customer_phone && `${cs.customer_phone} · `}{cs.seller_name} · {new Date(cs.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}
                        </div>
                        <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>CR-{cs.id.slice(0, 8).toUpperCase()}</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0, marginLeft: 12 }}>
                        <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: isOpen ? theme.accent.red : "#34d399" }}>
                          {isOpen ? fmt(balance) : fmt(cs.amount)}
                        </div>
                        <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted }}>{isOpen ? "balance" : "total"}</div>
                        {cs.amount_paid > 0 && isOpen && (
                          <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#34d399" }}>{fmt(cs.amount_paid)} paid</div>
                        )}
                        <div style={{ fontSize: 10, color: theme.text.muted, marginTop: 2 }}>{isExpanded ? "▲" : "▼"}</div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div style={{ borderTop: `1px solid ${theme.border.default}` }}>
                        <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 4, background: "rgba(255,255,255,0.01)" }}>
                          <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Items</div>
                          {cs.items.map((item, idx) => (
                            <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: theme.font.mono, color: theme.text.secondary }}>
                              <span>{item.quantity}× {item.product_name}</span>
                              <span>{fmt(item.subtotal)}</span>
                            </div>
                          ))}
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
                                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0, fontFamily: theme.font.mono, color: "#34d399", fontWeight: 700 }}>
                                    {idx + 1}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.primary, fontWeight: 600 }}>{fmt(p.amount)}</div>
                                    <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted }}>
                                      {p.payment_method === "cash" ? "💵 Cash" : "📱 M-Pesa"}{p.mpesa_ref ? ` · ${p.mpesa_ref}` : ""}
                                    </div>
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
                                  <span style={{ color: theme.accent.red, fontWeight: 700 }}>{fmt(balance)}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {isOpen && (
                          <div style={{ display: "flex", gap: 8, padding: "10px 16px 14px", borderTop: `1px solid ${theme.border.default}` }}>
                            <button onClick={() => { setPayTarget(cs); setPayAmount(""); setPayMethod2("cash"); setPayMpesaRef(""); setPayAgent(null); setPayPin(""); setPayPinError(""); setPayError(""); }}
                              style={{ flex: 1, padding: "10px", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 10, color: "#34d399", fontFamily: theme.font.mono, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                              💰 Record Payment
                            </button>
                            <button onClick={() => { setReturnTarget(cs); setReturnAgent(null); setReturnPin(""); setReturnPinError(""); setReturnError(""); }}
                              style={{ flex: 1, padding: "10px", background: "rgba(107,114,128,0.1)", border: "1px solid rgba(107,114,128,0.25)", borderRadius: 10, color: "#9ca3af", fontFamily: theme.font.mono, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                              ↩ Mark Returned
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

            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>Amount (KSh)</label>
              <input className="ki" type="number" value={expAmount}
                onChange={e => { setExpAmount(sanitizeAmount(e.target.value)); setExpError(""); }}
                placeholder="e.g. 500" min="0" />
            </div>

            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>What was it for?</label>
              <textarea className="ki" value={expDesc}
                onChange={e => { setExpDesc(sanitizeText(e.target.value, 200)); setExpError(""); }}
                placeholder="e.g. Lunch for agents, Transport to warehouse..."
                rows={2} maxLength={200} style={{ resize: "none", lineHeight: 1.5 }} />
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
              <input className="ki" type="number" value={editAmount}
                onChange={e => { setEditAmount(sanitizeAmount(e.target.value)); setEditError(""); }}
                placeholder="e.g. 500" min="0" />
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

      {/* ══ CUSTOMERS TAB ══ */}
      {activeTab === "customers" && (
        <div style={{ padding: isMobile ? "16px 16px 100px" : "24px 40px 100px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Search */}
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.4 }}>🔍</span>
            <input
              className="ki" value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
              placeholder="Search by name or phone…"
              style={{ paddingLeft: 36 }} />
          </div>

          {creditLoading ? (
            <div style={{ padding: "48px 20px", textAlign: "center" }}>
              <div style={{ width: 22, height: 22, border: "3px solid rgba(6,182,212,0.2)", borderTopColor: "#06b6d4", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 10px" }} />
              <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono }}>Loading customers…</div>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16 }}>
              <div style={{ fontSize: 40, opacity: 0.2, marginBottom: 12 }}>👤</div>
              <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono }}>
                {creditSales.length === 0 ? "No credit sales yet" : "No customers match that search"}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredCustomers.map(customer => {
                const totalOwed    = customer.sales.reduce((t, s) => t + s.amount, 0);
                const totalPaid    = customer.sales.reduce((t, s) => t + s.amount_paid, 0);
                const balance      = totalOwed - totalPaid;
                const openSales    = customer.sales.filter(s => s.status !== "paid" && s.status !== "returned");
                const latestSale   = customer.sales.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
                const balanceColor = balance > 0 ? theme.accent.red : "#34d399";
                return (
                  <div key={customer.phone || customer.name}
                    style={{ background: theme.bg.card, border: `1px solid ${balance > 0 ? "rgba(248,113,113,0.2)" : theme.border.default}`, borderRadius: 14, padding: "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{customer.name}</div>
                        {customer.phone && (
                          <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 6 }}>{customer.phone}</div>
                        )}
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Sales</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: theme.text.primary, fontFamily: theme.font.mono }}>{customer.sales.length}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Total</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: theme.accent.gold, fontFamily: theme.font.mono }}>{fmt(totalOwed)}</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Paid</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "#34d399", fontFamily: theme.font.mono }}>{fmt(totalPaid)}</div>
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Balance</div>
                        <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 20, color: balanceColor }}>{fmt(balance)}</div>
                        {openSales.length > 0 && (
                          <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: balanceColor, marginTop: 3 }}>{openSales.length} open</div>
                        )}
                      </div>
                    </div>
                    {latestSale && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${theme.border.default}`, fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                        Last sale: {new Date(latestSale.created_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                        {latestSale.items.length > 0 && ` · ${latestSale.items[0].product_name}${latestSale.items.length > 1 ? ` +${latestSale.items.length - 1} more` : ""}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ RECORD PAYMENT MODAL ══ */}
      {payTarget && (
        <div style={{ position: "fixed", inset: 0, background: theme.bg.overlay, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}
          onClick={e => { if (e.target === e.currentTarget) resetPayModal(); }}>
          <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 20, padding: "24px 20px 28px", width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 16, animation: "slideUp 0.22s ease", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 17 }}>Record Payment</div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                  {payTarget.customer_name} · Balance: {fmt(payTarget.amount - payTarget.amount_paid)}
                </div>
              </div>
              <button onClick={resetPayModal} style={{ background: "transparent", border: "none", color: theme.text.muted, fontSize: 20, cursor: "pointer", padding: "4px 8px" }}>✕</button>
            </div>

            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>Amount Paid (KSh)</label>
              <input className="ki" type="number" value={payAmount}
                onChange={e => {
                  const clean   = sanitizeAmount(e.target.value);
                  const balance = payTarget.amount - payTarget.amount_paid;
                  const val     = Number(clean) || 0;
                  setPayAmount(val > balance ? String(balance) : clean);
                  setPayError("");
                }}
                placeholder={`Balance: ${fmt(payTarget.amount - payTarget.amount_paid)}`}
                min="0" />
            </div>

            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Payment Method</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {([{ key: "cash", icon: "💵", label: "Cash", col: "#34d399" }, { key: "mpesa", icon: "📱", label: "M-Pesa", col: theme.accent.cyan }] as const).map(({ key, icon, label, col }) => (
                  <button key={key} onClick={() => setPayMethod2(key)}
                    style={{ padding: "10px 8px", border: `1px solid ${payMethod2 === key ? col + "80" : theme.border.default}`, borderRadius: 12, background: payMethod2 === key ? col + "18" : "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 18 }}>{icon}</span>
                    <span style={{ fontSize: 11, fontFamily: theme.font.mono, fontWeight: 600, color: payMethod2 === key ? col : theme.text.muted }}>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {payMethod2 === "mpesa" && (
              <div>
                <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>M-Pesa Ref (optional)</label>
                <input className="ki" value={payMpesaRef}
                  onChange={e => setPayMpesaRef(sanitizeCode(e.target.value, 20))}
                  placeholder="e.g. QHX7K3LM2P" maxLength={20} spellCheck={false} />
              </div>
            )}

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
      )}

      {/* ══ MARK RETURNED MODAL ══ */}
      {returnTarget && (
        <div style={{ position: "fixed", inset: 0, background: theme.bg.overlay, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}
          onClick={e => { if (e.target === e.currentTarget) resetReturnModal(); }}>
          <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 20, padding: "24px 20px 28px", width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 16, animation: "slideUp 0.22s ease", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 17 }}>Mark as Returned</div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                  {returnTarget.customer_name} · Stock will be restored
                </div>
              </div>
              <button onClick={resetReturnModal} style={{ background: "transparent", border: "none", color: theme.text.muted, fontSize: 20, cursor: "pointer", padding: "4px 8px" }}>✕</button>
            </div>

            <div style={{ background: "rgba(107,114,128,0.06)", border: "1px solid rgba(107,114,128,0.2)", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Items to restore</div>
              {returnTarget.items.map((item, idx) => (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: theme.font.mono }}>
                  <span style={{ color: theme.text.secondary }}>{item.quantity}× {item.product_name}</span>
                  <span style={{ color: theme.text.muted }}>{fmt(item.subtotal)}</span>
                </div>
              ))}
            </div>

            <div style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 14px", fontSize: 11, fontFamily: theme.font.mono, color: theme.accent.red, lineHeight: 1.6 }}>
              ⚠ This will restore stock and mark the sale as returned. This cannot be undone.
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
      )}
    </div>
  );
}
