// pages/PosShopInfo.tsx
// Shows shop stock and assigned agents

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import { useNetwork } from "../context/NetworkContext";
import { supabase, productImageUrl } from "../lib/supabase";
import { getQueue } from "../lib/offlineQueue";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";


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

// ── Custom themed select (avoids Android's native radio picker) ──
interface CustomSelectOption {
  value: string;
  label: string;
  code?: string;
  badge?: string;
  badgeColor?: string;
}

function CustomSelect({
  value, onChange, options, placeholder, theme, isDark,
}: {
  value: string;
  onChange: (v: string) => void;
  options: CustomSelectOption[];
  placeholder: string;
  theme: any;
  isDark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const selected = options.find(o => o.value === value);
  const panelBg     = isDark ? "#111827" : "#ffffff";
  const panelBorder = "rgba(6,182,212,0.32)";
  const panelShadow = isDark ? "0 16px 48px rgba(0,0,0,0.6)" : "0 8px 28px rgba(0,0,0,0.14)";
  const triggerBg   = isDark ? "rgba(255,255,255,0.06)" : "rgba(6,182,212,0.06)";
  const hoverBg     = isDark ? "rgba(255,255,255,0.07)" : "rgba(6,182,212,0.07)";

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
          background: triggerBg,
          border: `1px solid ${open ? "rgba(6,182,212,0.55)" : value ? "rgba(6,182,212,0.38)" : theme.border.default}`,
          borderRadius: 9, padding: "12px 14px",
          color: selected ? theme.text.primary : theme.text.muted,
          fontFamily: theme.font.mono, fontSize: 13,
          cursor: "pointer", textAlign: "left", boxSizing: "border-box",
          boxShadow: open ? "0 0 0 3px rgba(6,182,212,0.12)" : "none",
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
      >
        <div style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {selected ? (
            <>
              <span style={{ fontWeight: 700, fontFamily: theme.font.display, fontSize: 14, color: theme.text.primary }}>{selected.label}</span>
              {selected.code && <span style={{ color: theme.text.muted, fontSize: 11, marginLeft: 6 }}>({selected.code})</span>}
            </>
          ) : (
            <span style={{ color: theme.text.muted }}>{placeholder}</span>
          )}
        </div>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, color: theme.text.muted, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 9999,
          minWidth: "min(300px, calc(100vw - 56px))",
          background: panelBg,
          border: `1px solid ${panelBorder}`,
          borderRadius: 10,
          boxShadow: panelShadow,
          maxHeight: "min(220px, 38vh)", overflowY: "auto",
        }}>
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            style={{
              width: "100%", padding: "11px 14px", textAlign: "left",
              background: !value ? "rgba(6,182,212,0.1)" : "transparent",
              border: "none", borderBottom: `1px solid ${theme.border.default}`,
              color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 12, cursor: "pointer",
            }}
          >
            {placeholder}
          </button>

          {options.map(opt => {
            const isSel = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  width: "100%", padding: "11px 14px", textAlign: "left",
                  background: isSel ? "rgba(6,182,212,0.12)" : "transparent",
                  border: "none", borderBottom: `1px solid ${theme.border.default}`,
                  color: theme.text.primary,
                  fontFamily: theme.font.mono, fontSize: 13,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 10,
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = hoverBg; }}
                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span style={{
                  flexShrink: 0, width: 8, height: 8, borderRadius: "50%",
                  background: isSel ? "#06b6d4" : (isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"),
                  boxShadow: isSel ? "0 0 6px rgba(6,182,212,0.7)" : "none",
                }} />
                <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontFamily: theme.font.display, fontSize: 14, color: theme.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {opt.label}
                    {opt.code && <span style={{ fontWeight: 400, color: theme.text.muted, fontSize: 11, marginLeft: 6 }}>({opt.code})</span>}
                  </div>
                  {opt.badge && (
                    <div style={{ fontSize: 11, marginTop: 2, color: opt.badgeColor ?? "#f59e0b" }}>{opt.badge}</div>
                  )}
                </div>
                {isSel && <span style={{ color: "#06b6d4", fontSize: 16, flexShrink: 0, fontWeight: 700 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Invoice product picker (multi-select modal) ──
function InvoiceProductPicker({
  products, addedIds, onAdd, theme, isDark,
}: {
  products: { id: string; name: string; price: number; sku?: string; remaining?: number; unit?: string }[];
  addedIds: Set<string>;
  onAdd: (ids: string[]) => void;
  theme: any;
  isDark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = products.filter(p =>
    !q || p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q)
  );

  const toggle = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    onAdd([...checked]);
    setChecked(new Set());
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative", width: "100%", marginBottom: 14 }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", border: `1px solid ${theme.border.default}`, borderRadius: 8, background: theme.bg.card, color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 13, cursor: "pointer" }}>
        <span>{checked.size > 0 ? `${checked.size} selected` : "+ Add products…"}</span>
        <span style={{ fontSize: 14 }}>🔍</span>
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.5)" }} />
          <div style={{
            position: "fixed", zIndex: 9999,
            top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            width: "min(420px, calc(100vw - 32px))",
            maxHeight: "min(70vh, 480px)",
            background: theme.bg.card, border: `1px solid ${theme.accent.cyan}55`,
            borderRadius: 12, boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            <div style={{ padding: 10, borderBottom: `1px solid ${theme.border.default}` }}>
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search products…"
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: theme.bg.input, border: `1px solid ${theme.border.default}`,
                  borderRadius: 8, padding: "10px 12px",
                  color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none",
                }}
              />
            </div>

            <div style={{ overflowY: "auto", flex: 1 }}>
              {filtered.length === 0 ? (
                <div style={{ padding: 16, textAlign: "center", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 12 }}>
                  No products match
                </div>
              ) : filtered.map(p => {
                const isChecked = checked.has(p.id);
                const alreadyAdded = addedIds.has(p.id);
                return (
                  <button key={p.id} type="button" disabled={alreadyAdded}
                    onClick={() => toggle(p.id)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "none", borderBottom: `1px solid ${theme.border.default}`, background: isChecked ? "rgba(6,182,212,0.1)" : "transparent", cursor: alreadyAdded ? "not-allowed" : "pointer", opacity: alreadyAdded ? 0.4 : 1, textAlign: "left" }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                      border: `2px solid ${isChecked ? theme.accent.cyan : (isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.3)")}`,
                      background: isChecked ? theme.accent.cyan : (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)"),
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isChecked && <span style={{ color: "#000", fontSize: 12, fontWeight: 800, lineHeight: 1 }}>✓</span>}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, color: theme.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <span style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, flexShrink: 0 }}>
                      {alreadyAdded ? "Added" : `KSh ${p.price.toLocaleString()}`}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ padding: 10, borderTop: `1px solid ${theme.border.default}` }}>
              <button type="button" onClick={handleAdd} disabled={checked.size === 0}
                style={{ width: "100%", padding: "9px 0", borderRadius: 8, border: "none", background: checked.size === 0 ? "rgba(6,182,212,0.25)" : "linear-gradient(135deg,#06b6d4,#0891b2)", color: "#fff", fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, cursor: checked.size === 0 ? "not-allowed" : "pointer" }}>
                Add {checked.size > 0 ? checked.size : ""} product{checked.size === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function PosShopInfo() {
  const { shop } = useShopAuth();
  const { theme, isDark } = useTheme();
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


  // ── Invoice state ──
const [showInvoiceModal, setShowInvoiceModal] = useState(false);
const [invoiceSharing, setInvoiceSharing] = useState(false);
const [invoiceShareMsg, setInvoiceShareMsg] = useState<string | null>(null);
const [invoiceItems, setInvoiceItems] = useState<{ product_id: string; name: string; price: number; unit: string; qty: number }[]>([]);
const [customerName, setCustomerName] = useState("");
const [customerPhone, setCustomerPhone] = useState("");
const [paymentMethod, setPaymentMethod] = useState<"pochi" | "send" | "paybill" | "till" | "custom" | "">("");
const [paymentDetails, setPaymentDetails] = useState("");
const [paymentAccount, setPaymentAccount] = useState("");

const canSharePdf = (() => {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as any;
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    const dummy = new File([new Blob(["x"])], "x.pdf", { type: "application/pdf" });
    return nav.canShare({ files: [dummy] });
  } catch {
    return false;
  }
})();

const openInvoiceModal = () => {
  setInvoiceItems([]);
  setCustomerName("");
  setCustomerPhone("");
  setPaymentMethod("pochi");
  setPaymentDetails("");
  setPaymentAccount("");
  setShowInvoiceModal(true);
};

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

  const generateInvoicePdf = (): { doc: jsPDF; filename: string } | null => {
    if (invoiceItems.length === 0) return null;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  
    const biz = shop?.name ?? "Shop";
    const ownerPhone = (shop as any)?.phone || "";
    const now = new Date();
    const invoiceNo = `INV-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}-${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}`;
  
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text(biz, 14, 18);
    if (shop?.shop_code) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(140);
      doc.text(`Shop: ${shop.shop_code}`, 14, 23);
    }
  
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(`Invoice #${invoiceNo}`, 14, 30);
    doc.text(`Date: ${now.toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}`, 14, 35);
  
    let cursorY = 43;
    if (customerName) {
      doc.setTextColor(0);
      doc.text(`Billed to: ${customerName}${customerPhone ? " · " + customerPhone : ""}`, 14, cursorY);
      cursorY += 6;
    }
  
    // Payment display
    let paymentDisplay = "";
    if (paymentMethod === "custom") {
      paymentDisplay = paymentDetails || "Custom payment";
    } else if (paymentMethod) {
      const methodLabels: Record<string, string> = {
        pochi: "Pochi La Biashara",
        send: "Send to Number",
        paybill: "Paybill",
        till: "Till Number",
      };
      const methodLabel = methodLabels[paymentMethod] || paymentMethod;
      if (paymentMethod === "paybill") {
        const parts: string[] = [];
        if (paymentDetails.trim()) parts.push(paymentDetails.trim());
        if (paymentAccount.trim()) parts.push(`Acc: ${paymentAccount.trim()}`);
        paymentDisplay = parts.length ? `${methodLabel} - ${parts.join(" · ")}` : methodLabel;
      } else {
        paymentDisplay = paymentDetails.trim() ? `${methodLabel} - ${paymentDetails}` : methodLabel;
      }
    }
  
    const startY = cursorY;
    const rows = invoiceItems.map((it, i) => [
      String(i + 1), it.name, String(it.qty), it.unit,
      `KSh ${it.price.toLocaleString()}`,
      `KSh ${(it.price * it.qty).toLocaleString()}`,
    ]);
    const total = invoiceItems.reduce((s, it) => s + it.price * it.qty, 0);
  
    autoTable(doc, {
      startY,
      head: [["#", "Product", "Qty", "Unit", "Unit Price", "Total"]],
      body: rows,
      styles: { fontSize: 10, cellPadding: 4 },
      headStyles: { fillColor: [15, 40, 80], textColor: 255 },
      columnStyles: { 4: { halign: "right" }, 5: { halign: "right" } },
    });
  
    const pageWidth = doc.internal.pageSize.getWidth();
    const finalY = (doc as any).lastAutoTable.finalY + 8;
    const boxW = 60, boxH = 10, boxX = pageWidth - 14 - boxW, boxY = finalY;
  
    doc.setFillColor(15, 40, 80);
    doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("GRAND TOTAL", boxX + 5, boxY + 7);
    doc.setFontSize(11);
    doc.text(`KSh ${total.toLocaleString()}`, boxX + boxW - 5, boxY + 7.3, { align: "right" });
  
    // Payment panel
    const panelX = 14, panelY = boxY, panelW = boxX - panelX - 6, panelH = 18;
    if (paymentDisplay) {
      doc.setFillColor(236, 254, 255);
      doc.setDrawColor(6, 182, 212);
      doc.setLineWidth(0.4);
      doc.roundedRect(panelX, panelY, panelW, panelH, 2, 2, "FD");
      doc.setFillColor(6, 182, 212);
      doc.rect(panelX, panelY, 1.4, panelH, "F");
      doc.setTextColor(8, 145, 178);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text("PAYMENT DETAILS", panelX + 5, panelY + 5.5);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12.5);
      doc.setTextColor(15, 23, 42);
      const wrapped = doc.splitTextToSize(paymentDisplay, panelW - 10);
      doc.text(wrapped.slice(0, 2), panelX + 5, panelY + 12.5);
    }
  
    const footerTop = boxY + Math.max(boxH, panelH) + 12;
    const thankYou = "Thank You For Doing Business With Us";
    doc.setFont("helvetica", "bolditalic");
    doc.setFontSize(15);
    doc.setTextColor(15, 40, 80);
    const tyW = doc.getTextWidth(thankYou);
    doc.text(thankYou, (pageWidth - tyW) / 2, footerTop);
  
    if (ownerPhone) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10.5);
      doc.setTextColor(90, 90, 90);
      const contact = `Give us a call or contact us through: ${ownerPhone}`;
      const cW = doc.getTextWidth(contact);
      doc.text(contact, (pageWidth - cW) / 2, footerTop + 7);
    }
  
    return { doc, filename: `${invoiceNo}.pdf` };
  };
  
  const handleDownloadInvoice = () => {
    const result = generateInvoicePdf();
    if (!result) return;
    result.doc.save(result.filename);
    setShowInvoiceModal(false);
  };
  
  const handleShareInvoice = async () => {
    const result = generateInvoicePdf();
    if (!result) return;
    const blob = result.doc.output("blob");
    const file = new File([blob], result.filename, { type: "application/pdf" });
  
    const canShareFiles =
      typeof navigator !== "undefined" &&
      typeof (navigator as any).canShare === "function" &&
      (navigator as any).canShare({ files: [file] });
  
    if (!canShareFiles) {
      result.doc.save(result.filename);
      setInvoiceShareMsg("Sharing isn't available on this device — the PDF was downloaded instead.");
      return;
    }
  
    setInvoiceSharing(true);
    setInvoiceShareMsg(null);
    try {
      await (navigator as any).share({
        files: [file],
        title: `Invoice ${result.filename}`,
        text: `Invoice from ${shop?.name ?? "us"}`,
      });
      setShowInvoiceModal(false);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      result.doc.save(result.filename);
      setInvoiceShareMsg("Couldn't open the share sheet — the PDF was downloaded instead.");
    } finally {
      setInvoiceSharing(false);
    }
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
<div style={{
  borderBottom: `1px solid ${theme.border.default}`,
  padding: isMobile ? "14px 16px" : "20px 40px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
}}>
  <div style={{ minWidth: 0 }}>
    <div style={{
      fontFamily: theme.font.display,
      fontWeight: 800,
      fontSize: isMobile ? 18 : 22,
    }}>
      Shop Info
    </div>
    <div style={{
      fontSize: 11,
      fontFamily: theme.font.mono,
      color: theme.text.muted,
      marginTop: 2,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }}>
      {shop?.name} · {shop?.shop_code}
    </div>
  </div>

  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
    <button
      onClick={openInvoiceModal}
      style={{
        background: "rgba(234,179,8,0.1)",
        border: "1px solid rgba(234,179,8,0.3)",
        borderRadius: 9,
        padding: isMobile ? "7px 10px" : "8px 14px",
        color: theme.accent.gold,
        fontFamily: theme.font.mono,
        fontSize: isMobile ? 11 : 12,
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 5,
        whiteSpace: "nowrap",
      }}
    >
      🧾 {isMobile ? "" : "Invoice"}
    </button>

    <button
      onClick={() => { fetchInfo(); fetchStats(); }}
      style={{
        background: "rgba(6,182,212,0.08)",
        border: "1px solid rgba(6,182,212,0.2)",
        borderRadius: 9,
        padding: isMobile ? "7px 10px" : "8px 14px",
        color: theme.accent.cyan,
        fontFamily: theme.font.mono,
        fontSize: isMobile ? 11 : 12,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      ↺ {isMobile ? "" : "Refresh"}
    </button>
  </div>
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

{/* ══ INVOICE MODAL ══ */}
{showInvoiceModal && (
  <div
    onClick={() => setShowInvoiceModal(false)}
    style={{
      position: "fixed", inset: 0, zIndex: 1200,
      background: "rgba(0,0,0,0.8)",
      backdropFilter: "blur(6px)",
      WebkitBackdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: isMobile ? 8 : 20,
      animation: "fadeIn 0.18s ease both",
    }}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{
        background: theme.bg.card,
        border: `1px solid ${theme.border.default}`,
        borderRadius: 16,
        padding: isMobile ? 16 : 22,
        maxWidth: 560,
        width: "100%",
        maxHeight: "94vh",
        overflowY: "auto",
        boxSizing: "border-box",
        animation: "zoomIn 0.2s ease both",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 20 }}>
            Customer Invoice
          </div>
          <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 3 }}>
            {shop?.name} · {shop?.shop_code}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowInvoiceModal(false)}
          aria-label="Close"
          style={{
            width: 30, height: 30, borderRadius: 8,
            border: `1px solid ${theme.border.default}`,
            background: theme.bg.input, color: theme.text.muted,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15, lineHeight: 1, padding: 0, flexShrink: 0,
          }}
        >✕</button>
      </div>

      {/* Customer fields */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexDirection: isMobile ? "column" : "row" }}>
        <input
          className=""
          placeholder="Customer name (optional)"
          value={customerName}
          onChange={e => setCustomerName(e.target.value)}
          style={{
            flex: 1, background: theme.bg.input, border: `1px solid ${theme.border.default}`,
            borderRadius: 8, padding: "12px 14px", color: theme.text.primary,
            fontFamily: theme.font.mono, fontSize: 13, outline: "none",
          }}
        />
        <input
          placeholder="Customer Phone (optional)"
          value={customerPhone}
          onChange={e => setCustomerPhone(e.target.value)}
          style={{
            flex: 1, background: theme.bg.input, border: `1px solid ${theme.border.default}`,
            borderRadius: 8, padding: "12px 14px", color: theme.text.primary,
            fontFamily: theme.font.mono, fontSize: 13, outline: "none",
          }}
        />
      </div>

      {/* Payment method */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ color: theme.text.secondary, fontSize: 11, fontFamily: theme.font.mono, letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
          Payment Method (optional)
        </label>

        <div style={{ marginBottom: 10 }}>
          <CustomSelect
            value={paymentMethod}
            onChange={v => setPaymentMethod(v as any)}
            placeholder="— Select Payment Method —"
            theme={theme}
            isDark={isDark}
            options={[
              { value: "pochi", label: "Pochi La Biashara" },
              { value: "send",  label: "Send to Number" },
              { value: "paybill", label: "Paybill" },
              { value: "till",  label: "Till Number" },
              { value: "custom", label: "Custom" },
            ]}
          />
        </div>

        {paymentMethod === "custom" ? (
          <input
            placeholder="Enter full payment instructions"
            value={paymentDetails}
            onChange={e => setPaymentDetails(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 8, padding: "12px 14px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none" }}
          />
        ) : paymentMethod === "paybill" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              placeholder="Paybill number, e.g., 3213248"
              value={paymentDetails}
              onChange={e => setPaymentDetails(e.target.value)}
              inputMode="numeric"
              style={{ width: "100%", boxSizing: "border-box", background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 8, padding: "12px 14px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none" }}
            />
            <div style={{ background: "rgba(6,182,212,0.05)", border: "1px dashed rgba(6,182,212,0.4)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.accent.cyan, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>
                ＋ Account Number Required
              </div>
              <input
                placeholder="Enter account number, e.g., 547352"
                value={paymentAccount}
                onChange={e => setPaymentAccount(e.target.value)}
                inputMode="numeric"
                style={{ width: "100%", boxSizing: "border-box", background: theme.bg.input, border: "1px solid rgba(6,182,212,0.35)", borderRadius: 8, padding: "12px 14px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none" }}
              />
            </div>
          </div>
        ) : (
          <input
            placeholder="Enter payment number/account (optional)"
            value={paymentDetails}
            onChange={e => setPaymentDetails(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 8, padding: "12px 14px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none" }}
          />
        )}
      </div>

      {/* Product picker */}
      <InvoiceProductPicker
        products={stock.map(s => ({
          id: s.product.id,
          name: s.product.name,
          price: s.product.price,
          sku: s.product.sku,
          unit: s.product.unit,
          remaining: s.remaining,
        }))}
        addedIds={new Set(invoiceItems.map(it => it.product_id))}
        theme={theme}
        isDark={isDark}
        onAdd={(ids) => {
          setInvoiceItems(prev => {
            const toAdd = ids
              .filter(id => !prev.some(it => it.product_id === id))
              .map(id => {
                const s = stock.find(x => x.product.id === id)!;
                return {
                  product_id: s.product.id,
                  name: s.product.name,
                  price: s.product.price,
                  unit: s.product.unit,
                  qty: 1,
                };
              });
            return [...prev, ...toAdd];
          });
        }}
      />

      {/* Invoice items list */}
      {invoiceItems.length === 0 ? (
        <div style={{ textAlign: "center", padding: "20px 0", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 12 }}>
          No items added yet
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase" }}>
            <span style={{ flex: 1 }}>Product</span>
            <span style={{ width: 50, textAlign: "center" }}>Qty</span>
            <span style={{ width: 80, textAlign: "center" }}>Price</span>
            <span style={{ width: 80, textAlign: "right" }}>Total</span>
            <span style={{ width: 16 }} />
          </div>

          {invoiceItems.map((it, i) => (
            <div key={it.product_id} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px" }}>
              <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
              <input
                type="number" min={1} value={it.qty}
                style={{ width: 50, background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 6, padding: "6px 4px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 12, textAlign: "center", outline: "none" }}
                onChange={e => setInvoiceItems(prev => prev.map((x, idx) => idx === i ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x))}
              />
              <input
                type="number" min={0} value={it.price}
                style={{ width: 80, background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 6, padding: "6px 4px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 12, textAlign: "center", outline: "none" }}
                onChange={e => setInvoiceItems(prev => prev.map((x, idx) => idx === i ? { ...x, price: Math.max(0, Number(e.target.value)) } : x))}
              />
              <span style={{ width: 80, textAlign: "right", fontFamily: theme.font.mono, fontSize: 12, fontWeight: 700 }}>
                KSh {(it.price * it.qty).toLocaleString()}
              </span>
              <button onClick={() => setInvoiceItems(prev => prev.filter((_, idx) => idx !== i))}
                style={{ width: 16, background: "none", border: "none", color: "#f87171", cursor: "pointer" }}>
                ✕
              </button>
            </div>
          ))}

          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: theme.font.mono, fontWeight: 700, borderTop: `1px solid ${theme.border.default}`, paddingTop: 8 }}>
            <span>Total</span>
            <span>KSh {invoiceItems.reduce((s, it) => s + it.price * it.qty, 0).toLocaleString()}</span>
          </div>
        </div>
      )}

      {invoiceShareMsg && (
        <div style={{
          marginBottom: 12, padding: "10px 12px",
          background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)",
          borderRadius: 8, fontSize: 11, fontFamily: theme.font.mono,
          color: theme.accent.gold, lineHeight: 1.5,
        }}>
          {invoiceShareMsg}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={handleDownloadInvoice}
          disabled={invoiceItems.length === 0 || invoiceSharing}
          style={{
            flex: 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            background: invoiceItems.length === 0 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.05)",
            border: `1px solid ${invoiceItems.length === 0 ? theme.border.default : "rgba(255,255,255,0.14)"}`,
            borderRadius: 10, padding: "13px 0",
            color: invoiceItems.length === 0 ? theme.text.muted : theme.text.primary,
            fontFamily: theme.font.display, fontWeight: 700, fontSize: 14,
            cursor: invoiceItems.length === 0 ? "not-allowed" : "pointer",
            opacity: invoiceSharing ? 0.5 : 1,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </button>

        {canSharePdf && (
          <button
            onClick={handleShareInvoice}
            disabled={invoiceItems.length === 0 || invoiceSharing}
            style={{
              flex: 1.2,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              background: invoiceItems.length === 0 || invoiceSharing
                ? "rgba(234,179,8,0.35)"
                : "linear-gradient(135deg,#eab308,#d97706)",
              border: "none", borderRadius: 10, padding: "13px 0",
              color: "#fff", fontFamily: theme.font.display, fontWeight: 700, fontSize: 14,
              cursor: invoiceItems.length === 0 || invoiceSharing ? "not-allowed" : "pointer",
              boxShadow: invoiceItems.length === 0 || invoiceSharing ? "none" : "0 4px 14px rgba(234,179,8,0.3)",
              opacity: invoiceSharing ? 0.8 : 1,
            }}
          >
            {invoiceSharing ? (
              <>
                <span style={{
                  width: 13, height: 13,
                  border: "2px solid rgba(255,255,255,0.35)", borderTopColor: "#fff",
                  borderRadius: "50%", display: "inline-block",
                  animation: "spin 0.7s linear infinite",
                }} />
                Opening…
              </>
            ) : (
              <>📤 Share</>
            )}
          </button>
        )}
      </div>
    </div>
  </div>
)}
    </div>
  );
}