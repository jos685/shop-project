import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../lib/supabase";

const fmt = (n: number) => `KSh ${n.toLocaleString()}`;

interface LocalTransaction {
  id: string;
  amount: number;
  quantity: number;
  payment_method: string;
  cash_amount: number | null;
  mpesa_amount: number | null;
  created_at: string;
  product_name: string | null;
  product_sku: string | null;
  seller_name: string | null;
  seller_code: string | null;
}

interface CommissionRow {
  id: string;
  created_at: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  base_price: number;
  commission_rate: number;
  commission_earned: number;
  seller_agent_id: string;
  seller_name: string;
}

interface CommSettings { enabled: boolean; rate: number; }
interface AgentOption  { agent_id: string; name: string; agent_code: string; }

type ActiveTab  = "transactions" | "commission";
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
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<ActiveTab>("transactions");

  const [transactions, setTransactions] = useState<LocalTransaction[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [hasMore, setHasMore]           = useState(false);
  const [offset, setOffset]             = useState(0);
  const [filter, setFilter]             = useState<DateFilter>("today");
  const [search, setSearch]             = useState("");
  const [methodFilter, setMethodFilter] = useState<"all" | "cash" | "mpesa" | "split">("all");

  // Commission tab state
  const [commSettings,     setCommSettings]     = useState<CommSettings | null>(null);
  const [commAgents,       setCommAgents]       = useState<AgentOption[]>([]);
  const [commData,         setCommData]         = useState<CommissionRow[]>([]);
  const [commLoading,      setCommLoading]      = useState(false);
  const [commFilter,       setCommFilter]       = useState<DateFilter>("today");
  const [selectedAgentId,  setSelectedAgentId]  = useState<string>("");
  const [payoutsMap,       setPayoutsMap]       = useState<Record<string, number>>({});

  // Shared lookup maps so we don't re-fetch known products/agents on load-more
  const productMapRef = useRef<Record<string, { name: string; sku: string }>>({});
  const sellerMapRef  = useRef<Record<string, { name: string; code: string }>>({});

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
      created_at:     t.created_at,
      product_name:   existingProductMap[t.product_id]?.name  ?? "—",
      product_sku:    existingProductMap[t.product_id]?.sku   ?? "",
      seller_name:    existingSellerMap[t.seller_agent_id]?.name ?? "Unknown",
      seller_code:    existingSellerMap[t.seller_agent_id]?.code ?? "",
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
      .select("id, amount, quantity, payment_method, cash_amount, mpesa_amount, created_at, product_id, seller_agent_id")
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

  const fetchCommissionData = useCallback(async () => {
    if (!shop) return;
    setCommLoading(true);

    const [settingsRes, agentsRes, payoutsRes] = await Promise.all([
      supabase.rpc("get_shop_commission", { p_owner_id: shop.owner_id }),
      supabase.from("shop_agents").select("agent_id, agent_name, agent_code").eq("shop_id", shop.id).eq("active", true),
      supabase.rpc("get_agent_commission_payouts", { p_owner_id: shop.owner_id }),
    ]);

    const pMap: Record<string, number> = {};
    for (const row of (payoutsRes.data as any[]) ?? []) {
      pMap[row.agent_id] = Number(row.total_paid ?? 0);
    }
    setPayoutsMap(pMap);

    setCommSettings((settingsRes.data as any)?.[0] ?? { enabled: false, rate: 0 });
    const agents: AgentOption[] = (agentsRes.data || []).map((a: any) => ({
      agent_id:   a.agent_id,
      name:       a.agent_name ?? "Agent",
      agent_code: a.agent_code ?? "",
    }));
    setCommAgents(agents);

    const startDate = getStartDate(commFilter);
    let query = supabase
      .from("shop_transactions")
      .select("id, created_at, product_id, seller_agent_id, quantity, unit_price, base_price, commission_rate, commission_earned")
      .eq("shop_id", shop.id)
      .not("unit_price", "is", null)
      .order("created_at", { ascending: false });

    if (startDate)       query = query.gte("created_at", startDate.toISOString());
    if (selectedAgentId) query = query.eq("seller_agent_id", selectedAgentId);

    const { data: txData } = await query;

    const productIds = [...new Set((txData || []).map((t: any) => t.product_id).filter(Boolean))];
    const productMap: Record<string, string> = {};
    if (productIds.length > 0) {
      const { data: prods } = await supabase.from("products").select("id, name").in("id", productIds);
      for (const p of prods ?? []) productMap[p.id] = p.name;
    }

    const agentMap: Record<string, string> = {};
    for (const a of agents) agentMap[a.agent_id] = a.name;

    setCommData((txData || []).map((t: any) => ({
      id:                t.id,
      created_at:        t.created_at,
      product_name:      productMap[t.product_id] ?? "—",
      quantity:          t.quantity ?? 0,
      unit_price:        Number(t.unit_price   ?? 0),
      base_price:        Number(t.base_price   ?? 0),
      commission_rate:   Number(t.commission_rate   ?? 0),
      commission_earned: Number(t.commission_earned ?? 0),
      seller_agent_id:   t.seller_agent_id ?? "",
      seller_name:       agentMap[t.seller_agent_id] ?? "Unknown",
    })));

    setCommLoading(false);
  }, [shop, commFilter, selectedAgentId]);

  const loadMore = useCallback(async () => {
    if (!shop || loadingMore) return;
    setLoadingMore(true);

    const startDate = getStartDate(filter);
    let query = supabase
      .from("shop_transactions")
      .select("id, amount, quantity, payment_method, cash_amount, mpesa_amount, created_at, product_id, seller_agent_id")
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
    if (activeTab === "commission") fetchCommissionData();
  }, [activeTab, fetchCommissionData]);

  // Realtime — transactions
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

  // Realtime — payouts (auto-refresh commission tab when owner records a payout)
  useEffect(() => {
    if (!shop) return;
    const ch = supabase.channel("pos-payouts-live")
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "agent_commission_payouts",
        filter: `owner_id=eq.${shop.owner_id}`,
      }, fetchCommissionData)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, fetchCommissionData]);

  const methodBadge = (method: string) => {
    if (method === "cash")  return { icon: "💵", color: "#34d399", label: "Cash"   };
    if (method === "mpesa") return { icon: "📱", color: "#60a5fa", label: "M-Pesa" };
    return                         { icon: "⚡", color: "#fbbf24", label: "Split"  };
  };

  const displayed = transactions.filter(tx => {
    const matchesMethod = methodFilter === "all" || tx.payment_method === methodFilter;
    const q = search.toLowerCase();
    const matchesSearch = !q
      || (tx.product_name ?? "").toLowerCase().includes(q)
      || (tx.seller_name  ?? "").toLowerCase().includes(q)
      || (tx.product_sku  ?? "").toLowerCase().includes(q);
    return matchesMethod && matchesSearch;
  });

  const totalRevenue = displayed.reduce((s, t) => s + t.amount, 0);
  const totalCash    = displayed.reduce((s, t) => s + (t.cash_amount  ?? 0), 0);
  const totalMpesa   = displayed.reduce((s, t) => s + (t.mpesa_amount ?? 0), 0);

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

  const totalCommission = commData.reduce((s, r) => s + r.commission_earned, 0);
  const totalPaidOut = selectedAgentId
    ? (payoutsMap[selectedAgentId] ?? 0)
    : Object.values(payoutsMap).reduce((s, v) => s + v, 0);
  const balanceOwed = Math.max(0, totalCommission - totalPaidOut);

  const groupCommByDate = (rows: CommissionRow[]) => {
    const groups: Record<string, CommissionRow[]> = {};
    for (const r of rows) {
      const key = new Date(r.created_at).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return groups;
  };
  const groupedComm = groupCommByDate(commData);

  return (
    <div style={{ minHeight: "100vh", background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin   { to{transform:rotate(360deg)} }
        .tx-row { transition: background 0.12s; }
        .tx-row:hover { background: rgba(6,182,212,0.04) !important; }
        .filter-pill { transition: all 0.15s; cursor: pointer; }
        .filter-pill:hover { opacity: 0.85; }
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

      {/* Tab bar */}
      <div style={{
        position: "sticky", top: 57, background: theme.bg.base, zIndex: 39,
        borderBottom: `1px solid ${theme.border.default}`,
        display: "flex", padding: "0 16px",
      }}>
        {(["transactions", "commission"] as const).map(tab => (
          <button key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: "12px 0",
              border: "none", borderBottom: `2px solid ${activeTab === tab ? theme.accent.cyan : "transparent"}`,
              background: "transparent",
              color: activeTab === tab ? theme.accent.cyan : theme.text.muted,
              fontFamily: theme.font.mono, fontSize: 12, fontWeight: activeTab === tab ? 600 : 400,
              cursor: "pointer", transition: "all 0.15s",
            }}>
            {tab === "transactions" ? "Transactions" : "Commission"}
          </button>
        ))}
      </div>

      <div style={{ padding: "16px 16px 100px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* ══ TRANSACTIONS TAB ══ */}
        {activeTab === "transactions" && (<>

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
                placeholder="Search product or seller..."
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {[
              { label: "Total",  value: fmt(totalRevenue), color: theme.accent.gold },
              { label: "Cash",   value: fmt(totalCash),    color: "#34d399"          },
              { label: "M-Pesa", value: fmt(totalMpesa),   color: "#60a5fa"          },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{label}</div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 15, color }}>{value}</div>
              </div>
            ))}
          </div>

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
                    <div style={{ padding: "8px 18px", background: "rgba(255,255,255,0.02)", borderBottom: `1px solid ${theme.border.default}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{date}</div>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.accent.gold }}>{fmt(txns.reduce((s, t) => s + t.amount, 0))}</div>
                    </div>
                    {txns.map((tx, i) => {
                      const badge  = methodBadge(tx.payment_method);
                      const isLast = i === txns.length - 1;
                      return (
                        <div key={tx.id} className="tx-row"
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: isLast ? "none" : `1px solid ${theme.border.default}` }}>
                          <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
                            {badge.icon}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.product_name ?? "—"}</div>
                            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                              {tx.seller_name} · {new Date(tx.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>
                              TXN-{tx.id.slice(0, 8).toUpperCase()}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: theme.accent.gold }}>{fmt(tx.amount)}</div>
                            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: badge.color, marginTop: 2 }}>{tx.quantity}× · {badge.label}</div>
                          </div>
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
        </>)}

        {/* ══ COMMISSION TAB ══ */}
        {activeTab === "commission" && (<>

          {/* Rate banner */}
          {commSettings && (
            commSettings.enabled ? (
              <div style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 12, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 12, fontFamily: theme.font.mono, color: theme.text.secondary }}>Commission Active</div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 20, color: theme.accent.cyan }}>{commSettings.rate}%</div>
              </div>
            ) : (
              <div style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 12, padding: "12px 16px", fontSize: 12, fontFamily: theme.font.mono, color: theme.accent.red }}>
                Commission is currently disabled by your owner. Historical earnings are shown below.
              </div>
            )
          )}

          {/* Date filter pills */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
            {(Object.keys(FILTER_LABELS) as DateFilter[]).map(f => (
              <button key={f} className="filter-pill"
                onClick={() => setCommFilter(f)}
                style={{
                  padding: "7px 16px", borderRadius: 50,
                  border: `1px solid ${commFilter === f ? theme.accent.cyan : theme.border.default}`,
                  background: commFilter === f ? "rgba(6,182,212,0.15)" : "transparent",
                  color: commFilter === f ? theme.accent.cyan : theme.text.muted,
                  fontFamily: theme.font.mono, fontSize: 11, fontWeight: commFilter === f ? 600 : 400,
                  whiteSpace: "nowrap",
                }}>
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>

          {/* Agent selector */}
          {commAgents.length > 0 && (
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
              <button className="filter-pill"
                onClick={() => setSelectedAgentId("")}
                style={{
                  padding: "7px 14px", borderRadius: 50, whiteSpace: "nowrap",
                  border: `1px solid ${selectedAgentId === "" ? theme.accent.gold : theme.border.default}`,
                  background: selectedAgentId === "" ? "rgba(234,179,8,0.12)" : "transparent",
                  color: selectedAgentId === "" ? theme.accent.gold : theme.text.muted,
                  fontFamily: theme.font.mono, fontSize: 11, fontWeight: selectedAgentId === "" ? 600 : 400,
                }}>
                All Agents
              </button>
              {commAgents.map(a => (
                <button key={a.agent_id} className="filter-pill"
                  onClick={() => setSelectedAgentId(a.agent_id)}
                  style={{
                    padding: "7px 14px", borderRadius: 50, whiteSpace: "nowrap",
                    border: `1px solid ${selectedAgentId === a.agent_id ? theme.accent.gold : theme.border.default}`,
                    background: selectedAgentId === a.agent_id ? "rgba(234,179,8,0.12)" : "transparent",
                    color: selectedAgentId === a.agent_id ? theme.accent.gold : theme.text.muted,
                    fontFamily: theme.font.mono, fontSize: 11, fontWeight: selectedAgentId === a.agent_id ? 600 : 400,
                  }}>
                  {a.name}
                </button>
              ))}
            </div>
          )}

          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Total Earned</div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 16, color: "#34d399" }}>{fmt(totalCommission)}</div>
            </div>
            <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Paid Out</div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 16, color: theme.accent.cyan }}>{fmt(totalPaidOut)}</div>
            </div>
          </div>

          {/* Balance owed */}
          <div style={{
            background: balanceOwed > 0 ? "rgba(234,179,8,0.08)" : "rgba(52,211,153,0.06)",
            border: `1px solid ${balanceOwed > 0 ? "rgba(234,179,8,0.25)" : "rgba(52,211,153,0.2)"}`,
            borderRadius: 14, padding: "14px 18px",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Balance Owed</div>
              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                {balanceOwed > 0 ? "Pending payout from owner" : "All commission paid out"}
              </div>
            </div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 24, color: balanceOwed > 0 ? theme.accent.gold : "#34d399" }}>
              {balanceOwed > 0 ? fmt(balanceOwed) : "✓ Clear"}
            </div>
          </div>

          {/* Commission list */}
          <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 18, overflow: "hidden", animation: "fadeUp 0.3s ease" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${theme.border.default}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 14 }}>Earnings Breakdown</div>
              <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted }}>{commData.length} records</div>
            </div>

            {commLoading ? (
              <div style={{ padding: "48px 20px", textAlign: "center" }}>
                <div style={{ width: 24, height: 24, border: "3px solid rgba(6,182,212,0.2)", borderTopColor: theme.accent.cyan, borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 10px" }} />
                <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono }}>Loading commission data...</div>
              </div>
            ) : commData.length === 0 ? (
              <div style={{ padding: "60px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 40, opacity: 0.2, marginBottom: 12 }}>💰</div>
                <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono }}>No commission records found</div>
                <div style={{ color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, marginTop: 4 }}>Commission is recorded when a sale is made above the base price.</div>
              </div>
            ) : (
              <div>
                {Object.entries(groupedComm).map(([date, rows]) => (
                  <div key={date}>
                    <div style={{ padding: "8px 18px", background: "rgba(255,255,255,0.02)", borderBottom: `1px solid ${theme.border.default}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{date}</div>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: "#34d399" }}>
                        {fmt(rows.reduce((s, r) => s + r.commission_earned, 0))}
                      </div>
                    </div>
                    {rows.map((row, i) => {
                      const isLast  = i === rows.length - 1;
                      const markup  = Math.max(0, row.unit_price - row.base_price);
                      const hasMarkup = markup > 0;
                      return (
                        <div key={row.id} className="tx-row"
                          style={{ padding: "12px 18px", borderBottom: isLast ? "none" : `1px solid ${theme.border.default}`, display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ width: 34, height: 34, borderRadius: 9, background: hasMarkup ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.04)", border: `1px solid ${hasMarkup ? "rgba(52,211,153,0.25)" : "rgba(255,255,255,0.08)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
                            {hasMarkup ? "📈" : "➖"}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.product_name}</div>
                            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                              {row.seller_name} · {new Date(row.created_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                            <div style={{ fontSize: 10, fontFamily: theme.font.mono, marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ color: theme.text.muted }}>{row.quantity}× @ {fmt(row.unit_price)}</span>
                              {hasMarkup && <span style={{ color: "#34d399" }}>+{fmt(markup)}/unit markup</span>}
                              <span style={{ color: theme.text.muted }}>· rate {row.commission_rate}%</span>
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 15, color: row.commission_earned > 0 ? "#34d399" : theme.text.muted }}>
                              {fmt(row.commission_earned)}
                            </div>
                            <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>commission</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>)}
      </div>
    </div>
  );
}
