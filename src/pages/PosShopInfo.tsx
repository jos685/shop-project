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
  product: {
    id: string;
    name: string;
    sku: string;
    price: number;
    unit: string;
  };
}

interface ShopAgent {
  id: string;
  pin: string;
  active: boolean;
  agent: {
    id: string;
    name: string;
    agent_id: string;
    avatar: string;
  };
}

export default function PosShopInfo() {
  const { shop } = useShopAuth();
  const { theme } = useTheme();
  const width = useWindowWidth();
  const isMobile = width < 640;

  const [stock,        setStock]        = useState<StockItem[]>([]);
  const [agents,       setAgents]       = useState<ShopAgent[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [tab,          setTab]          = useState<"stock" | "agents">("stock");

  // Today's sales stats
  const [todaySales,   setTodaySales]   = useState(0);
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayCash,    setTodayCash]    = useState(0);
  const [todayMpesa,   setTodayMpesa]   = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);

  const fetchInfo = useCallback(async () => {
    if (!shop) return;
    setLoading(true);
    console.log("🔍 fetchInfo called. shop.id:", shop?.id);
    try {
      // ── Step 1: parallel fetches ──────────────────────────────────────
      const [allocRes, shopAgentsRaw, txRes] = await Promise.all([
        // Read denormalised product columns stored directly on shop_allocations
        // FK join (product:products(...)) returns null due to RLS on products table
        // from the shop session — denormalised columns bypass this entirely
        supabase
          .from("shop_allocations")
          .select("id, allocated, remaining, product_id, product_name, product_sku, product_price, product_unit")
          .eq("shop_id", shop.id),
        // Select agent_name/avatar columns stored directly on shop_agents
        // (avoids RLS cross-table read on profiles)
        supabase
          .from("shop_agents")
          .select("id, pin, active, agent_id, agent_name, agent_code, agent_avatar")
          .eq("shop_id", shop.id)
          .eq("active", true),
        supabase
          .from("shop_transactions")
          .select("product_id, quantity")
          .eq("shop_id", shop.id),
      ]);

      console.log("🔍 allocations:", JSON.stringify(allocRes.data), "err:", allocRes.error?.message);
      console.log("🔍 shop_agents:", JSON.stringify(shopAgentsRaw.data), "err:", shopAgentsRaw.error?.message);

      // ── Step 2: build agents from denormalised columns ────────────────
      // If agent_name column doesn't exist yet, fall back to profiles via owner RPC
      let hydratedAgents: ShopAgent[] = (shopAgentsRaw.data || []).map((r: any) => ({
        id:     r.id,
        pin:    r.pin,
        active: r.active,
        agent: {
          id:       r.agent_id,
          name:     r.agent_name   ?? "Agent",
          agent_id: r.agent_code   ?? "",
          avatar:   r.agent_avatar ?? "",
        },
      }));

      // Fallback: if agent_name is missing, try fetching profiles using owner_id
      // This works if RLS allows owner reads (shop_agents owner_id matches shop.owner_id)
      const needsFallback = hydratedAgents.some(a => a.agent.name === "Agent");
      if (needsFallback) {
        const agentIds = hydratedAgents.map(a => a.agent.id).filter(Boolean);
        if (agentIds.length > 0) {
          const { data: profilesData, error: profileErr } = await supabase
            .from("profiles")
            .select("id, name, agent_id, avatar")
            .in("id", agentIds)
            .eq("owner_id", shop.owner_id);   // scope to this shop's owner — may satisfy RLS
          console.log("🔍 profiles fallback:", JSON.stringify(profilesData), "err:", profileErr?.message);
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

      // ── Step 3: build productMap from denormalised columns ───────────
      // product_name/sku/price/unit are stored directly on shop_allocations
      // so no cross-table read is needed — fully RLS-safe from shop session
      const allocData = (allocRes.data || []) as any[];
      console.log("🔍 allocations+products:", JSON.stringify(allocData), "err:", allocRes.error?.message);

      const productMap: Record<string, any> = {};
      for (const a of allocData) {
        if (!a.product_id || !a.product_name) continue; // skip rows not yet backfilled
        productMap[a.product_id] = {
          id:    a.product_id,
          name:  a.product_name,
          sku:   a.product_sku   ?? "",
          price: Number(a.product_price ?? 0),
          unit:  a.product_unit  ?? "",
        };
      }
      console.log("🔍 productMap keys:", Object.keys(productMap));

      // ── Step 4: sold map ──────────────────────────────────────────────
      const soldMap: Record<string, number> = {};
      for (const t of (txRes.data || [])) {
        if (!t.product_id) continue;
        soldMap[t.product_id] = (soldMap[t.product_id] || 0) + (Number(t.quantity) || 1);
      }

      // ── Step 5: merge stock ───────────────────────────────────────────
      const stockItems: StockItem[] = (allocRes.data || [])
        .filter((a: any) => !!productMap[a.product_id])
        .map((a: any) => ({
          id:        a.id,
          allocated: a.allocated,
          remaining: Math.max(0, a.allocated - (soldMap[a.product_id] || 0)),
          product:   productMap[a.product_id],
        }));

      console.log("✅ stockItems:", stockItems.length, "agents:", hydratedAgents.length);
      setStock(stockItems);
      setAgents(hydratedAgents);
    } catch (err) {
      console.error("ShopInfo fetchInfo error:", err);
    } finally {
      setLoading(false);
    }
  }, [shop]);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  const fetchStats = useCallback(async () => {
    if (!shop) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("shop_transactions")
      .select("amount, cash_amount, mpesa_amount")
      .eq("shop_id", shop.id)
      .gte("created_at", today.toISOString());
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
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "shop_transactions",
        filter: `shop_id=eq.${shop.id}`,
      }, fetchStats)
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
        .section   { animation: fadeUp 0.3s ease both; }
        .stock-row { transition: background 0.1s; }
        .stock-row:hover { background: rgba(255,255,255,0.02) !important; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ borderBottom: `1px solid ${theme.border.default}`, padding: isMobile ? "14px 16px" : "20px 40px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 18 : 22 }}>Shop Info</div>
          <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
            {shop?.name} · {shop?.shop_code}
          </div>
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
            {[
              { label: "Sales",   value: String(todaySales),  color: theme.text.primary, icon: "🧾", sub: "transactions" },
              { label: "Revenue", value: fmt(todayRevenue),   color: theme.accent.gold,  icon: "💰", sub: "total earned"  },
              { label: "Cash",    value: fmt(todayCash),      color: "#34d399",           icon: "💵", sub: "cash"          },
              { label: "M-Pesa",  value: fmt(todayMpesa),     color: "#60a5fa",           icon: "📱", sub: "mobile"        },
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
      <div style={{ display: "flex", borderBottom: `1px solid ${theme.border.default}`, padding: "0 16px" }}>
        {([
          { key: "stock",  label: `📦 Stock (${stock.length})`   },
          { key: "agents", label: `👤 Agents (${agents.length})` },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: "14px 20px", border: "none", borderBottom: `2px solid ${tab === t.key ? theme.accent.cyan : "transparent"}`, background: "transparent", color: tab === t.key ? theme.accent.cyan : theme.text.muted, fontFamily: theme.font.mono, fontSize: 13, cursor: "pointer", fontWeight: tab === t.key ? 600 : 400 }}>
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
            {/* ── STOCK TAB ── */}
            {tab === "stock" && (
              <div className="section">
                {/* Summary cards */}
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
                    {/* Table header — desktop only */}
                    {!isMobile && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 90px 90px 90px", gap: 12, padding: "12px 20px", borderBottom: `1px solid ${theme.border.default}`, background: "rgba(255,255,255,0.02)" }}>
                        {["Product", "Unit Price", "Allocated", "Remaining", "Sold"].map(h => (
                          <div key={h} style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</div>
                        ))}
                      </div>
                    )}

                    {stock.map((item, i) => {
                      const sold   = item.allocated - item.remaining;
                      const pct    = item.allocated > 0 ? Math.round((item.remaining / item.allocated) * 100) : 0;
                      const sc     = item.remaining === 0 ? theme.accent.red : pct <= 20 ? theme.accent.gold : theme.accent.green;
                      const isLast = i === stock.length - 1;

                      return (
                        <div key={item.id} className="stock-row"
                          style={{ borderBottom: isLast ? "none" : `1px solid ${theme.border.default}`, padding: isMobile ? "16px" : "16px 20px" }}>

                          {isMobile ? (
                            /* Mobile card layout */
                            <div>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>{item.product.name}</div>
                                  <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>{item.product.sku}</div>
                                </div>
                                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                                  <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 24, color: sc, lineHeight: 1 }}>{item.remaining}</div>
                                  <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                                    {item.remaining} {item.product.unit} left
                                  </div>
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
                            /* Desktop table row */
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
                                <div style={{ marginTop: 6, fontSize: 11, fontFamily: theme.font.mono, color: theme.accent.red }}>
                                  ⚠ Out of stock
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

            {/* ── AGENTS TAB ── */}
            {tab === "agents" && (
              <div className="section">
                {agents.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16 }}>
                    <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 14 }}>👤</div>
                    <div style={{ color: theme.text.muted, fontSize: 14, fontFamily: theme.font.mono }}>No agents assigned to this shop</div>
                    <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono, marginTop: 6, opacity: 0.6 }}>Contact your supervisor to assign agents</div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(280px,1fr))", gap: 12 }}>
                    {agents.map(sa => {
                      const ag = sa.agent;
                      return (
                        <div key={sa.id} style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16, padding: "22px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
                          {/* Avatar + name */}
                          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg,rgba(6,182,212,0.2),rgba(6,182,212,0.08))", border: "2px solid rgba(6,182,212,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: theme.font.display, fontWeight: 800, fontSize: 20, color: theme.accent.cyan, flexShrink: 0 }}>
                              {ag.avatar || ag.name?.slice(0, 2).toUpperCase() || "?"}
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 17 }}>{ag.name}</div>
                              <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{ag.agent_id}</div>
                            </div>
                            <div style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 20, padding: "4px 10px", fontSize: 10, fontFamily: theme.font.mono, color: "#34d399", fontWeight: 600, flexShrink: 0 }}>
                              Active
                            </div>
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