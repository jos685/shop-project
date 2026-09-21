// pages/PosShopInfo.tsx
// Shows shop stock and assigned agents

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import { useNetwork } from "../context/NetworkContext";
import { supabase, productImageUrl } from "../lib/supabase";
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
  product: { id: string; name: string; sku: string; price: number; unit: string; image_url?: string | null };
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
  const { isOnline, pendingCount } = useNetwork();
  const location = useLocation();
  const width = useWindowWidth();
  const isMobile = width < 640;
  const isWide   = width >= 1024; 

  // ── Expanded product card (shows recent tx + allocation) ──
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [txHistory,  setTxHistory]  = useState<Record<string, any[]>>({});
  const [txLoading,  setTxLoading]  = useState<Set<string>>(new Set());

  // ── Image lightbox ──
 const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
 
 // ── Lightbox: Esc to close + lock body scroll ──
useEffect(() => {
  if (!lightbox) return;
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
  window.addEventListener("keydown", onKey);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  return () => {
    window.removeEventListener("keydown", onKey);
    document.body.style.overflow = prevOverflow;
  };
}, [lightbox]);
  const [stock,           setStock]           = useState<StockItem[]>([]);
  const [agents,          setAgents]          = useState<ShopAgent[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [isOfflineData,   setIsOfflineData]   = useState(false);
  const [tab,             setTab]             = useState<ActiveTab>("stock");
  const [stockSearch, setStockSearch] = useState("");

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
  const [todayCash,    setTodayCash]    = useState(0);
  const [todayMpesa,   setTodayMpesa]   = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);

  // ── fetch stock + agents ──────────────────────────────────────────────
  const cacheKey = shop ? `pos_cache_${shop.id}` : null;

  // Load from cache first so offline visits show real data immediately
  useEffect(() => {
    if (!shop) return;
    try {
      // Try the full stock cache first (includes 0-remaining items)
      const fullRaw = localStorage.getItem(`pos_stock_full_${shop.id}`);
      if (fullRaw) {
        const { items } = JSON.parse(fullRaw);
        if (items?.length) {
          setStock(items.map((a: any) => ({
            id: a.id, allocated: a.allocated, remaining: a.remaining ?? 0,
            product: { id: a.product.id, name: a.product.name, sku: a.product.sku, price: a.product.price, unit: a.product.unit },
          })));
        }
      } else if (cacheKey) {
        // Fallback to PosScan cache (only remaining > 0 items)
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const { products } = JSON.parse(raw);
          if (products?.length) {
            setStock(products.map((a: any) => ({
              id: a.id, allocated: a.allocated, remaining: a.remaining,
              product: { id: a.product.id, name: a.product.name, sku: a.product.sku, price: a.product.price, unit: a.product.unit },
            })));
          }
        }
      }
      // Agents always come from PosScan cache (flat format)
      if (cacheKey) {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const { agents: cachedAgents } = JSON.parse(raw);
          if (cachedAgents?.length) {
            setAgents(cachedAgents.map((a: any) => ({
              id: a.id, pin: a.pin, active: a.active,
              agent: { id: a.agent_id, name: a.name, agent_id: a.agent_code, avatar: a.avatar },
            })));
          }
        }
      }
    } catch {}
  }, [shop, cacheKey]);

  const fetchInfo = useCallback(async () => {
    if (!shop) return;
    // When offline use cached data already loaded above; skip network
    if (!navigator.onLine) { setIsOfflineData(true); setLoading(false); return; }
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
          .select("id, name, sku, price, unit, image_url")
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

      const freshStock = (allocRes.data || [])
        .filter((a: any) => !!a.product_id)
        .map((a: any) => ({
          id: a.id,
          allocated: a.allocated,
          remaining: Math.max(0, a.remaining ?? 0),
          product: {
            id:        a.product_id,
            name:      productsMap[a.product_id]?.name      || a.product_name  || "—",
            sku:       productsMap[a.product_id]?.sku       || a.product_sku   || "",
            price:     Number(productsMap[a.product_id]?.price ?? a.product_price ?? 0),
            unit:      productsMap[a.product_id]?.unit      || a.product_unit  || "",
            image_url: productImageUrl(productsMap[a.product_id]?.image_url),
          },
        }));

      setStock(freshStock);

       // Update the PosScan cache as well so both pages stay in sync
    try {
      // Update the product cache used by PosScan
      const productData = freshStock.map(item => ({
        id: item.id,
        allocated: item.allocated,
        remaining: item.remaining,
        product: {
          id: item.product.id,
          name: item.product.name,
          sku: item.product.sku,
          price: item.product.price,
          unit: item.product.unit,
          image_url: item.product.image_url,
        }
      }));
      
      // Also update the main cache used by PosScan
      const cacheKey = `pos_cache_${shop.id}`;
      const existingCache = localStorage.getItem(cacheKey);
      if (existingCache) {
        const parsed = JSON.parse(existingCache);
        parsed.products = productData;
        localStorage.setItem(cacheKey, JSON.stringify(parsed));
      }
    } catch (cacheError) {
      console.error("Failed to update cache:", cacheError);
    }
    
      setAgents(hydratedAgents);
      setIsOfflineData(false);

      // Persist full stock (all items including 0-remaining) for offline visits
      try {
        localStorage.setItem(`pos_stock_full_${shop.id}`, JSON.stringify({ items: freshStock, cachedAt: Date.now() }));
      } catch {}
    } catch (err) {
      console.error("ShopInfo fetchInfo error:", err);
    } finally {
      setLoading(false);
    }
  }, [shop]);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  // ── Listen for stock changes from other pages (returns, adjustments) ──
useEffect(() => {
  if (!shop) return;
  
  const handleStockChange = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.shopId === shop.id) {
      // Refetch stock data
      fetchInfo();
    }
  };
  
  window.addEventListener('shop:stock_changed', handleStockChange);
  
  // Also listen for visibility changes (user coming back to this tab)
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      fetchInfo();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  
  return () => {
    window.removeEventListener('shop:stock_changed', handleStockChange);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}, [shop, fetchInfo]);

// ── Realtime stock updates from database ──
useEffect(() => {
  if (!shop) return;
  
  // Get all product IDs that this shop has stock for
  const productIds = stock.map(item => item.product.id);
  if (productIds.length === 0) return;
  
  const channel = supabase.channel(`shop-stock-${shop.id}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'products',
        filter: `id=in.(${productIds.join(',')})`,
      },
      () => {
        // Product stock updated - refresh stock data
        fetchInfo();
      }
    )
    .subscribe();
  
  return () => {
    supabase.removeChannel(channel);
  };
}, [shop, stock.map(item => item.product.id).join(','), fetchInfo]);

  // ── fetch today's stats ───────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    if (!shop) return;
    if (!navigator.onLine) { setStatsLoading(false); return; }
    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const { data, error } = await supabase.rpc("get_shop_transactions", {
      p_shop_id: shop.id,
      p_start:   today.toISOString(),
      p_end:     tomorrow.toISOString(),
      p_limit:   1000,
      p_offset:  0,
    });
    if (error) console.error("fetchStats error:", error.message, error.code);
    if (data) {
      setTodaySales(data.length);
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

  const loadProductTx = useCallback(async (productId: string) => {
    if (!shop || txHistory[productId]) return;
    setTxLoading(prev => new Set(prev).add(productId));
    try {
      // shop_transactions is flat — one row per product line.
      // No join table needed; every field we want is right here.
      const { data: rows, error } = await supabase
        .from("shop_transactions")
        .select("id, quantity, unit_price, amount, payment_method, cash_amount, mpesa_amount, seller_agent_id, created_at, status")
        .eq("shop_id", shop.id)
        .eq("product_id", productId)
        .order("created_at", { ascending: false })
        .limit(20);
  
      if (error) throw error;
  
      // Resolve seller name locally from the already-loaded shopAgents list.
      // shopAgents[].agent.id === shop_transactions.seller_agent_id
      const agentNameById = new Map<string, string>();
      for (const sa of agents) {
        if (sa.agent?.id) agentNameById.set(sa.agent.id, sa.agent.name || "Agent");
      }
  
      const merged = (rows || []).map((r: any) => ({
        id:             r.id,
        quantity:       r.quantity,
        unit_price:     r.unit_price,
        amount:         r.amount,
        payment_method: r.payment_method,
        cash_amount:    r.cash_amount,
        mpesa_amount:   r.mpesa_amount,
        created_at:     r.created_at,
        status:         r.status,
        agent_name:     r.seller_agent_id ? (agentNameById.get(r.seller_agent_id) ?? "—") : "—",
      }));
  
      setTxHistory(prev => ({ ...prev, [productId]: merged }));
    } catch (err) {
      console.error("loadProductTx error:", err);
      setTxHistory(prev => ({ ...prev, [productId]: [] }));
    } finally {
      setTxLoading(prev => { const n = new Set(prev); n.delete(productId); return n; });
    }
  }, [shop, txHistory, agents]);   // ← agents in deps so name lookup stays fresh
  
  const toggleExpand = (productId: string) => {
    setExpandedId(prev => {
      const next = prev === productId ? null : productId;
      if (next) loadProductTx(next);
      return next;
    });
  };

  const filteredStock = stock
  .filter(item => {
    const q = stockSearch.trim().toLowerCase();
    if (!q) return true;
    return item.product.name.toLowerCase().includes(q) || item.product.sku.toLowerCase().includes(q);
  })
    .sort((a, b) => a.product.name.localeCompare(b.product.name));

  return (
   <div style={{ minHeight: "100vh", background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');

        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes zoomIn { from{opacity:0;transform:scale(0.92)} to{opacity:1;transform:scale(1)} }
        .thumb { transition: transform 0.15s ease, border-color 0.15s ease; }
        .thumb-clickable:hover { transform: scale(1.08); border-color: rgba(6,182,212,0.55) !important; }
        @keyframes spin   { to{transform:rotate(360deg)} }
        .section    { animation: fadeUp 0.3s ease both; }
        .stock-row  { transition: background 0.1s; }
        .stock-row:hover { background: rgba(255,255,255,0.02) !important; }
        ${theme.kiCss}
      `}</style>

      {/* ── Header ── */}
      {!isMobile && (
      <div style={{ 
        borderBottom: `1px solid ${theme.border.default}`, 
        padding: "20px 40px", 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "space-between" 
      }}>
    
     <div>
      <div style={{ 
        fontFamily: theme.font.display, 
        fontWeight: 800, 
        fontSize: 22 
      }}>
        Shop Info
      </div>

      <div style={{ 
        fontSize: 11, 
        fontFamily: theme.font.mono, 
        color: theme.text.muted, 
        marginTop: 2 
      }}>
        {shop?.name} · {shop?.shop_code}
      </div>
     </div>

     <button
      onClick={() => { fetchInfo(); fetchStats(); }}
      style={{
        background: "rgba(6,182,212,0.08)",
        border: "1px solid rgba(6,182,212,0.2)",
        borderRadius: 9,
        padding: "8px 14px",
        color: theme.accent.cyan,
        fontFamily: theme.font.mono,
        fontSize: 12,
        cursor: "pointer"
      }}
     >
      ↺ Refresh
    </button>

  </div>
)}

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
                {/* Offline data banner */}
                {(isOfflineData || !isOnline) && stock.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 12, padding: "10px 14px", marginBottom: 16 }}>
                    <span style={{ fontSize: 15 }}>📵</span>
                    <span style={{ fontSize: 12, fontFamily: theme.font.mono, color: "#fbbf24" }}>
                      Showing cached stock — data from last online session. Numbers reflect offline sales not yet synced.
                    </span>
                  </div>
                )}
                {!isOnline && stock.length === 0 && (
                  <div style={{ textAlign: "center", padding: "60px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16, marginBottom: 24 }}>
                    <div style={{ fontSize: 40, opacity: 0.3, marginBottom: 12 }}>📵</div>
                    <div style={{ color: theme.text.muted, fontSize: 14, fontFamily: theme.font.mono }}>No cached stock data available</div>
                    <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono, marginTop: 6, opacity: 0.6 }}>Connect to the internet to load stock information</div>
                  </div>
                )}

                  {stock.length > 0 && (
                    <div style={{ position: "relative", marginBottom: 16 }}>
                      <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.4 }}>🔍</span>
                      <input
                        type="text"
                        value={stockSearch}
                        onChange={e => setStockSearch(e.target.value)}
                        placeholder="Search by product name or SKU..."
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          background: theme.bg.card,
                          border: `1px solid ${theme.border.default}`,
                          borderRadius: 12,
                          padding: "10px 14px 10px 38px",
                          color: theme.text.primary,
                          fontFamily: theme.font.mono,
                          fontSize: 13,
                          outline: "none",
                        }}
                      />
                      {stockSearch && (
                        <button
                          onClick={() => setStockSearch("")}
                          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: theme.text.muted, cursor: "pointer", fontSize: 14, padding: 4 }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
              
                {filteredStock.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16 }}>
                    {stockSearch ? (
                          <>
                            <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 14 }}>🔍</div>
                            <div style={{ color: theme.text.muted, fontSize: 14, fontFamily: theme.font.mono }}>No products match "{stockSearch}"</div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 14 }}>📦</div>
                            <div style={{ color: theme.text.muted, fontSize: 14, fontFamily: theme.font.mono }}>No products assigned to this shop yet</div>
                            <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono, marginTop: 6, opacity: 0.6 }}>Contact your supervisor to assign stock</div>
                          </>
                        )}
                    <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 14 }}>📦</div>
                    <div style={{ color: theme.text.muted, fontSize: 14, fontFamily: theme.font.mono }}>No products assigned to this shop yet</div>
                    <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono, marginTop: 6, opacity: 0.6 }}>Contact your supervisor to assign stock</div>
                  </div>
                  ) 
                : (
                  <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16, overflow: "hidden" }}>
                    {!isMobile && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 90px 90px 90px", gap: 12, padding: "12px 20px", borderBottom: `1px solid ${theme.border.default}`, background: "rgba(255,255,255,0.02)" }}>
                        {["Product", "Unit Price", "Allocated", "Remaining", "Sold"].map(h => (
                          <div key={h} style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</div>
                        ))}
                      </div>
                    )}
                           {filteredStock.length === 0 ? (
  <div style={{ textAlign: "center", padding: "60px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16 }}>
    {stockSearch ? (
      <>
        <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 14 }}>🔍</div>
        <div style={{ color: theme.text.muted, fontSize: 14, fontFamily: theme.font.mono }}>No products match "{stockSearch}"</div>
      </>
    ) : (
      <>
        <div style={{ fontSize: 48, opacity: 0.2, marginBottom: 14 }}>📦</div>
        <div style={{ color: theme.text.muted, fontSize: 14, fontFamily: theme.font.mono }}>No products assigned to this shop yet</div>
        <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono, marginTop: 6, opacity: 0.6 }}>Contact your supervisor to assign stock</div>
      </>
    )}
  </div>
) : (
  <div style={{
    display: "grid",
    gridTemplateColumns: isWide ? "repeat(2, minmax(0, 1fr))" : "1fr",
    gap: 12,
  }}>
    {filteredStock.map(item => {
      const sold = item.allocated - item.remaining;
      const pct  = item.allocated > 0 ? Math.round((item.remaining / item.allocated) * 100) : 0;
      const sc   = item.remaining === 0 ? theme.accent.red : pct <= 20 ? theme.accent.gold : theme.accent.green;
      const isExpanded = expandedId === item.product.id;
      const history    = txHistory[item.product.id];
      const isLoading  = txLoading.has(item.product.id);

      return (
        <div
          key={item.id}
          onClick={() => toggleExpand(item.product.id)}
          style={{
            background: theme.bg.card,
            border: `1px solid ${isExpanded ? theme.accent.cyan : theme.border.default}`,
            borderRadius: 16,
            padding: 16,
            cursor: "pointer",
            transition: "border-color 0.15s ease",
          }}
        >
          {/* ── header row ── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
              <div
                className={item.product.image_url ? "thumb thumb-clickable" : "thumb"}
                onClick={e => {
                  e.stopPropagation();          // don't trigger the expand toggle
                  if (item.product.image_url) setLightbox({ url: item.product.image_url, name: item.product.name });
                }}
                style={{
                  width: 40, height: 40, borderRadius: 10, overflow: "hidden", flexShrink: 0,
                  background: "rgba(255,255,255,0.05)",
                  border: `1px solid ${theme.border.default}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, position: "relative",
                  cursor: item.product.image_url ? "zoom-in" : "default",
                }}
              >
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>📦</span>
                {item.product.image_url && (
                  <img
                    src={item.product.image_url} alt=""
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                  />
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>{item.product.name}</div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                  {item.product.sku} · {item.product.unit}
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 24, color: sc, lineHeight: 1 }}>{item.remaining}</div>
              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{item.product.unit} left</div>
            </div>
          </div>

          {/* ── progress ── */}
          <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ width: `${pct}%`, height: "100%", borderRadius: 4, background: sc, transition: "width 0.8s ease" }} />
          </div>

          {/* ── mini stats ── */}
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

          {/* ── expanded: allocation + recent transactions ── */}
          {isExpanded && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${theme.border.default}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Recent Transactions
                </div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                  {isLoading ? "loading…" : history ? `${history.length} found` : ""}
                </div>
              </div>

              {isLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
                  <div style={{ width: 18, height: 18, border: "2px solid rgba(6,182,212,0.2)", borderTopColor: theme.accent.cyan, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                </div>
              ) : history && history.length > 0 ? (
                <div>
                  {history.map((t, idx) => (
                    <div
                    key={t.id ?? idx}
                      style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "8px 0",
                        borderBottom: idx < history.length - 1 ? `1px solid ${theme.border.default}` : "none",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontFamily: theme.font.mono }}>
                          {t.quantity} × {fmt(Number(t.unit_price ?? 0))}
                        </div>
                        <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                          {t.created_at ? new Date(t.created_at).toLocaleString() : "—"}
                          {t.agent_name ? ` · ${t.agent_name}` : ""}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                        <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 13, color: theme.accent.green }}>
                        {fmt(Number(t.amount ?? 0))}
                        </div>
                        <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                          {t.payment_method
                            || (Number(t.mpesa_amount) > 0 ? "M-Pesa" : Number(t.cash_amount) > 0 ? "Cash" : "—")}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "14px 0", fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted }}>
                  No recent transactions for this product
                </div>
              )}

              {/* Allocation summary */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
                {[
                  { label: "Allocated", value: String(item.allocated), color: theme.text.primary },
                  { label: "Sold",      value: String(sold),           color: theme.accent.green },
                  { label: "Remaining", value: String(item.remaining), color: sc },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 8, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 13, color }}>{value}</div>
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

    {/* ══ IMAGE LIGHTBOX ══ */}
{lightbox && (
  <div
    onClick={() => setLightbox(null)}
    style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.85)",
      backdropFilter: "blur(6px)",
      WebkitBackdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: isMobile ? 16 : 40,
      animation: "fadeIn 0.18s ease both",
    }}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: "relative",
        display: "flex", flexDirection: "column", alignItems: "center",
        maxWidth: "100%",
        animation: "zoomIn 0.2s ease both",
      }}
    >
      {/* ✕ anchored to the image, not the screen */}
      <button
        onClick={e => { e.stopPropagation(); setLightbox(null); }}
        aria-label="Close image"
        style={{
          position: "absolute",
          top: -12, right: -12,
          width: 32, height: 32, borderRadius: "50%",
          background: "rgba(20,20,20,0.9)",
          border: "1px solid rgba(255,255,255,0.28)",
          color: "#fff", fontSize: 14, lineHeight: 1,
          cursor: "pointer", zIndex: 2,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
        }}
      >✕</button>

      <img
        src={lightbox.url}
        alt={lightbox.name}
        style={{
          maxWidth: isMobile ? "100%" : "min(560px, 55vw)",
          maxHeight: isMobile ? "48vh" : "56vh",
          width: "auto", height: "auto",
          objectFit: "contain",
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.14)",
          background: theme.bg.card,
          display: "block",
          boxShadow: "0 24px 70px rgba(0,0,0,0.65)",
        }}
      />

      {/* Product name only — no helper text */}
      <div style={{
        marginTop: 12,
        fontFamily: theme.font.display, fontWeight: 700,
        fontSize: isMobile ? 14 : 16, color: "#fff",
        textAlign: "center",
      }}>
        {lightbox.name}
      </div>
    </div>
  </div>
)}
    </div>
  );
}