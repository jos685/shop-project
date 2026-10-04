import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import { useNetwork } from "../context/NetworkContext";
import QrScanner from "../components/QrScanner";
import { supabase, productImageUrl } from "../lib/supabase";
import { useOwnerFeatures } from "../lib/ownerFeatures";
import { enqueue } from "../lib/offlineQueue";
import { sanitizeText, sanitizePhone, sanitizeAmount, sanitizeCode } from "../lib/sanitize";
import { createPortal } from "react-dom";
// import FloatingCart from "../components/FloatingCart";
import UnlistedItemModal from "../components/UnlistedItemModal";
// import BottomSheet from "../components/BottomSheet";
import SaleDock from "../components/SaleDock";
import AddToast from "../components/AddToast";
import type { CartItem, ListedCartItem, CustomItem } from "../types/pos";
import { cartItemName, cartItemImage } from "../types/pos";
import CenterModal from "../components/CenterModal";


type Step         = "scan" | "verify" | "success";
type PayMethod    = "cash" | "mpesa" | "split" | "credit";
type VerifyMethod = "pin" | "badge";

const STEPS: Step[] = ["scan", "verify", "success"];
const STEP_LABELS: Record<Step, string> = {
  scan:    "Products",
  verify:  "Authorise",
  success: "Done",
};

const fmt = (n: number) => `KSh ${n.toLocaleString()}`;


function isSubsequence(q: string, t: string): boolean {
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++;
  return i === q.length;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function fuzzyMatch(query: string, text: string | null | undefined): boolean {
  if (!query) return true;
  if (!text) return false;
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  const queryWords = q.split(/\s+/).filter(Boolean);
  if (queryWords.length > 1 && queryWords.every(w => fuzzyMatch(w, text))) return true;
  if (q.length < 3) return false;
  const qs = q.replace(/\s+/g, ""), ts = t.replace(/\s+/g, "");
  if (qs.length >= 4 && isSubsequence(qs, ts)) return true;
  const words = t.split(/[\s\-_.,;:()[\]/]+/).filter(Boolean);
  const maxDist = q.length <= 4 ? 1 : q.length <= 8 ? 2 : Math.floor(q.length / 3);
  for (const w of words) {
    if (q.length / w.length >= 0.5 && isSubsequence(q, w)) return true;
    if (Math.abs(w.length - q.length) <= maxDist && levenshtein(q, w) <= maxDist) return true;
  }
  return false;
}

function useWindowWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

interface LocalProduct {
  id: string; name: string; sku: string; price: number; unit: string;
  image_url: string | null;
}
interface LocalAlloc {
  id: string; allocated: number; remaining: number; product_id: string; product: LocalProduct;
}
interface LocalAgent {
  id: string; pin: string; active: boolean; agent_id: string;
  name: string; agent_code: string; avatar: string;
}


// Reusable product image with click-to-zoom lightbox
function ProductImage({ 
  imageUrl, 
  productName, 
  size = 40, 
  onClick 
} : { 
  imageUrl: string | null; 
  productName: string; 
  size?: number;
  onClick?: () => void;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [imgError, setImgError] = useState(false);
  
  useEffect(() => {
    if (!showPreview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowPreview(false); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [showPreview]);
  
  const handleClick = (e: React.MouseEvent) => {
    if (onClick) { e.stopPropagation(); onClick(); }
    else if (imageUrl && !imgError) { e.stopPropagation(); setShowPreview(true); }
  };
  
  return (
    <>
      <div 
        className={imageUrl && !imgError ? "thumb thumb-clickable" : "thumb"}
        onClick={handleClick}
        style={{ 
          width: size, height: size, 
          borderRadius: Math.max(8, size * 0.22), 
          background: "rgba(255,255,255,0.05)", 
          display: "flex", alignItems: "center", justifyContent: "center", 
          fontSize: size * 0.45, flexShrink: 0, overflow: "hidden", position: "relative",
          cursor: (imageUrl && !imgError) ? "zoom-in" : "default",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {imageUrl && !imgError ? (
          <img 
            src={imageUrl} alt={productName}
            style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", top: 0, left: 0 }}
            onError={() => setImgError(true)}
          />
        ) : (
          <span>📦</span>
        )}
      </div>
      
      {showPreview && createPortal(
  <div
    // Stop the click from bubbling up through React's tree to the parent
    // product <button>, which would otherwise trigger add-to-cart.
    onClick={e => { e.stopPropagation(); setShowPreview(false); }}
    style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.85)",
      backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, animation: "fadeIn 0.18s ease both",
    }}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: "relative",
        display: "flex", flexDirection: "column", alignItems: "center",
        maxWidth: "100%", animation: "zoomIn 0.2s ease both",
      }}
    >
      <button
        onClick={e => { e.stopPropagation(); setShowPreview(false); }}
        aria-label="Close"
        style={{
          position: "absolute", top: -12, right: -12,
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
        src={imageUrl!} alt={productName}
        style={{
          maxWidth: "min(480px, 78vw)",
          maxHeight: "56vh",
          width: "auto", height: "auto",
          objectFit: "contain",
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "#1a1a1a",
          display: "block",
          boxShadow: "0 24px 70px rgba(0,0,0,0.65)",
        }}
      />

      <div style={{
        marginTop: 12,
        fontFamily: "'Syne',sans-serif", fontWeight: 700,
        fontSize: 15, color: "#fff", textAlign: "center",
        maxWidth: 420, padding: "0 8px",
      }}>
        {productName}
      </div>
    </div>
  </div>,
  document.body
)}
    </>
  );
}
  
export default function PosScan() {
  const { shop }  = useShopAuth();
  const { theme } = useTheme();
  const { isOnline, pendingCount, refreshPendingCount } = useNetwork();
  const navigate  = useNavigate();
  const width     = useWindowWidth();
  const isMobile  = width < 640;
  const isDesktop = width >= 1024;
  const NAV_H = isMobile ? 92 : 128;

  const [reopenPayAfterEdit, setReopenPayAfterEdit] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; lastKey?: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (text: string, lastKey?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, lastKey });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const { features } = useOwnerFeatures(shop?.owner_id);
  const canScan = features.scan_to_sell;

  // ── flow state ────────────────────────────────────────────────────────
  const [step,         setStep]         = useState<Step>("scan");
  const [verifyMethod, setVerifyMethod] = useState<VerifyMethod>("pin");

  useEffect(() => {
    if (step === "success") {
      setPayOpen(false);
      setToast(null);
    }
  }, [step]);

  // scan
  const [mode,           setMode]           = useState<"camera" | "manual">("manual");
  const [cameraActive,   setCameraActive]   = useState(true);
  const [badgeActive,    setBadgeActive]    = useState(false);
  const [searchQuery,    setSearchQuery]    = useState("");
  const [myProducts,     setMyProducts]     = useState<LocalAlloc[]>([]);


  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  const [unlistedOpen, setUnlistedOpen] = useState(false);

  const [editingUnlistedKey, setEditingUnlistedKey] = useState<string | null>(null);

const editUnlistedItem = (key: string) => {
  const item = cart.find(i => i.key === key);
  if (!item || item.kind !== "unlisted") return;
  setEditingUnlistedKey(key);
  setUnlistedOpen(true);
  setPayOpen(false);
  setReopenPayAfterEdit(true);
};

  // cart
  const [cart,           setCart]           = useState<CartItem[]>([]);
  const [cartRestored,   setCartRestored]   = useState(false);
  const [addingProduct,  setAddingProduct]  = useState<LocalAlloc | null>(null);
  const [addQty,         setAddQty]         = useState("1");
  const [addSellPrice,   setAddSellPrice]   = useState("");

  // checkout
  const [customerName,    setCustomerName]    = useState("");
  const [customerPhone,   setCustomerPhone]   = useState("");
  

  // saved customer contacts
  interface SavedCustomer { id?: string; name: string; phone: string; }
  const customersKey = shop ? `pos_customers_${shop.id}` : null;
  const [savedCustomers,   setSavedCustomers]   = useState<SavedCustomer[]>([]);
  const [initialPayment, setInitialPayment] = useState("");
  const [initialCashAmount, setInitialCashAmount] = useState("");
  const [initialMpesaAmount, setInitialMpesaAmount] = useState("");
  const [initialPayMethod, setInitialPayMethod] = useState<"cash" | "mpesa">("cash");
  const [payMethod,     setPayMethod]     = useState<PayMethod | null>(null);
  const [cashAmount,    setCashAmount]    = useState("");
  const [mpesaAmount,   setMpesaAmount]   = useState("");
  const [mpesaRef,      setMpesaRef]      = useState("");

  // agent / verify
  const [shopAgents,    setShopAgents]    = useState<LocalAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<LocalAgent | null>(null);
  const [pin,           setPin]           = useState("");
  const [pinError,      setPinError]      = useState("");
  const [pinShake,      setPinShake]      = useState(false);
  const [badgeError,    setBadgeError]    = useState("");

  // PIN lockout
  const PIN_MAX_FAILS  = 5;
  const PIN_LOCK_MS    = 30_000;
  const [pinFails,     setPinFails]     = useState(0);
  const [pinCountdown, setPinCountdown] = useState(0);
  const pinLockRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const submittingRef  = useRef(false);



  const startPinLock = useCallback((until: number) => {
    if (pinLockRef.current) clearInterval(pinLockRef.current);
    const tick = () => {
      const rem = Math.ceil((until - Date.now()) / 1000);
      if (rem <= 0) { setPinCountdown(0); if (pinLockRef.current) clearInterval(pinLockRef.current); }
      else setPinCountdown(rem);
    };
    tick();
    pinLockRef.current = setInterval(tick, 500);
  }, []);

  useEffect(() => () => { if (pinLockRef.current) clearInterval(pinLockRef.current); }, []);

  // ── Cash register sound — synthesized via Web Audio API, no external files ──
  const cashAudioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const unlock = () => {
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!cashAudioCtxRef.current || cashAudioCtxRef.current.state === "closed") {
          cashAudioCtxRef.current = new Ctx();
        }
        if (cashAudioCtxRef.current.state === "suspended") cashAudioCtxRef.current.resume();
      } catch { /* ignore */ }
    };
    document.addEventListener("click", unlock);
    document.addEventListener("touchstart", unlock);
    const onVisible = () => { if (document.visibilityState === "visible") unlock(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const playCashSound = useCallback(() => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!cashAudioCtxRef.current || cashAudioCtxRef.current.state === "closed") {
        cashAudioCtxRef.current = new Ctx();
      }
      const ctx = cashAudioCtxRef.current;

      const fire = () => {
        const now = ctx.currentTime;
        [700, 1100, 1600].forEach((freq, i) => {
          const osc  = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          const start = now + i * 0.09;
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.3, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + 0.25);
        });
      };

      if (ctx.state === "running") {
        fire();
      } else {
        ctx.resume().then(fire).catch(() => {});
      }
    } catch { /* audio blocked or unsupported — fail silently */ }
  }, []);

  // Play the moment the success screen appears — same render pass as the sale,
  // not gated behind any fetch/poll cycle.
  useEffect(() => {
    if (step === "success") playCashSound();
  }, [step, playCashSound]);

  // ── Cart persistence ──────────────────────────────────────────────────
  const cartKey = shop ? `pos_cart_${shop.id}` : null;

  // Restore saved cart once shop loads
  useEffect(() => {
    if (!cartKey) return;
    try {
      const raw = localStorage.getItem(cartKey);
      if (!raw) return;
      const saved: CartItem[] = JSON.parse(raw);
      if (saved.length > 0) { setCart(saved); setCartRestored(true); }
    } catch {}
  }, [cartKey]);

  // Dismiss the restored banner after 4 s
  useEffect(() => {
    if (!cartRestored) return;
    const t = setTimeout(() => setCartRestored(false), 4000);
    return () => clearTimeout(t);
  }, [cartRestored]);

  // Persist cart whenever it changes — but never on the success screen so navigating
  // away after a completed sale doesn't restore the old cart on next visit.
  useEffect(() => {
    if (!cartKey) return;
    if (step === "success") { localStorage.removeItem(cartKey); return; }
    if (cart.length === 0) { localStorage.removeItem(cartKey); return; }
    try { localStorage.setItem(cartKey, JSON.stringify(cart)); } catch {}
  }, [cart, cartKey, step]);

  const pinIsLocked = pinCountdown > 0;

  // misc
  const [processing,   setProcessing]   = useState(false);
  const [error,        setError]        = useState("");
  const [scanFeedback, setScanFeedback] = useState("");
  const [savedBatchRef, setSavedBatchRef] = useState("");
  const [wasQueued,    setWasQueued]    = useState(false);
  const [saleTimestamp, setSaleTimestamp] = useState("");
  const [commissionConfig, setCommissionConfig] = useState<{ enabled: boolean; rate: number }>({ enabled: false, rate: 0 });
  const [businessName,  setBusinessName]  = useState("");
  const [receiptStatus, setReceiptStatus] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  // ── camera sync ───────────────────────────────────────────────────────
  useEffect(() => {
    setCameraActive(canScan && mode === "camera" && step === "scan" && !addingProduct);
  }, [canScan, mode, step, addingProduct]);

  useEffect(() => {
    setBadgeActive(step === "verify" && verifyMethod === "badge");
  }, [step, verifyMethod]);

  // ── fetch agents + stock ──────────────────────────────────────────────
  // Cache keys — scoped per shop so different shops don't share data.
  const cacheKey = shop ? `pos_cache_${shop.id}` : null;

  // Load from cache first so the UI is immediately populated when offline.
  useEffect(() => {
    if (!cacheKey) return;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) return;
      const { agents, products, commission, bizName, customItems: cachedCustom } = JSON.parse(raw);
        if (agents)        setShopAgents(agents);
        if (products)      setMyProducts(products);
        if (commission)    setCommissionConfig(commission);
        if (bizName)       setBusinessName(bizName);
        if (cachedCustom)  setCustomItems(cachedCustom);
    } catch {}
  }, [cacheKey]);

  // Network fetch — skipped entirely when offline so we don't clobber the cache with empty data.
  useEffect(() => {
    if (!shop || !isOnline) return;
    (async () => {
      const [agentsRes, allocsRes, commRes, profileRes, customRes] = await Promise.all([
        supabase.from("shop_agents")
          .select("id, pin, active, agent_id, agent_name, agent_code, agent_avatar")
          .eq("shop_id", shop.id).eq("active", true),
        supabase.from("shop_allocations")
          .select("id, allocated, remaining, product_id, product_name, product_sku, product_price, product_unit")
          .eq("shop_id", shop.id),
        supabase.rpc("get_shop_commission", { p_owner_id: shop.owner_id }),
        supabase.from("profiles").select("business_name").eq("id", shop.owner_id).single(),
        supabase.from("shop_custom_items")
        .select("id, shop_id, name, unit, default_price, category, active")
        .eq("shop_id", shop.id).eq("active", true)
        .order("name"),
      ]);

      // Bail out if any primary fetch failed — don't overwrite good cached data with nothing.
      if (agentsRes.error || allocsRes.error) return;

      const commission = (commRes.data as any)?.[0] ?? { enabled: false, rate: 0 };
      const bizName    = (profileRes.data as any)?.business_name ?? shop.name;

      const agents = (agentsRes.data || []).map((r: any) => ({
        id: r.id, pin: r.pin, active: r.active, agent_id: r.agent_id,
        name: r.agent_name ?? "Agent", agent_code: r.agent_code ?? "", avatar: r.agent_avatar ?? "",
      }));

      const productIds = (allocsRes.data || []).map((a: any) => a.product_id).filter(Boolean);
      let productsMap: Record<string, any> = {};
      if (productIds.length > 0) {
        const { data: prodsData } = await supabase
          .from("products").select("id, name, sku, price, unit, image_url").in("id", productIds);
        for (const p of prodsData || []) productsMap[p.id] = p;
      }

      const allProducts = (allocsRes.data || [])
        .filter((a: any) => !!a.product_id)
        .map((a: any) => {
          const p = productsMap[a.product_id] || {};
          return {
            id: a.id, allocated: a.allocated,
            remaining: Math.max(0, a.remaining ?? 0),
            product_id: a.product_id,
            product: {
              id:    a.product_id,
              name:  p.name  || a.product_name  || "—",
              sku:   p.sku   || a.product_sku   || "",
              price: Number(p.price ?? a.product_price ?? 0),
              unit:  p.unit  || a.product_unit  || "",
              image_url: p.image_url ? productImageUrl(p.image_url) : null,
            },
          };
        });

      // Only show items with stock available in the scan UI
      const products = allProducts.filter(p => p.remaining > 0);

      setCommissionConfig(commission);
      setBusinessName(bizName);
      const cItems = (customRes.data ?? []) as CustomItem[];
      setCustomItems(cItems);
      setShopAgents(agents);
      setMyProducts(products);

      // Persist to cache so the next offline session has fresh data.
      if (cacheKey) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            agents, products, commission, bizName, customItems: cItems,
          }));
        } catch {}
      }
      
    
      // Full stock cache (all items including 0-remaining) for the stock info page
      if (shop?.id) {
        try { localStorage.setItem(`pos_stock_full_${shop.id}`, JSON.stringify({ items: allProducts, cachedAt: Date.now() })); } catch {}
      }
    })();
  }, [shop, isOnline, cacheKey]);

  // ── customer contacts: load from cache then Supabase ─────────────────
  useEffect(() => {
    if (!customersKey) return;
    try {
      const cached = localStorage.getItem(customersKey);
      if (cached) setSavedCustomers(JSON.parse(cached));
    } catch {}
  }, [customersKey]);

  

  useEffect(() => {
    if (!shop || !isOnline) return;
    supabase
      .from("shop_customers")
      .select("id, name, phone")
      .eq("shop_id", shop.id)
      .order("name")
      .then(({ data }) => {
        if (!data) return;
        setSavedCustomers(data as SavedCustomer[]);
        if (customersKey) {
          try { localStorage.setItem(customersKey, JSON.stringify(data)); } catch {}
        }
      });
  }, [shop, isOnline, customersKey]);

  
  const saveCustomItem = useCallback(async (
    name: string, unit: string, price: number
  ): Promise<CustomItem | null> => {
    if (!shop) return null;
    const trimmed = name.trim();
    if (!trimmed) return null;
  
    // Try to find an existing match first
    const existing = customItems.find(
      c => c.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) return existing;
  
    const { data, error } = await supabase
      .from("shop_custom_items")
      .insert({
        shop_id: shop.id,
        owner_id: shop.owner_id,
        name: trimmed,
        unit: unit || "pc",
        default_price: price || 0,
        created_by: shop.owner_id, // or current agent id if you track it
      })
      .select("id, shop_id, name, unit, default_price, category, active")
      .single();
  
    if (error || !data) {
      console.warn("saveCustomItem failed:", error?.message);
      return null;
    }
  
    const created = data as CustomItem;
    setCustomItems(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
  
    // Persist to cache
    if (cacheKey) {
      try {
        const raw = localStorage.getItem(cacheKey);
        const existingCache = raw ? JSON.parse(raw) : {};
        const next = [...(existingCache.customItems ?? []), created]
          .sort((a, b) => a.name.localeCompare(b.name));
        localStorage.setItem(cacheKey, JSON.stringify({ ...existingCache, customItems: next }));
      } catch {}
    }
    return created;
  }, [shop, customItems, cacheKey]);

  const saveCustomer = useCallback(async (name: string, phone: string) => {
    if (!shop || !name.trim() || !phone.trim()) return;
    const already = savedCustomers.some(c => c.phone === phone.trim());
    if (already) return;
    const { data, error } = await supabase
      .from("shop_customers")
      .insert({ shop_id: shop.id, owner_id: shop.owner_id, name: name.trim(), phone: phone.trim() })
      .select("id, name, phone")
      .single();
    if (data) {
      setSavedCustomers(prev => {
        const next = [...prev, data as SavedCustomer].sort((a, b) => a.name.localeCompare(b.name));
        if (customersKey) { try { localStorage.setItem(customersKey, JSON.stringify(next)); } catch {} }
        return next;
      });
    } else {
      console.warn("saveCustomer insert failed:", error?.message, error?.code);
      // Re-fetch to sync local state with whatever is actually in the DB
      const { data: fresh } = await supabase
        .from("shop_customers")
        .select("id, name, phone")
        .eq("shop_id", shop.id)
        .order("name");
      if (fresh) {
        setSavedCustomers(fresh as SavedCustomer[]);
        if (customersKey) { try { localStorage.setItem(customersKey, JSON.stringify(fresh)); } catch {} }
      }
    }
  }, [shop, savedCustomers, customersKey]);

  // Re-fetch the shop's allocation list from the DB and sync both the UI
// state and the localStorage cache. Called after failures and on focus.
const refreshProducts = useCallback(async () => {
  if (!shop || !isOnline) return;
  try {
    const { data: allocsData, error } = await supabase
      .from("shop_allocations")
      .select("id, allocated, remaining, product_id, product_name, product_sku, product_price, product_unit")
      .eq("shop_id", shop.id);

    if (error) {
      console.warn("refreshProducts fetch failed:", error.message);
      return;
    }

    const productIds = (allocsData || []).map((a: any) => a.product_id).filter(Boolean);
    let productsMap: Record<string, any> = {};
    if (productIds.length > 0) {
      const { data: prodsData } = await supabase
        .from("products")
        .select("id, name, sku, price, unit, image_url")
        .in("id", productIds);
      for (const p of prodsData || []) productsMap[p.id] = p;
    }

    const allProducts = (allocsData || [])
      .filter((a: any) => !!a.product_id)
      .map((a: any) => {
        const p = productsMap[a.product_id] || {};
        return {
          id: a.id,
          allocated: a.allocated,
          remaining: Math.max(0, a.remaining ?? 0),
          product_id: a.product_id,
          product: {
            id:    a.product_id,
            name:  p.name  || a.product_name  || "—",
            sku:   p.sku   || a.product_sku   || "",
            price: Number(p.price ?? a.product_price ?? 0),
            unit:  p.unit  || a.product_unit  || "",
            image_url: p.image_url ? productImageUrl(p.image_url) : null,
          },
        };
      });

    const products = allProducts.filter(p => p.remaining > 0);
    setMyProducts(products);

    if (cacheKey) {
      try {
        const raw = localStorage.getItem(cacheKey);
        const existing = raw ? JSON.parse(raw) : {};
        localStorage.setItem(cacheKey, JSON.stringify({ ...existing, products }));
      } catch {}
    }
    if (shop?.id) {
      try {
        localStorage.setItem(
          `pos_stock_full_${shop.id}`,
          JSON.stringify({ items: allProducts, cachedAt: Date.now() })
        );
      } catch {}
    }
  } catch (err) {
    console.warn("refreshProducts error:", err);
  }
}, [shop, isOnline, cacheKey]);


  // ── product lookup ────────────────────────────────────────────────────
  const fetchAllocationBySku = useCallback(async (sku: string): Promise<LocalAlloc | null> => {
    if (!shop) return null;
    const inMem = myProducts.find(a => a.product.sku.toUpperCase() === sku.toUpperCase());
    if (inMem) return inMem;
    if (!isOnline) return null;

    const { data } = await supabase.from("shop_allocations")
      .select("id, allocated, remaining, product_id, product_name, product_sku, product_price, product_unit")
      .eq("shop_id", shop.id).eq("product_sku", sku.trim().toUpperCase()).single();

    if (!data?.product_id) return null;
    const { data: prod } = await supabase
      .from("products").select("id, name, sku, price, unit, image_url").eq("id", data.product_id).single();
    return {
      id: data.id, allocated: data.allocated,
      remaining: Math.max(0, data.remaining ?? 0),
      product_id: data.product_id,
      product: {
        id:    data.product_id,
        name:  prod?.name  || data.product_name  || "—",
        sku:   prod?.sku   || data.product_sku   || "",
        price: Number(prod?.price ?? data.product_price ?? 0),
        unit:  prod?.unit  || data.product_unit  || "",
        image_url: prod?.image_url ? productImageUrl(prod.image_url) : null,
      },
    };
  }, [shop, myProducts]);

  const editItem = (key: string) => {
    const item = cart.find(i => i.key === key);
    if (!item || item.kind !== "listed") return;
    setAddingProduct(item.allocation);
    setAddQty(String(item.quantity));
    setAddSellPrice(String(item.sellPrice));
    setToast(null);
    setPayOpen(false);              // close the payment modal so the product sheet is on top
    setReopenPayAfterEdit(true);    // remember to reopen it once the user saves
  };
  
  const undoItem = (key: string) => {
    setCart(prev => prev.filter(i => i.key !== key));
    setToast(null);
  };

  const handleProductTap = (alloc: LocalAlloc) => {
    if (alloc.remaining <= 0) {
      setScanFeedback(`No stock for ${alloc.product.name}`);
      setTimeout(() => setScanFeedback(""), 2500);
      return;
    }
    const existing = cart.find(i => i.kind === "listed" && i.allocation.product_id === alloc.product_id);
    if (existing) {
      // Re-tap = increment quantity by 1
      setCart(prev => prev.map(i =>
        i.key === existing.key ? { ...i, quantity: i.quantity + 1 } : i
      ));
      showToast(`${alloc.product.name} → ${existing.quantity + 1}`);
    } else {
      const newItem: ListedCartItem = {
        kind: "listed",
        key: alloc.id,
        allocation: alloc,
        quantity: 1,
        sellPrice: alloc.product.price,
      };
      setCart(prev => [...prev, newItem]);
      showToast(`Added · ${alloc.product.name}`, alloc.id);
    }
  };

  const handleQrScan = async (text: string) => {
    let sku = text.trim();
    try { const p = JSON.parse(text); if (p.sku) sku = p.sku; } catch {}
    const alloc = await fetchAllocationBySku(sku);
    if (!alloc) {
      setScanFeedback(`"${sku}" not found in this shop's stock.`);
      setTimeout(() => { setCameraActive(true); setScanFeedback(""); }, 2500);
      return;
    }
    handleProductTap(alloc);
  };
   
  // Live-filtered products. Matches name OR sku with fuzzy tolerance.
const filteredProducts = useMemo(() => {
  const base = [...myProducts].sort((a, b) => a.product.name.localeCompare(b.product.name));
  const q = searchQuery.trim();
  if (!q) return base;
  return base.filter(a => fuzzyMatch(q, a.product.name) || fuzzyMatch(q, a.product.sku));
}, [myProducts, searchQuery]);

// If the user typed a value that exactly matches a SKU, pin it as a quick-add.
const exactSkuMatch = useMemo(() => {
  const q = searchQuery.trim().toUpperCase();
  if (!q) return null;
  return myProducts.find(a => a.product.sku.toUpperCase() === q) ?? null;
}, [myProducts, searchQuery]);

  // ── cart ops ──────────────────────────────────────────────────────────
  const handleAddToCart = () => {
    if (!addingProduct) return;
    const qty = Math.max(1, parseInt(addQty) || 1);
    const sp  = Number(addSellPrice) || addingProduct.product.price;
  
    if (qty > addingProduct.remaining) {
      setError(`Only ${addingProduct.remaining} units available.`);
      return;
    }
    if (sp < addingProduct.product.price) {
      setError(`Sell price cannot be less than ${fmt(addingProduct.product.price)}.`);
      return;
    }
  
    setCart(prev => {
      const existing = prev.find(
        i => i.kind === "listed" && i.allocation.product_id === addingProduct.product_id
      );
      if (existing) {
        return prev.map(i =>
          i.kind === "listed" && i.allocation.product_id === addingProduct.product_id
            ? { ...i, quantity: qty, sellPrice: sp }
            : i
        );
      }
      const newItem: ListedCartItem = {
        kind: "listed",
        key: addingProduct.id,
        allocation: addingProduct,
        quantity: qty,
        sellPrice: sp,
      };
      return [...prev, newItem];
    });
    setAddingProduct(null);
    setAddQty("1");
    setAddSellPrice("");
    setError("");

    if (reopenPayAfterEdit) {
      setReopenPayAfterEdit(false);
      setPayOpen(true);   // bring the payment modal back with the updated row
    }
  };


  const handleAddUnlisted = (input: {
    customItemId: string | null;
    name: string;
    unit: string;
    quantity: number;
    sellPrice: number;
  }) => {
    if (editingUnlistedKey) {
      // Update the existing unlisted row
      setCart(prev => prev.map(i =>
        i.key === editingUnlistedKey && i.kind === "unlisted"
          ? {
              ...i,
              customItemId: input.customItemId,
              name: input.name,
              unit: input.unit || "pc",
              quantity: Math.max(1, input.quantity),
              sellPrice: Math.max(0, input.sellPrice),
            }
          : i
      ));
      setEditingUnlistedKey(null);
    } else {
      // Add a new unlisted row
      setCart(prev => [
        ...prev,
        {
          kind: "unlisted",
          key: crypto.randomUUID(),
          customItemId: input.customItemId,
          name: input.name,
          unit: input.unit || "pc",
          quantity: Math.max(1, input.quantity),
          sellPrice: Math.max(0, input.sellPrice),
        },
      ]);
    }
    setUnlistedOpen(false);
    setError("");
    if (reopenPayAfterEdit) {
      setReopenPayAfterEdit(false);
      setPayOpen(true);
    }
  };

  const handleRemoveFromCart = (key: string) => {
    setCart(prev => prev.filter(i => i.key !== key));
  };
  
  const handleUpdateCartQty = (key: string, qty: number) => {
    setCart(prev => prev.map(i => i.key === key ? { ...i, quantity: Math.max(1, qty) } : i));
  };

  const handleUpdateCartPrice = (key: string, price: number) => {
    setCart(prev => prev.map(i => {
      if (i.key !== key) return i;
      // Listed items cannot sell below base price
      if (i.kind === "listed" && price < i.allocation.product.price) return i;
      return { ...i, sellPrice: Math.max(0, price) };
    }));
  };

  // ── checkout ──────────────────────────────────────────────────────────
  const grandTotal = cart.reduce((s, i) => s + i.sellPrice * i.quantity, 0);

  // ── submit sale ───────────────────────────────────────────────────────
  const handleSubmitSale = async (verifiedAgent: LocalAgent) => {
    if (cart.length === 0) return;
    if (!payMethod) {
      setError("Choose a payment method before completing the sale.");
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;

    // Persist the active agent so the dashboard can greet them by name
    if (shop?.id) {
      localStorage.setItem(`pos_last_agent_${shop.id}`, JSON.stringify({ name: verifiedAgent.name, id: verifiedAgent.agent_id }));
    }

    // Offline: queue the sale and proceed to success screen
    if (!isOnline) {
      enqueue({
        shopId:        shop!.id,
        ownerId:       shop!.owner_id,
        type:          payMethod === "credit" ? "credit" : "regular",
        cart: cart.map(item => item.kind === "unlisted"
          ? {
              isUnlisted:  true,
              customItemId: item.customItemId,
              productName: item.name,
              unit:        item.unit,
              quantity:    item.quantity,
              sellPrice:   item.sellPrice,
              basePrice:   item.sellPrice,   // no markup
            }
          : {
              isUnlisted:  false,
              allocationId: item.allocation.id,
              productId:    item.allocation.product.id,
              productName:  item.allocation.product.name,
              productImage: item.allocation.product.image_url,
              quantity:     item.quantity,
              sellPrice:    item.sellPrice,
              basePrice:    item.allocation.product.price,
            }
        ),
        payMethod,
        cashAmount:      Number(cashAmount)  || 0,
        mpesaAmount:     Number(mpesaAmount) || 0,
        mpesaRef:        mpesaRef.trim(),
        customerName:    customerName.trim(),
        customerPhone:   customerPhone.trim(),
        initialPayment:  Number(initialPayment) || 0,
        initialCashAmount: Number(initialCashAmount) || 0,
        initialMpesaAmount: Number(initialMpesaAmount) || 0,
        initialPayMethod,
        verifiedAgent:   { agent_id: verifiedAgent.agent_id, name: verifiedAgent.name },
        commissionConfig,
        grandTotal,
      });

      // Deduct stock locally so agents can't oversell during offline mode.
      setMyProducts(prev => {
        const allUpdated = prev.map(alloc => {
          const sold = cart.find(i => i.kind === "listed" && i.allocation.id === alloc.id);
          if (!sold) return alloc;
          return { ...alloc, remaining: Math.max(0, alloc.remaining - sold.quantity) };
        });
        // Update PosScan cache (only remaining > 0 for scan UI)
        if (cacheKey) {
          try {
            const raw = localStorage.getItem(cacheKey);
            if (raw) {
              const cached = JSON.parse(raw);
              localStorage.setItem(cacheKey, JSON.stringify({ ...cached, products: allUpdated.filter(a => a.remaining > 0) }));
            }
          } catch {}
        }
        // Update full stock cache so PosShopInfo shows correct remaining (including items at 0)
        if (shop?.id) {
          try {
            const fullKey = `pos_stock_full_${shop.id}`;
            const raw = localStorage.getItem(fullKey);
            if (raw) {
              const cached = JSON.parse(raw);
              const updatedItems = (cached.items || []).map((item: any) => {
                const match = allUpdated.find((a: any) => a.id === item.id);
                return match ? { ...item, remaining: match.remaining } : item;
              });
              localStorage.setItem(fullKey, JSON.stringify({ ...cached, items: updatedItems }));
            }
          } catch {}
        }
        // Return only items with remaining > 0 for the scan UI state
        return allUpdated.filter(alloc => alloc.remaining > 0);
      });

      refreshPendingCount();
      setWasQueued(true);
      setSelectedAgent(verifiedAgent);
      setSavedBatchRef("OFFLINE");
      setSaleTimestamp(new Date().toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }));
      setPayOpen(false);
      setStep("success");
      submittingRef.current = false;
      return;
    }

    setProcessing(true); setError("");

    try {
    // Deduct stock for every item regardless of payment method.
    // Track successfully deducted items so we can roll back on partial failure.
    const deducted: { id: string; quantity: number; name: string }[] = [];
    for (const item of cart) {
      if (item.kind === "unlisted") continue;   // nothing to deduct
    
      const { error: stockErr } = await supabase.rpc("deduct_shop_stock", {
        p_shop_allocation_id: item.allocation.id,
        p_quantity: item.quantity,
      });
    
      if (stockErr) {
        Promise.all(deducted.map(d =>
          supabase.rpc("deduct_shop_stock", { p_shop_allocation_id: d.id, p_quantity: -d.quantity })
        )).catch(() => {});
    
        await refreshProducts();
    
        setError(
          stockErr.message.includes("Insufficient") || stockErr.message.toLowerCase().includes("stock")
            ? `${item.allocation.product.name} is out of stock (or has less than ${item.quantity} left). The list has been refreshed — please pick a different item.`
            : `Failed to deduct stock for ${item.allocation.product.name}. ${stockErr.message}`
        );
        return;
      }
      deducted.push({ id: item.allocation.id, quantity: item.quantity, name: item.allocation.product.name });
    }

    // ── Credit / Pay Later ────────────────────────────────────────────
        // ── Credit / Pay Later ────────────────────────────────────────────
        if (payMethod === "credit") {
          const creditItems = cart.map(item => item.kind === "unlisted"
      ? {
          allocation_id:  null,
          product_id:     null,
          custom_item_id: item.customItemId,
          product_name:   item.name,
          is_unlisted:    true,
          quantity:       item.quantity,
          unit_price:     item.sellPrice,
          subtotal:       item.sellPrice * item.quantity,
        }
      : {
          allocation_id:  item.allocation.id,
          product_id:     item.allocation.product.id,
          custom_item_id: null,
          product_name:   item.allocation.product.name,
          is_unlisted:    false,
          quantity:       item.quantity,
          unit_price:     item.sellPrice,
          subtotal:       item.sellPrice * item.quantity,
        }
    );

      const initPaid = Math.min(Math.max(0, Number(initialPayment) || 0), grandTotal);
      const initCashPaid = Math.min(Math.max(0, Number(initialCashAmount) || 0), initPaid);
      const initMpesaPaid = initPaid - initCashPaid;
      const initStatus = initPaid >= grandTotal - 0.5 ? "paid" : initPaid > 0 ? "partial" : "pending";
      const txStatus = initPaid >= grandTotal - 0.5 ? "ok" : "credit_partial";

            // Find the first listed item, if any — used as the "primary" product on the
            const firstListed = cart.find((i): i is ListedCartItem => i.kind === "listed");
      const primaryProductId = firstListed ? firstListed.allocation.product.id : null;
      const primaryBasePrice  = firstListed ? firstListed.allocation.product.price : 0;
      const { data: fnData, error: fnErr } = await supabase.functions.invoke("insert-credit-sale", {
        body: {
          shop_id:         shop?.id,
          owner_id:        shop?.owner_id,
          items:           creditItems,
          amount:          grandTotal,
          amount_paid:     initPaid,
          customer_name:   customerName.trim(),
          customer_phone:  customerPhone.trim(),
          seller_agent_id: verifiedAgent.agent_id,
          seller_name:     verifiedAgent.name,
          status:          initStatus,
          // Payment details for the upfront portion (sent only when initPaid > 0)
          ...(initPaid > 0 && {
            initial_payment_method: initMpesaPaid > 0 && initCashPaid > 0 ? "split" : initCashPaid > 0 ? "cash" : "mpesa",
            tx_row: {
              shop_id:           shop?.id,
              owner_id:          shop?.owner_id,
              seller_agent_id:   verifiedAgent.agent_id,
              product_id:        primaryProductId,
              quantity:          cart.reduce((s, i) => s + i.quantity, 0),
              amount:            initPaid,
              customer_phone:    customerPhone.trim(),
              payment_method:    initMpesaPaid > 0 && initCashPaid > 0 ? "split" : initCashPaid > 0 ? "cash" : "mpesa",
              cash_amount:       initCashPaid,
              mpesa_amount:      initMpesaPaid,
              mpesa_ref:         initMpesaPaid > 0 ? mpesaRef.trim() || null : null,
              status:            txStatus,
              unit_price:        primaryBasePrice,
              base_price:        primaryBasePrice,
              commission_rate:   0,
              commission_earned: 0,
            },
          }),
        },
      });

      if (fnErr || !fnData?.success) {
        console.error("insert-credit-sale error:", fnErr ?? fnData?.error);
        Promise.all(deducted.map(d =>
          supabase.rpc("deduct_shop_stock", { p_shop_allocation_id: d.id, p_quantity: -d.quantity })
        )).catch(() => {});
        setError(`Credit sale failed: ${fnData?.error ?? fnErr?.message ?? "unknown error"}`);
        return;
      }

      const creditData = fnData.data;

      setSavedBatchRef((creditData?.id ?? "").slice(0, 8).toUpperCase());
      setSelectedAgent(verifiedAgent);
      setProcessing(false);
      setSaleTimestamp(new Date().toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }));
      setStep("success");

      // Save customer contact for future lookups (credit sales always have name + phone)
      if (customerName.trim() && customerPhone.trim()) {
        saveCustomer(customerName.trim(), customerPhone.trim());
      }

      // Fire credit receipt asynchronously — best effort
      if (customerPhone.trim()) {
        const paid    = Math.min(Math.max(0, Number(initialPayment) || 0), grandTotal);
        const balance = grandTotal - paid;
        setReceiptStatus("sending");
        supabase.functions.invoke("send-receipt", {
          body: {
            phone:           customerPhone.trim(),
            business_name:   businessName,
            agent_name:      verifiedAgent.name,
            customer_name:   customerName.trim() || null,
            items: cart.map(item => ({
              name:       cartItemName(item),
              quantity:   item.quantity,
              unit_price: item.sellPrice,
              total:      item.sellPrice * item.quantity,
            })),
            total_amount:   grandTotal,
            payment_method: "credit",
            amount_paid:    paid,
            balance_owed:   balance,
          },
        }).then(({ data: rd, error: re }) => {
          setReceiptStatus((re || !(rd as any)?.sent) ? "failed" : "sent");
        });
      }

      return;
    }

    // ── Cash / M-Pesa / Split ─────────────────────────────────────────
    const cash  = payMethod === "cash"  ? grandTotal : payMethod === "mpesa" ? 0 : Number(cashAmount)  || 0;
    const mpesa = payMethod === "mpesa" ? grandTotal : payMethod === "cash"  ? 0 : Number(mpesaAmount) || 0;

    const commRate = commissionConfig.enabled ? commissionConfig.rate : 0;

    const txRows = cart.map(item => {
      // ── Unlisted branch ──
      if (item.kind === "unlisted") {
        const itemTotal = item.sellPrice * item.quantity;
        const ratio = grandTotal > 0 ? itemTotal / grandTotal : 0;
        return {
          shop_id:           shop?.id,
          owner_id:          shop?.owner_id,
          seller_agent_id:   verifiedAgent.agent_id,
          product_id:        null,
          custom_item_id:    item.customItemId,
          product_name:      item.name,
          is_unlisted:       true,
          quantity:          item.quantity,
          amount:            itemTotal,
          customer_phone:    customerPhone.trim(),
          payment_method:    payMethod,
          cash_amount:       payMethod === "cash"  ? itemTotal : payMethod === "mpesa" ? 0 : Math.round(cash  * ratio),
          mpesa_amount:      payMethod === "mpesa" ? itemTotal : payMethod === "cash"  ? 0 : Math.round(mpesa * ratio),
          mpesa_ref:         (payMethod === "mpesa" || payMethod === "split") ? mpesaRef.trim() || null : null,
          status:            "ok",
          unit_price:        item.sellPrice,
          base_price:        item.sellPrice,   // no markup for unlisted
          commission_rate:   0,
          commission_earned: 0,
        };
      }
    
      // ── Listed branch (unchanged) ──
      const basePrice   = item.allocation.product.price;
      const unitPrice   = item.sellPrice;
      const itemTotal   = unitPrice * item.quantity;
      const markup      = Math.max(0, unitPrice - basePrice);
      const commEarned  = Math.round(markup * item.quantity * commRate / 100);
      const ratio       = grandTotal > 0 ? itemTotal / grandTotal : 0;
      return {
        shop_id:           shop?.id,
        owner_id:          shop?.owner_id,
        seller_agent_id:   verifiedAgent.agent_id,
        product_id:        item.allocation.product.id,
        custom_item_id:    null,
        product_name:      item.allocation.product.name,
        is_unlisted:       false,
        quantity:          item.quantity,
        amount:            itemTotal,
        customer_phone:    customerPhone.trim(),
        payment_method:    payMethod,
        cash_amount:       payMethod === "cash"  ? itemTotal : payMethod === "mpesa" ? 0 : Math.round(cash  * ratio),
        mpesa_amount:      payMethod === "mpesa" ? itemTotal : payMethod === "cash"  ? 0 : Math.round(mpesa * ratio),
        mpesa_ref:         (payMethod === "mpesa" || payMethod === "split") ? mpesaRef.trim() || null : null,
        status:            "ok",
        unit_price:        unitPrice,
        base_price:        basePrice,
        commission_rate:   commRate,
        commission_earned: commEarned,
      };
    });

    const { data, error: txErr } = await supabase.rpc("insert_shop_transaction", { p_rows: txRows });
    if (txErr) {
      console.error("shop_transactions insert error:", JSON.stringify(txErr, null, 2));
      console.error("txRows payload:", JSON.stringify(txRows, null, 2));
      Promise.all(deducted.map(d =>
        supabase.rpc("deduct_shop_stock", { p_shop_allocation_id: d.id, p_quantity: -d.quantity })
      )).catch(() => {});
      setError(`Transaction failed (${txErr.code}: ${txErr.message}). Stock has been restored — please try again.`);
      return;
    }

    // Notify PosTransactionsPage — window event works same-process; no JWT/RLS dependency
    window.dispatchEvent(new CustomEvent("shop:new_sale", { detail: { shopId: shop?.id } }));

    const firstId = (data?.[0]?.id ?? "").slice(0, 8).toUpperCase();
    setSavedBatchRef(firstId);
    setSelectedAgent(verifiedAgent);
    setProcessing(false);
    setSaleTimestamp(new Date().toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }));
    setStep("success");

    // Auto-save customer contact if name + phone were provided
    if (customerName.trim() && customerPhone.trim()) {
      saveCustomer(customerName.trim(), customerPhone.trim());
    }

    // Fire receipt asynchronously — sale is already saved, this is best-effort
    if (customerPhone.trim()) {
      setReceiptStatus("sending");
      supabase.functions.invoke("send-receipt", {
        body: {
          phone:          customerPhone.trim(),
          business_name:  businessName,
          agent_name:     verifiedAgent.name,
          items: cart.map(item => ({
            name:       cartItemName(item),
            quantity:   item.quantity,
            unit_price: item.sellPrice,
            total:      item.sellPrice * item.quantity,
          })),
          total_amount:   grandTotal,
          payment_method: payMethod,
          mpesa_ref:      mpesaRef.trim() || null,
        },
      }).then(({ data: rd, error: re }) => {
        setReceiptStatus((re || !(rd as any)?.sent) ? "failed" : "sent");
      });
    }
    } catch (err) {
      console.error("handleSubmitSale error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setProcessing(false);
      submittingRef.current = false;
    }
  };

  // ── Badge QR verify ───────────────────────────────────────────────────
  const handleBadgeScan = (text: string) => {
    setBadgeActive(false);
    let agentId = text.trim(), agentCode = text.trim();
    try { const p = JSON.parse(text); if (p.agent_id) agentId = p.agent_id; if (p.agent_code) agentCode = p.agent_code; } catch {}
    const found = shopAgents.find(a =>
      a.agent_id === agentId ||
      a.agent_code.toUpperCase() === agentCode.toUpperCase()
    );
    if (!found) {
      setBadgeError("Badge not recognised. Try again or use PIN.");
      setTimeout(() => { setBadgeActive(true); setBadgeError(""); }, 2500);
      return;
    }
    setBadgeError("");
    handleSubmitSale(found);
  };


    // ── PIN digit handler — shared by on-screen numpad and physical keyboard ──
    const handlePinKey = (k: string) => {
      if (pinIsLocked) return;
  
      if (k === "⌫") {
        setPin(p => p.slice(0, -1));
        setPinError(""); setError("");
        return;
      }
  
      if (!/^[0-9]$/.test(k)) return;
      setError("");
      if (pin.length >= 4) return;
  
      const newPin = pin + k;
  
      if (newPin.length === 4 && selectedAgent) {
        const storedPin = selectedAgent.pin != null ? String(selectedAgent.pin) : null;
      
        if (!storedPin) {
          setPin("");
          setPinError("This agent has no PIN set. Ask your owner to configure one.");
          setPinShake(true);
          setTimeout(() => setPinShake(false), 400);
          return;
        }
      
        if (newPin !== storedPin) {
          const next = pinFails + 1;
          setPinFails(next);
          if (next >= PIN_MAX_FAILS) startPinLock(Date.now() + PIN_LOCK_MS);
          setPin("");
          setPinError("Incorrect PIN. Try again.");
          setPinShake(true);
          setTimeout(() => setPinShake(false), 400);
          return;
        }
      
        setPin("");
        setPinError("");
        setPinFails(0); setPinCountdown(0);
        handleSubmitSale(selectedAgent);
        return;
      }
  
      setPin(newPin);
      setPinError("");
    };
  
    // ── Physical keyboard input while the PIN pad is open ────────────────
    // No dep array on purpose: handlePinKey closes over pin / pinFails /
    // selectedAgent, so we re-bind the listener each render to see fresh values.
    useEffect(() => {
      const pinPadOpen =
        (step === "verify" && verifyMethod === "pin" && !!selectedAgent && !processing) ||
        (payOpen && !!selectedAgent && !processing);
      if (!pinPadOpen) return;
  
      const onKey = (e: KeyboardEvent) => {
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
  
        if (e.key === "Escape") {
          e.preventDefault();
          setSelectedAgent(null); setPin(""); setPinError("");
          return;
        }
        if (e.key === "Backspace") { e.preventDefault(); handlePinKey("⌫"); return; }
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); handlePinKey(e.key); return; }
        if (e.key === "Enter")     { e.preventDefault(); return; } // 4 digits auto-submits
      };
  
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    });

    useEffect(() => {
      if (!shop || !isOnline) return;
      const onFocus = async () => {
        const { data } = await supabase
          .from("shop_custom_items")
          .select("id, shop_id, name, unit, default_price, category, active")
          .eq("shop_id", shop.id).eq("active", true)
          .order("name");
        if (data) setCustomItems(data as CustomItem[]);
      };
      window.addEventListener("focus", onFocus);
      return () => window.removeEventListener("focus", onFocus);
    }, [shop, isOnline]);


    const handleReset = () => {
      setStep("scan"); setMode("manual"); setSearchQuery("");
      setCart([]); setAddingProduct(null); setAddQty("1"); setAddSellPrice("");
      setSelectedAgent(null); setPin(""); setPinError(""); setBadgeError("");
      setCustomerName(""); setCustomerPhone("");
      setInitialPayment(""); setInitialCashAmount(""); setInitialMpesaAmount(""); setInitialPayMethod("cash");
      setPayMethod(null);
      setCashAmount(""); setMpesaAmount(""); setMpesaRef("");
      setError(""); setScanFeedback(""); setProcessing(false);
      setVerifyMethod("pin"); setReceiptStatus("idle"); setCartRestored(false); setWasQueued(false);
      setUnlistedOpen(false);                       // ← ADD THIS
      if (cartKey) localStorage.removeItem(cartKey);
      setPinFails(0); setPinCountdown(0);
      if (pinLockRef.current) { clearInterval(pinLockRef.current); pinLockRef.current = null; }
    };

    const goBack = () => {
      setError("");
      if (step === "verify") {
        setStep("scan");
        setSearchQuery("");
        setBadgeActive(false);
      }
    };

  return (
    <div style={{ minHeight: "100vh", background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.body }}>

     {/* Offline banner */}
        {!isOnline && (
          <div style={{
            position: "fixed",
            top: isMobile ? 8 : 0,
            left: isMobile ? "50%" : 0,
            right: isMobile ? "auto" : 0,
            transform: isMobile ? "translateX(-50%)" : "none",
            width: isMobile ? "calc(100% - 24px)" : "100%",
            maxWidth: isMobile ? 420 : "100%",
            zIndex: 9999,
            background: "#92400e",
            color: "#fef3c7",
            padding: isMobile ? "8px 12px" : "10px 16px",
            display: "flex", alignItems: "center",
            justifyContent: isMobile ? "center" : "space-between",
            gap: isMobile ? 6 : 12,
            fontFamily: "monospace",
            fontSize: isMobile ? 11 : 13,
            fontWeight: 600,
            borderRadius: isMobile ? 12 : 0,
            boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
            textAlign: isMobile ? "center" : "left",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ flexShrink: 0 }}>⚡</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {isMobile
                  ? "Offline — sales will be queued"
                  : "Offline — sales will be queued and synced when connection returns."}
              </span>
            </div>
            {pendingCount > 0 && (
              <span style={{
                background: "#fef3c7",
                color: "#92400e",
                borderRadius: 20,
                padding: isMobile ? "1px 8px" : "2px 10px",
                fontSize: isMobile ? 10 : 11,
                flexShrink: 0,
              }}>
                {pendingCount} queued
              </span>
            )}
          </div>
        )}
      <style>{`
        
        @keyframes fadeUp     { from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin       { to{transform:rotate(360deg)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes zoomIn { from{opacity:0;transform:scale(0.92)} to{opacity:1;transform:scale(1)} }
        .thumb { transition: transform 0.15s ease, border-color 0.15s ease; }
        .thumb-clickable:hover { transform: scale(1.08); border-color: rgba(6,182,212,0.55) !important; }
        @keyframes successPop { 0%{transform:scale(0.5);opacity:0}70%{transform:scale(1.1)}100%{transform:scale(1);opacity:1} }
        @keyframes shake      { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }
        @keyframes slideUp    { from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)} }
        .section       { animation: fadeUp 0.3s ease; }
        .success-icon  { animation: successPop 0.5s ease; }
        .shake         { animation: shake 0.35s ease; }
         .overlay-sheet { animation: slideUp 0.25s ease; }
        ${theme.kiCss.replace(/border-radius:10px/g, "border-radius:12px").replace(/font-size:14px/g, "font-size:15px").replace(/padding:11px 13px/g, "padding:13px 14px")}
        .abtn { border:none;cursor:pointer;font-family:'Syne',sans-serif;font-weight:800;font-size:16px;border-radius:14px;padding:16px;width:100%;transition:opacity 0.15s,transform 0.1s; }
        .abtn:active { transform:scale(0.98); }
        .abtn:disabled { opacity:0.45;cursor:not-allowed; }
        .pin-digit { width:${isMobile ? "46px" : "52px"};height:${isMobile ? "58px" : "64px"};border:2px solid ${theme.border.default};border-radius:12px;display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;font-size:26px;font-weight:700;transition:all 0.15s; }
        .pin-digit.filled { border-color:${theme.accent.cyan}80;background:${theme.accent.cyan}14; }
        .back-btn:hover { background:rgba(255,255,255,0.08) !important; }
        .cart-row:hover { background:rgba(255,255,255,0.03) !important; }
        .num-btn:active:not(:disabled) { background:rgba(6,182,212,0.18) !important; transform:scale(0.92); }
        .num-del:active:not(:disabled) { background:rgba(248,113,113,0.2) !important; transform:scale(0.92); }
        .method-card:hover { border-color:rgba(6,182,212,0.3) !important; }
        @keyframes pinDotPop { 0%{transform:scale(0.6);opacity:0.5} 70%{transform:scale(1.25)} 100%{transform:scale(1.1);opacity:1} }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        borderBottom: `1px solid ${theme.border.default}`,
        padding: isMobile ? "12px 14px" : "16px 40px",
        position: "sticky", top: 58, background: theme.bg.base, zIndex: 40,
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {step !== "scan" && step !== "success" && (
              <button className="back-btn" onClick={goBack}
                style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${theme.border.default}`, borderRadius: 9, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: theme.text.muted, fontSize: 18, flexShrink: 0, transition: "background 0.15s" }}>
                ‹
              </button>
            )}
            <div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 16 : 19 }}>
                {STEP_LABELS[step]}
              </div>
              {!isMobile && (
              <div style={{ color: theme.text.muted, fontSize: 10, fontFamily: theme.font.mono, marginTop: 1 }}>
                {step === "scan"     ? "Scan or pick products to add to cart"                                         : ""}
                {step === "verify"   ? "Verify identity to complete the sale"                                         : ""}
                {step === "success"  ? (wasQueued ? "Queued — will sync when online" : "Transaction saved successfully") : ""}
              </div>
            )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            
            <button onClick={step === "scan" ? () => navigate("/pos") : handleReset}
              style={{ background: "none", border: `1px solid ${theme.border.default}`, borderRadius: 9, padding: "7px 13px", color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, cursor: "pointer", whiteSpace: "nowrap" }}>
              {step === "scan" ? "← Back" : "✕ Cancel"}
            </button>
          </div>
        </div>

        {/* Step progress */}
        {step !== "success" && (
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {(["scan", "verify"] as Step[]).map((s, i) => {
              const done    = STEPS.indexOf(step) > i;
              const current = step === s;
              const canJump = s === "scan" ? true : cart.length > 0;
              const clickable = canJump && !current;
              return (
                <div key={s} style={{ display: "flex", alignItems: "center", flex: i < 1 ? 1 : "none" }}>
                  <button
                    onClick={() => {
                      if (!clickable) return;
                      setStep(s);
                      setError("");
                      if (s !== "verify") setBadgeActive(false);
                    }}
                    disabled={!clickable}
                    style={{
                      background: "none", border: "none", padding: 0, gap: 5,
                      display: "flex", alignItems: "center",
                      cursor: clickable ? "pointer" : "default",
                      opacity: canJump ? 1 : 0.5,
                      transition: "opacity 0.15s",
                    }}
                    title={clickable ? `Go to ${STEP_LABELS[s]}` : s === "scan" ? "" : "Add items to cart first"}
                  >
                    <div style={{
                      width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: done ? 13 : 11,
                      background: done ? theme.accent.cyan : current ? "rgba(6,182,212,0.2)" : "rgba(255,255,255,0.05)",
                      border: `1.5px solid ${done || current ? theme.accent.cyan : "rgba(255,255,255,0.1)"}`,
                      color: done ? "#000" : current ? theme.accent.cyan : theme.text.muted,
                      fontFamily: theme.font.mono, fontWeight: 700,
                    }}>
                      {done ? "✓" : i + 1}
                    </div>
                    <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: current ? theme.accent.cyan : theme.text.muted, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                      {STEP_LABELS[s]}
                    </div>
                  </button>
                  {i < 1 && <div style={{ flex: 1, height: 1, background: done ? theme.accent.cyan : "rgba(255,255,255,0.08)", margin: "0 8px" }} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{
          padding: isMobile
          ? `14px 14px ${
              step === "scan" && cart.length > 0 && !payOpen && !addingProduct
                ? "calc(env(safe-area-inset-bottom, 0px) + 140px)"
                : "90px"
            }`
          : `24px 40px ${
              step === "scan" && cart.length > 0 && !payOpen && !addingProduct
                ? "calc(env(safe-area-inset-bottom, 0px) + 140px)"
                : "90px"
            }`,
          maxWidth: isDesktop ? 1400 : 720,
          margin: "0 auto"
        }}>

        {/* ══════════════════ STEP 1: SCAN ══════════════════ */}
        {step === "scan" && (
          <div className="section" style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Cart restored banner */}
            {cartRestored && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.25)", borderRadius: 12, padding: "10px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: theme.font.mono, color: theme.accent.cyan }}>
                  <span>🛒</span>
                  Cart restored — {cart.length} item{cart.length !== 1 ? "s" : ""} from your last session
                </div>
                <button onClick={() => { setCart([]); setCartRestored(false); }}
                  style={{ background: "none", border: "none", color: theme.text.muted, fontSize: 16, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>✕</button>
              </div>
            )}

            <div style={{ display: "flex", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: 4, gap: 4 }}>
              {(["manual", "camera"] as const).map(m => (
                <button key={m} onClick={() => { setMode(m); setError(""); setAddingProduct(null); }}
                  style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: theme.font.mono, fontSize: 13, fontWeight: mode === m ? 600 : 400, background: mode === m ? "rgba(6,182,212,0.15)" : "transparent", color: mode === m ? theme.accent.cyan : theme.text.muted }}>
                  {m === "camera" ? `${canScan ? "📷" : "🔒"} Camera` : "📦 Products"}
                </button>
              ))}
            </div>

            {mode === "camera" && !canScan && (
              <div style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 16, padding: "32px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>🔒</div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 16, color: "#e2e8f0", marginBottom: 8 }}>
                  Camera Scan Not Available
                </div>
                <div style={{ fontFamily: theme.font.mono, fontSize: 12, color: theme.text.muted, lineHeight: 1.7, marginBottom: 16 }}>
                  This shop's current package does not include QR scanning.<br />
                  You can still add products manually from the list.
                </div>
                <div style={{ fontFamily: theme.font.mono, fontSize: 11, color: "rgba(168,85,247,0.7)", background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.18)", borderRadius: 8, padding: "8px 14px", display: "inline-block" }}>
                  Ask the business owner to upgrade their package to enable camera scanning
                </div>
              </div>
            )}

            {mode === "camera" && canScan && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {scanFeedback && (
                  <div style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)", borderRadius: 10, padding: "10px 14px", fontSize: 12, fontFamily: theme.font.mono, color: theme.accent.gold }}>⚠ {scanFeedback}</div>
                )}
                <QrScanner active={cameraActive} onScanSuccess={handleQrScan} />
                <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: "12px 14px" }}>
                  {["Hold 10–30cm from QR code", "Ensure good lighting", "Center QR in frame"].map(tip => (
                    <div key={tip} style={{ fontSize: 11, color: theme.text.muted, fontFamily: theme.font.mono, marginBottom: 3, display: "flex", gap: 8 }}>
                      <span style={{ color: theme.accent.cyan }}>→</span>{tip}
                    </div>
                  ))}
                </div>
              </div>
            )}

        

{mode === "manual" && (
  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

    {/* Unified search — name or SKU, fuzzy */}
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 15, opacity: 0.45, pointerEvents: "none" }}>🔍</span>
      <input
        className="ki"
        value={searchQuery}
        onChange={e => { setSearchQuery(e.target.value); setError(""); }}
        onKeyDown={async e => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const q = searchQuery.trim();
          if (!q) return;
          if (exactSkuMatch) { handleProductTap(exactSkuMatch); setSearchQuery(""); return; }
          // Try a network SKU lookup for a product not yet in the local list.
          const alloc = await fetchAllocationBySku(q);
          if (alloc) { handleProductTap(alloc); setSearchQuery(""); return; }
          if (filteredProducts.length === 1) { handleProductTap(filteredProducts[0]); setSearchQuery(""); return; }
          if (filteredProducts.length === 0) setError(`"${q}" not found in this shop's stock.`);
        }}
        placeholder="Search by name or SKU…"
        style={{ paddingLeft: 40, paddingRight: searchQuery ? 40 : 14 }}
        spellCheck={false}
        autoComplete="off"
        maxLength={40}
      />
      {searchQuery && (
        <button onClick={() => { setSearchQuery(""); setError(""); }}
          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 24, height: 24, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.08)", color: theme.text.muted, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, lineHeight: 1 }}>×</button>
      )}
    </div>

    <button
  onClick={() => { setUnlistedOpen(true); setError(""); }}
  style={{
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: "12px 14px",
    background: "rgba(168,85,247,0.06)",
    border: "1px dashed rgba(168,85,247,0.4)",
    borderRadius: 12,
    color: "#c084fc",
    fontFamily: theme.font.mono,
    fontSize: 13,
    cursor: "pointer",
    transition: "background 0.15s",
  }}
  onMouseEnter={e => (e.currentTarget.style.background = "rgba(168,85,247,0.12)")}
  onMouseLeave={e => (e.currentTarget.style.background = "rgba(168,85,247,0.06)")}
>
  ➕ Sell item not in stock
</button>

    {/* Exact SKU quick-add */}
    {exactSkuMatch && (
      <button onClick={() => { handleProductTap(exactSkuMatch); setSearchQuery(""); }}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.3)", borderRadius: 12, cursor: "pointer", textAlign: "left" }}>
        <span style={{ fontSize: 16 }}>⚡</span>
        <span style={{ flex: 1, fontSize: 12, fontFamily: theme.font.mono, color: theme.accent.cyan }}>
          Exact SKU match — tap to add <strong>{exactSkuMatch.product.name}</strong>
        </span>
        <span style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted }}>Enter ↵</span>
      </button>
    )}

    {error && <div style={{ color: theme.accent.red, fontSize: 12, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 12px" }}>⚠ {error}</div>}

    {myProducts.length === 0 ? (
      <div style={{ textAlign: "center", padding: "36px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14 }}>
        <div style={{ fontSize: 34, opacity: 0.2, marginBottom: 10 }}>📦</div>
        <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono }}>No stock available</div>
      </div>
    ) : (
      <div>
        <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
          {searchQuery.trim()
            ? `${filteredProducts.length} of ${myProducts.length} products`
            : `Available (${myProducts.length})`}
        </div>
        {filteredProducts.length === 0 && (
          <div style={{ textAlign: "center", padding: "24px 16px", color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono }}>
            No products match "{searchQuery}"
          </div>
        )}
                <div style={{
          maxHeight: isMobile ? "52vh" : 520,
          overflowY: "auto",
          overflowX: "hidden",
          paddingRight: 2,          // keeps scrollbar off the cards
          WebkitOverflowScrolling: "touch",

          // Reserve space at the end of the list so the last product can
          // scroll clear of the floating SaleDock. Without this the final
          // card sits flush against the container edge and gets hidden
          // behind the dock. Only applies while the dock is visible.
          paddingBottom:
            step === "scan" && cart.length > 0 && !payOpen && !addingProduct
              ? 80
              : 12,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: 8 }}>
            {filteredProducts.map(alloc => {
            const sc     = alloc.remaining <= 3 ? "#f87171" : alloc.remaining <= 10 ? "#fbbf24" : "#34d399";
            const pct    = alloc.allocated > 0 ? Math.round((alloc.remaining / alloc.allocated) * 100) : 0;
            const inCart = cart.find(
              i => i.kind === "listed" && i.allocation.product_id === alloc.product_id
            );
            return (
              <button key={alloc.id} onClick={() => handleProductTap(alloc)}
                  style={{ padding: "8px 10px", border: `1px solid ${inCart ? "rgba(6,182,212,0.3)" : "rgba(255,255,255,0.08)"}`, borderRadius: 11, background: inCart ? "rgba(6,182,212,0.05)" : "linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, textAlign: "left", transition: "border-color 0.15s" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(6,182,212,0.3)")}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = inCart ? "rgba(6,182,212,0.3)" : "rgba(255,255,255,0.08)")}>
                  <ProductImage imageUrl={alloc.product.image_url} productName={alloc.product.name} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, marginBottom: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{alloc.product.name}</div>
                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{alloc.product.sku} · {fmt(alloc.product.price)}</div>
                    <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 2, height: 2 }}>
                      <div style={{ width: `${pct}%`, height: "100%", borderRadius: 2, background: sc }} />
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                    <div style={{ background: `${sc}18`, border: `1px solid ${sc}40`, borderRadius: 8, padding: "4px 8px", textAlign: "center", minWidth: 40 }}>
                      <div style={{ fontSize: 14, fontFamily: theme.font.mono, fontWeight: 800, color: sc, lineHeight: 1 }}>{alloc.remaining}</div>
                      <div style={{ fontSize: 8, fontFamily: theme.font.mono, color: sc, opacity: 0.8, marginTop: 1 }}>{alloc.product.unit}</div>
                    </div>
                    {inCart && (
                      <div style={{ fontSize: 8, fontFamily: theme.font.mono, color: theme.accent.cyan, background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 5, padding: "1px 6px" }}>
                        ×{inCart.quantity}
                      </div>
                    )}
                  </div>
                </button>
            );
          })}
        </div>
        </div>
      </div>
    )}
  </div>

  
)}

          </div>
        )}

       

        {/* ══════════════════ STEP 3: VERIFY ══════════════════ */}
        {step === "verify" && (
          <div className="section" style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 14 : 20, alignItems: "flex-start" }}>

            {/* LEFT COLUMN — Cart summary (sticky on desktop) */}
            <div style={{ flex: isMobile ? "unset" : "0 0 36%", display: "flex", flexDirection: "column", gap: 14, position: isMobile ? "static" : "sticky", top: 80, width: isMobile ? "100%" : "auto" }}>
              <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Order Summary</div>
                {cart.map(item => (
  <div key={item.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
    <div style={{ fontSize: 13, color: theme.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8 }}>
      {item.quantity}× {cartItemName(item)}
      {item.kind === "unlisted" && (
        <span style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#c084fc", marginLeft: 6 }}>· unlisted</span>
      )}
    </div>
    <div style={{ fontFamily: theme.font.mono, fontSize: 13, color: theme.text.primary, flexShrink: 0 }}>
      {fmt(item.sellPrice * item.quantity)}
    </div>

    <button
  onClick={() => {
    if (item.kind === "listed") editItem(item.key);
    else editUnlistedItem(item.key);
  }}
  aria-label="Edit item"
  style={{
    flexShrink: 0, width: 26, height: 26, borderRadius: 7,
    border: `1px solid ${theme.border.default}`,
    background: "transparent", color: theme.accent.cyan,
    cursor: "pointer", fontSize: 13,
    display: "flex", alignItems: "center", justifyContent: "center",
  }}
>
  ✎
</button>
  </div>
))}
                <div style={{ borderTop: `1px solid ${theme.border.default}`, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                  <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                    {payMethod === "cash" ? "💵 Cash" : payMethod === "mpesa" ? "📱 M-Pesa" : payMethod === "split" ? "⚡ Split" : "📝 Pay Later"}
                    {payMethod === "credit" && customerName ? ` · ${customerName}` : customerPhone ? ` · ${customerPhone}` : ""}
                  </div>
                  <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 18, color: theme.accent.gold }}>{fmt(grandTotal)}</div>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN — Verify method + agent + PIN */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              {error && <div style={{ color: theme.accent.red, fontSize: 12, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 14px" }}>⚠ {error}</div>}
              {/* Method toggle — card style */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {([
                  { key: "badge" as const, icon: "📛", label: "Scan Badge", desc: "Agent QR badge" },
                  { key: "pin"   as const, icon: "🔑", label: "Enter PIN",  desc: "4-digit agent PIN" },
                ]).map(({ key, icon, label, desc }) => {
                  const isSel = verifyMethod === key;
                  return (
                    <button key={key} className="method-card"
                      onClick={() => { setVerifyMethod(key); setPinError(""); setBadgeError(""); setPin(""); }}
                      style={{
                        padding: "16px 10px 14px",
                        border: `1.5px solid ${isSel ? "rgba(6,182,212,0.55)" : "rgba(255,255,255,0.08)"}`,
                        borderRadius: 16,
                        background: isSel ? "rgba(6,182,212,0.1)" : "rgba(255,255,255,0.02)",
                        cursor: "pointer",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                        transition: "all 0.15s", textAlign: "center",
                        position: "relative",
                      }}>
                      <span style={{ fontSize: 24, lineHeight: 1 }}>{icon}</span>
                      <div style={{ fontFamily: theme.font.display, fontSize: 13, fontWeight: 700, color: isSel ? theme.accent.cyan : theme.text.primary, marginTop: 2 }}>
                        {label}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: isSel ? "rgba(6,182,212,0.7)" : theme.text.muted }}>
                        {desc}
                      </div>
                      {isSel && (
                        <div style={{ position: "absolute", top: 10, right: 10, width: 7, height: 7, borderRadius: "50%", background: theme.accent.cyan, boxShadow: "0 0 8px rgba(6,182,212,0.9)" }} />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* ── PIN method ── */}
              {verifyMethod === "pin" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Who is selling?</label>
                    {shopAgents.length === 0 ? (
                      <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono, padding: 14, background: "rgba(255,255,255,0.02)", borderRadius: 10, border: `1px solid ${theme.border.default}` }}>
                        No agents assigned to this shop yet.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {shopAgents.map(sa => {
                          const isSel = selectedAgent?.id === sa.id;
                          return (
                            <button key={sa.id} onClick={() => { setSelectedAgent(sa); setPin(""); setPinError(""); }}
                              style={{ padding: "12px 14px", border: `1px solid ${isSel ? "rgba(6,182,212,0.5)" : "rgba(255,255,255,0.08)"}`, borderRadius: 12, background: isSel ? "rgba(6,182,212,0.12)" : "rgba(255,255,255,0.02)", cursor: "pointer", display: "flex", flexDirection: "row", alignItems: "center", gap: 12, transition: "all 0.15s", textAlign: "left" }}>
                              <div style={{ width: 40, height: 40, borderRadius: "50%", background: isSel ? "rgba(6,182,212,0.2)" : "rgba(255,255,255,0.06)", border: `1px solid ${isSel ? "rgba(6,182,212,0.4)" : "rgba(255,255,255,0.1)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: theme.font.display, fontWeight: 700, fontSize: 16, color: isSel ? theme.accent.cyan : theme.text.muted, flexShrink: 0 }}>
                                {sa.avatar || sa.name.charAt(0).toUpperCase()}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: isSel ? theme.accent.cyan : theme.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sa.name}</div>
                                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{sa.agent_code}</div>
                              </div>
                              {isSel && <div style={{ width: 8, height: 8, borderRadius: "50%", background: theme.accent.cyan, boxShadow: "0 0 8px rgba(6,182,212,0.6)", flexShrink: 0 }} />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {selectedAgent && (
                    <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono, padding: "10px 14px", background: "rgba(6,182,212,0.05)", border: "1px solid rgba(6,182,212,0.15)", borderRadius: 10, textAlign: "center" }}>
                      {selectedAgent.name} selected — PIN entry will appear on screen
                    </div>
                  )}
                </div>
              )}

              {/* ── Badge method ── */}
              {verifyMethod === "badge" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ background: "rgba(6,182,212,0.05)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 12, padding: "12px 14px", fontSize: 12, fontFamily: theme.font.mono, color: theme.text.muted, lineHeight: 1.6 }}>
                    📛 Ask the selling agent to hold their <strong style={{ color: theme.text.primary }}>QR badge</strong> up to the camera to verify the sale.
                  </div>
                  {badgeError && (
                    <div style={{ color: theme.accent.red, fontSize: 12, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 14px", textAlign: "center" }}>
                      ⚠ {badgeError}
                    </div>
                  )}
                  <QrScanner active={badgeActive} onScanSuccess={handleBadgeScan} />
                  {processing && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "14px", background: "rgba(6,182,212,0.06)", borderRadius: 12, fontSize: 13, fontFamily: theme.font.mono, color: theme.accent.cyan }}>
                      <span style={{ width: 16, height: 16, border: "2px solid rgba(6,182,212,0.3)", borderTopColor: theme.accent.cyan, borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                      Processing sale...
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════ STEP 4: SUCCESS ══════════════════ */}
        {step === "success" && (
          <div className="section" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, paddingTop: 16, textAlign: "center" }}>
            <div className="success-icon" style={{ width: 86, height: 86, borderRadius: "50%", background: wasQueued ? "rgba(251,191,36,0.15)" : payMethod === "credit" ? "rgba(248,113,113,0.15)" : "rgba(52,211,153,0.15)", border: `2px solid ${wasQueued ? "#fbbf24" : payMethod === "credit" ? "#f87171" : "#34d399"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 38 }}>
              {wasQueued ? "⏳" : payMethod === "credit" ? "📝" : "✓"}
            </div>
            <div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 22 : 26 }}>
                {wasQueued ? "Sale Queued Offline" : payMethod === "credit" ? "Credit Sale Recorded!" : "Sale Recorded!"}
              </div>
              <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono, marginTop: 4 }}>
                {wasQueued
                  ? "Will sync automatically when your connection is restored."
                  : payMethod === "credit"
                  ? (() => { const ip = Math.min(Math.max(0, Number(initialPayment) || 0), grandTotal); return ip > 0 ? `${fmt(ip)} paid upfront · ${fmt(grandTotal - ip)} remaining` : `Stock deducted · ${fmt(grandTotal)} balance due`; })()
                  : `${cart.length} item${cart.length !== 1 ? "s" : ""} synced to owner dashboard`}
              </div>
              {/* Silent receipt status */}
              {receiptStatus !== "idle" && (
                <div style={{ marginTop: 8, fontSize: 11, fontFamily: theme.font.mono, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  color: receiptStatus === "sent" ? "#34d399" : receiptStatus === "failed" ? "#f87171" : theme.text.muted }}>
                  {receiptStatus === "sending" && (
                    <span style={{ width: 10, height: 10, border: "1.5px solid rgba(255,255,255,0.2)", borderTopColor: theme.text.muted, borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                  )}
                  {receiptStatus === "sent"    && "✓ Receipt sent"}
                  {receiptStatus === "failed"  && "⚠ Receipt could not be delivered"}
                  {receiptStatus === "sending" && "Sending receipt..."}
                </div>
              )}
            </div>
            <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 18, padding: "20px 22px", width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Ref + timestamp row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottom: `1px solid ${theme.border.default}` }}>
                <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {wasQueued ? "Status" : payMethod === "credit" ? "Credit Ref" : "Receipt Ref"}
                </span>
                <span style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 13, color: wasQueued ? "#fbbf24" : payMethod === "credit" ? theme.accent.red : theme.accent.cyan }}>
                  {wasQueued ? "Pending sync" : payMethod === "credit" ? `CR-${savedBatchRef}` : `TXN-${savedBatchRef}`}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Date &amp; Time</span>
                <span style={{ fontFamily: theme.font.mono, fontSize: 12, color: theme.text.secondary }}>{saleTimestamp}</span>
              </div>
              {/* Items */}
              {cart.map(item => (
              <div key={item.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: theme.text.secondary }}>
                  {item.quantity}× {cartItemName(item)}
                  {item.kind === "unlisted" && (
                    <span style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#c084fc", marginLeft: 6 }}>· unlisted</span>
                  )}
                </span>
                <span style={{ fontFamily: theme.font.mono, fontSize: 12, color: theme.text.primary }}>
                  {fmt(item.sellPrice * item.quantity)}
                </span>
              </div>
            ))}
              {/* Summary rows */}
              {payMethod === "credit" ? (
                <>
                  {[
                    { label: "Seller",   value: selectedAgent?.name ?? "—" },
                    { label: "Customer", value: customerName || "—" },
                    { label: "Phone",    value: customerPhone || "—" },
                    { label: "Payment",  value: "📝 Pay Later" },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                      <span style={{ fontSize: 13, fontFamily: theme.font.mono, fontWeight: 500, color: theme.text.primary }}>{value}</span>
                    </div>
                  ))}
                  {(() => {
                    const ip  = Math.max(0, Number(initialPayment) || 0);
                    const bal = grandTotal - ip;
                    return (
                      <>
                        {ip > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Paid Upfront</span>
                            <span style={{ fontSize: 13, fontFamily: theme.font.mono, fontWeight: 600, color: "#34d399" }}>{fmt(ip)}</span>
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${theme.border.default}`, paddingTop: 10, marginTop: 4 }}>
                          <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Balance Due</span>
                          <span style={{ fontSize: 20, fontFamily: theme.font.display, fontWeight: 800, color: bal <= 0 ? "#34d399" : theme.accent.red }}>{bal <= 0 ? "Paid ✓" : fmt(bal)}</span>
                        </div>
                      </>
                    );
                  })()}
                </>
              ) : (
                <>
                  {[
                    { label: "Seller",   value: selectedAgent?.name ?? "—" },
                    { label: "Payment",  value: payMethod === "cash" ? "💵 Cash" : payMethod === "mpesa" ? "📱 M-Pesa" : "⚡ Split" },
                    { label: "Customer", value: customerPhone || "—" },
                    { label: "Total",    value: fmt(grandTotal), highlight: true },
                  ].map(({ label, value, highlight }) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: highlight ? `1px solid ${theme.border.default}` : "none", paddingTop: highlight ? 10 : 0, marginTop: highlight ? 4 : 0 }}>
                      <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                      <span style={{ fontSize: highlight ? 20 : 13, fontFamily: highlight ? theme.font.display : theme.font.mono, fontWeight: highlight ? 800 : 500, color: highlight ? theme.accent.gold : theme.text.primary }}>{value}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
            <button className="abtn" onClick={handleReset}
              style={{ background: `linear-gradient(135deg,${theme.accent.cyan},#0891b2)`, color: "#fff", maxWidth: 320 }}>
              + New Sale
            </button>
          </div>
        )}
      
      </div>
    

      {/* ══════════════════ ADD-TO-CART OVERLAY ══════════════════ */}
      {addingProduct && (
        <div
          style={{ position: "fixed", inset: 0, background: theme.bg.overlay, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}
          onClick={e => {
            if (e.target === e.currentTarget) {
              setAddingProduct(null);
              setError("");
              if (reopenPayAfterEdit) {
                setReopenPayAfterEdit(false);
                setPayOpen(true);
              }
            }
          }}>
          <div className="overlay-sheet" style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 20, padding: "24px 20px 28px", width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Product info */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <ProductImage 
                  imageUrl={addingProduct.product.image_url} 
                  productName={addingProduct.product.name} 
                  size={48} 
                />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{addingProduct.product.name}</div>
                <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                  {addingProduct.product.sku} · {fmt(addingProduct.product.price)} · {addingProduct.remaining} left
                </div>
              </div>
              {cart.find(i => i.kind === "listed" && i.allocation.product_id === addingProduct.product_id) && (
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.accent.cyan, background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 8, padding: "3px 8px", flexShrink: 0 }}>
                  In cart
                </div>
              )}
            </div>

           

                          {/* Quantity */}
                                <div>
                                  <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>
                                    Quantity
                                  </label>

                                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    {/* Quick-pick chips */}
                                    {[1, 2, 3, 5, 10].map(q => (
                                      <button
                                        key={q}
                                        onClick={() => setAddQty(q.toString())}
                                        style={{
                                          width: 44,
                                          height: 44,
                                          flexShrink: 0,
                                          border: `1px solid ${addQty === q.toString() ? "rgba(6,182,212,0.5)" : theme.border.default}`,
                                          borderRadius: 10,
                                          cursor: "pointer",
                                          background: addQty === q.toString() ? "rgba(6,182,212,0.15)" : "transparent",
                                          color: addQty === q.toString() ? theme.accent.cyan : theme.text.muted,
                                          fontFamily: theme.font.mono,
                                          fontSize: 15,
                                          fontWeight: 600,
                                        }}
                                      >
                                        {q}
                                      </button>
                                    ))}

                                    {/* Custom qty input with "Qty" prefix */}
                                    <div
                                      style={{
                                        flex: "1 1 130px",
                                        minWidth: 120,
                                        maxWidth: 170,
                                        height: 44,
                                        display: "flex",
                                        alignItems: "center",
                                        border: "1.5px solid rgba(6,182,212,0.55)",
                                        borderRadius: 10,
                                        overflow: "hidden",
                                        background: theme.bg.input,
                                      }}
                                    >
                                      <span
                                        style={{
                                          padding: "0 8px 0 12px",
                                          fontFamily: theme.font.mono,
                                          fontSize: 12,
                                          fontWeight: 700,
                                          color: theme.accent.cyan,
                                          textTransform: "uppercase",
                                          letterSpacing: "0.05em",
                                          borderRight: "1px solid rgba(6,182,212,0.35)",
                                          height: "100%",
                                          display: "flex",
                                          alignItems: "center",
                                        }}
                                      >
                                        Qty
                                      </span>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={addQty}
                                        onChange={e => setAddQty(e.target.value.replace(/[^0-9]/g, ""))}
                                        placeholder="Custom"
                                        style={{
                                          flex: 1,
                                          height: "100%",
                                          minWidth: 0,
                                          background: "transparent",
                                          border: "none",
                                          outline: "none",
                                          textAlign: "center",
                                          fontFamily: theme.font.mono,
                                          fontWeight: 700,
                                          fontSize: 16,
                                          color: theme.accent.cyan,
                                          padding: "0 8px",
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>

            {/* Sell Price */}
            {(() => {
            
                  const sp      = Number(addSellPrice) || addingProduct.product.price;
                  const qty     = Math.max(1, parseInt(addQty) || 1);
                  const markup  = Math.max(0, sp - addingProduct.product.price);
                  const hasCommission = commissionConfig.enabled && commissionConfig.rate > 0;
                  return (
                    <div>
                      <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>
                        Sell Price
                        <span style={{ color: theme.text.muted, fontSize: 9, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>custom</span>
                      </label>
                      <input className="ki" type="text" inputMode="numeric"
                        value={addSellPrice}
                        onChange={e => { setAddSellPrice(sanitizeAmount(e.target.value)); setError(""); }}
                      />
                      {markup > 0 && (
                        <div style={{ fontSize: 11, fontFamily: theme.font.mono, marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#34d399" }}>Markup: {fmt(markup * qty)}</span>
                          {hasCommission && (
                            <span style={{ color: theme.accent.cyan }}>
                              Commission: {fmt(Math.round(markup * qty * commissionConfig.rate / 100))}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}



            {/* Subtotal preview */}
            <div style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${theme.border.default}`, borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted }}>Subtotal</span>
              <span style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 18, color: theme.accent.gold }}>
                {fmt((Number(addSellPrice) || addingProduct.product.price) * (Math.max(1, parseInt(addQty) || 1)))}
              </span>
            </div>

            {error && (
              <div style={{ color: theme.accent.red, fontSize: 12, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 12px" }}>⚠ {error}</div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => {
                setAddingProduct(null);
                setError("");
                if (reopenPayAfterEdit) {
                  setReopenPayAfterEdit(false);
                  setPayOpen(true);
                }
              }}
              style={{ flex: 1, padding: "14px", border: `1px solid ${theme.border.default}`, borderRadius: 13, background: "transparent", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 14, cursor: "pointer" }}
            >
              Cancel
            </button>
              <button className="abtn" onClick={handleAddToCart}
                style={{ flex: 2, background: `linear-gradient(135deg,${theme.accent.cyan},#0891b2)`, color: "#fff", fontSize: 15 }}>
                {cart.find(i => i.kind === "listed" && i.allocation.product_id === addingProduct.product_id) ? "Update Cart" : "Add to Cart"} →
              </button>
            </div>
          </div>
        </div>
      )}

   
      
<UnlistedItemModal
  open={unlistedOpen}
  onClose={() => {
    setUnlistedOpen(false);
    setEditingUnlistedKey(null);
    if (reopenPayAfterEdit) {
      setReopenPayAfterEdit(false);
      setPayOpen(true);
    }
  }}
  customItems={customItems}
  theme={theme}
  isMobile={isMobile}
  onSaveCustomItem={saveCustomItem}
  onAdd={handleAddUnlisted}
  initialItem={
    editingUnlistedKey
      ? (() => {
          const item = cart.find(i => i.key === editingUnlistedKey);
          if (!item || item.kind !== "unlisted") return null;
          return {
            customItemId: item.customItemId,
            name: item.name,
            unit: item.unit,
            quantity: item.quantity,
            sellPrice: item.sellPrice,
          };
        })()
      : null
  }
/>

{/* ══════════════════ SALE DOCK ══════════════════ */}
{step === "scan" && cart.length > 0 && !addingProduct && !payOpen && !unlistedOpen && (
  <SaleDock
    count={cart.length}
    total={grandTotal}
    theme={theme}
    disabled={cart.length === 0}
    onExpand={() => setPayOpen(true)}
    onCharge={() => setPayOpen(true)}
    bottomOffset={NAV_H}
  />
)}

{/* ══════════════════ ADD TOAST ══════════════════ */}
{toast && step === "scan" && !payOpen && (
  <AddToast
    text={toast.text}
    theme={theme}
    bottomOffset={NAV_H}
    onEdit={toast.lastKey ? () => { setToast(null); setPayOpen(true); } : undefined}
  onUndo={() => undoItem(toast.lastKey!)}
  />
)}


<CenterModal
  open={payOpen}
  onClose={() => {
    if (processing) return;
    setPayOpen(false);
    setPin(""); setPinError(""); setPinFails(0);
    setSelectedAgent(null);
    setError(""); 
  }}
  theme={theme}
  maxWidth={480}
>
  {processing ? (
    <div style={{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <div style={{ position: "relative", width: 56, height: 56 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "3px solid rgba(6,182,212,0.15)" }} />
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "3px solid transparent", borderTopColor: theme.accent.cyan, animation: "spin 0.75s linear infinite" }} />
      </div>
      <div style={{ fontFamily: theme.font.mono, fontSize: 12, color: theme.text.muted }}>
        {payMethod === "credit" ? "Recording credit sale…" : `Processing ${cart.length} item${cart.length !== 1 ? "s" : ""}…`}
      </div>
    </div>
  ) : (
    <>
      {/* ── Header: total + close ── */}
      <div style={{ padding: "16px 18px 12px", borderBottom: `1px solid ${theme.border.default}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Charge · {cart.length} item{cart.length !== 1 ? "s" : ""}
            </div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 22, color: theme.accent.gold, lineHeight: 1.1 }}>
              {fmt(grandTotal)}
            </div>
          </div>
          <button
            onClick={() => {
              setPayOpen(false);
              setPin(""); setPinError(""); setPinFails(0);
              setSelectedAgent(null);
              setError(""); 
              
            }}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: "50%",
              border: `1px solid ${theme.border.default}`,
              background: "transparent", color: theme.text.muted,
              cursor: "pointer", fontSize: 14,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "12px 18px 18px" }}>

                {/* ── Cart items — editable ── */}
                <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Items
            </span>
            {cart.length > 0 && (
              <button
                onClick={() => {
                  if (!confirm("Clear all items from the cart?")) return;
                  setCart([]);
                  setSelectedAgent(null);
                  setPin(""); setPinError("");
                  setError("");
                }}
                style={{
                  background: "none", border: "none",
                  color: "#f87171", fontSize: 10, cursor: "pointer",
                  fontFamily: theme.font.mono, fontWeight: 700,
                  padding: 0,
                }}
              >
                Clear all
              </button>
            )}
          </div>
          
                <div style={{
  maxHeight: 260,
  overflowY: "auto",
  overflowX: "hidden",
  paddingRight: 4,
  WebkitOverflowScrolling: "touch",
}}>
  {/* Column headers */}
  <div style={{
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 52px 76px 72px 22px",
    gap: 6, alignItems: "center",
    fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted,
    textTransform: "uppercase", letterSpacing: "0.06em",
    padding: "0 0 6px",
    position: "sticky", top: 0,
    background: theme.bg.card,
    zIndex: 1,
  }}>
    <span>Product</span>
    <span style={{ textAlign: "center" }}>Qty</span>
    <span style={{ textAlign: "center" }}>Price</span>
    <span style={{ textAlign: "right" }}>Total</span>
    <span />
  </div>

  {cart.map(item => {
    const isListed  = item.kind === "listed";
    const remaining = isListed ? item.allocation.remaining : 9999;
    const minPrice  = isListed ? item.allocation.product.price : 0;
    return (
      <div key={item.key} style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 52px 76px 72px 22px",
        gap: 6, alignItems: "center",
        padding: "7px 0",
        borderBottom: `1px solid ${theme.border.default}`,
      }}>
        {/* Product — the minmax(0,1fr) col truncates cleanly */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <ProductImage imageUrl={cartItemImage(item)} productName={cartItemName(item)} size={28} />
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 12, fontWeight: 600,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {cartItemName(item)}
            </div>
            {!isListed && (
              <span style={{ fontSize: 9, fontFamily: theme.font.mono, color: "#c084fc" }}>unlisted</span>
            )}
          </div>
        </div>

        {/* Qty */}
        <input
          type="number" inputMode="numeric" min={1} max={remaining}
          value={item.quantity}
          onChange={e => {
            const v = parseInt(e.target.value, 10);
            if (isNaN(v) || v < 1) return;
            handleUpdateCartQty(item.key, Math.min(v, remaining));
          }}
          style={{
            width: "100%", padding: "5px 4px", boxSizing: "border-box",
            background: theme.bg.input,
            border: `1px solid ${theme.border.default}`,
            borderRadius: 7, color: theme.text.primary,
            fontFamily: theme.font.mono, fontSize: 12,
            textAlign: "center", outline: "none",
          }}
        />

        {/* Price */}
        <input
          type="number" inputMode="numeric" min={minPrice}
          value={item.sellPrice}
          onChange={e => {
            const v = Number(e.target.value);
            if (isNaN(v) || v < 0) return;
            handleUpdateCartPrice(item.key, v);
          }}
          style={{
            width: "100%", padding: "5px 4px", boxSizing: "border-box",
            background: theme.bg.input,
            border: `1px solid ${theme.border.default}`,
            borderRadius: 7, color: theme.text.primary,
            fontFamily: theme.font.mono, fontSize: 12,
            textAlign: "center", outline: "none",
          }}
        />

        {/* Line total */}
        <div style={{
          fontFamily: theme.font.mono, fontSize: 12, fontWeight: 700,
          color: theme.accent.gold, textAlign: "right",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {fmt(item.sellPrice * item.quantity)}
        </div>

        {/* Remove */}
        <button
          onClick={() => handleRemoveFromCart(item.key)}
          aria-label="Remove item"
          style={{
            width: 22, height: 22, padding: 0, lineHeight: 1,
            border: "none", background: "transparent",
            color: "#f87171", cursor: "pointer", fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ✕
        </button>
      </div>
    );
  })}
</div>
          {/* Add more link */}
          <button
            onClick={() => {
              setPayOpen(false);
              setSearchQuery("");
              setError("");
            }}
            style={{
              marginTop: 8, width: "100%",
              background: "transparent",
              border: "1px dashed rgba(6,182,212,0.3)",
              borderRadius: 10, padding: "8px 12px",
              color: theme.accent.cyan, fontFamily: theme.font.mono, fontSize: 11,
              cursor: "pointer",
            }}
          >
            + Add more products
          </button>
        </div>

        {/* ── Payment chips ── */}
        <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
          Payment
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 12 }}>
          {([
            { key: "cash"   as const, icon: "💵", label: "Cash"      },
            { key: "mpesa"  as const, icon: "📱", label: "M-Pesa"    },
            { key: "split"  as const, icon: "⚡", label: "Split"     },
            { key: "credit" as const, icon: "📝", label: "Pay Later" },
          ]).map(({ key, icon, label }) => {
            const sel = payMethod === key;
            return (
              <button
                key={key}
                onClick={() => { setPayMethod(key); setCashAmount(""); setMpesaAmount(""); setMpesaRef(""); setError("") }}
                style={{
                  padding: "9px 4px",
                  border: `1.5px solid ${sel ? theme.accent.cyan : theme.border.default}`,
                  borderRadius: 10,
                  background: sel ? "rgba(6,182,212,0.12)" : "transparent",
                  color: sel ? theme.accent.cyan : theme.text.muted,
                  fontFamily: theme.font.mono, fontWeight: 700, fontSize: 10,
                  cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                }}
              >
                <span style={{ fontSize: 17 }}>{icon}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* ── M-Pesa ref ── */}
        {(payMethod === "mpesa" || payMethod === "split") && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
              M-Pesa Ref (optional)
            </label>
            <input
              className="ki"
              value={mpesaRef}
              onChange={e => setMpesaRef(sanitizeCode(e.target.value, 12))}
              placeholder="e.g. QHX7K3LM2P"
              maxLength={12}
              spellCheck={false}
            />
          </div>
        )}

        {/* ── Split amounts ── */}
        {payMethod === "split" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 10, fontFamily: theme.font.mono, color: "#34d399", display: "block", marginBottom: 5, textTransform: "uppercase" }}>💵 Cash</label>
              <input className="ki" type="text" inputMode="numeric" value={cashAmount}
                onChange={e => {
                  const v = sanitizeAmount(e.target.value);
                  setCashAmount(v);
                  setMpesaAmount(String(Math.max(0, Math.round(grandTotal - (Number(v) || 0)))));
                }}
                placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.accent.cyan, display: "block", marginBottom: 5, textTransform: "uppercase" }}>📱 M-Pesa</label>
              <input className="ki" type="text" inputMode="numeric" value={mpesaAmount}
                onChange={e => {
                  const v = sanitizeAmount(e.target.value);
                  setMpesaAmount(v);
                  setCashAmount(String(Math.max(0, Math.round(grandTotal - (Number(v) || 0)))));
                }}
                placeholder="0" />
            </div>
          </div>
        )}

        {/* ── Credit fields ── */}
        {payMethod === "credit" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                        <div>
              <label style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", display: "block", marginBottom: 5 }}>
                Customer Name <span style={{ color: theme.accent.red }}>*</span>
              </label>
              <input
                id="credit-customer-name"
                className="ki"
                type="text"
                value={customerName}
                onChange={e => {
                  setCustomerName(sanitizeText(e.target.value, 60));
                  // Clear the "name required" error as soon as the user types
                  if (error && payMethod === "credit") setError("");
                }}
                placeholder="e.g. John Kamau"
                maxLength={60}
                style={{
                  borderColor: customerName.trim() ? undefined : "rgba(248,113,113,0.5)",
                }}
              />
              {!customerName.trim() && (
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: "#f87171", marginTop: 4 }}>
                  Required for Pay Later sales
                </div>
              )}
            </div>
            <div>
              <label style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", display: "block", marginBottom: 5 }}>
                Initial Payment <span style={{ color: theme.text.muted, textTransform: "none" }}>(optional)</span>
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input className="ki" type="text" inputMode="numeric" value={initialCashAmount}
                  onChange={e => {
                    const v = sanitizeAmount(e.target.value);
                    const c = Number(v) || 0;
                    const m = Number(initialMpesaAmount) || 0;
                    const cap = Math.round(grandTotal);
                    const safeC = c + m > cap ? Math.max(0, cap - m) : c;
                    setInitialCashAmount(String(safeC));
                    setInitialPayment(String(safeC + m));
                  }}
                  placeholder="💵 Cash" />
                <input className="ki" type="text" inputMode="numeric" value={initialMpesaAmount}
                  onChange={e => {
                    const v = sanitizeAmount(e.target.value);
                    const m = Number(v) || 0;
                    const c = Number(initialCashAmount) || 0;
                    const cap = Math.round(grandTotal);
                    const safeM = c + m > cap ? Math.max(0, cap - c) : m;
                    setInitialMpesaAmount(String(safeM));
                    setInitialPayment(String(c + safeM));
                  }}
                  placeholder="📱 M-Pesa" />
              </div>
            </div>
          </div>
        )}

        {/* ── Phone field for receipt — always visible ── */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", display: "block", marginBottom: 5 }}>
            Customer Phone <span style={{ color: theme.text.muted, textTransform: "none" }}>(optional — receipt sent if provided)</span>
          </label>
          <input className="ki" type="tel" value={customerPhone}
            onChange={e => setCustomerPhone(sanitizePhone(e.target.value))}
            placeholder="07XXXXXXXXX or 254XXXXXXXXX" maxLength={13} />
        </div>

                {/* ── Error banner ── */}
                {error && (
          <div style={{
            fontSize: 12,
            fontFamily: theme.font.mono,
            color: "#f87171",
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.25)",
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 12,
          }}>
            ⚠ {error}
          </div>
        )}

       

        {/* ── Agent picker ── */}
<div style={{ borderTop: `1px solid ${theme.border.default}`, paddingTop: 12 }}>
  {shopAgents.length === 0 ? (
    <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono, padding: 14, textAlign: "center" }}>
      No agents assigned to this shop yet.
    </div>
  ) : (
    <>
      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", marginBottom: 8 }}>
        Who is selling?
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {shopAgents.map(sa => (
          <button
          key={sa.id}
          onClick={() => {
            if (cart.length === 0) {
              setError("Add at least one product to the cart first.");
              return;
            }
            if (!payMethod) {
              setError("Choose a payment method before selecting an agent.");
              return;
            }
            if (payMethod === "credit" && !customerName.trim()) {
              setError("Enter the customer's name before selecting an agent for a credit sale.");
              setPinShake(true);
              setTimeout(() => setPinShake(false), 500);

              // Scroll the name field into view and focus it
              const el = document.getElementById("credit-customer-name") as HTMLInputElement | null;
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
              setTimeout(() => el?.focus(), 250);
              return;
            }
            setError("");
            setSelectedAgent(sa);
            setPin("");
            setPinError("");
          }}
            style={{
              padding: "10px 12px",
              border: `1px solid ${theme.border.default}`,
              borderRadius: 12, background: "transparent",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
              color: theme.text.primary,
            }}
          >
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(6,182,212,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: theme.accent.cyan, flexShrink: 0, fontSize: 13 }}>
              {sa.avatar || sa.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sa.name}</div>
              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>{sa.agent_code}</div>
            </div>
          </button>
        ))}
      </div>
    </>
  )}
</div>
            </div>
           </>
         )}
      </CenterModal>

                  {/* ══════════════════ PIN OVERLAY ══════════════════ */}
{payOpen && selectedAgent && !processing && (
  <div
    onClick={() => { setSelectedAgent(null); setPin(""); setPinError(""); }}
    style={{
      position: "fixed", inset: 0, zIndex: 80,
      background: "rgba(0,0,0,0.55)",
      backdropFilter: "blur(3px)",
      WebkitBackdropFilter: "blur(3px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      animation: "fadeIn 0.15s ease both",
    }}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{
        background: theme.bg.card,
        border: `1px solid ${theme.border.default}`,
        borderRadius: 20,
        boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
        padding: "18px 18px 22px",
        width: "min(340px, calc(100vw - 32px))",
        animation: "zoomIn 0.2s ease both",
      }}
    >
      {/* Header: agent + back */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button
          onClick={() => { setSelectedAgent(null); setPin(""); setPinError(""); }}
          aria-label="Back"
          style={{
            width: 28, height: 28, borderRadius: "50%",
            border: `1px solid ${theme.border.default}`,
            background: "transparent", color: theme.text.muted,
            cursor: "pointer", fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          ←
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selectedAgent.name}
          </div>
          <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
            Enter 4-digit PIN · auto-submits
          </div>
        </div>
      </div>

      {/* Sale total reminder */}
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>
          Sale Total
        </div>
        <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 22, color: theme.accent.gold, lineHeight: 1 }}>
          {fmt(grandTotal)}
        </div>
      </div>

      {/* Dots */}
      <div className={pinShake ? "shake" : ""} style={{ display: "flex", gap: 16, justifyContent: "center", marginBottom: 14, opacity: pinIsLocked ? 0.3 : 1 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            width: 14, height: 14, borderRadius: "50%",
            background: i < pin.length ? theme.accent.cyan : "transparent",
            border: `2.5px solid ${i < pin.length ? theme.accent.cyan : "rgba(255,255,255,0.22)"}`,
            transition: "all 0.15s cubic-bezier(0.34,1.56,0.64,1)",
            boxShadow: i < pin.length ? `0 0 12px ${theme.accent.cyan}65` : "none",
            transform: i < pin.length ? "scale(1.15)" : "scale(1)",
          }} />
        ))}
      </div>

      {/* Errors */}
      {(pinError || error) && (
        <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: "#f87171", textAlign: "center", marginBottom: 10 }}>
          ⚠ {pinError || error}
        </div>
      )}
      {pinIsLocked && (
        <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: "#f87171", textAlign: "center", marginBottom: 10 }}>
          🔒 Too many wrong PINs — try again in {pinCountdown}s
        </div>
      )}

      {/* Numpad */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map(k => (
          <button
            key={k}
            disabled={!k || pinIsLocked}
            onClick={() => { if (k) handlePinKey(k); }}
            style={{
              height: 48,
              border: "none", borderRadius: 10,
              background: k === "⌫" ? "rgba(248,113,113,0.08)" : k ? "rgba(255,255,255,0.06)" : "transparent",
              color: k === "⌫" ? "#f87171" : theme.text.primary,
              fontFamily: theme.font.mono,
              fontSize: k === "⌫" ? 18 : 20,
              cursor: k && !pinIsLocked ? "pointer" : "default",
              opacity: pinIsLocked ? 0.3 : 1,
              transition: "background 0.1s, transform 0.08s",
            }}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  </div>
)}

    </div>
  );
}