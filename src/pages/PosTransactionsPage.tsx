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
  seller_name: string | null;
  seller_code: string | null;
  customer_phone: string | null;
  unit_price: number | null;
  receipt_sent: boolean | null;
  receipt_phone: string | null;
  status: string | null;
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

type DateFilter = "today" | "week" | "month" | "all";

const PAGE_SIZE = 25;

const FILTER_LABELS: Record<DateFilter, string> = {
  today: "Today",
  week:  "This Week",
  month: "This Month",
  all:   "All Time",
};

function getStartDate(filter: DateFilter): Date | null {
  const d = new Date();
  if (filter === "today") { d.setHours(0, 0, 0, 0); return d; }
  if (filter === "week")  { d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d; }
  if (filter === "month") { d.setDate(1); d.setHours(0, 0, 0, 0); return d; }
  return null;
}

export default function PosTransactionsPage() {
  const { shop } = useShopAuth();
  const { theme } = useTheme();
  const { pendingCount } = useNetwork();
  const navigate = useNavigate();

  const [queuedSales, setQueuedSales]   = useState<QueuedSale[]>([]);
  const [expandedQ,   setExpandedQ]     = useState<string | null>(null);

  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [hasMore, setHasMore]           = useState(false);
  const [offset, setOffset]             = useState(0);
  const [filter, setFilter]             = useState<DateFilter>("today");
  const [search, setSearch]             = useState("");
  const [methodFilter, setMethodFilter] = useState<"all" | "cash" | "mpesa" | "split">("all");
  const [expanded, setExpanded]         = useState<string | null>(null);
  const [resendingId, setResendingId]   = useState<string | null>(null);
  const [businessName, setBusinessName] = useState("");

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

  const enrichRows = useCallback(async (
    txData: any[],
    existingProductMap: Record<string, { name: string; sku: string }>,
    existingSellerMap: Record<string, { name: string; code: string }>,
  ): Promise<LocalTransaction[]> => {
    if (!shop) return [];

    const newProductIds = [...new Set(txData.map((t: any) => t.product_id).filter((id: string) => id && !existingProductMap[id]))];
    const newAgentIds   = [...new Set(txData.map((t: any) => t.seller_agent_id).filter((id: string) => id && !existingSellerMap[id]))];

    if (newProductIds.length > 0) {
      const { data: prodsData } = await supabase
        .from("products")
        .select("id, name, sku")
        .in("id", newProductIds);
      for (const p of prodsData ?? []) {
        existingProductMap[p.id] = { name: p.name, sku: p.sku ?? "" };
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
      product_name:   t.status === "credit_partial" && !t.product_id ? "Credit Sale Payment" : (existingProductMap[t.product_id]?.name ?? "—"),
      product_sku:    existingProductMap[t.product_id]?.sku   ?? "",
      seller_name:    existingSellerMap[t.seller_agent_id]?.name ?? "Unknown",
      seller_code:    existingSellerMap[t.seller_agent_id]?.code ?? "",
      customer_phone: t.customer_phone ?? null,
      unit_price:     t.unit_price ?? null,
      receipt_sent:   t.receipt_sent ?? null,
      receipt_phone:  t.receipt_phone ?? null,
      status:         t.status ?? null,
    }));
  }, [shop]);

  const fetchTransactions = useCallback(async () => {
    if (!shop) return;
    setLoading(true);
    productMapRef.current = {};
    sellerMapRef.current  = {};

    const startDate = getStartDate(filter);
    let query = supabase
      .from("shop_transactions")
      .select("id, amount, quantity, payment_method, cash_amount, mpesa_amount, mpesa_ref, created_at, product_id, seller_agent_id, customer_phone, unit_price, receipt_sent, receipt_phone, status")
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: false })
      .range(0, PAGE_SIZE - 1);

    if (startDate) query = query.gte("created_at", startDate.toISOString());

    const { data: txData, error } = await query;
    if (error || !txData) { setLoading(false); return; }

    const enriched = await enrichRows(txData, productMapRef.current, sellerMapRef.current);
    setTransactions(enriched);
    setOffset(PAGE_SIZE);
    setHasMore(txData.length === PAGE_SIZE);
    setLoading(false);
  }, [shop, filter, enrichRows]);

  const loadMore = useCallback(async () => {
    if (!shop || loadingMore) return;
    setLoadingMore(true);

    const startDate = getStartDate(filter);
    let query = supabase
      .from("shop_transactions")
      .select("id, amount, quantity, payment_method, cash_amount, mpesa_amount, mpesa_ref, created_at, product_id, seller_agent_id, customer_phone, unit_price, receipt_sent, receipt_phone, status")
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (startDate) query = query.gte("created_at", startDate.toISOString());

    const { data: txData, error } = await query;
    if (error || !txData) { setLoadingMore(false); return; }

    const enriched = await enrichRows(txData, productMapRef.current, sellerMapRef.current);
    setTransactions(prev => [...prev, ...enriched]);
    setOffset(prev => prev + PAGE_SIZE);
    setHasMore(txData.length === PAGE_SIZE);
    setLoadingMore(false);
  }, [shop, filter, offset, loadingMore, enrichRows]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  useEffect(() => {
    if (!shop) return;
    const ch = supabase.channel("pos-transactions-live")
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "shop_transactions",
        filter: `shop_id=eq.${shop.id}`,
      }, fetchTransactions)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, fetchTransactions]);

  // ── Resend receipt ────────────────────────────────────────────────────
  async function handleResend(tx: LocalTransaction) {
    const phone = tx.receipt_phone ?? tx.customer_phone ?? "";
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

  const methodBadge = (method: string) => {
    if (method === "cash")  return { icon: "💵", color: "#34d399", label: "Cash"   };
    if (method === "mpesa") return { icon: "📱", color: "#60a5fa", label: "M-Pesa" };
    return                         { icon: "⚡", color: "#fbbf24", label: "Split"  };
  };

  const displayed = transactions.filter(tx => {
    const matchesMethod = methodFilter === "all" || tx.payment_method === methodFilter;
    const q = search.toLowerCase();
    const matchesSearch = !q
      || (tx.product_name   ?? "").toLowerCase().includes(q)
      || (tx.seller_name    ?? "").toLowerCase().includes(q)
      || (tx.product_sku    ?? "").toLowerCase().includes(q)
      || (tx.customer_phone ?? "").toLowerCase().includes(q)
      || (tx.mpesa_ref      ?? "").toLowerCase().includes(q);
    return matchesMethod && matchesSearch;
  });

  const totalRevenue  = displayed.reduce((s, t) => s + t.amount, 0);
  const totalCash     = displayed.reduce((s, t) => s + (t.cash_amount  ?? 0), 0);
  const totalMpesa    = displayed.reduce((s, t) => s + (t.mpesa_amount ?? 0), 0);
  const queuedTotal   = queuedSales.reduce((s, q) => s + q.grandTotal, 0);

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

  const groupByDate = (txns: LocalTransaction[]) => {
    const groups: Record<string, LocalTransaction[]> = {};
    for (const tx of txns) {
      const key = new Date(tx.created_at).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      if (!groups[key]) groups[key] = [];
      groups[key].push(tx);
    }
    return groups;
  };

  const grouped = groupByDate(displayed);

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
        position: "sticky", top: 0, background: theme.bg.base, zIndex: 40,
      }}>
        <button onClick={() => navigate("/pos")}
          style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${theme.border.default}`, borderRadius: 10, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: theme.text.primary, fontSize: 18, flexShrink: 0 }}>
          ‹
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>Transactions</div>
          <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 1 }}>{shop?.name} · {shop?.shop_code}</div>
        </div>
        <button onClick={fetchTransactions}
          style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 10, width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 16 }}>
          ↻
        </button>
      </div>

      <div style={{ padding: "16px 16px 100px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Date filter pills */}
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
          {(Object.keys(FILTER_LABELS) as DateFilter[]).map(f => (
            <button key={f} className="filter-pill"
              onClick={() => setFilter(f)}
              style={{
                padding: "7px 16px", borderRadius: 50,
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

        {/* Search + method filter */}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, position: "relative" }}>
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
          <select
            value={methodFilter}
            onChange={e => setMethodFilter(e.target.value as any)}
            style={{
              padding: "10px 12px", background: theme.bg.card,
              border: `1px solid ${theme.border.default}`, borderRadius: 12,
              color: theme.text.primary, fontSize: 12, fontFamily: theme.font.mono,
              outline: "none", cursor: "pointer",
            }}>
            <option value="all">All</option>
            <option value="cash">Cash</option>
            <option value="mpesa">M-Pesa</option>
            <option value="split">Split</option>
          </select>
        </div>

        {/* Summary strip */}
        <div style={{ display: "grid", gridTemplateColumns: queuedSales.length > 0 ? "repeat(4,1fr)" : "repeat(3,1fr)", gap: 8 }}>
          {[
            { label: "Total",  value: fmt(totalRevenue), color: theme.accent.gold },
            { label: "Cash",   value: fmt(totalCash),    color: "#34d399"         },
            { label: "M-Pesa", value: fmt(totalMpesa),   color: "#60a5fa"         },
            ...(queuedSales.length > 0
              ? [{ label: "Queued", value: fmt(queuedTotal), color: "#fbbf24" }]
              : []),
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: label === "Queued" ? "rgba(251,191,36,0.06)" : theme.bg.card, border: `1px solid ${label === "Queued" ? "rgba(251,191,36,0.25)" : theme.border.default}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: label === "Queued" ? "#fbbf24" : theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{label}</div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 15, color }}>{value}</div>
            </div>
          ))}
        </div>

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
          ) : displayed.length === 0 ? (
            <div style={{ padding: "60px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 40, opacity: 0.2, marginBottom: 12 }}>🧾</div>
              <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono }}>No transactions found</div>
              {search && <div style={{ color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, marginTop: 4 }}>Try clearing your search</div>}
            </div>
          ) : (
            <div>
              {Object.entries(grouped).map(([date, txns]) => (
                <div key={date}>
                  {/* Date group header */}
                  <div style={{ padding: "8px 18px", background: "rgba(255,255,255,0.02)", borderBottom: `1px solid ${theme.border.default}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{date}</div>
                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.accent.gold }}>{fmt(txns.reduce((s, t) => s + t.amount, 0))}</div>
                  </div>

                  {groupTransactions(txns).map((group, gi, arr) => {
                    const isMulti  = group.items.length > 1;
                    const isLast   = gi === arr.length - 1;
                    const isOpen   = expanded === group.key;
                    const badge    = methodBadge(group.payment_method);
                    const time     = new Date(group.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
                    const isCredit = group.items.some(t => t.status === "credit_partial");

                    if (isMulti) {
                      const label = `${group.items[0].product_name ?? "Item"} +${group.items.length - 1} more`;
                      return (
                        <div key={group.key}>
                          <div className="tx-row" onClick={() => setExpanded(isOpen ? null : group.key)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: (!isOpen && isLast) ? "none" : `1px solid ${theme.border.default}`, background: isOpen ? "rgba(6,182,212,0.03)" : undefined }}>
                            <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
                              🛒
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
                              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{group.seller_name} · {time}</div>
                              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 5 }}>
                                <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: theme.accent.cyan, background: "rgba(6,182,212,0.10)", border: "1px solid rgba(6,182,212,0.25)", borderRadius: 20, padding: "2px 8px" }}>
                                  {group.items.length} items
                                </span>
                                {isCredit && (
                                  <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: "#c084fc", background: "rgba(192,132,252,0.10)", border: "1px solid rgba(192,132,252,0.30)", borderRadius: 20, padding: "2px 8px" }}>
                                    📝 Credit · Partial Payment
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
                            <div className="expand-panel" style={{ borderBottom: isLast ? "none" : `1px solid ${theme.border.default}`, background: "rgba(255,255,255,0.01)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
                              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>Items in this sale</div>
                              {group.items.map(tx => (
                                <div key={tx.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: theme.bg.input, borderRadius: 10 }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.product_name ?? "—"}</div>
                                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{tx.quantity}× · {tx.unit_price != null ? fmt(tx.unit_price) : "—"}/unit</div>
                                    <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>TXN-{tx.id.slice(0, 8).toUpperCase()}</div>
                                  </div>
                                  <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 13, color: theme.accent.gold, flexShrink: 0, marginLeft: 12 }}>{fmt(tx.amount)}</div>
                                </div>
                              ))}
                              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.15)", borderRadius: 10, marginTop: 2 }}>
                                <span style={{ fontSize: 12, fontFamily: theme.font.mono, color: theme.text.muted }}>Sale Total · {badge.label}</span>
                                <span style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: theme.accent.gold }}>{fmt(group.total)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }

                    // Single-item group — same display as before
                    const tx        = group.items[0];
                    const rcpt      = receiptBadge(tx);
                    const isSending = resendingId === tx.id;
                    const phone     = tx.receipt_phone ?? tx.customer_phone;
                    const canResend = !!phone && tx.receipt_sent !== true;

                    return (
                      <div key={group.key}>
                        <div
                          className="tx-row"
                          onClick={() => setExpanded(isOpen ? null : group.key)}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: (!isOpen && isLast) ? "none" : `1px solid ${theme.border.default}`, background: isOpen ? "rgba(6,182,212,0.03)" : undefined }}>
                          <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
                            {badge.icon}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.product_name ?? "—"}</div>
                            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{tx.seller_name} · {time}</div>
                            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>TXN-{tx.id.slice(0, 8).toUpperCase()}</div>
                            {tx.status === "credit_partial" && (
                              <div style={{ marginTop: 5 }}>
                                <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: "#c084fc", background: "rgba(192,132,252,0.10)", border: "1px solid rgba(192,132,252,0.30)", borderRadius: 20, padding: "2px 8px" }}>
                                  📝 Credit · Partial Payment
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
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: theme.accent.gold }}>{fmt(tx.amount)}</div>
                            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: badge.color, marginTop: 2 }}>{tx.quantity}× · {badge.label}</div>
                            <div style={{ fontSize: 10, color: theme.text.muted, marginTop: 3 }}>{isOpen ? "▲" : "▼"}</div>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="expand-panel" style={{ borderBottom: isLast ? "none" : `1px solid ${theme.border.default}`, background: "rgba(255,255,255,0.01)", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                              {([
                                { label: "Transaction ID", value: "TXN-" + tx.id.slice(0, 8).toUpperCase(), full: true, mono: true },
                                ...(tx.status === "credit_partial" ? [{ label: "Sale Type", value: "Credit Sale · Upfront Payment", full: true, color: "#c084fc" }] : []),
                                { label: "Product",    value: tx.product_name ?? "—" },
                                { label: "SKU",        value: tx.product_sku  || "—", mono: true },
                                { label: "Unit Price", value: tx.unit_price != null ? fmt(tx.unit_price) : "—" },
                                { label: "Qty",        value: String(tx.quantity) },
                                { label: "Total",      value: fmt(tx.amount), color: theme.accent.gold },
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
                            {(canResend || tx.receipt_sent === true) && (
                              <div onClick={e => e.stopPropagation()}>
                                {tx.receipt_sent === true ? (
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 10 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <span>📱</span>
                                      <span style={{ fontSize: 12, fontFamily: theme.font.mono, color: "#34d399" }}>Sent to <strong>{tx.receipt_phone ?? tx.customer_phone}</strong></span>
                                    </div>
                                    <button onClick={() => handleResend(tx)} disabled={isSending} style={{ padding: "5px 14px", background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)", borderRadius: 8, color: "#34d399", fontFamily: theme.font.mono, fontSize: 11, fontWeight: 700, cursor: isSending ? "not-allowed" : "pointer", opacity: isSending ? 0.6 : 1 }}>
                                      {isSending ? "Sending..." : "Resend"}
                                    </button>
                                  </div>
                                ) : (
                                  <button onClick={() => handleResend(tx)} disabled={isSending} style={{ width: "100%", padding: "12px 16px", background: tx.receipt_sent === false ? "rgba(234,179,8,0.08)" : "rgba(6,182,212,0.08)", border: `1px solid ${tx.receipt_sent === false ? "rgba(234,179,8,0.3)" : "rgba(6,182,212,0.25)"}`, borderRadius: 10, color: tx.receipt_sent === false ? "#fbbf24" : theme.accent.cyan, fontFamily: theme.font.mono, fontSize: 13, fontWeight: 700, cursor: isSending ? "not-allowed" : "pointer", opacity: isSending ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                                    {isSending
                                      ? <><span style={{ width: 13, height: 13, border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} /> Sending...</>
                                      : tx.receipt_sent === false ? `📵 Retry Receipt → ${phone}` : `📄 Send Receipt → ${phone}`}
                                  </button>
                                )}
                              </div>
                            )}
                            {!phone && (
                              <div style={{ padding: "10px 14px", background: "rgba(255,255,255,0.03)", border: `1px solid ${theme.border.default}`, borderRadius: 10, fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, textAlign: "center" }}>
                                No phone number recorded — receipt cannot be sent
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
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
    </div>
  );
}
