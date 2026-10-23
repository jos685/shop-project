// pages/PosShopInfo.tsx
// Shows shop stock and assigned agents

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import { useNetwork } from "../context/NetworkContext";
import { supabase, productImageUrl } from "../lib/supabase";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  BarChart2, ClipboardList, History, PlusCircle, PackagePlus,
  Send, RotateCcw, Pencil,  Store, ShoppingCart,
  AlertTriangle, Trash2,
} from "lucide-react";

const LOG_PAGE_SIZE = 12; // for activity log pagination
const TX_PAGE_SIZE  = 12;   // for recent transactions pagination



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
    id: string; name: string; sku: string; price: number; unit: string; image_url?: string | null;
    batch_label?: string | null;   
    expiry_date?: string | null;    
  };
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

const getExpiryInfo = (dateStr: string | null | undefined) => {
  if (!dateStr) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(dateStr); d.setHours(0,0,0,0);
  const days = Math.round((d.getTime() - now.getTime()) / 86400000);
  
  if (days < 0)   return { label: "EXPIRED", color: "#f87171", bg: "rgba(248,113,113,0.15)", border: "rgba(248,113,113,0.3)" };
  if (days <= 30) return { label: `${days}d left`, color: "#fb923c", bg: "rgba(251,146,60,0.15)", border: "rgba(251,146,60,0.3)" };
  if (days <= 90) return { label: `${days}d left`, color: "#fbbf24", bg: "rgba(251,191,36,0.15)", border: "rgba(251,191,36,0.3)" };
  return null;
};

export default function PosShopInfo() {
  const { shop } = useShopAuth();
  const { theme, isDark } = useTheme();
  const { isOnline } = useNetwork();
  const location = useLocation();
  const width = useWindowWidth();
  const isMobile = width < 640;
  const isWide   = width >= 1024; 

    const [expiryTracking, setExpiryTracking] = useState(false);

  // ── Per-product tab: breakdown (transactions) | log (activity) ──
    const [activeTab,   setActiveTab]   = useState<Record<string, "tx" | "log">>({});
    const [activityLog, setActivityLog] = useState<Record<string, any[]>>({});
    const [loadingLog,  setLoadingLog]  = useState<string | null>(null);
    const [logPage,     setLogPage]     = useState<Record<string, number>>({});
    const [txPage,      setTxPage]      = useState<Record<string, number>>({});

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
  const [stockPage, setStockPage] = useState(1);
  const STOCK_PAGE_SIZE = 20;

  useEffect(() => { setStockPage(1); }, [stockSearch]);
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


// ── Custom (non-stock) invoice items ─────────────────────
const [showCustomItemForm, setShowCustomItemForm] = useState(false);
const [customItemName,  setCustomItemName]  = useState("");
const [customItemPrice, setCustomItemPrice] = useState("");
const [customItemUnit,  setCustomItemUnit]  = useState("pcs");
const [customItemQty,   setCustomItemQty]   = useState("1");
const [customItemError, setCustomItemError] = useState("");

// ── Invoice tabs + saved-invoice history ─────────────────
const [invoiceTab, setInvoiceTab] = useState<"create" | "history">("create");
const [currentInvoiceNumber, setCurrentInvoiceNumber] = useState("");
const [savedInvoices, setSavedInvoices] = useState<any[]>([]);
const [invoiceHistoryLoading, setInvoiceHistoryLoading] = useState(false);
const [invoiceHistoryError, setInvoiceHistoryError] = useState<string | null>(null);
const [invoiceHistoryPage, setInvoiceHistoryPage] = useState(1);
const [invoiceHistoryTotal, setInvoiceHistoryTotal] = useState(0);
const [confirmDeleteInvoice, setConfirmDeleteInvoice] = useState<any | null>(null);
const [deletingInvoice, setDeletingInvoice] = useState(false);
const [deleteInvoiceError, setDeleteInvoiceError] = useState<string | null>(null);
const INVOICES_PAGE_SIZE = 10;

// ── Invoice detail / edit ──────────────────────────────────
const [viewingInvoice, setViewingInvoice] = useState<any | null>(null);
const [editInvoiceItems, setEditInvoiceItems] = useState<{
  product_id?: string; name: string; price: number; unit: string; qty: number;
}[]>([]);
const [editCustomerName,    setEditCustomerName]    = useState("");
const [editCustomerPhone,   setEditCustomerPhone]   = useState("");
const [editPaymentMethod,   setEditPaymentMethod]   = useState<"pochi" | "send" | "paybill" | "till" | "custom" | "">("");
const [editPaymentDetails,  setEditPaymentDetails]  = useState("");
const [editPaymentAccount,  setEditPaymentAccount]  = useState("");
const [savingInvoiceEdit,   setSavingInvoiceEdit]   = useState(false);
const [invoiceEditError,    setInvoiceEditError]    = useState<string | null>(null);
const [invoiceEditMsg,      setInvoiceEditMsg]      = useState<string | null>(null);

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

// ── Generate a fresh invoice number ─────────────────────
const makeInvoiceNumber = () => {
  const n = new Date();
  return `INV-${n.getFullYear()}${String(n.getMonth()+1).padStart(2,"0")}${String(n.getDate()).padStart(2,"0")}`
       + `-${String(n.getHours()).padStart(2,"0")}${String(n.getMinutes()).padStart(2,"0")}${String(n.getSeconds()).padStart(2,"0")}`;
};

const openInvoiceModal = () => {
  setInvoiceItems([]);
  setCustomerName("");
  setCustomerPhone("");
  setPaymentMethod("");
  setPaymentDetails("");
  setPaymentAccount("");
  setInvoiceShareMsg(null);

  // Reset the custom-item form
  setShowCustomItemForm(false);
  setCustomItemName("");
  setCustomItemPrice("");
  setCustomItemUnit("pcs");
  setCustomItemQty("1");
  setCustomItemError("");

  // Always open on the Create tab with a fresh number
  setInvoiceTab("create");
  setCurrentInvoiceNumber(makeInvoiceNumber());
  setViewingInvoice(null);
  setEditInvoiceItems([]);
  setInvoiceEditError(null);
  setInvoiceEditMsg(null);

  setShowInvoiceModal(true);
};

// ── Add a custom (non-stock) item to the invoice ─────────
const addCustomItem = () => {
  const name  = customItemName.trim();
  const price = Number(customItemPrice);
  const qty   = Number(customItemQty);
  const unit  = customItemUnit.trim() || "pcs";

  if (!name)                                          { setCustomItemError("Enter an item name."); return; }
  if (!customItemPrice || isNaN(price) || price < 0)  { setCustomItemError("Enter a valid price."); return; }
  if (!customItemQty   || isNaN(qty)   || qty   < 1)  { setCustomItemError("Enter a valid quantity."); return; }

  // A unique pseudo-id — nothing needs to exist in the products table
  const customId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  setInvoiceItems(prev => [
    ...prev,
    { product_id: customId, name, price, unit, qty },
  ]);

  // Keep the panel open and clear fields — fast for multi-entry
  setCustomItemName("");
  setCustomItemPrice("");
  setCustomItemQty("1");
  setCustomItemError("");
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
       const [allocRes, shopAgentsRaw, profileRes] = await Promise.all([
        supabase.from("shop_allocations")
          .select("id, allocated, remaining, product_id, product_name, product_sku, product_price, product_unit")
          .eq("shop_id", shop.id),
        supabase.from("shop_agents")
          .select("id, pin, active, agent_id, agent_name, agent_code, agent_avatar")
          .eq("shop_id", shop.id).eq("active", true),
        supabase.from("profiles").select("enable_expiry_tracking").eq("id", shop.owner_id).single(), 
      ]);
      
      setExpiryTracking(!!(profileRes.data as any)?.enable_expiry_tracking); 

      if (allocRes.error) console.error("shop_allocations error:", allocRes.error.message);

      const productIds = (allocRes.data || []).map((a: any) => a.product_id).filter(Boolean);
      let productsMap: Record<string, any> = {};
      if (productIds.length > 0) {
        const { data: prodsData, error: prodsError } = await supabase
          .from("products")
          .select("id, name, sku, price, unit, image_url, batch_label, expiry_date") 
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
            batch_label: productsMap[a.product_id]?.batch_label || null, // 👈 Add
            expiry_date: productsMap[a.product_id]?.expiry_date || null,
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


  const loadProductTx = useCallback(async (productId: string) => {
    if (!shop || txHistory[productId]) return;
    setTxLoading(prev => new Set(prev).add(productId));
    try {
      // shop_transactions is flat — one row per product line.
      // No join table needed; every field we want is right here.
      const { data: rows, error } = await supabase.rpc("get_shop_product_transactions", {
        p_shop_id:    shop.id,
        p_product_id: productId,
        p_limit:      500,
      });

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

  const fetchLog = useCallback(async (productId: string, force = false) => {
    if (!shop) return;
    if (activityLog[productId] && !force) return;
    setLoadingLog(productId);
    try {
      const SHOP_VISIBLE_ACTIONS = [
        "assigned_to_shop",
        "shop_alloc_updated",
        "shop_sale_recorded",
        "stock_adjusted",
        "removed_from_shop",
        "shop_return_recorded",
        "shop_return_restocked",
        "shop_return_to_warehouse",
      ];
  
      const { data, error } = await supabase.rpc("get_shop_activity_log", {
        p_shop_id:    shop.id,
        p_product_id: productId,
        p_actions:    SHOP_VISIBLE_ACTIONS,
        p_limit:      1000,
      });
  
      if (error) {
        console.error("get_shop_activity_log error:", error.message);
        setActivityLog(prev => ({ ...prev, [productId]: [] }));
        return;
      }
      setActivityLog(prev => ({ ...prev, [productId]: data || [] }));
    } finally {
      setLoadingLog(null);
    }
  }, [shop, activityLog]);
  
  const toggleExpand = (productId: string) => {
    setExpandedId(prev => {
      const next = prev === productId ? null : productId;
      if (next) {
        loadProductTx(next);
        // Default the tab to transactions; only fetch the log lazily
        setActiveTab(t => ({ ...t, [next]: t[next] ?? "tx" }));
      }
      return next;
    });
  };

  // ── Core PDF builder — used by fresh + historical invoices ──
const buildInvoicePdf = (opts: {
  invoiceNumber: string;
  items: { name: string; price: number; unit: string; qty: number }[];
  customerName: string;
  customerPhone: string;
  paymentMethod: string;
  paymentDetails: string;
  paymentAccount: string;
}): { doc: jsPDF; filename: string } | null => {
  if (opts.items.length === 0) return null;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const biz        = shop?.name ?? "Shop";
  const ownerPhone = (shop as any)?.phone || "";
  const now        = new Date();
  const invoiceNo  = opts.invoiceNumber;

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
  doc.text(
    `Date: ${now.toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric" })}`,
    14, 35,
  );

  let cursorY = 43;
  if (opts.customerName) {
    doc.setTextColor(0);
    doc.text(`Billed to: ${opts.customerName}${opts.customerPhone ? " · " + opts.customerPhone : ""}`, 14, cursorY);
    cursorY += 6;
  }

  // Payment display
  let paymentDisplay = "";
  if (opts.paymentMethod === "custom") {
    paymentDisplay = opts.paymentDetails || "Custom payment";
  } else if (opts.paymentMethod) {
    const methodLabels: Record<string, string> = {
      pochi: "Pochi La Biashara",
      send:  "Send to Number",
      paybill: "Paybill",
      till:  "Till Number",
    };
    const methodLabel = methodLabels[opts.paymentMethod] || opts.paymentMethod;
    if (opts.paymentMethod === "paybill") {
      const parts: string[] = [];
      if (opts.paymentDetails.trim()) parts.push(opts.paymentDetails.trim());
      if (opts.paymentAccount.trim()) parts.push(`Acc: ${opts.paymentAccount.trim()}`);
      paymentDisplay = parts.length ? `${methodLabel} - ${parts.join(" · ")}` : methodLabel;
    } else {
      paymentDisplay = opts.paymentDetails.trim()
        ? `${methodLabel} - ${opts.paymentDetails}`
        : methodLabel;
    }
  }

  const startY = cursorY;
  const rows = opts.items.map((it, i) => [
    String(i + 1), it.name, String(it.qty), it.unit,
    `KSh ${it.price.toLocaleString()}`,
    `KSh ${(it.price * it.qty).toLocaleString()}`,
  ]);
  const total = opts.items.reduce((s, it) => s + it.price * it.qty, 0);

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

// ── Save the current invoice to history (best-effort) ────
const saveInvoiceToHistory = async (invoiceNumber: string): Promise<boolean> => {
  if (!shop || invoiceItems.length === 0) return true;
  const total = invoiceItems.reduce((s, it) => s + it.price * it.qty, 0);

  const { error } = await supabase.rpc("create_shop_invoice", {
    p_shop_id:         shop.id,
    p_owner_id:        shop.owner_id,
    p_invoice_number:  invoiceNumber,
    p_customer_name:   customerName   || null,
    p_customer_phone:  customerPhone  || null,
    p_payment_method:  paymentMethod  || null,
    p_payment_details: paymentDetails || null,
    p_payment_account: paymentAccount || null,
    p_items:           invoiceItems,
    p_total:           total,
  });

  if (error) {
    console.error("[shop invoice save] failed:", error);
    setInvoiceShareMsg(`Invoice was generated, but saving to history failed: ${error.message}`);
    return false;
  }
  return true;
};

// ── Fetch saved invoices (scoped to this shop when possible) ──
const fetchInvoiceHistory = async (page = 1) => {
  if (!shop) return;
  setInvoiceHistoryLoading(true);
  setInvoiceHistoryError(null);
  const from = (page - 1) * INVOICES_PAGE_SIZE;

  const [listRes, countRes] = await Promise.all([
    supabase.rpc("get_shop_invoices", {
      p_shop_id: shop.id,
      p_limit:   INVOICES_PAGE_SIZE,
      p_offset:  from,
    }),
    supabase.rpc("count_shop_invoices", { p_shop_id: shop.id }),
  ]);

  if (listRes.error) {
    setInvoiceHistoryError(listRes.error.message);
  } else {
    setSavedInvoices(listRes.data || []);
    setInvoiceHistoryTotal(Number(countRes.data ?? 0));
  }
  if (countRes.error) {
    console.warn("[shop invoices count] failed:", countRes.error.message);
  }
  setInvoiceHistoryLoading(false);
};

// Auto-fetch when the history tab opens or the page changes
useEffect(() => {
  if (showInvoiceModal && invoiceTab === "history") {
    fetchInvoiceHistory(invoiceHistoryPage);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [showInvoiceModal, invoiceTab, invoiceHistoryPage]);

// ── Re-download a saved invoice ─────────────────────────
const handleRedownloadInvoice = (inv: any) => {
  const result = buildInvoicePdf({
    invoiceNumber:  inv.invoice_number,
    items:          Array.isArray(inv.items) ? inv.items : [],
    customerName:   inv.customer_name   ?? "",
    customerPhone:  inv.customer_phone  ?? "",
    paymentMethod:  inv.payment_method  ?? "",
    paymentDetails: inv.payment_details ?? "",
    paymentAccount: inv.payment_account ?? "",
  });
  if (result) result.doc.save(result.filename);
};

// ── Delete a saved invoice ──────────────────────────────
const handleDeleteInvoice = async () => {
  if (!confirmDeleteInvoice || !shop) return;
  setDeletingInvoice(true);
  setDeleteInvoiceError(null);

  const { error } = await supabase.rpc("delete_shop_invoice", {
    p_shop_id:    shop.id,
    p_invoice_id: confirmDeleteInvoice.id,
  });

  setDeletingInvoice(false);
  if (error) { setDeleteInvoiceError(error.message); return; }

   if (viewingInvoice && viewingInvoice.id === confirmDeleteInvoice.id) {
   closeInvoiceDetail();
   }

  setConfirmDeleteInvoice(null);
  const remaining = invoiceHistoryTotal - 1;
  const maxPage   = Math.max(1, Math.ceil(remaining / INVOICES_PAGE_SIZE));
  const target    = Math.min(invoiceHistoryPage, maxPage);
  setInvoiceHistoryPage(target);
  fetchInvoiceHistory(target);
};

// ── Open an invoice in the detail / edit view ────────────
const openInvoiceDetail = (inv: any) => {
  setViewingInvoice(inv);
  setEditInvoiceItems(
    Array.isArray(inv.items)
      ? inv.items.map((x: any) => ({ ...x }))
      : []
  );
  setEditCustomerName(inv.customer_name   ?? "");
  setEditCustomerPhone(inv.customer_phone ?? "");
  setEditPaymentMethod((inv.payment_method as any) ?? "");
  setEditPaymentDetails(inv.payment_details ?? "");
  setEditPaymentAccount(inv.payment_account ?? "");
  setInvoiceEditError(null);
  setInvoiceEditMsg(null);
};

const closeInvoiceDetail = () => {
  setViewingInvoice(null);
  setEditInvoiceItems([]);
  setInvoiceEditError(null);
  setInvoiceEditMsg(null);
};

// ── Persist edits back to Supabase ──────────────────────
const handleSaveInvoiceEdit = async () => {
  if (!viewingInvoice || !shop) return;
  if (editInvoiceItems.length === 0) {
    setInvoiceEditError("An invoice must have at least one item.");
    return;
  }

  setSavingInvoiceEdit(true);
  setInvoiceEditError(null);
  setInvoiceEditMsg(null);

  const total = editInvoiceItems.reduce((s, it) => s + it.price * it.qty, 0);

  const { error } = await supabase.rpc("update_shop_invoice", {
    p_shop_id:         shop.id,
    p_invoice_id:      viewingInvoice.id,
    p_customer_name:   editCustomerName.trim()   || null,
    p_customer_phone:  editCustomerPhone.trim()  || null,
    p_payment_method:  editPaymentMethod         || null,
    p_payment_details: editPaymentDetails.trim() || null,
    p_payment_account: editPaymentAccount.trim() || null,
    p_items:           editInvoiceItems,
    p_total:           total,
  });

  setSavingInvoiceEdit(false);
  if (error) { setInvoiceEditError(error.message); return; }

  const updated = {
    ...viewingInvoice,
    customer_name:   editCustomerName.trim()   || null,
    customer_phone:  editCustomerPhone.trim()  || null,
    payment_method:  editPaymentMethod         || null,
    payment_details: editPaymentDetails.trim() || null,
    payment_account: editPaymentAccount.trim() || null,
    items:           editInvoiceItems,
    total,
  };
  setViewingInvoice(updated);
  setSavedInvoices(prev => prev.map(x => x.id === updated.id ? updated : x));
  setInvoiceEditMsg("Changes saved.");
};

// ── Download the edited state ───────────────────────────
const handleDownloadEdited = () => {
  if (!viewingInvoice) return;
  const result = buildInvoicePdf({
    invoiceNumber:  viewingInvoice.invoice_number,
    items:          editInvoiceItems,
    customerName:   editCustomerName,
    customerPhone:  editCustomerPhone,
    paymentMethod:  editPaymentMethod,
    paymentDetails: editPaymentDetails,
    paymentAccount: editPaymentAccount,
  });
  if (result) result.doc.save(result.filename);
};

// ── Share the edited state ──────────────────────────────
const handleShareEdited = async () => {
  if (!viewingInvoice) return;
  const result = buildInvoicePdf({
    invoiceNumber:  viewingInvoice.invoice_number,
    items:          editInvoiceItems,
    customerName:   editCustomerName,
    customerPhone:  editCustomerPhone,
    paymentMethod:  editPaymentMethod,
    paymentDetails: editPaymentDetails,
    paymentAccount: editPaymentAccount,
  });
  if (!result) return;

  const blob = result.doc.output("blob");
  const file = new File([blob], result.filename, { type: "application/pdf" });

  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof (navigator as any).canShare === "function" &&
    (navigator as any).canShare({ files: [file] });

  if (!canShareFiles) {
    result.doc.save(result.filename);
    setInvoiceEditMsg("Sharing unavailable — PDF downloaded instead.");
    return;
  }

  setInvoiceSharing(true);
  setInvoiceEditMsg(null);
  try {
    await (navigator as any).share({
      files: [file],
      title: `Invoice ${result.filename}`,
      text:  `Invoice from ${shop?.name ?? "us"}`,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") return;
    result.doc.save(result.filename);
    setInvoiceEditMsg("Couldn't open share sheet — PDF downloaded instead.");
  } finally {
    setInvoiceSharing(false);
  }
};

// ── Delete from inside the detail view ─────────────────
const handleDeleteFromDetail = () => {
  if (!viewingInvoice) return;
  setConfirmDeleteInvoice(viewingInvoice);
  setDeleteInvoiceError(null);
};

  
 // ── Download the current invoice + save to history ──────
const handleDownloadInvoice = async () => {
  const result = buildInvoicePdf({
    invoiceNumber: currentInvoiceNumber || makeInvoiceNumber(),
    items: invoiceItems,
    customerName, customerPhone,
    paymentMethod, paymentDetails, paymentAccount,
  });
  if (!result) return;

  const num = currentInvoiceNumber || result.filename.replace(/\.pdf$/, "");
  result.doc.save(result.filename);
  await saveInvoiceToHistory(num);
  setShowInvoiceModal(false);
};

// ── Share the current invoice + save to history ─────────
const handleShareInvoice = async () => {
  const result = buildInvoicePdf({
    invoiceNumber: currentInvoiceNumber || makeInvoiceNumber(),
    items: invoiceItems,
    customerName, customerPhone,
    paymentMethod, paymentDetails, paymentAccount,
  });
  if (!result) return;

  const num = currentInvoiceNumber || result.filename.replace(/\.pdf$/, "");
  const blob = result.doc.output("blob");
  const file = new File([blob], result.filename, { type: "application/pdf" });

  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof (navigator as any).canShare === "function" &&
    (navigator as any).canShare({ files: [file] });

  if (!canShareFiles) {
    result.doc.save(result.filename);
    await saveInvoiceToHistory(num);
    setInvoiceShareMsg("Sharing isn't available on this device — the PDF was downloaded instead.");
    return;
  }

  setInvoiceSharing(true);
  setInvoiceShareMsg(null);
  try {
    await (navigator as any).share({
      files: [file],
      title: `Invoice ${result.filename}`,
      text:  `Invoice from ${shop?.name ?? "us"}`,
    });
    await saveInvoiceToHistory(num);
    setShowInvoiceModal(false);
  } catch (err: any) {
    if (err?.name === "AbortError") return;
    result.doc.save(result.filename);
    await saveInvoiceToHistory(num);
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
      🧾 Invoice
    </button>

    <button
      onClick={() => fetchInfo()}
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
    {filteredStock
  .slice((stockPage - 1) * STOCK_PAGE_SIZE, stockPage * STOCK_PAGE_SIZE)
  .map(item => {
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
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {item.product.name}
                  {expiryTracking && item.product.batch_label && (
                    <span style={{ fontSize: 9, fontFamily: theme.font.mono, background: "rgba(6,182,212,0.1)", color: theme.accent.cyan, padding: "1px 5px", borderRadius: 4, border: "1px solid rgba(6,182,212,0.25)", fontWeight: 700 }}>
                      {item.product.batch_label}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>{item.product.sku} · {item.product.unit}</span>
                  {expiryTracking && (() => {
                    const exp = getExpiryInfo(item.product.expiry_date);
                    if (!exp) return null;
                    return (
                      <span style={{ color: exp.color, background: exp.bg, padding: "1px 5px", borderRadius: 4, border: `1px solid ${exp.border}`, fontWeight: 700 }}>
                        ⏰ {exp.label}
                      </span>
                    );
                  })()}
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

{isExpanded && (
  <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${theme.border.default}` }}>

    {/* ── Tab bar ── */}
    <div style={{
      display: "flex",
      borderBottom: `1px solid ${theme.border.default}`,
      marginBottom: 12,
    }}>
      {([
        { key: "tx"  as const, label: "Recent Transactions", Icon: BarChart2   },
        { key: "log" as const, label: "Activity Log",        Icon: ClipboardList },
      ]).map(({ key, label, Icon }) => {
        const isActive = (activeTab[item.product.id] ?? "tx") === key;
        return (
          <button
            key={key}
            onClick={(e) => {
              e.stopPropagation();                     // don't collapse the card
              setActiveTab(t => ({ ...t, [item.product.id]: key }));
              if (key === "log" && !activityLog[item.product.id]) {
                fetchLog(item.product.id);
              }
            }}
            style={{
              padding: "8px 14px",
              border: "none",
              borderBottom: `2px solid ${isActive ? theme.accent.cyan : "transparent"}`,
              background: "transparent",
              color: isActive ? theme.accent.cyan : theme.text.muted,
              fontFamily: theme.font.mono,
              fontSize: 11,
              cursor: "pointer",
              fontWeight: isActive ? 700 : 400,
              display: "flex", alignItems: "center", gap: 6,
              marginBottom: -1,
            }}
          >
            <Icon size={12} />
            {label}
          </button>
        );
      })}
    </div>

    {/* ── Recent Transactions tab ── */}
    {(activeTab[item.product.id] ?? "tx") === "tx" && (
      <>
        {isLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
            <div style={{ width: 18, height: 18, border: "2px solid rgba(6,182,212,0.2)", borderTopColor: theme.accent.cyan, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          </div>
        ) : history && history.length > 0 ? (() => {
          const curPage    = txPage[item.product.id] ?? 1;
          const totalPages = Math.max(1, Math.ceil(history.length / TX_PAGE_SIZE));
          const safePage   = Math.min(curPage, totalPages);
          const paged      = history.slice((safePage - 1) * TX_PAGE_SIZE, safePage * TX_PAGE_SIZE);

          return (
            <>
              {/* Header row: count + page indicator */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                  {history.length} transaction{history.length !== 1 ? "s" : ""}
                </div>
                {totalPages > 1 && (
                  <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                    Page {safePage} of {totalPages}
                  </div>
                )}
              </div>

              {/* Rows */}
              {paged.map((t, idx) => (
                <div
                  key={t.id ?? idx}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 0",
                    borderBottom: idx < paged.length - 1 ? `1px solid ${theme.border.default}` : "none",
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
                      {t.payment_method || (Number(t.mpesa_amount) > 0 ? "M-Pesa" : Number(t.cash_amount) > 0 ? "Cash" : "—")}
                    </div>
                  </div>
                </div>
              ))}

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setTxPage(p => ({ ...p, [item.product.id]: Math.max(1, safePage - 1) })); }}
                    disabled={safePage === 1}
                    style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${theme.border.default}`, borderRadius: 8, padding: "5px 12px", color: safePage === 1 ? theme.text.muted : theme.text.primary, fontFamily: theme.font.mono, fontSize: 11, cursor: safePage === 1 ? "not-allowed" : "pointer", opacity: safePage === 1 ? 0.4 : 1 }}
                  >← Prev</button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(pg => pg === 1 || pg === totalPages || Math.abs(pg - safePage) <= 1)
                    .reduce<(number | "…")[]>((acc, pg, i, arr) => {
                      if (i > 0 && pg - (arr[i - 1] as number) > 1) acc.push("…");
                      acc.push(pg);
                      return acc;
                    }, [])
                    .map((pg, i) =>
                      pg === "…" ? (
                        <span key={`e-${i}`} style={{ fontSize: 11, color: theme.text.muted, padding: "0 2px" }}>…</span>
                      ) : (
                        <button
                          key={pg}
                          onClick={(e) => { e.stopPropagation(); setTxPage(p => ({ ...p, [item.product.id]: pg as number })); }}
                          style={{
                            minWidth: 30, height: 30, borderRadius: 8,
                            border: `1px solid ${safePage === pg ? theme.accent.cyan : theme.border.default}`,
                            background: safePage === pg ? `${theme.accent.cyan}18` : "rgba(255,255,255,0.03)",
                            color: safePage === pg ? theme.accent.cyan : theme.text.secondary,
                            fontFamily: theme.font.mono, fontSize: 11, cursor: "pointer", padding: "0 6px",
                          }}
                        >{pg}</button>
                      )
                    )}

                  <button
                    onClick={(e) => { e.stopPropagation(); setTxPage(p => ({ ...p, [item.product.id]: Math.min(totalPages, safePage + 1) })); }}
                    disabled={safePage === totalPages}
                    style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${theme.border.default}`, borderRadius: 8, padding: "5px 12px", color: safePage === totalPages ? theme.text.muted : theme.text.primary, fontFamily: theme.font.mono, fontSize: 11, cursor: safePage === totalPages ? "not-allowed" : "pointer", opacity: safePage === totalPages ? 0.4 : 1 }}
                  >Next →</button>
                </div>
              )}
            </>
          );
        })() : (
          <div style={{ textAlign: "center", padding: "14px 0", fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted }}>
            No recent transactions for this product
          </div>
        )}
      </>
    )}

    {/* ── Activity Log tab ── */}
    {(activeTab[item.product.id] ?? "tx") === "log" && (
      <>
        {loadingLog === item.product.id ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "16px 0" }}>
            <div style={{ width: 18, height: 18, border: "2px solid rgba(6,182,212,0.2)", borderTopColor: theme.accent.cyan, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          </div>
        ) : !activityLog[item.product.id]?.length ? (
          <div style={{ textAlign: "center", padding: "20px 0", fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted }}>
            <ClipboardList size={26} style={{ opacity: 0.25, marginBottom: 6 }} />
            <div>No activity recorded yet for this product.</div>
          </div>
        ) : (() => {
          const log         = activityLog[item.product.id];
          const curPage     = logPage[item.product.id] ?? 1;
          const totalPages  = Math.max(1, Math.ceil(log.length / LOG_PAGE_SIZE));
          const safePage    = Math.min(curPage, totalPages);
          const pagedLog    = log.slice((safePage - 1) * LOG_PAGE_SIZE, safePage * LOG_PAGE_SIZE);

          const meta: Record<string, { Icon: React.ElementType; color: string; label: string }> = {
            product_created:           { Icon: PlusCircle,    color: theme.accent.cyan,  label: "Product Created"      },
            stock_added:               { Icon: PackagePlus,   color: "#a78bfa",           label: "Restocked"            },
            allocation_updated:        { Icon: Pencil,        color: theme.accent.gold,  label: "Allocation Updated"   },
            assigned_to_shop:          { Icon: Store,         color: "#f59e0b",           label: "Assigned to Shop"     },
            shop_sale_recorded:        { Icon: ShoppingCart,  color: theme.accent.green, label: "Shop Sale"            },
            shop_alloc_updated:        { Icon: Pencil,        color: theme.accent.gold,  label: "Shop Stock Updated"   },
            stock_adjusted:            { Icon: AlertTriangle, color: "#f97316",           label: "Stock Adjusted"       },
            removed_from_shop:         { Icon: RotateCcw,     color: theme.accent.red,   label: "Removed from Shop"    },
          
            // ⬇️ new — returns
            shop_return_recorded:      { Icon: RotateCcw,     color: "#fb923c",           label: "Customer Return"      },
            shop_return_restocked:     { Icon: PackagePlus,   color: "#22d3ee",           label: "Return Restocked"     },
            shop_return_to_warehouse:  { Icon: Send,          color: "#a78bfa",           label: "Returned to Owner"    },
          };

          return (
            <>
              {/* Header row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                  {log.length} event{log.length !== 1 ? "s" : ""} total
                </div>
                {totalPages > 1 && (
                  <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                    Page {safePage} of {totalPages}
                  </div>
                )}
              </div>

              {/* Timeline */}
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {pagedLog.map((entry: any, idx: number) => {
                  const isLast = idx === pagedLog.length - 1;
                  const m = meta[entry.action] || { Icon: History, color: theme.text.muted, label: entry.action };
                  const d = new Date(entry.created_at);
                  const dateStr = d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
                  const timeStr = d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });

                  return (
                    <div key={entry.id} style={{ display: "flex", gap: 12, position: "relative" }}>
                      {/* Timeline dot + line */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: "50%",
                          background: `${m.color}18`, border: `1px solid ${m.color}40`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0, zIndex: 1,
                        }}>
                          <m.Icon size={13} color={m.color} />
                        </div>
                        {!isLast && (
                          <div style={{ width: 1, flex: 1, background: theme.border.default, minHeight: 16, margin: "4px 0" }} />
                        )}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 14, paddingTop: 4 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: m.color }}>{m.label}</div>
                          <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, flexShrink: 0, textAlign: "right" }}>
                            <div>{dateStr}</div>
                            <div>{timeStr}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: theme.text.secondary, lineHeight: 1.5, wordBreak: "break-word" }}>
                          {entry.note}
                        </div>
                        {entry.quantity && (
                          <div style={{
                            marginTop: 4, display: "inline-block",
                            background: entry.quantity > 0 ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)",
                            border: `1px solid ${entry.quantity > 0 ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
                            borderRadius: 6, padding: "2px 8px",
                            fontSize: 10, fontFamily: theme.font.mono,
                            color: entry.quantity > 0 ? theme.accent.green : theme.accent.red,
                          }}>
                            {entry.quantity > 0 ? "+" : ""}{entry.quantity} units
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16, flexWrap: "wrap" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setLogPage(p => ({ ...p, [item.product.id]: Math.max(1, safePage - 1) })); }}
                    disabled={safePage === 1}
                    style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${theme.border.default}`, borderRadius: 8, padding: "5px 12px", color: safePage === 1 ? theme.text.muted : theme.text.primary, fontFamily: theme.font.mono, fontSize: 11, cursor: safePage === 1 ? "not-allowed" : "pointer", opacity: safePage === 1 ? 0.4 : 1 }}
                  >← Prev</button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(pg => pg === 1 || pg === totalPages || Math.abs(pg - safePage) <= 1)
                    .reduce<(number | "…")[]>((acc, pg, i, arr) => {
                      if (i > 0 && pg - (arr[i - 1] as number) > 1) acc.push("…");
                      acc.push(pg);
                      return acc;
                    }, [])
                    .map((pg, i) =>
                      pg === "…" ? (
                        <span key={`e-${i}`} style={{ fontSize: 11, color: theme.text.muted, padding: "0 2px" }}>…</span>
                      ) : (
                        <button
                          key={pg}
                          onClick={(e) => { e.stopPropagation(); setLogPage(p => ({ ...p, [item.product.id]: pg as number })); }}
                          style={{
                            minWidth: 30, height: 30, borderRadius: 8,
                            border: `1px solid ${safePage === pg ? theme.accent.cyan : theme.border.default}`,
                            background: safePage === pg ? `${theme.accent.cyan}18` : "rgba(255,255,255,0.03)",
                            color: safePage === pg ? theme.accent.cyan : theme.text.secondary,
                            fontFamily: theme.font.mono, fontSize: 11, cursor: "pointer", padding: "0 6px",
                          }}
                        >{pg}</button>
                      )
                    )}

                  <button
                    onClick={(e) => { e.stopPropagation(); setLogPage(p => ({ ...p, [item.product.id]: Math.min(totalPages, safePage + 1) })); }}
                    disabled={safePage === totalPages}
                    style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${theme.border.default}`, borderRadius: 8, padding: "5px 12px", color: safePage === totalPages ? theme.text.muted : theme.text.primary, fontFamily: theme.font.mono, fontSize: 11, cursor: safePage === totalPages ? "not-allowed" : "pointer", opacity: safePage === totalPages ? 0.4 : 1 }}
                  >Next →</button>
                </div>
              )}
            </>
          );
        })()}
      </>
    )}

    {/* ── Allocation summary (always visible under both tabs) ── */}
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

      {/* Tab switcher */}
<div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
  {([
    ["create",  "New Invoice", "🧾"],
    ["history", "My Invoices", "📚"],
  ] as const).map(([key, label, icon]) => (
    <button
      key={key}
      type="button"
      onClick={() => setInvoiceTab(key)}
      style={{
        flex: 1, padding: "9px 0", borderRadius: 8,
        border: `1px solid ${invoiceTab === key ? "rgba(234,179,8,0.4)" : theme.border.default}`,
        background: invoiceTab === key ? "rgba(234,179,8,0.1)" : "transparent",
        color: invoiceTab === key ? theme.accent.gold : theme.text.muted,
        fontFamily: theme.font.mono, fontSize: 12, cursor: "pointer",
        fontWeight: invoiceTab === key ? 700 : 400,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}
    >
      <span>{icon}</span>{label}
      {key === "history" && invoiceHistoryTotal > 0 && (
        <span style={{
          fontSize: 10, padding: "1px 6px", borderRadius: 99,
          background: invoiceTab === key ? "rgba(234,179,8,0.2)" : "rgba(255,255,255,0.08)",
        }}>{invoiceHistoryTotal}</span>
      )}
    </button>
  ))}
</div>

      {/* Customer fields */}
      {invoiceTab === "create" && (<>
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

       {/* ── Custom item: something not in your stock ── */}
          {!showCustomItemForm ? (
            <button
              type="button"
              onClick={() => setShowCustomItemForm(true)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px dashed ${theme.accent.cyan}66`,
                background: "rgba(6,182,212,0.04)",
                color: theme.accent.cyan,
                fontFamily: theme.font.mono,
                fontSize: 12,
                cursor: "pointer",
                marginBottom: 14,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              <PlusCircle size={13} /> Add item not in your stock
            </button>
          ) : (
            <div
              style={{
                background: "rgba(6,182,212,0.04)",
                border: `1px solid ${theme.accent.cyan}66`,
                borderRadius: 10,
                padding: 12,
                marginBottom: 14,
                display: "flex", flexDirection: "column", gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{
                  fontSize: 11, fontFamily: theme.font.mono,
                  color: theme.accent.cyan, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                }}>Custom Item</div>
                <button
                  type="button"
                  onClick={() => { setShowCustomItemForm(false); setCustomItemError(""); }}
                  aria-label="Close"
                  style={{
                    background: "none", border: "none", color: theme.text.muted,
                    fontSize: 15, cursor: "pointer", lineHeight: 1, padding: 0,
                  }}
                >✕</button>
              </div>

              <input
                placeholder="Item name *"
                value={customItemName}
                onChange={e => setCustomItemName(e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: theme.bg.input, border: `1px solid ${theme.border.default}`,
                  borderRadius: 8, padding: "10px 12px", color: theme.text.primary,
                  fontFamily: theme.font.mono, fontSize: 13, outline: "none",
                }}
              />

              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="number" min={0}
                  placeholder="Price *"
                  value={customItemPrice}
                  onChange={e => setCustomItemPrice(e.target.value)}
                  style={{
                    flex: 1, background: theme.bg.input,
                    border: `1px solid ${theme.border.default}`, borderRadius: 8,
                    padding: "10px 12px", color: theme.text.primary,
                    fontFamily: theme.font.mono, fontSize: 13, outline: "none",
                  }}
                />
                <input
                  type="number" min={1}
                  placeholder="Qty"
                  value={customItemQty}
                  onChange={e => setCustomItemQty(e.target.value)}
                  style={{
                    width: 70, background: theme.bg.input,
                    border: `1px solid ${theme.border.default}`, borderRadius: 8,
                    padding: "10px 12px", color: theme.text.primary,
                    fontFamily: theme.font.mono, fontSize: 13, outline: "none",
                  }}
                />
                <input
                  placeholder="Unit"
                  value={customItemUnit}
                  onChange={e => setCustomItemUnit(e.target.value)}
                  style={{
                    width: 80, background: theme.bg.input,
                    border: `1px solid ${theme.border.default}`, borderRadius: 8,
                    padding: "10px 12px", color: theme.text.primary,
                    fontFamily: theme.font.mono, fontSize: 13, outline: "none",
                  }}
                />
              </div>

              {customItemError && (
                <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.accent.red }}>
                  ⚠ {customItemError}
                </div>
              )}

              <button
                type="button"
                onClick={addCustomItem}
                style={{
                  padding: "9px 0", borderRadius: 8, border: "none",
                  background: "linear-gradient(135deg,#06b6d4,#0891b2)",
                  color: "#fff", fontFamily: theme.font.display,
                  fontWeight: 700, fontSize: 13, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                <PlusCircle size={13} /> Add to Invoice
              </button>
            </div>
          )}

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
      </>)}

           {/* ── HISTORY TAB ── */}
{/* ── HISTORY TAB ── */}
{invoiceTab === "history" && (
  <div>
    {viewingInvoice ? (
      /* ══════════ DETAIL / EDIT VIEW ══════════ */
      <div style={{ display: "flex", flexDirection: "column", gap: 10,
        maxHeight: isMobile ? "60svh" : "64vh" }}>

        {/* Back bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button onClick={closeInvoiceDetail}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${theme.border.default}`,
              borderRadius: 8, padding: "6px 12px",
              color: theme.text.secondary, fontFamily: theme.font.mono,
              fontSize: 12, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
            }}>← Back</button>
          <div style={{
            flex: 1, minWidth: 0, fontSize: 12,
            fontFamily: theme.font.mono, color: theme.accent.gold, fontWeight: 700,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{viewingInvoice.invoice_number}</div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex",
          flexDirection: "column", gap: 10, paddingRight: 2 }}>

          {/* Customer */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input placeholder="Customer name (optional)" value={editCustomerName}
              onChange={e => setEditCustomerName(e.target.value)}
              style={{
                flex: "1 1 160px", background: theme.bg.input,
                border: `1px solid ${theme.border.default}`, borderRadius: 8,
                padding: "10px 12px", color: theme.text.primary,
                fontFamily: theme.font.mono, fontSize: 13, outline: "none",
                boxSizing: "border-box",
              }} />
            <input placeholder="Customer phone (optional)" value={editCustomerPhone}
              onChange={e => setEditCustomerPhone(e.target.value)}
              style={{
                flex: "1 1 160px", background: theme.bg.input,
                border: `1px solid ${theme.border.default}`, borderRadius: 8,
                padding: "10px 12px", color: theme.text.primary,
                fontFamily: theme.font.mono, fontSize: 13, outline: "none",
                boxSizing: "border-box",
              }} />
          </div>

          {/* Payment */}
          <div>
            <label style={{ color: theme.text.secondary, fontSize: 10,
              fontFamily: theme.font.mono, letterSpacing: "0.07em",
              textTransform: "uppercase", display: "block", marginBottom: 5 }}>
              Payment Method
            </label>
            <div style={{ marginBottom: 8 }}>
              <CustomSelect
                value={editPaymentMethod}
                onChange={v => setEditPaymentMethod(v as any)}
                placeholder="— None —"
                theme={theme} isDark={isDark}
                options={[
                  { value: "pochi",   label: "Pochi La Biashara" },
                  { value: "send",    label: "Send to Number" },
                  { value: "paybill", label: "Paybill" },
                  { value: "till",    label: "Till Number" },
                  { value: "custom",  label: "Custom" },
                ]}
              />
            </div>

            {editPaymentMethod === "custom" ? (
              <input placeholder="Payment instructions" value={editPaymentDetails}
                onChange={e => setEditPaymentDetails(e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box", background: theme.bg.input,
                  border: `1px solid ${theme.border.default}`, borderRadius: 8,
                  padding: "10px 12px", color: theme.text.primary,
                  fontFamily: theme.font.mono, fontSize: 13, outline: "none",
                }} />
            ) : editPaymentMethod === "paybill" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <input placeholder="Paybill number" value={editPaymentDetails}
                  onChange={e => setEditPaymentDetails(e.target.value)}
                  inputMode="numeric"
                  style={{
                    width: "100%", boxSizing: "border-box", background: theme.bg.input,
                    border: `1px solid ${theme.border.default}`, borderRadius: 8,
                    padding: "10px 12px", color: theme.text.primary,
                    fontFamily: theme.font.mono, fontSize: 13, outline: "none",
                  }} />
                <input placeholder="Account number" value={editPaymentAccount}
                  onChange={e => setEditPaymentAccount(e.target.value)}
                  inputMode="numeric"
                  style={{
                    width: "100%", boxSizing: "border-box", background: theme.bg.input,
                    border: `1px solid ${theme.border.default}`, borderRadius: 8,
                    padding: "10px 12px", color: theme.text.primary,
                    fontFamily: theme.font.mono, fontSize: 13, outline: "none",
                  }} />
              </div>
            ) : editPaymentMethod ? (
              <input placeholder="Payment number / account" value={editPaymentDetails}
                onChange={e => setEditPaymentDetails(e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box", background: theme.bg.input,
                  border: `1px solid ${theme.border.default}`, borderRadius: 8,
                  padding: "10px 12px", color: theme.text.primary,
                  fontFamily: theme.font.mono, fontSize: 13, outline: "none",
                }} />
            ) : null}
          </div>

          {/* Items */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", marginBottom: 6 }}>
              <label style={{ color: theme.text.secondary, fontSize: 10,
                fontFamily: theme.font.mono, letterSpacing: "0.07em",
                textTransform: "uppercase" }}>
                Items ({editInvoiceItems.length})
              </label>
              <button
                onClick={() => setEditInvoiceItems(prev => [
                  ...prev, { name: "New item", price: 0, unit: "pcs", qty: 1 },
                ])}
                style={{
                  background: "rgba(6,182,212,0.1)",
                  border: "1px solid rgba(6,182,212,0.25)",
                  borderRadius: 6, padding: "3px 10px",
                  color: theme.accent.cyan, fontFamily: theme.font.mono,
                  fontSize: 10, cursor: "pointer",
                }}>+ Add item</button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {editInvoiceItems.map((it, i) => (
                <div key={i} style={{
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${theme.border.default}`,
                  borderRadius: 8, padding: "8px 10px",
                  display: "flex", flexDirection: "column", gap: 6,
                }}>
                  <input placeholder="Item name" value={it.name}
                    onChange={e => setEditInvoiceItems(prev => prev.map((x, idx) =>
                      idx === i ? { ...x, name: e.target.value } : x))}
                    style={{
                      fontSize: 13, padding: "7px 10px", background: theme.bg.input,
                      border: `1px solid ${theme.border.default}`, borderRadius: 6,
                      color: theme.text.primary, fontFamily: theme.font.mono,
                      outline: "none", boxSizing: "border-box", width: "100%",
                    }} />

                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="number" min={1} value={it.qty}
                      onChange={e => setEditInvoiceItems(prev => prev.map((x, idx) =>
                        idx === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))}
                      style={{
                        width: 56, textAlign: "center", fontSize: 12,
                        padding: "6px 4px", background: theme.bg.input,
                        border: `1px solid ${theme.border.default}`, borderRadius: 6,
                        color: theme.text.primary, fontFamily: theme.font.mono,
                        outline: "none",
                      }} />
                    <input type="number" min={0} value={it.price}
                      onChange={e => setEditInvoiceItems(prev => prev.map((x, idx) =>
                        idx === i ? { ...x, price: Math.max(0, Number(e.target.value) || 0) } : x))}
                      style={{
                        flex: 1, fontSize: 12, padding: "6px 8px",
                        background: theme.bg.input,
                        border: `1px solid ${theme.border.default}`, borderRadius: 6,
                        color: theme.text.primary, fontFamily: theme.font.mono,
                        outline: "none",
                      }} />
                    <span style={{
                      fontSize: 12, fontFamily: theme.font.mono,
                      fontWeight: 700, color: theme.accent.green,
                      minWidth: 68, textAlign: "right",
                    }}>
                      {fmt(it.price * it.qty)}
                    </span>
                    <button
                      onClick={() => setEditInvoiceItems(prev => prev.filter((_, idx) => idx !== i))}
                      disabled={editInvoiceItems.length === 1}
                      style={{
                        background: "rgba(248,113,113,0.08)",
                        border: "1px solid rgba(248,113,113,0.2)",
                        borderRadius: 6, padding: "5px 8px",
                        color: theme.accent.red,
                        cursor: editInvoiceItems.length === 1 ? "not-allowed" : "pointer",
                        fontSize: 12, opacity: editInvoiceItems.length === 1 ? 0.4 : 1,
                        display: "flex", alignItems: "center",
                      }}><Trash2 size={11} /></button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              display: "flex", justifyContent: "space-between",
              fontFamily: theme.font.mono, fontWeight: 700,
              borderTop: `1px solid ${theme.border.default}`,
              paddingTop: 8, marginTop: 8, fontSize: 13,
            }}>
              <span>Total</span>
              <span style={{ color: theme.accent.green }}>
                {fmt(editInvoiceItems.reduce((s, it) => s + it.price * it.qty, 0))}
              </span>
            </div>
          </div>
        </div>

        {/* Messages */}
        {invoiceEditError && (
          <div style={{
            flexShrink: 0, color: theme.accent.red, fontSize: 11,
            fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.2)", borderRadius: 8,
            padding: "8px 10px", display: "flex", alignItems: "center", gap: 6,
          }}>
            <AlertTriangle size={12} />{invoiceEditError}
          </div>
        )}
        {invoiceEditMsg && !invoiceEditError && (
          <div style={{
            flexShrink: 0, color: theme.accent.green, fontSize: 11,
            fontFamily: theme.font.mono, background: "rgba(52,211,153,0.08)",
            border: "1px solid rgba(52,211,153,0.2)", borderRadius: 8,
            padding: "8px 10px",
          }}>
            ✓ {invoiceEditMsg}
          </div>
        )}

        {/* Actions */}
        <div style={{ flexShrink: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={handleSaveInvoiceEdit} disabled={savingInvoiceEdit}
            style={{
              flex: "1 1 90px",
              background: savingInvoiceEdit
                ? "rgba(132,204,22,0.3)"
                : "linear-gradient(135deg,#84cc16,#65a30d)",
              border: "none", borderRadius: 10,
              padding: isMobile ? 10 : 12,
              color: "#fff", fontFamily: theme.font.display,
              fontWeight: 700, fontSize: isMobile ? 12 : 13,
              cursor: savingInvoiceEdit ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center",
              justifyContent: "center", gap: 5,
            }}>
            {savingInvoiceEdit ? "Saving…" : "Save"}
          </button>

          <button onClick={handleDownloadEdited}
            style={{
              flex: "1 1 90px",
              background: "rgba(6,182,212,0.1)",
              border: "1px solid rgba(6,182,212,0.25)",
              borderRadius: 10, padding: isMobile ? 10 : 12,
              color: theme.accent.cyan, fontFamily: theme.font.mono,
              fontSize: isMobile ? 11 : 12, cursor: "pointer",
              display: "flex", alignItems: "center",
              justifyContent: "center", gap: 5,
            }}>⬇ Download</button>

          {canSharePdf && (
            <button onClick={handleShareEdited} disabled={invoiceSharing}
              style={{
                flex: "1 1 90px",
                background: invoiceSharing ? "rgba(234,179,8,0.35)"
                  : "linear-gradient(135deg,#eab308,#d97706)",
                border: "none", borderRadius: 10,
                padding: isMobile ? 10 : 12,
                color: "#fff", fontFamily: theme.font.display,
                fontWeight: 700, fontSize: isMobile ? 12 : 13,
                cursor: invoiceSharing ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center",
                justifyContent: "center", gap: 5,
              }}>
              {invoiceSharing ? "…" : <><Send size={12} /> Share</>}
            </button>
          )}

          <button onClick={handleDeleteFromDetail} title="Delete invoice"
            style={{
              flex: "0 0 auto",
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.2)",
              borderRadius: 10,
              padding: isMobile ? "10px 12px" : "12px 14px",
              color: theme.accent.red, fontFamily: theme.font.mono,
              fontSize: isMobile ? 11 : 12, cursor: "pointer",
              display: "flex", alignItems: "center",
              justifyContent: "center", gap: 5,
            }}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>

    ) : invoiceHistoryLoading ? (
      <div style={{ textAlign: "center", padding: "50px 0", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 12 }}>
        <div style={{
          width: 24, height: 24, border: "2px solid rgba(234,179,8,0.2)",
          borderTopColor: theme.accent.gold, borderRadius: "50%",
          animation: "spin 0.8s linear infinite", margin: "0 auto 12px",
        }} />
        Loading invoices…
      </div>
    ) : invoiceHistoryError ? (
      <div style={{
        padding: "16px", background: "rgba(248,113,113,0.06)",
        border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10,
        color: "#f87171", fontFamily: theme.font.mono, fontSize: 12,
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        <span style={{ flex: 1, minWidth: 0 }}>⚠ {invoiceHistoryError}</span>
        <button onClick={() => fetchInvoiceHistory(invoiceHistoryPage)}
          style={{
            background: "rgba(248,113,113,0.15)",
            border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 6, padding: "4px 10px",
            color: "#f87171", fontFamily: theme.font.mono,
            fontSize: 11, cursor: "pointer",
          }}>Retry</button>
      </div>
    ) : savedInvoices.length === 0 ? (
      <div style={{ textAlign: "center", padding: "50px 0", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 12 }}>
        <div style={{ fontSize: 40, marginBottom: 10, opacity: 0.4 }}>📚</div>
        No invoices yet.
        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
          Downloaded or shared invoices will appear here.
        </div>
      </div>
    ) : (
      <>
        <div style={{
          display: "flex", flexDirection: "column", gap: 8,
          maxHeight: "55vh", overflowY: "auto",
        }}>
          {savedInvoices.map(inv => {
            const d = new Date(inv.created_at);
            const dateStr = d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
            const timeStr = d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
            const itemCount = Array.isArray(inv.items) ? inv.items.length : 0;
            return (
              <div key={inv.id} style={{
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${theme.border.default}`,
                borderRadius: 10, padding: "12px 14px",
                display: "flex", flexDirection: "column", gap: 8,
                transition: "border-color 0.15s",
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(234,179,8,0.35)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = theme.border.default; }}
              >
                {/* Tappable info section — opens the detail view */}
                <div
                  onClick={() => openInvoiceDetail(inv)}
                  style={{ cursor: "pointer", display: "flex",
                    flexDirection: "column", gap: 8 }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start",
                    justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: 12, fontFamily: theme.font.mono, fontWeight: 700,
                        color: theme.accent.gold,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{inv.invoice_number}</div>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                        {dateStr} · {timeStr}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontFamily: theme.font.display, fontWeight: 800, color: theme.accent.green, lineHeight: 1 }}>
                        {fmt(inv.total || 0)}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 3 }}>
                        {itemCount} item{itemCount === 1 ? "" : "s"}
                      </div>
                    </div>
                    <span style={{
                      color: theme.text.muted, fontSize: 16, flexShrink: 0,
                      alignSelf: "center", marginLeft: 2,
                    }}>›</span>
                  </div>

                  {(inv.customer_name || inv.customer_phone || inv.payment_method) && (
                    <div style={{
                      fontSize: 11, fontFamily: theme.font.mono, color: theme.text.secondary,
                      display: "flex", gap: 10, flexWrap: "wrap",
                    }}>
                      {inv.customer_name  && <span>👤 {inv.customer_name}</span>}
                      {inv.customer_phone && <span>📞 {inv.customer_phone}</span>}
                      {inv.payment_method && <span style={{ textTransform: "capitalize" }}>💳 {inv.payment_method}</span>}
                    </div>
                  )}
                </div>

                {/* Action buttons — sibling, no click bleed */}
                <div style={{
                  display: "flex", gap: 6, justifyContent: "flex-end",
                  borderTop: `1px solid ${theme.border.default}`, paddingTop: 8,
                }}>
                  <button
                    onClick={() => handleRedownloadInvoice(inv)}
                    style={{
                      background: "rgba(6,182,212,0.1)",
                      border: "1px solid rgba(6,182,212,0.25)",
                      borderRadius: 7, padding: "6px 12px",
                      color: theme.accent.cyan, fontFamily: theme.font.mono,
                      fontSize: 11, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.2"
                      strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Download
                  </button>

                  <button
                    onClick={() => { setConfirmDeleteInvoice(inv); setDeleteInvoiceError(null); }}
                    style={{
                      background: "rgba(248,113,113,0.08)",
                      border: "1px solid rgba(248,113,113,0.2)",
                      borderRadius: 7, padding: "6px 12px",
                      color: theme.accent.red, fontFamily: theme.font.mono,
                      fontSize: 11, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                    }}
                  >
                    <Trash2 size={11} /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {invoiceHistoryTotal > INVOICES_PAGE_SIZE && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 8, marginTop: 12, paddingTop: 12,
            borderTop: `1px solid ${theme.border.default}`,
          }}>
            <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, whiteSpace: "nowrap" }}>
              {((invoiceHistoryPage - 1) * INVOICES_PAGE_SIZE) + 1}–
              {Math.min(invoiceHistoryPage * INVOICES_PAGE_SIZE, invoiceHistoryTotal)} of {invoiceHistoryTotal}
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button
                onClick={() => setInvoiceHistoryPage(p => Math.max(1, p - 1))}
                disabled={invoiceHistoryPage === 1}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${theme.border.default}`,
                  borderRadius: 7, padding: "6px 12px",
                  color: invoiceHistoryPage === 1 ? theme.text.muted : theme.text.primary,
                  fontFamily: theme.font.mono, fontSize: 11,
                  cursor: invoiceHistoryPage === 1 ? "not-allowed" : "pointer",
                  opacity: invoiceHistoryPage === 1 ? 0.4 : 1,
                }}
              >← Prev</button>
              <span style={{ padding: "5px 8px", fontSize: 11, fontFamily: theme.font.mono, color: theme.text.secondary, whiteSpace: "nowrap" }}>
                {invoiceHistoryPage}/{Math.max(1, Math.ceil(invoiceHistoryTotal / INVOICES_PAGE_SIZE))}
              </span>
              <button
                onClick={() => setInvoiceHistoryPage(p => p + 1)}
                disabled={invoiceHistoryPage >= Math.ceil(invoiceHistoryTotal / INVOICES_PAGE_SIZE)}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${theme.border.default}`,
                  borderRadius: 7, padding: "6px 12px",
                  color: invoiceHistoryPage >= Math.ceil(invoiceHistoryTotal / INVOICES_PAGE_SIZE)
                    ? theme.text.muted : theme.text.primary,
                  fontFamily: theme.font.mono, fontSize: 11,
                  cursor: invoiceHistoryPage >= Math.ceil(invoiceHistoryTotal / INVOICES_PAGE_SIZE)
                    ? "not-allowed" : "pointer",
                  opacity: invoiceHistoryPage >= Math.ceil(invoiceHistoryTotal / INVOICES_PAGE_SIZE) ? 0.4 : 1,
                }}
              >Next →</button>
            </div>
          </div>
        )}
      </>
    )}
  </div>
)}
        </div>
  </div>
)}

{/* ── CONFIRM DELETE INVOICE ───────────────────────────── */}
{confirmDeleteInvoice && (
  <div
    style={{
      position: "fixed", inset: 0, zIndex: 1600,
      background: "rgba(0,0,0,0.82)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}
    onClick={() => {
      if (!deletingInvoice) {
        setConfirmDeleteInvoice(null);
        setDeleteInvoiceError(null);
      }
    }}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{
        background: theme.bg.card,
        border: "1.5px solid rgba(239,68,68,0.4)",
        borderRadius: 18, padding: "26px 24px",
        maxWidth: 400, width: "100%",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🗑️</div>
        <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 17, color: theme.text.primary, marginBottom: 8 }}>
          Delete this invoice?
        </div>
        <div style={{ fontSize: 12, fontFamily: theme.font.mono, color: theme.text.muted, lineHeight: 1.6 }}>
          <strong style={{ color: theme.text.primary }}>{confirmDeleteInvoice.invoice_number}</strong>
          <br />will be permanently removed from history.
        </div>
      </div>
      {deleteInvoiceError && (
        <div style={{ fontSize: 11, color: "#f87171", fontFamily: theme.font.mono, marginBottom: 12 }}>
          ⚠ {deleteInvoiceError}
        </div>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={() => { setConfirmDeleteInvoice(null); setDeleteInvoiceError(null); }}
          disabled={deletingInvoice}
          style={{
            flex: 1, background: "none",
            border: `1px solid ${theme.border.default}`,
            borderRadius: 10, padding: 12, color: theme.text.muted,
            fontFamily: theme.font.mono, fontSize: 13,
            cursor: deletingInvoice ? "not-allowed" : "pointer",
          }}
        >Cancel</button>
        <button
          onClick={handleDeleteInvoice}
          disabled={deletingInvoice}
          style={{
            flex: 1.4,
            background: deletingInvoice ? "rgba(239,68,68,0.35)" : "linear-gradient(135deg,#b91c1c,#ef4444)",
            border: "none", borderRadius: 10, padding: 12,
            color: "#fff", fontFamily: theme.font.display, fontWeight: 700, fontSize: 14,
            cursor: deletingInvoice ? "not-allowed" : "pointer",
          }}
        >{deletingInvoice ? "Deleting…" : "Yes, delete"}</button>
      </div>
    </div>
  </div>
)}

    </div>
  );
}

