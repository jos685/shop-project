// pages/PosShopInfo.tsx
// Shows shop stock and assigned agents

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import { useNetwork } from "../context/NetworkContext";
import { supabase } from "../lib/supabase";
import { getQueue } from "../lib/offlineQueue";

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

type ActiveTab = "stock" | "agents";

export default function PosShopInfo() {
  const { shop } = useShopAuth();
  const { theme } = useTheme();
  const { pendingCount } = useNetwork();
  const location = useLocation();
  const width = useWindowWidth();
  const isMobile = width < 640;

  const [stock,        setStock]        = useState<StockItem[]>([]);
  const [agents,       setAgents]       = useState<ShopAgent[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [tab,          setTab]          = useState<ActiveTab>("stock");

  // Deep-link from dashboard: navigate("/pos/info", { state: { tab: "stock" } })
  useEffect(() => {
    const state = location.state as { tab?: string } | null;
    if (state?.tab && ["stock", "agents"].includes(state.tab)) {
      setTab(state.tab as ActiveTab);
      window.history.replaceState({}, "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Offline queue
  const [queuedCount, setQueuedCount] = useState(0);
  const [queuedTotal, setQueuedTotal] = useState(0);
  useEffect(() => {
    const q = getQueue();
    setQueuedCount(q.length);
    setQueuedTotal(q.reduce((s, sale) => s + sale.grandTotal, 0));
  }, [pendingCount]);

  // Today's stats
  const [todaySales,   setTodaySales]   = useState(0);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayCash,    setTodayCash]    = useState(0);
  const [todayMpesa,   setTodayMpesa]   = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);

  // ── fetch stock + agents ──────────────────────────────────────────────
  const cacheKey = shop ? `pos_cache_${shop.id}` : null;

  // Load from cache first so offline visits show real data immediately
  useEffect(() => {
    if (!cacheKey) return;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return;
      const { products, agents: cachedAgents } = JSON.parse(raw);
      if (products?.length) {
        setStock(products.map((a: any) => ({
          id: a.id, allocated: a.allocated, remaining: a.remaining,
          product: { id: a.product.id, name: a.product.name, sku: a.product.sku, price: a.product.price, unit: a.product.unit },
        })));
      }
      if (cachedAgents?.length) {
        setAgents(cachedAgents.map((a: any) => ({
          id: a.id, pin: a.pin, active: a.active,
          agent: { id: a.agent_id, name: a.name, agent_id: a.agent_code, avatar: a.avatar },
        })));
      }
    } catch {}
  }, [cacheKey]);

  const fetchInfo = useCallback(async () => {
    if (!shop) return;
    // When offline use cached data already loaded above; skip network
    if (!navigator.onLine) { setLoading(false); return; }
    setLoading(true);
    try {
      const [allocRes, shopAgentsRaw] = await Promise.all([
        supabase.from("shop_allocations")
          .select("id, allocated, remaining, product_id, product_name, product_sku, product_price, product_unit")
          .eq("shop_id", shop.id),
        supabase.from("shop_agents")
          .select("id, pin, active, agent_id, agent_name, agent_code, agent_avatar")
          .eq("shop_id", shop.id).eq("active", true),
      ]);

      if (allocRes.error) console.error("shop_allocations error:", allocRes.error.message);

      const productIds = (allocRes.data || []).map((a: any) => a.product_id).filter(Boolean);
      let productsMap: Record<string, any> = {};
      if (productIds.length > 0) {
        const { data: prodsData, error: prodsError } = await supabase
          .from("products")
          .select("id, name, sku, price, unit")
          .in("id", productIds);
        if (prodsError) console.error("products fetch error:", prodsError.message);
        for (const p of prodsData || []) productsMap[p.id] = p;
      }

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

      setStock(
        (allocRes.data || [])
          .filter((a: any) => !!a.product_id)
          .map((a: any) => ({
            id: a.id,
            allocated: a.allocated,
            remaining: Math.max(0, a.remaining ?? 0),
            product: {
              id:    a.product_id,
              name:  productsMap[a.product_id]?.name  || a.product_name  || "—",
              sku:   productsMap[a.product_id]?.sku   || a.product_sku   || "",
              price: Number(productsMap[a.product_id]?.price ?? a.product_price ?? 0),
              unit:  productsMap[a.product_id]?.unit  || a.product_unit  || "",
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
    if (!navigator.onLine) { setStatsLoading(false); return; }
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

  const totalStockValue     = stock.reduce((s, i) => s + (i.product?.price ?? 0) * i.remaining,  0);
  const totalAllocatedValue = stock.reduce((s, i) => s + (i.product?.price ?? 0) * i.allocated, 0);

  return (
    <div style={{ minHeight: "100vh", background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin   { to{transform:rotate(360deg)} }
        .section    { animation: fadeUp 0.3s ease both; }
        .stock-row  { transition: background 0.1s; }
        .stock-row:hover { background: rgba(255,255,255,0.02) !important; }
        ${theme.kiCss}
      `}</style>

      {/* ── Header ── */}
      <div style={{ borderBottom: `1px solid ${theme.border.default}`, padding: isMobile ? "14px 16px" : "20px 40px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 18 : 22 }}>Shop Info</div>
          <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{shop?.name} · {shop?.shop_code}</div>
        </div>
        <button onClick={() => { fetchInfo(); fetchStats(); }}
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
          <div style={{ display: "grid", gridTemplateColumns: queuedCount > 0 ? `repeat(${isMobile ? 2 : 5},1fr)` : "repeat(4,1fr)", gap: 8 }}>
            {[
              { label: "Sales",   value: String(todaySales), color: theme.text.primary, icon: "🧾", sub: "transactions", queued: false },
              { label: "Revenue", value: fmt(todayRevenue),  color: theme.accent.gold,  icon: "💰", sub: "total earned",  queued: false },
              { label: "Cash",    value: fmt(todayCash),     color: "#34d399",           icon: "💵", sub: "cash",          queued: false },
              { label: "M-Pesa",  value: fmt(todayMpesa),    color: "#60a5fa",           icon: "📱", sub: "mobile",        queued: false },
              ...(queuedCount > 0
                ? [{ label: "Queued", value: String(queuedCount), color: "#fbbf24", icon: "⏳", sub: fmt(queuedTotal), queued: true }]
                : []),
            ].map(({ label, value, color, icon, sub, queued }) => (
              <div key={label} style={{ background: queued ? "rgba(251,191,36,0.06)" : theme.bg.card, border: `1px solid ${queued ? "rgba(251,191,36,0.3)" : theme.border.default}`, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: queued ? "#fbbf24" : theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
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
          { key: "stock",  label: `📦 Stock (${stock.length})`  },
          { key: "agents", label: `👤 Agents (${agents.length})` },
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
          </>
        )}
      </div>
    </div>
  );
}
