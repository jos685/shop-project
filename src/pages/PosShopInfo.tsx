import { useState, useEffect, useCallback } from "react";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../lib/supabase";

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

interface StockItem {
  id: string;
  allocated: number;
  remaining: number;
  product: { id: string; name: string; sku: string; price: number; unit: string };
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

type ActiveTab = "stock" | "agents" | "expenses" | "credit";

export default function PosShopInfo() {
  const { shop } = useShopAuth();
  const { theme } = useTheme();
  const width = useWindowWidth();
  const isMobile = width < 640;

  const [stock,        setStock]        = useState<StockItem[]>([]);
  const [agents,       setAgents]       = useState<ShopAgent[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [tab,          setTab]          = useState<ActiveTab>("stock");

  // Today's stats
  const [todaySales,   setTodaySales]   = useState(0);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayCash,    setTodayCash]    = useState(0);
  const [todayMpesa,   setTodayMpesa]   = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);

  // Expenses
  const [expenses,     setExpenses]     = useState<Expense[]>([]);
  const [expLoading,   setExpLoading]   = useState(false);

  // Log expense modal
  const [logOpen,      setLogOpen]      = useState(false);
  const [expAmount,    setExpAmount]    = useState("");
  const [expDesc,      setExpDesc]      = useState("");
  const [expAgent,     setExpAgent]     = useState<ShopAgent | null>(null);
  const [expPin,       setExpPin]       = useState("");
  const [expPinError,  setExpPinError]  = useState("");
  const [expPinShake,  setExpPinShake]  = useState(false);
  const [expProcessing,setExpProcessing]= useState(false);
  const [expError,     setExpError]     = useState("");

  // Edit expense modal
  const [editTarget,   setEditTarget]   = useState<Expense | null>(null);
  const [editAmount,   setEditAmount]   = useState("");
  const [editDesc,     setEditDesc]     = useState("");
  const [editAgent,    setEditAgent]    = useState<ShopAgent | null>(null);
  const [editPin,      setEditPin]      = useState("");
  const [editPinError, setEditPinError] = useState("");
  const [editPinShake, setEditPinShake] = useState(false);
  const [editProcessing,setEditProcessing] = useState(false);
  const [editError,    setEditError]    = useState("");

  // Credit sales
  const [creditSales,      setCreditSales]      = useState<CreditSale[]>([]);
  const [creditLoading,    setCreditLoading]    = useState(false);

  // Record payment modal
  const [payTarget,        setPayTarget]        = useState<CreditSale | null>(null);
  const [payAmount,        setPayAmount]        = useState("");
  const [payMethod2,       setPayMethod2]       = useState<"cash" | "mpesa">("cash");
  const [payMpesaRef,      setPayMpesaRef]      = useState("");
  const [payAgent,         setPayAgent]         = useState<ShopAgent | null>(null);
  const [payPin,           setPayPin]           = useState("");
  const [payPinError,      setPayPinError]      = useState("");
  const [payPinShake,      setPayPinShake]      = useState(false);
  const [payProcessing,    setPayProcessing]    = useState(false);
  const [payError,         setPayError]         = useState("");

  // Mark returned modal
  const [returnTarget,     setReturnTarget]     = useState<CreditSale | null>(null);
  const [returnAgent,      setReturnAgent]      = useState<ShopAgent | null>(null);
  const [returnPin,        setReturnPin]        = useState("");
  const [returnPinError,   setReturnPinError]   = useState("");
  const [returnPinShake,   setReturnPinShake]   = useState(false);
  const [returnProcessing, setReturnProcessing] = useState(false);
  const [returnError,      setReturnError]      = useState("");

  // Credit card expand + payment history
  const [expandedCreditId, setExpandedCreditId] = useState<string | null>(null);
  const [creditPayments,   setCreditPayments]   = useState<Record<string, CreditPayment[]>>({});
  const [paymentsLoading,  setPaymentsLoading]  = useState<string | null>(null);

  // ── fetch stock + agents ──────────────────────────────────────────────
  const fetchInfo = useCallback(async () => {
    if (!shop) return;
    setLoading(true);
    try {
      const [allocRes, shopAgentsRaw] = await Promise.all([
        supabase.from("shop_allocations")
          .select("id, allocated, remaining, product_id, product_name, product_sku, product_price, product_unit, product:products(id, name, sku, price, unit)")
          .eq("shop_id", shop.id),
        supabase.from("shop_agents")
          .select("id, pin, active, agent_id, agent_name, agent_code, agent_avatar")
          .eq("shop_id", shop.id).eq("active", true),
      ]);

      let hydratedAgents: ShopAgent[] = (shopAgentsRaw.data || []).map((r: any) => ({
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

      if (allocRes.error) {
        console.error("shop_allocations error:", allocRes.error.message);
      }

      setStock(
        (allocRes.data || [])
          .filter((a: any) => !!a.product_id)
          .map((a: any) => ({
            id: a.id,
            allocated: a.allocated,
            remaining: Math.max(0, a.remaining ?? 0),
            product: {
              id:    a.product_id,
              name:  a.product_name  || "—",
              sku:   a.product_sku   || "",
              price: Number(a.product_price || 0),
              unit:  a.product_unit  || "",
            },
          }))
      );
      setAgents(hydratedAgents);
    } catch (err) {
      console.error("ShopInfo fetchInfo error:", err);
    } finally {
      setLoading(false);
    }
  }, [shop]);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  // ── fetch today's stats ───────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    if (!shop) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { data } = await supabase.from("shop_transactions")
      .select("amount, cash_amount, mpesa_amount")
      .eq("shop_id", shop.id).gte("created_at", today.toISOString());
    if (data) {
      setTodaySales(data.length);
      setTodayRevenue(data.reduce((s: number, t: any) => s + t.amount, 0));
      setTodayCash(data.reduce((s: number, t: any) => s + (t.cash_amount  ?? 0), 0));
      setTodayMpesa(data.reduce((s: number, t: any) => s + (t.mpesa_amount ?? 0), 0));
    }
    setStatsLoading(false);
  }, [shop]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    if (!shop) return;
    const ch = supabase.channel("shop-info-stats-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "shop_transactions", filter: `shop_id=eq.${shop.id}` }, fetchStats)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, fetchStats]);

  // ── fetch expenses ────────────────────────────────────────────────────
  const fetchExpenses = useCallback(async () => {
    if (!shop) return;
    setExpLoading(true);
    const { data } = await supabase.from("shop_expenses")
      .select("id, amount, description, logged_by, logged_by_name, created_at, updated_at")
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: false });
    setExpenses((data || []) as Expense[]);
    setExpLoading(false);
  }, [shop]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  useEffect(() => {
    if (!shop) return;
    const ch = supabase.channel("shop-expenses-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_expenses", filter: `shop_id=eq.${shop.id}` }, fetchExpenses)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, fetchExpenses]);

  // ── fetch credit sales ────────────────────────────────────────────────
  const fetchCreditSales = useCallback(async () => {
    if (!shop) return;
    setCreditLoading(true);
    const { data } = await supabase.from("shop_credit_sales")
      .select("id, amount, amount_paid, customer_name, customer_phone, seller_name, seller_agent_id, status, items, created_at")
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: false });
    setCreditSales((data || []) as CreditSale[]);
    setCreditLoading(false);
  }, [shop]);

  useEffect(() => { fetchCreditSales(); }, [fetchCreditSales]);

  useEffect(() => {
    if (!shop) return;
    const ch = supabase.channel("shop-credit-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_credit_sales", filter: `shop_id=eq.${shop.id}` }, fetchCreditSales)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, fetchCreditSales]);

  const fetchPaymentsFor = useCallback(async (creditSaleId: string) => {
    setPaymentsLoading(creditSaleId);
    const { data } = await supabase.from("shop_credit_payments")
      .select("id, amount, payment_method, mpesa_ref, created_at")
      .eq("credit_sale_id", creditSaleId)
      .order("created_at", { ascending: true });
    setCreditPayments(prev => ({ ...prev, [creditSaleId]: (data || []) as CreditPayment[] }));
    setPaymentsLoading(null);
  }, []);

  const toggleCreditCard = (id: string) => {
    if (expandedCreditId === id) {
      setExpandedCreditId(null);
    } else {
      setExpandedCreditId(id);
      if (!creditPayments[id]) fetchPaymentsFor(id);
    }
  };

  // ── log expense submit ────────────────────────────────────────────────
  const handleLogExpense = async (agent: ShopAgent) => {
    const amount = parseFloat(expAmount);
    if (!amount || amount <= 0) { setExpError("Enter a valid amount."); return; }
    if (!expDesc.trim()) { setExpError("Describe the expense."); return; }
    setExpProcessing(true);
    const { error } = await supabase.from("shop_expenses").insert({
      shop_id: shop?.id,
      owner_id: shop?.owner_id,
      amount,
      description: expDesc.trim(),
      logged_by: agent.agent.id,
      logged_by_name: agent.agent.name,
    });
    if (error) { setExpProcessing(false); setExpError("Failed to save expense. Try again."); return; }
    setLogOpen(false);
    setExpAmount(""); setExpDesc(""); setExpAgent(null); setExpPin("");
    setExpError(""); setExpProcessing(false);
    fetchExpenses();
  };

  const openEdit = (exp: Expense) => {
    setEditTarget(exp);
    setEditAmount(String(exp.amount));
    setEditDesc(exp.description);
    setEditAgent(null); setEditPin(""); setEditPinError(""); setEditError("");
  };

  // ── edit expense submit ───────────────────────────────────────────────
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
    setEditAmount(""); setEditDesc(""); setEditAgent(null); setEditPin("");
    setEditError(""); setEditProcessing(false);
    fetchExpenses();
  };

  const resetLogModal = () => {
    setLogOpen(false);
    setExpAmount(""); setExpDesc(""); setExpAgent(null);
    setExpPin(""); setExpPinError(""); setExpError(""); setExpProcessing(false);
  };

  const resetEditModal = () => {
    setEditTarget(null);
    setEditAmount(""); setEditDesc(""); setEditAgent(null);
    setEditPin(""); setEditPinError(""); setEditError(""); setEditProcessing(false);
  };

  // ── record payment submit ─────────────────────────────────────────────
  const handleRecordPayment = async (_agent: ShopAgent) => {
    if (!payTarget) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) { setPayError("Enter a valid payment amount."); return; }
    const balance = payTarget.amount - payTarget.amount_paid;
    if (amount > balance) { setPayError(`Amount exceeds what is owed. Balance is ${fmt(balance)}.`); return; }
    setPayProcessing(true);

    const { error: insErr } = await supabase.from("shop_credit_payments").insert({
      credit_sale_id: payTarget.id,
      shop_id:        shop?.id,
      owner_id:       shop?.owner_id,
      amount,
      payment_method: payMethod2,
      mpesa_ref:      payMethod2 === "mpesa" ? payMpesaRef.trim() || null : null,
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
  };

  // ── mark returned submit ──────────────────────────────────────────────
  const handleMarkReturned = async (_agent: ShopAgent) => {
    if (!returnTarget) return;
    setReturnProcessing(true);

    // Restore stock for each item
    for (const item of returnTarget.items) {
      const { data: allocData } = await supabase
        .from("shop_allocations").select("remaining").eq("id", item.allocation_id).single();
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
    fetchInfo(); // refresh stock counts
  };

  const resetReturnModal = () => {
    setReturnTarget(null);
    setReturnAgent(null); setReturnPin(""); setReturnPinError(""); setReturnError(""); setReturnProcessing(false);
  };

  const totalStockValue     = stock.reduce((s, i) => s + (i.product?.price ?? 0) * i.remaining,  0);
  const totalAllocatedValue = stock.reduce((s, i) => s + (i.product?.price ?? 0) * i.allocated, 0);
  const totalExpenses       = expenses.reduce((s, e) => s + e.amount, 0);

  // ── PIN keypad (reusable render helper) ──────────────────────────────
  const PinKeypad = ({
    selectedAgent, pin, setPin, pinError, setPinError, pinShake, setPinShake,
    processing, onVerify,
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
      <div className={pinShake ? "shake" : ""} style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 14 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            width: 44, height: 54, border: `2px solid ${i < pin.length ? "rgba(6,182,212,0.5)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "DM Mono, monospace", fontSize: 24, fontWeight: 700,
            background: i < pin.length ? "rgba(6,182,212,0.08)" : "transparent", transition: "all 0.15s",
          }}>
            {i < pin.length ? "●" : ""}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, maxWidth: 280, margin: "0 auto", width: "100%" }}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map(k => (
          <button key={k} disabled={!k || processing}
            onClick={() => {
              if (k === "⌫") { setPin(pin.slice(0, -1)); setPinError(""); }
              else if (k && pin.length < 4) {
                const newPin = pin + k;
                setPin(newPin);
                if (newPin.length === 4) {
                  if (newPin !== selectedAgent.pin) {
                    setPinError("Incorrect PIN. Try again.");
                    setPinShake(true);
                    setTimeout(() => { setPinShake(false); setPin(""); }, 400);
                  } else {
                    setPinError("");
                    onVerify(selectedAgent);
                  }
                }
              }
            }}
            style={{ height: 50, border: `1px solid ${k ? "rgba(255,255,255,0.1)" : "transparent"}`, borderRadius: 10, background: k ? "rgba(255,255,255,0.04)" : "transparent", color: k === "⌫" ? theme.accent.red : theme.text.primary, fontFamily: "DM Mono, monospace", fontSize: k === "⌫" ? 18 : 20, fontWeight: 600, cursor: k ? "pointer" : "default" }}>
            {k}
          </button>
        ))}
      </div>
      {pinError && (
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

  return (
    <div style={{ minHeight: "100vh", background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin   { to{transform:rotate(360deg)} }
        @keyframes slideUp { from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)} }
        @keyframes shake  { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-7px)} 40%,80%{transform:translateX(7px)} }
        .section    { animation: fadeUp 0.3s ease both; }
        .stock-row  { transition: background 0.1s; }
        .stock-row:hover { background: rgba(255,255,255,0.02) !important; }
        .exp-row    { transition: background 0.12s; }
        .exp-row:hover { background: rgba(255,255,255,0.03) !important; }
        ${theme.kiCss}
        .shake { animation: shake 0.35s ease; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ borderBottom: `1px solid ${theme.border.default}`, padding: isMobile ? "14px 16px" : "20px 40px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 18 : 22 }}>Shop Info</div>
          <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{shop?.name} · {shop?.shop_code}</div>
        </div>
        <button onClick={() => { fetchInfo(); fetchStats(); fetchExpenses(); fetchCreditSales(); }}
          style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 9, padding: "8px 14px", color: theme.accent.cyan, fontFamily: theme.font.mono, fontSize: 12, cursor: "pointer" }}>
          ↺ Refresh
        </button>
      </div>

      {/* ── Today's Summary ── */}
      <div style={{ padding: isMobile ? "14px 16px" : "16px 40px", borderBottom: `1px solid ${theme.border.default}` }}>
        <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Today's Summary</div>
        {statsLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
            <div style={{ width: 20, height: 20, border: "3px solid rgba(6,182,212,0.2)", borderTopColor: theme.accent.cyan, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
            {[
              { label: "Sales",   value: String(todaySales), color: theme.text.primary, icon: "🧾", sub: "transactions" },
              { label: "Revenue", value: fmt(todayRevenue),  color: theme.accent.gold,  icon: "💰", sub: "total earned"  },
              { label: "Cash",    value: fmt(todayCash),     color: "#34d399",           icon: "💵", sub: "cash"          },
              { label: "M-Pesa",  value: fmt(todayMpesa),    color: "#60a5fa",           icon: "📱", sub: "mobile"        },
            ].map(({ label, value, color, icon, sub }) => (
              <div key={label} style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
                  <span style={{ fontSize: 12, opacity: 0.5 }}>{icon}</span>
                </div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 14 : 17, color, lineHeight: 1.1 }}>{value}</div>
                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 4, opacity: 0.7 }}>{sub}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: "flex", borderBottom: `1px solid ${theme.border.default}`, padding: "0 16px", overflowX: "auto" }}>
        {([
          { key: "stock",    label: `📦 Stock (${stock.length})`                                                     },
          { key: "agents",   label: `👤 Agents (${agents.length})`                                                   },
          { key: "expenses", label: `💸 Expenses (${expenses.length})`                                               },
          { key: "credit",   label: `📝 Credit (${creditSales.filter(c => c.status !== "paid" && c.status !== "returned").length})` },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: "14px 18px", border: "none", borderBottom: `2px solid ${tab === t.key ? theme.accent.cyan : "transparent"}`, background: "transparent", color: tab === t.key ? theme.accent.cyan : theme.text.muted, fontFamily: theme.font.mono, fontSize: 12, cursor: "pointer", fontWeight: tab === t.key ? 600 : 400, whiteSpace: "nowrap" }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: isMobile ? "16px 16px 90px" : "24px 40px 90px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ width: 28, height: 28, border: "3px solid rgba(6,182,212,0.2)", borderTopColor: theme.accent.cyan, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
            <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono }}>Loading shop info...</div>
          </div>
        ) : (
          <>
            {/* ══ STOCK TAB ══ */}
            {tab === "stock" && (
              <div className="section">
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
                  {[
                    { label: "Products",       value: String(stock.length),     color: theme.accent.cyan  },
                    { label: "Stock Value",     value: fmt(totalStockValue),     color: theme.accent.gold  },
                    { label: "Total Allocated", value: fmt(totalAllocatedValue), color: theme.accent.green },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14, padding: "16px 18px" }}>
                      <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>{label}</div>
                      <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: isMobile ? 18 : 20, color }}>{value}</div>
                    </div>
                  ))}
                </div>

                {stock.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16 }}>
                    <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 14 }}>📦</div>
                    <div style={{ color: theme.text.muted, fontSize: 14, fontFamily: theme.font.mono }}>No products assigned to this shop yet</div>
                    <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono, marginTop: 6, opacity: 0.6 }}>Contact your supervisor to assign stock</div>
                  </div>
                ) : (
                  <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16, overflow: "hidden" }}>
                    {!isMobile && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 90px 90px 90px", gap: 12, padding: "12px 20px", borderBottom: `1px solid ${theme.border.default}`, background: "rgba(255,255,255,0.02)" }}>
                        {["Product", "Unit Price", "Allocated", "Remaining", "Sold"].map(h => (
                          <div key={h} style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</div>
                        ))}
                      </div>
                    )}
                    {stock.map((item, i) => {
                      const sold = item.allocated - item.remaining;
                      const pct  = item.allocated > 0 ? Math.round((item.remaining / item.allocated) * 100) : 0;
                      const sc   = item.remaining === 0 ? theme.accent.red : pct <= 20 ? theme.accent.gold : theme.accent.green;
                      return (
                        <div key={item.id} className="stock-row"
                          style={{ borderBottom: i < stock.length - 1 ? `1px solid ${theme.border.default}` : "none", padding: isMobile ? "16px" : "16px 20px" }}>
                          {isMobile ? (
                            <div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>{item.product.name}</div>
                                  <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>{item.product.sku}</div>
                                </div>
                                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                                  <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 24, color: sc, lineHeight: 1 }}>{item.remaining}</div>
                                  <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{item.product.unit} left</div>
                                </div>
                              </div>
                              <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 12 }}>
                                <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: sc, transition: "width 0.8s ease" }} />
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                {[
                                  { label: "Price",     value: fmt(item.product.price), color: theme.accent.gold  },
                                  { label: "Allocated", value: String(item.allocated),  color: theme.text.primary },
                                  { label: "Sold",      value: String(sold),            color: theme.accent.green },
                                ].map(({ label, value, color }) => (
                                  <div key={label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                                    <div style={{ fontSize: 8, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                                    <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 13, color }}>{value}</div>
                                  </div>
                                ))}
                              </div>
                              {item.remaining === 0 && (
                                <div style={{ marginTop: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px", fontSize: 11, fontFamily: theme.font.mono, color: theme.accent.red, textAlign: "center" }}>
                                  ⚠ Out of stock — contact supervisor to restock
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 90px 90px 90px", gap: 12, alignItems: "center", marginBottom: 8 }}>
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{item.product.name}</div>
                                  <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>{item.product.sku} · {item.product.unit}</div>
                                </div>
                                <div style={{ fontFamily: theme.font.mono, fontWeight: 600, color: theme.accent.gold }}>{fmt(item.product.price)}</div>
                                <div style={{ fontFamily: theme.font.mono, color: theme.text.secondary }}>{item.allocated}</div>
                                <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 16, color: sc }}>{item.remaining}</div>
                                <div style={{ fontFamily: theme.font.mono, color: theme.accent.green }}>{sold}</div>
                              </div>
                              <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 4, height: 4, overflow: "hidden" }}>
                                <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: sc, transition: "width 0.8s ease" }} />
                              </div>
                              {item.remaining === 0 && (
                                <div style={{ marginTop: 6, fontSize: 11, fontFamily: theme.font.mono, color: theme.accent.red }}>⚠ Out of stock</div>
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

            {/* ══ AGENTS TAB ══ */}
            {tab === "agents" && (
              <div className="section">
                {agents.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16 }}>
                    <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 14 }}>👤</div>
                    <div style={{ color: theme.text.muted, fontSize: 14, fontFamily: theme.font.mono }}>No agents assigned to this shop</div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px,1fr))", gap: 12 }}>
                    {agents.map(sa => {
                      const ag = sa.agent;
                      return (
                        <div key={sa.id} style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16, padding: "22px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg,rgba(6,182,212,0.2),rgba(6,182,212,0.08))", border: "2px solid rgba(6,182,212,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: theme.font.display, fontWeight: 800, fontSize: 20, color: theme.accent.cyan, flexShrink: 0 }}>
                              {ag.avatar || ag.name?.slice(0, 2).toUpperCase() || "?"}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 17 }}>{ag.name}</div>
                              <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{ag.agent_id}</div>
                            </div>
                            <div style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 20, padding: "4px 10px", fontSize: 10, fontFamily: theme.font.mono, color: "#34d399", fontWeight: 600, flexShrink: 0 }}>Active</div>
                          </div>
                          <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, lineHeight: 1.6, padding: "0 2px" }}>
                            Agent PIN is hidden for security. Contact your supervisor if you need access.
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ══ CREDIT TAB ══ */}
            {tab === "credit" && (() => {
              const openCredit   = creditSales.filter(c => c.status === "pending" || c.status === "partial");
              const totalOutstanding = openCredit.reduce((s, c) => s + (c.amount - c.amount_paid), 0);
              const statusColor  = (s: string) => s === "paid" ? "#34d399" : s === "returned" ? "#6b7280" : s === "partial" ? "#fbbf24" : "#f87171";
              const statusLabel  = (s: string) => s === "paid" ? "Paid" : s === "returned" ? "Returned" : s === "partial" ? "Partial" : "Pending";
              return (
                <div className="section" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Summary cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
                  </div>

                  {/* List */}
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
                        const balance   = cs.amount - cs.amount_paid;
                        const sc        = statusColor(cs.status);
                        const isOpen    = cs.status === "pending" || cs.status === "partial";
                        const isExpanded = expandedCreditId === cs.id;
                        const payments  = creditPayments[cs.id] || [];
                        const loadingPay = paymentsLoading === cs.id;
                        return (
                          <div key={cs.id} style={{ background: theme.bg.card, border: `1px solid ${isExpanded ? "rgba(6,182,212,0.25)" : theme.border.default}`, borderRadius: 16, overflow: "hidden", transition: "border-color 0.15s" }}>
                            {/* Header — tap to expand */}
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
                                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                                  CR-{cs.id.slice(0, 8).toUpperCase()}
                                </div>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0, marginLeft: 12 }}>
                                <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: isOpen ? theme.accent.red : "#34d399" }}>
                                  {isOpen ? fmt(balance) : fmt(cs.amount)}
                                </div>
                                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted }}>
                                  {isOpen ? "balance" : "total"}
                                </div>
                                {cs.amount_paid > 0 && isOpen && (
                                  <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#34d399" }}>
                                    {fmt(cs.amount_paid)} paid
                                  </div>
                                )}
                                <div style={{ fontSize: 10, color: theme.text.muted, marginTop: 2 }}>
                                  {isExpanded ? "▲" : "▼"}
                                </div>
                              </div>
                            </button>

                            {/* Expanded detail */}
                            {isExpanded && (
                              <div style={{ borderTop: `1px solid ${theme.border.default}` }}>
                                {/* Items */}
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

                                {/* Payment history */}
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
                                      {/* Running total */}
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

                                {/* Action buttons */}
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
              );
            })()}

            {/* ══ EXPENSES TAB ══ */}
            {tab === "expenses" && (
              <div className="section" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Summary + log button */}
                <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
                  <div style={{ flex: 1, background: theme.bg.card, border: "1px solid rgba(248,113,113,0.2)", borderRadius: 14, padding: "16px 18px" }}>
                    <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Total Expenses</div>
                    <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 20 : 24, color: theme.accent.red }}>{fmt(totalExpenses)}</div>
                    <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 4 }}>{expenses.length} record{expenses.length !== 1 ? "s" : ""}</div>
                  </div>
                  <button onClick={() => setLogOpen(true)}
                    style={{ flex: 1, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 14, padding: "16px 18px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <span style={{ fontSize: 24 }}>➕</span>
                    <span style={{ fontFamily: theme.font.mono, fontSize: 12, fontWeight: 600, color: theme.accent.red }}>Log Expense</span>
                  </button>
                </div>

                {/* Expense list */}
                {expLoading ? (
                  <div style={{ textAlign: "center", padding: "40px 0" }}>
                    <div style={{ width: 22, height: 22, border: "3px solid rgba(248,113,113,0.2)", borderTopColor: theme.accent.red, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" }} />
                  </div>
                ) : expenses.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "50px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16 }}>
                    <div style={{ fontSize: 44, opacity: 0.2, marginBottom: 12 }}>💸</div>
                    <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono }}>No expenses recorded yet</div>
                    <div style={{ color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, marginTop: 5, opacity: 0.6 }}>Tap "Log Expense" to add one</div>
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
          </>
        )}
      </div>

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

            {/* Amount */}
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>Amount Paid (KSh)</label>
              <input className="ki" type="number" value={payAmount}
                onChange={e => {
                  const val = e.target.value;
                  setPayAmount(val);
                  const balance = payTarget.amount - payTarget.amount_paid;
                  if (Number(val) > balance) {
                    setPayError(`Amount exceeds what is owed. Balance is ${fmt(balance)}.`);
                  } else {
                    setPayError("");
                  }
                }}
                placeholder={`Balance: ${fmt(payTarget.amount - payTarget.amount_paid)}`} />
            </div>

            {/* Payment method */}
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
                <input className="ki" value={payMpesaRef} onChange={e => setPayMpesaRef(e.target.value.toUpperCase())} placeholder="e.g. QHX7K3LM2P" />
              </div>
            )}

            {payError && (
              <div style={{ color: theme.accent.red, fontSize: 11, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px" }}>⚠ {payError}</div>
            )}

            {/* Agent selector */}
            {!payAgent ? (
              <div>
                <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Who is collecting?</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {agents.map(sa => (
                    <button key={sa.id} onClick={() => { setPayAgent(sa); setPayPin(""); setPayPinError(""); }}
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
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: theme.accent.cyan, flexShrink: 0 }}>
                      {payAgent.agent.avatar || payAgent.agent.name.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ fontFamily: theme.font.mono, fontSize: 13, color: theme.accent.cyan }}>{payAgent.agent.name}</span>
                  </div>
                  <button onClick={() => { setPayAgent(null); setPayPin(""); setPayPinError(""); }}
                    style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, padding: "4px 10px", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 10, cursor: "pointer" }}>
                    Change
                  </button>
                </div>
                <PinKeypad
                  selectedAgent={payAgent} pin={payPin} setPin={setPayPin}
                  pinError={payPinError} setPinError={setPayPinError}
                  pinShake={payPinShake} setPinShake={setPayPinShake}
                  processing={payProcessing} onVerify={handleRecordPayment}
                />
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

            {/* Items to be returned */}
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

            {returnError && (
              <div style={{ color: theme.accent.red, fontSize: 11, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px" }}>⚠ {returnError}</div>
            )}

            {/* Agent selector */}
            {!returnAgent ? (
              <div>
                <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Confirm your identity</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {agents.map(sa => (
                    <button key={sa.id} onClick={() => { setReturnAgent(sa); setReturnPin(""); setReturnPinError(""); }}
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
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: theme.accent.cyan, flexShrink: 0 }}>
                      {returnAgent.agent.avatar || returnAgent.agent.name.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ fontFamily: theme.font.mono, fontSize: 13, color: theme.accent.cyan }}>{returnAgent.agent.name}</span>
                  </div>
                  <button onClick={() => { setReturnAgent(null); setReturnPin(""); setReturnPinError(""); }}
                    style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, padding: "4px 10px", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 10, cursor: "pointer" }}>
                    Change
                  </button>
                </div>
                <PinKeypad
                  selectedAgent={returnAgent} pin={returnPin} setPin={setReturnPin}
                  pinError={returnPinError} setPinError={setReturnPinError}
                  pinShake={returnPinShake} setPinShake={setReturnPinShake}
                  processing={returnProcessing} onVerify={handleMarkReturned}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ LOG EXPENSE MODAL ══ */}
      {logOpen && (
        <div style={{ position: "fixed", inset: 0, background: theme.bg.overlay, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}
          onClick={e => { if (e.target === e.currentTarget) resetLogModal(); }}>
          <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 20, padding: "24px 20px 28px", width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 16, animation: "slideUp 0.22s ease", maxHeight: "90vh", overflowY: "auto" }}>
            {/* Title */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 17 }}>Log Expense</div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>PIN required to record</div>
              </div>
              <button onClick={resetLogModal}
                style={{ background: "transparent", border: "none", color: theme.text.muted, fontSize: 20, cursor: "pointer", padding: "4px 8px" }}>✕</button>
            </div>

            {/* Amount */}
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>Amount (KSh)</label>
              <input className="ki" type="number" value={expAmount} onChange={e => { setExpAmount(e.target.value); setExpError(""); }}
                placeholder="e.g. 500" />
            </div>

            {/* Description */}
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>What was it for?</label>
              <textarea className="ki" value={expDesc} onChange={e => { setExpDesc(e.target.value); setExpError(""); }}
                placeholder="e.g. Lunch for agents, Transport to warehouse..."
                rows={2} style={{ resize: "none", lineHeight: 1.5 }} />
            </div>

            {expError && (
              <div style={{ color: theme.accent.red, fontSize: 11, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px" }}>⚠ {expError}</div>
            )}

            {/* Agent selector */}
            {!expAgent ? (
              <div>
                <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Who is logging this?</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {agents.map(sa => (
                    <button key={sa.id} onClick={() => { setExpAgent(sa); setExpPin(""); setExpPinError(""); }}
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
              </div>
            ) : (
              <div>
                {/* Selected agent + change */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: theme.accent.cyan, flexShrink: 0 }}>
                      {expAgent.agent.avatar || expAgent.agent.name.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ fontFamily: theme.font.mono, fontSize: 13, color: theme.accent.cyan }}>{expAgent.agent.name}</span>
                  </div>
                  <button onClick={() => { setExpAgent(null); setExpPin(""); setExpPinError(""); }}
                    style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, padding: "4px 10px", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 10, cursor: "pointer" }}>
                    Change
                  </button>
                </div>
                <PinKeypad
                  selectedAgent={expAgent} pin={expPin} setPin={setExpPin}
                  pinError={expPinError} setPinError={setExpPinError}
                  pinShake={expPinShake} setPinShake={setExpPinShake}
                  processing={expProcessing} onVerify={handleLogExpense}
                />
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
            {/* Title */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 17 }}>Edit Expense</div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.accent.red, marginTop: 2 }}>
                  Only {editTarget.logged_by_name} can edit this
                </div>
              </div>
              <button onClick={resetEditModal}
                style={{ background: "transparent", border: "none", color: theme.text.muted, fontSize: 20, cursor: "pointer", padding: "4px 8px" }}>✕</button>
            </div>

            {/* Amount */}
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>Amount (KSh)</label>
              <input className="ki" type="number" value={editAmount} onChange={e => { setEditAmount(e.target.value); setEditError(""); }}
                placeholder="e.g. 500" />
            </div>

            {/* Description */}
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>What was it for?</label>
              <textarea className="ki" value={editDesc} onChange={e => { setEditDesc(e.target.value); setEditError(""); }}
                placeholder="e.g. Lunch for agents..." rows={2} style={{ resize: "none", lineHeight: 1.5 }} />
            </div>

            {editError && (
              <div style={{ color: theme.accent.red, fontSize: 11, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8, padding: "8px 12px" }}>⚠ {editError}</div>
            )}

            {/* Agent selector */}
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
                        <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.accent.cyan, background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 6, padding: "2px 7px", flexShrink: 0 }}>
                          Owner
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: theme.accent.cyan, flexShrink: 0 }}>
                      {editAgent.agent.avatar || editAgent.agent.name.charAt(0).toUpperCase()}
                    </div>
                    <span style={{ fontFamily: theme.font.mono, fontSize: 13, color: theme.accent.cyan }}>{editAgent.agent.name}</span>
                  </div>
                  <button onClick={() => { setEditAgent(null); setEditPin(""); setEditPinError(""); }}
                    style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, padding: "4px 10px", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 10, cursor: "pointer" }}>
                    Change
                  </button>
                </div>
                <PinKeypad
                  selectedAgent={editAgent} pin={editPin} setPin={setEditPin}
                  pinError={editPinError} setPinError={setEditPinError}
                  pinShake={editPinShake} setPinShake={setEditPinShake}
                  processing={editProcessing} onVerify={handleEditExpense}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
