import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import { useNetwork } from "../context/NetworkContext";
import QrScanner from "../components/QrScanner";
import { supabase } from "../lib/supabase";
import { useOwnerFeatures } from "../lib/ownerFeatures";
import { enqueue } from "../lib/offlineQueue";
import { sanitizeSku, sanitizeText, sanitizePhone, sanitizeAmount, sanitizeCode, validatePhone } from "../lib/sanitize";

type Step         = "scan" | "checkout" | "verify" | "success";
type PayMethod    = "cash" | "mpesa" | "split" | "credit";
type VerifyMethod = "pin" | "badge";

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

interface LocalProduct {
  id: string; name: string; sku: string; price: number; unit: string;
}
interface LocalAlloc {
  id: string; allocated: number; remaining: number; product_id: string; product: LocalProduct;
}
interface LocalAgent {
  id: string; pin: string; active: boolean; agent_id: string;
  name: string; agent_code: string; avatar: string;
}
interface CartItem {
  allocation: LocalAlloc;
  quantity: number;
  sellPrice: number;
}

const STEPS: Step[] = ["scan", "checkout", "verify", "success"];
const STEP_LABELS   = { scan: "Products", checkout: "Cart", verify: "Authorise", success: "Done" };

export default function PosScan() {
  const { shop }  = useShopAuth();
  const { theme } = useTheme();
  const { isOnline, pendingCount, refreshPendingCount } = useNetwork();
  const navigate  = useNavigate();
  const width     = useWindowWidth();
  const isMobile  = width < 640;
  const isDesktop = width >= 1024;

  const { features } = useOwnerFeatures(shop?.owner_id);
  const canScan = features.scan_to_sell;

  // ── flow state ────────────────────────────────────────────────────────
  const [step,         setStep]         = useState<Step>("scan");
  const [verifyMethod, setVerifyMethod] = useState<VerifyMethod>("pin");

  // scan
  const [mode,           setMode]           = useState<"camera" | "manual">("camera");
  const [cameraActive,   setCameraActive]   = useState(true);
  const [badgeActive,    setBadgeActive]    = useState(false);
  const [manualSku,      setManualSku]      = useState("");
  const [myProducts,     setMyProducts]     = useState<LocalAlloc[]>([]);
  const [productSearch,  setProductSearch]  = useState("");

  // cart
  const [cart,           setCart]           = useState<CartItem[]>([]);
  const [cartRestored,   setCartRestored]   = useState(false);
  const [addingProduct,  setAddingProduct]  = useState<LocalAlloc | null>(null);
  const [addQty,         setAddQty]         = useState("1");
  const [addSellPrice,   setAddSellPrice]   = useState("");

  // checkout
  const [customerName,    setCustomerName]    = useState("");
  const [customerPhone,   setCustomerPhone]   = useState("");
  const [fieldErrors,     setFieldErrors]     = useState<Record<string, string>>({});

  // saved customer contacts
  interface SavedCustomer { id?: string; name: string; phone: string; }
  const customersKey = shop ? `pos_customers_${shop.id}` : null;
  const usageKey     = shop ? `pos_customer_usage_${shop.id}` : null;
  const [savedCustomers,   setSavedCustomers]   = useState<SavedCustomer[]>([]);
  const [customerQuery,    setCustomerQuery]    = useState("");
  const [showCustDropdown, setShowCustDropdown] = useState(false);
  const [usageMap, setUsageMap] = useState<Record<string, number>>({});
  const [initialPayment,  setInitialPayment]  = useState("");
  const [initialPayMethod, setInitialPayMethod] = useState<"cash" | "mpesa">("cash");
  const [payMethod,     setPayMethod]     = useState<PayMethod>("cash");
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
      const { agents, products, commission, bizName } = JSON.parse(raw);
      if (agents)     setShopAgents(agents);
      if (products)   setMyProducts(products);
      if (commission) setCommissionConfig(commission);
      if (bizName)    setBusinessName(bizName);
    } catch {}
  }, [cacheKey]);

  // Network fetch — skipped entirely when offline so we don't clobber the cache with empty data.
  useEffect(() => {
    if (!shop || !isOnline) return;
    (async () => {
      const [agentsRes, allocsRes, commRes, profileRes] = await Promise.all([
        supabase.from("shop_agents")
          .select("id, pin, active, agent_id, agent_name, agent_code, agent_avatar")
          .eq("shop_id", shop.id).eq("active", true),
        supabase.from("shop_allocations")
          .select("id, allocated, remaining, product_id, product_name, product_sku, product_price, product_unit")
          .eq("shop_id", shop.id),
        supabase.rpc("get_shop_commission", { p_owner_id: shop.owner_id }),
        supabase.from("profiles").select("business_name").eq("id", shop.owner_id).single(),
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
          .from("products").select("id, name, sku, price, unit").in("id", productIds);
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
            },
          };
        });

      // Only show items with stock available in the scan UI
      const products = allProducts.filter(p => p.remaining > 0);

      setCommissionConfig(commission);
      setBusinessName(bizName);
      setShopAgents(agents);
      setMyProducts(products);

      // Persist to cache so the next offline session has fresh data.
      if (cacheKey) {
        try { localStorage.setItem(cacheKey, JSON.stringify({ agents, products, commission, bizName })); } catch {}
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
    if (!usageKey) return;
    try {
      const raw = localStorage.getItem(usageKey);
      if (raw) setUsageMap(JSON.parse(raw));
    } catch {}
  }, [usageKey]);

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

  const touchUsage = useCallback((phone: string) => {
    if (!phone.trim()) return;
    setUsageMap(prev => {
      const next = { ...prev, [phone.trim()]: Date.now() };
      if (usageKey) { try { localStorage.setItem(usageKey, JSON.stringify(next)); } catch {} }
      return next;
    });
  }, [usageKey]);

  const saveCustomer = useCallback(async (name: string, phone: string) => {
    if (!shop || !name.trim() || !phone.trim()) return;
    const already = savedCustomers.some(
      c => c.phone === phone.trim() || c.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (already) return;
    const { data } = await supabase
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
    }
  }, [shop, savedCustomers, customersKey]);

  const filteredCustomers = (customerQuery.trim()
    ? savedCustomers.filter(c =>
        c.name.toLowerCase().includes(customerQuery.toLowerCase()) ||
        c.phone.includes(customerQuery)
      )
    : [...savedCustomers]
  ).sort((a, b) => (usageMap[b.phone] ?? 0) - (usageMap[a.phone] ?? 0) || a.name.localeCompare(b.name));

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
      .from("products").select("id, name, sku, price, unit").eq("id", data.product_id).single();
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
      },
    };
  }, [shop, myProducts]);

  const handleProductFound = (alloc: LocalAlloc) => {
    if (!alloc || alloc.remaining <= 0) {
      setScanFeedback(`No stock available for ${alloc?.product?.name ?? "this product"}.`);
      setTimeout(() => setScanFeedback(""), 2500);
      return;
    }
    const existing   = cart.find(i => i.allocation.product_id === alloc.product_id);
    const canEdit    = commissionConfig.enabled && commissionConfig.rate > 0;
    setAddQty(existing ? String(existing.quantity) : "1");
    setAddSellPrice(canEdit && existing ? String(existing.sellPrice) : String(alloc.product.price));
    setAddingProduct(alloc);
    setError("");
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
    handleProductFound(alloc);
  };

  const handleManualLookup = async () => {
    if (!manualSku.trim()) { setError("Enter a SKU."); return; }
    const alloc = await fetchAllocationBySku(manualSku.trim());
    if (!alloc) { setError(`"${manualSku}" not found in this shop's stock.`); return; }
    handleProductFound(alloc);
  };

  // ── cart ops ──────────────────────────────────────────────────────────
  const handleAddToCart = () => {
    if (!addingProduct) return;
    const qty      = Math.max(1, parseInt(addQty) || 1);
    const canEdit  = commissionConfig.enabled && commissionConfig.rate > 0;
    const sp       = canEdit ? (Number(addSellPrice) || addingProduct.product.price) : addingProduct.product.price;
    if (qty > addingProduct.remaining) {
      setError(`Only ${addingProduct.remaining} units available.`);
      return;
    }
    if (canEdit && sp < addingProduct.product.price) {
      setError(`Sell price cannot be less than ${fmt(addingProduct.product.price)}.`);
      return;
    }
    setCart(prev => {
      const existing = prev.find(i => i.allocation.product_id === addingProduct.product_id);
      if (existing) return prev.map(i => i.allocation.product_id === addingProduct.product_id ? { ...i, quantity: qty, sellPrice: sp } : i);
      return [...prev, { allocation: addingProduct, quantity: qty, sellPrice: sp }];
    });
    setAddingProduct(null);
    setAddQty("1");
    setAddSellPrice("");
    setError("");
  };

  const handleRemoveFromCart = (productId: string) => {
    setCart(prev => prev.filter(i => i.allocation.product_id !== productId));
  };

  const handleUpdateCartQty = (productId: string, qty: number) => {
    setCart(prev => prev.map(i => i.allocation.product_id === productId ? { ...i, quantity: Math.max(1, qty) } : i));
  };

  // ── checkout ──────────────────────────────────────────────────────────
  const grandTotal = cart.reduce((s, i) => s + i.sellPrice * i.quantity, 0);

  function validateField(name: string, value: string, method = payMethod): string {
    if (name === "customerName") {
      const v = value.trim();
      if (method === "credit" && !v) return "Name is required for credit sales";
      if (v && v.length < 2) return "Name must be at least 2 characters";
      if (v.length > 60) return "Name must be 60 characters or fewer";
      return "";
    }
    if (name === "customerPhone") {
      const v = value.trim();
      if (method === "credit" && !v) return "Phone is required for credit sales";
      if (v) {
        const err = validatePhone(v);
        if (err) return err;
      }
      return "";
    }
    if (name === "mpesaRef") {
      const v = value.trim();
      if (v && (v.length < 8 || v.length > 12)) return "M-Pesa ref should be 8–12 characters";
      return "";
    }
    return "";
  }

  const handleCheckoutNext = () => {
    if (cart.length === 0) { setError("Add at least one product to the cart."); return; }

    const errs: Record<string, string> = {
      customerName:  validateField("customerName",  customerName),
      customerPhone: validateField("customerPhone", customerPhone),
      mpesaRef:      (payMethod === "mpesa" || payMethod === "split") ? validateField("mpesaRef", mpesaRef) : "",
    };
    const hasErr = Object.values(errs).some(Boolean);
    if (hasErr) { setFieldErrors(errs); return; }

    if (payMethod === "split") {
      const c = Number(cashAmount) || 0, m = Number(mpesaAmount) || 0;
      if (!cashAmount || !mpesaAmount) { setError("Enter both Cash and M-Pesa amounts."); return; }
      if (Math.abs(c + m - grandTotal) > 1) { setError(`Cash + M-Pesa must equal ${fmt(grandTotal)}.`); return; }
    }
    setFieldErrors({});
    setError("");
    setStep("verify");
  };

  // ── submit sale ───────────────────────────────────────────────────────
  const handleSubmitSale = async (verifiedAgent: LocalAgent) => {
    if (cart.length === 0) return;

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
        cart: cart.map(item => ({
          allocationId: item.allocation.id,
          productId:    item.allocation.product.id,
          productName:  item.allocation.product.name,
          quantity:     item.quantity,
          sellPrice:    item.sellPrice,
          basePrice:    item.allocation.product.price,
        })),
        payMethod,
        cashAmount:      Number(cashAmount)  || 0,
        mpesaAmount:     Number(mpesaAmount) || 0,
        mpesaRef:        mpesaRef.trim(),
        customerName:    customerName.trim(),
        customerPhone:   customerPhone.trim(),
        initialPayment:  Number(initialPayment) || 0,
        initialPayMethod,
        verifiedAgent:   { agent_id: verifiedAgent.agent_id, name: verifiedAgent.name },
        commissionConfig,
        grandTotal,
      });

      // Deduct stock locally so agents can't oversell during offline mode.
      setMyProducts(prev => {
        const allUpdated = prev.map(alloc => {
          const sold = cart.find(i => i.allocation.id === alloc.id);
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
      setStep("success");
      return;
    }

    setProcessing(true); setError("");

    try {
    // Deduct stock for every item regardless of payment method.
    // Track successfully deducted items so we can roll back on partial failure.
    const deducted: { id: string; quantity: number; name: string }[] = [];
    for (const item of cart) {
      const { error: stockErr } = await supabase.rpc("deduct_shop_stock", {
        p_shop_allocation_id: item.allocation.id,
        p_quantity: item.quantity,
      });
      if (stockErr) {
        // Best-effort rollback in parallel
        Promise.all(deducted.map(d =>
          supabase.rpc("deduct_shop_stock", { p_shop_allocation_id: d.id, p_quantity: -d.quantity })
        )).catch(() => {});
        setError(stockErr.message.includes("Insufficient")
          ? `Not enough stock for ${item.allocation.product.name}. Sale cancelled — all stock has been restored.`
          : `Failed to deduct stock for ${item.allocation.product.name}. Sale cancelled — all stock has been restored.`);
        return;
      }
      deducted.push({ id: item.allocation.id, quantity: item.quantity, name: item.allocation.product.name });
    }

    // ── Credit / Pay Later ────────────────────────────────────────────
    if (payMethod === "credit") {
      const creditItems = cart.map(item => ({
        allocation_id: item.allocation.id,
        product_id:    item.allocation.product.id,
        product_name:  item.allocation.product.name,
        quantity:      item.quantity,
        unit_price:    item.allocation.product.price,
        subtotal:      item.allocation.product.price * item.quantity,
      }));

      const initPaid  = Math.min(Math.max(0, Number(initialPayment) || 0), grandTotal);
      const initStatus = initPaid >= grandTotal - 0.5 ? "paid" : initPaid > 0 ? "partial" : "pending";

      const { data: creditData, error: creditErr } = await supabase
        .from("shop_credit_sales")
        .insert({
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
        })
        .select()
        .single();

      if (creditErr) {
        console.error("shop_credit_sales insert error:", creditErr);
        // Best-effort rollback — run in parallel so nothing blocks setProcessing
        Promise.all(deducted.map(d =>
          supabase.rpc("deduct_shop_stock", { p_shop_allocation_id: d.id, p_quantity: -d.quantity })
        )).catch(() => {});
        setError(`Credit sale failed: ${creditErr.message || creditErr.code || "unknown error"}`);
        return;
      }

      // Record initial payment (if any) into credit_payments
      if (initPaid > 0 && creditData?.id) {
        supabase.from("shop_credit_payments").insert({
          credit_sale_id: creditData.id,
          shop_id:        shop?.id,
          owner_id:       shop?.owner_id,
          amount:         initPaid,
          payment_method: initialPayMethod,
          mpesa_ref:      null,
        });
      }

      // Only record a shop_transaction when money was actually collected upfront.
      // Zero-upfront credit sales belong only in shop_credit_sales + shop_credit_payments;
      // a zero-amount shop_transaction would create ghost KSh 0 entries on the owner's dashboard.
      if (initPaid > 0) {
        const txStatus = initPaid >= grandTotal - 0.5 ? "ok" : "credit_partial";
        const { error: txCreditErr } = await supabase.rpc("insert_shop_transaction", {
          p_rows: {
            shop_id:           shop?.id,
            owner_id:          shop?.owner_id,
            seller_agent_id:   verifiedAgent.agent_id,
            product_id:        cart[0].allocation.product.id,
            quantity:          cart.reduce((s, i) => s + i.quantity, 0),
            amount:            initPaid,
            customer_phone:    customerPhone.trim(),
            payment_method:    initialPayMethod,
            cash_amount:       initialPayMethod === "cash"  ? initPaid : 0,
            mpesa_amount:      initialPayMethod === "mpesa" ? initPaid : 0,
            mpesa_ref:         null,
            status:            txStatus,
            unit_price:        cart[0].allocation.product.price,
            base_price:        cart[0].allocation.product.price,
            commission_rate:   0,
            commission_earned: 0,
            credit_sale_id:    creditData?.id ?? null,
          },
        });
        if (txCreditErr) console.error("credit transaction record error:", txCreditErr);
      }

      setSavedBatchRef((creditData?.id ?? "").slice(0, 8).toUpperCase());
      setSelectedAgent(verifiedAgent);
      setProcessing(false);
      setSaleTimestamp(new Date().toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }));
      setStep("success");

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
            items:           cart.map(item => ({
              name:       item.allocation.product.name,
              quantity:   item.quantity,
              unit_price: item.allocation.product.price,
              total:      item.allocation.product.price * item.quantity,
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

    const firstId = (data?.[0]?.id ?? "").slice(0, 8).toUpperCase();
    setSavedBatchRef(firstId);
    setSelectedAgent(verifiedAgent);
    setProcessing(false);
    setSaleTimestamp(new Date().toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }));
    setStep("success");

    // Auto-save customer contact if name + phone were provided
    if (customerName.trim() && customerPhone.trim()) {
      saveCustomer(customerName.trim(), customerPhone.trim());
      touchUsage(customerPhone.trim());
    }

    // Fire receipt asynchronously — sale is already saved, this is best-effort
    if (customerPhone.trim()) {
      setReceiptStatus("sending");
      supabase.functions.invoke("send-receipt", {
        body: {
          phone:          customerPhone.trim(),
          business_name:  businessName,
          agent_name:     verifiedAgent.name,
          items:          cart.map(item => ({
            name:       item.allocation.product.name,
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

  const handleReset = () => {
    setStep("scan"); setMode("camera"); setManualSku(""); setProductSearch("");
    setCart([]); setAddingProduct(null); setAddQty("1"); setAddSellPrice("");
    setSelectedAgent(null); setPin(""); setPinError(""); setBadgeError("");
    setCustomerName(""); setCustomerPhone(""); setCustomerQuery(""); setShowCustDropdown(false);
    setInitialPayment(""); setInitialPayMethod("cash"); setPayMethod("cash");
    setCashAmount(""); setMpesaAmount(""); setMpesaRef("");
    setError(""); setScanFeedback(""); setProcessing(false); setFieldErrors({});
    setVerifyMethod("pin"); setReceiptStatus("idle"); setCartRestored(false); setWasQueued(false);
    if (cartKey) localStorage.removeItem(cartKey);
    // Reset PIN lockout for the next sale
    setPinFails(0); setPinCountdown(0);
    if (pinLockRef.current) { clearInterval(pinLockRef.current); pinLockRef.current = null; }
  };

  const goBack = () => {
    setError("");
    if (step === "checkout") { setStep("scan"); }
    if (step === "verify")   { setStep("checkout"); setBadgeActive(false); }
  };

  return (
    <div style={{ minHeight: "100vh", background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.body }}>

      {/* Offline banner */}
      {!isOnline && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
          background: "#92400e",
          color: "#fef3c7",
          padding: "10px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontFamily: "monospace", fontSize: 13, fontWeight: 600,
          boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span>⚡</span>
            Offline — sales will be queued and synced when connection returns.
          </div>
          {pendingCount > 0 && (
            <span style={{ background: "#fef3c7", color: "#92400e", borderRadius: 20, padding: "2px 10px", fontSize: 11 }}>
              {pendingCount} queued
            </span>
          )}
        </div>
      )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp     { from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin       { to{transform:rotate(360deg)} }
        @keyframes successPop { 0%{transform:scale(0.5);opacity:0}70%{transform:scale(1.1)}100%{transform:scale(1);opacity:1} }
        @keyframes shake      { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }
        @keyframes slideUp    { from{opacity:0;transform:scale(0.96)}to{opacity:1;transform:scale(1)} }
        .section       { animation: fadeUp 0.3s ease both; }
        .success-icon  { animation: successPop 0.5s ease forwards; }
        .shake         { animation: shake 0.35s ease; }
        .overlay-sheet { animation: slideUp 0.25s ease both; }
        ${theme.kiCss.replace(/border-radius:10px/g, "border-radius:12px").replace(/font-size:14px/g, "font-size:15px").replace(/padding:11px 13px/g, "padding:13px 14px")}
        .abtn { border:none;cursor:pointer;font-family:'Syne',sans-serif;font-weight:800;font-size:16px;border-radius:14px;padding:16px;width:100%;transition:opacity 0.15s,transform 0.1s; }
        .abtn:active { transform:scale(0.98); }
        .abtn:disabled { opacity:0.45;cursor:not-allowed; }
        .pin-digit { width:${isMobile ? "46px" : "52px"};height:${isMobile ? "58px" : "64px"};border:2px solid ${theme.border.default};border-radius:12px;display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;font-size:26px;font-weight:700;transition:all 0.15s; }
        .pin-digit.filled { border-color:${theme.accent.cyan}80;background:${theme.accent.cyan}14; }
        .back-btn:hover { background:rgba(255,255,255,0.08) !important; }
        .cart-row:hover { background:rgba(255,255,255,0.03) !important; }
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
              <div style={{ color: theme.text.muted, fontSize: 10, fontFamily: theme.font.mono, marginTop: 1 }}>
                {step === "scan"     ? "Scan or pick products to add to cart"                                         : ""}
                {step === "checkout" ? `${cart.length} item${cart.length !== 1 ? "s" : ""} · ${fmt(grandTotal)}`     : ""}
                {step === "verify"   ? "Verify identity to complete the sale"                                         : ""}
                {step === "success"  ? (wasQueued ? "Queued — will sync when online" : "Transaction saved successfully") : ""}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {step === "scan" && cart.length > 0 && (
              <button onClick={() => { setStep("checkout"); setError(""); }}
                style={{ background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.3)", borderRadius: 10, padding: "7px 12px", color: theme.accent.cyan, fontSize: 12, fontFamily: theme.font.mono, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                🛒 {cart.length} · {fmt(grandTotal)}
              </button>
            )}
            <button onClick={step === "scan" ? () => navigate("/pos") : handleReset}
              style={{ background: "none", border: `1px solid ${theme.border.default}`, borderRadius: 9, padding: "7px 13px", color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, cursor: "pointer", whiteSpace: "nowrap" }}>
              {step === "scan" ? "← Back" : "✕ Cancel"}
            </button>
          </div>
        </div>

        {/* Step progress */}
        {step !== "success" && (
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {(["scan", "checkout", "verify"] as Step[]).map((s, i) => {
              const done    = STEPS.indexOf(step) > i;
              const current = step === s;
              return (
                <div key={s} style={{ display: "flex", alignItems: "center", flex: i < 2 ? 1 : "none" }}>
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
                  <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: current ? theme.accent.cyan : theme.text.muted, marginLeft: 5, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                    {STEP_LABELS[s]}
                  </div>
                  {i < 2 && <div style={{ flex: 1, height: 1, background: done ? theme.accent.cyan : "rgba(255,255,255,0.08)", margin: "0 8px" }} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ padding: isMobile ? "14px 14px 90px" : "20px 32px 90px", maxWidth: isDesktop ? 1100 : 720, margin: "0 auto" }}>

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
              {(["camera", "manual"] as const).map(m => (
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
                  Camera Scan is a Hustler Feature
                </div>
                <div style={{ fontFamily: theme.font.mono, fontSize: 12, color: theme.text.muted, lineHeight: 1.7, marginBottom: 16 }}>
                  This shop's plan doesn't include QR scanning.<br />
                  Products can still be added manually from the list.
                </div>
                <div style={{ fontFamily: theme.font.mono, fontSize: 11, color: "rgba(168,85,247,0.7)", background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.18)", borderRadius: 8, padding: "8px 14px", display: "inline-block" }}>
                  Ask the business owner to upgrade to Hustler to unlock scanning
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
                <div>
                  <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>Enter SKU manually</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input className="ki" value={manualSku}
                      onChange={e => { setManualSku(sanitizeSku(e.target.value)); setError(""); }}
                      placeholder="e.g. SAM-EAR-A10" style={{ flex: 1 }}
                      maxLength={40} spellCheck={false}
                      onKeyDown={e => e.key === "Enter" && handleManualLookup()} />
                    <button onClick={handleManualLookup}
                      style={{ background: `linear-gradient(135deg,${theme.accent.cyan},#0891b2)`, border: "none", borderRadius: 12, padding: "0 16px", color: "#fff", fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
                      Look Up
                    </button>
                  </div>
                </div>
                {error && <div style={{ color: theme.accent.red, fontSize: 12, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 12px" }}>⚠ {error}</div>}

                {/* Inventory search */}
                {myProducts.length > 0 && (
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.4 }}>🔍</span>
                    <input className="ki" value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      placeholder="Filter by name or SKU…"
                      style={{ paddingLeft: 36 }} />
                  </div>
                )}

                {myProducts.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "36px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14 }}>
                    <div style={{ fontSize: 34, opacity: 0.2, marginBottom: 10 }}>📦</div>
                    <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono }}>No stock available</div>
                  </div>
                ) : (() => {
                  const q = productSearch.toLowerCase();
                  const filtered = q
                    ? myProducts.filter(a => a.product.name.toLowerCase().includes(q) || a.product.sku.toLowerCase().includes(q))
                    : myProducts;
                  return (
                    <div>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                        {q ? `${filtered.length} of ${myProducts.length} products` : `Available (${myProducts.length})`}
                      </div>
                      {filtered.length === 0 && (
                        <div style={{ textAlign: "center", padding: "24px 16px", color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono }}>No products match "{productSearch}"</div>
                      )}
                      <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: 8 }}>
                        {filtered.map(alloc => {
                          const sc     = alloc.remaining <= 3 ? "#f87171" : alloc.remaining <= 10 ? "#fbbf24" : "#34d399";
                          const pct    = alloc.allocated > 0 ? Math.round((alloc.remaining / alloc.allocated) * 100) : 0;
                          const inCart = cart.find(i => i.allocation.product_id === alloc.product_id);
                          return (
                            <button key={alloc.id} onClick={() => handleProductFound(alloc)}
                              style={{ padding: "13px 14px", border: `1px solid ${inCart ? "rgba(6,182,212,0.3)" : "rgba(255,255,255,0.08)"}`, borderRadius: 13, background: inCart ? "rgba(6,182,212,0.05)" : "linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, textAlign: "left", transition: "border-color 0.15s" }}
                              onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(6,182,212,0.3)")}
                              onMouseLeave={e => (e.currentTarget.style.borderColor = inCart ? "rgba(6,182,212,0.3)" : "rgba(255,255,255,0.08)")}>
                              <div style={{ width: 40, height: 40, borderRadius: 9, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>📦</div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: theme.text.primary, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{alloc.product.name}</div>
                                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 5 }}>{alloc.product.sku} · {fmt(alloc.product.price)}</div>
                                <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 3, height: 3 }}>
                                  <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: sc }} />
                                </div>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                                <div style={{ background: `${sc}18`, border: `1px solid ${sc}40`, borderRadius: 10, padding: "6px 10px", textAlign: "center", minWidth: 46 }}>
                                  <div style={{ fontSize: 17, fontFamily: theme.font.mono, fontWeight: 800, color: sc, lineHeight: 1 }}>{alloc.remaining}</div>
                                  <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: sc, opacity: 0.8, marginTop: 2 }}>{alloc.product.unit}</div>
                                </div>
                                {inCart && (
                                  <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.accent.cyan, background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 6, padding: "2px 7px" }}>
                                    ×{inCart.quantity} in cart
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Checkout bar */}
            {cart.length > 0 && (
              <div style={{ position: "sticky", bottom: isMobile ? 70 : 16, marginTop: 4 }}>
                <button className="abtn" onClick={() => { setStep("checkout"); setError(""); }}
                  style={{ background: `linear-gradient(135deg,${theme.accent.cyan},#0891b2)`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px" }}>
                  <span>🛒 Review Cart ({cart.length} item{cart.length !== 1 ? "s" : ""})</span>
                  <span style={{ fontFamily: theme.font.mono, fontSize: 15 }}>{fmt(grandTotal)} →</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ STEP 2: CHECKOUT ══════════════════ */}
        {step === "checkout" && (
          <div className="section" style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 14 : 20, alignItems: "flex-start" }}>

            {/* LEFT COLUMN — Cart */}
            <div style={{ flex: isMobile ? "unset" : "0 0 44%", display: "flex", flexDirection: "column", gap: 14, position: isMobile ? "static" : "sticky", top: 80, width: isMobile ? "100%" : "auto" }}>
              {/* Cart items */}
              <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: `1px solid ${theme.border.default}`, fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Cart — {cart.length} item{cart.length !== 1 ? "s" : ""}
                </div>
                {cart.map((item, idx) => {
                  const itemTotal = item.sellPrice * item.quantity;
                  return (
                    <div key={item.allocation.product_id} className="cart-row" style={{ padding: "13px 16px", borderBottom: idx < cart.length - 1 ? `1px solid ${theme.border.default}` : "none", display: "flex", alignItems: "center", gap: 12, transition: "background 0.15s" }}>
                      <div style={{ width: 36, height: 36, borderRadius: 9, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>📦</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.allocation.product.name}</div>
                        <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                          {fmt(item.sellPrice)} each
                          {item.sellPrice > item.allocation.product.price && (
                            <span style={{ color: "#34d399", marginLeft: 5 }}>+{fmt(item.sellPrice - item.allocation.product.price)} markup</span>
                          )}
                        </div>
                      </div>
                      {/* Qty stepper */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          onClick={() => {
                            if (item.quantity <= 1) handleRemoveFromCart(item.allocation.product_id);
                            else handleUpdateCartQty(item.allocation.product_id, item.quantity - 1);
                          }}
                          style={{ width: 28, height: 28, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7, background: "rgba(255,255,255,0.04)", color: item.quantity <= 1 ? theme.accent.red : theme.text.primary, cursor: "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {item.quantity <= 1 ? "✕" : "−"}
                        </button>
                        <span style={{ fontFamily: theme.font.mono, fontSize: 14, fontWeight: 600, minWidth: 22, textAlign: "center" }}>{item.quantity}</span>
                        <button
                          onClick={() => { if (item.quantity < item.allocation.remaining) handleUpdateCartQty(item.allocation.product_id, item.quantity + 1); }}
                          disabled={item.quantity >= item.allocation.remaining}
                          style={{ width: 28, height: 28, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7, background: "rgba(255,255,255,0.04)", color: theme.accent.cyan, cursor: item.quantity >= item.allocation.remaining ? "not-allowed" : "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", opacity: item.quantity >= item.allocation.remaining ? 0.35 : 1 }}>
                          +
                        </button>
                      </div>
                      <div style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 14, color: theme.accent.gold, minWidth: 72, textAlign: "right" }}>{fmt(itemTotal)}</div>
                    </div>
                  );
                })}
                <div style={{ padding: "13px 16px", borderTop: `1px solid ${theme.border.default}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.02)" }}>
                  <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase" }}>Grand Total</span>
                  <span style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 22, color: theme.accent.gold }}>{fmt(grandTotal)}</span>
                </div>

                {/* Commission strip */}
                {commissionConfig.enabled && commissionConfig.rate > 0 && (() => {
                  const totalComm = payMethod === "credit" ? 0 : cart.reduce((s, item) => {
                    const markup = Math.max(0, item.sellPrice - item.allocation.product.price);
                    return s + Math.round(markup * item.quantity * commissionConfig.rate / 100);
                  }, 0);
                  if (payMethod === "credit") {
                    return (
                      <div style={{ padding: "10px 16px", borderTop: `1px solid ${theme.border.default}`, display: "flex", alignItems: "center", gap: 10, background: "rgba(248,113,113,0.05)" }}>
                        <span style={{ fontSize: 14 }}>💸</span>
                        <span style={{ flex: 1, fontSize: 11, fontFamily: theme.font.mono, color: "rgba(248,113,113,0.8)" }}>No commission on Pay Later sales</span>
                        <span style={{ fontSize: 12, fontFamily: theme.font.mono, fontWeight: 700, color: "rgba(248,113,113,0.6)" }}>KSh 0</span>
                      </div>
                    );
                  }
                  if (totalComm > 0) {
                    return (
                      <div style={{ padding: "10px 16px", borderTop: `1px solid ${theme.border.default}`, display: "flex", alignItems: "center", gap: 10, background: "rgba(52,211,153,0.05)" }}>
                        <span style={{ fontSize: 14 }}>💰</span>
                        <span style={{ flex: 1, fontSize: 11, fontFamily: theme.font.mono, color: "#34d399" }}>Your commission ({commissionConfig.rate}% on markup)</span>
                        <span style={{ fontSize: 14, fontFamily: theme.font.mono, fontWeight: 800, color: "#34d399" }}>+{fmt(totalComm)}</span>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* Add more */}
              <button onClick={() => { setStep("scan"); setError(""); }}
                style={{ background: "transparent", border: "1px dashed rgba(6,182,212,0.3)", borderRadius: 12, padding: "12px 16px", color: theme.accent.cyan, fontFamily: theme.font.mono, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                + Add more products
              </button>
            </div>

            {/* RIGHT COLUMN — Payment + customer info */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
              {/* Payment method */}
              <div>
                <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Payment Method</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {([
                    { key: "cash",   icon: "💵", label: "Cash",      col: "#34d399"         },
                    { key: "mpesa",  icon: "📱", label: "M-Pesa",    col: theme.accent.cyan  },
                    { key: "split",  icon: "⚡", label: "Split",     col: theme.accent.gold  },
                    { key: "credit", icon: "📝", label: "Pay Later", col: theme.accent.red   },
                  ] as const).map(({ key, icon, label, col }) => (
                    <button key={key} onClick={() => { setPayMethod(key); setCashAmount(""); setMpesaAmount(""); setMpesaRef(""); }}
                      style={{ padding: "12px 8px", border: `1px solid ${payMethod === key ? col + "80" : theme.border.default}`, borderRadius: 12, background: payMethod === key ? col + "18" : "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 20 }}>{icon}</span>
                      <span style={{ fontSize: 11, fontFamily: theme.font.mono, fontWeight: 600, color: payMethod === key ? col : theme.text.muted }}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Credit notice + initial payment */}
              {payMethod === "credit" && (
                <>
                  <div style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 12, padding: "11px 14px", fontSize: 12, fontFamily: theme.font.mono, color: theme.accent.red, lineHeight: 1.6 }}>
                    📝 Stock will be deducted now. Payment will be tracked separately under the Credit tab in Shop.
                    {commissionConfig.enabled && commissionConfig.rate > 0 && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(248,113,113,0.2)", color: "rgba(248,113,113,0.75)", fontSize: 11 }}>
                        💸 No commission is earned on Pay Later sales.
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>
                      Initial Payment <span style={{ color: theme.text.muted, textTransform: "none", letterSpacing: 0 }}>(optional — 0 by default)</span>
                    </label>
                    <input className="ki" type="number" value={initialPayment}
                      onChange={e => {
                        const clean = sanitizeAmount(e.target.value);
                        const val   = Number(clean) || 0;
                        const cap   = Math.round(grandTotal);
                        setInitialPayment(val > cap ? String(cap) : clean);
                      }}
                      placeholder={`e.g. 500 of ${fmt(grandTotal)}`}
                      min="0" max={Math.round(grandTotal)} />
                    {Number(initialPayment) > 0 && (
                      <>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          {([{ key: "cash", icon: "💵", label: "Cash" }, { key: "mpesa", icon: "📱", label: "M-Pesa" }] as const).map(({ key, icon, label }) => (
                            <button key={key} onClick={() => setInitialPayMethod(key)}
                              style={{ flex: 1, padding: "8px", border: `1px solid ${initialPayMethod === key ? theme.accent.green + "80" : theme.border.default}`, borderRadius: 10, background: initialPayMethod === key ? theme.accent.green + "18" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: theme.font.mono, fontSize: 11, fontWeight: 600, color: initialPayMethod === key ? theme.accent.green : theme.text.muted }}>
                              {icon} {label}
                            </button>
                          ))}
                        </div>
                        <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.accent.green, marginTop: 6 }}>
                          Balance after payment: {fmt(Math.max(0, grandTotal - Math.min(Number(initialPayment), grandTotal)))}
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}

              {payMethod === "split" && (
                <div style={{ background: "rgba(234,179,8,0.05)", border: "1px solid rgba(234,179,8,0.2)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.accent.gold }}>⚡ Split — Total: {fmt(grandTotal)}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ fontSize: 10, fontFamily: theme.font.mono, color: "#34d399", display: "block", marginBottom: 5, textTransform: "uppercase" }}>💵 Cash</label>
                      <input className="ki" type="number" value={cashAmount}
                        onChange={e => { const v = sanitizeAmount(e.target.value); setCashAmount(v); setMpesaAmount(String(Math.max(0, grandTotal - (Number(v) || 0)))); }}
                        placeholder="0" min="0" />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.accent.cyan, display: "block", marginBottom: 5, textTransform: "uppercase" }}>📱 M-Pesa</label>
                      <input className="ki" type="number" value={mpesaAmount}
                        onChange={e => { const v = sanitizeAmount(e.target.value); setMpesaAmount(v); setCashAmount(String(Math.max(0, grandTotal - (Number(v) || 0)))); }}
                        placeholder="0" min="0" />
                    </div>
                  </div>
                </div>
              )}

              {(payMethod === "mpesa" || payMethod === "split") && (
                <div>
                  <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>M-Pesa Ref <span style={{ color: theme.text.muted, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
                  <input className="ki" value={mpesaRef}
                    onChange={e => {
                      setMpesaRef(sanitizeCode(e.target.value, 12));
                      if (fieldErrors.mpesaRef) setFieldErrors(prev => ({ ...prev, mpesaRef: "" }));
                    }}
                    onBlur={() => {
                      const err = validateField("mpesaRef", mpesaRef);
                      if (err) setFieldErrors(prev => ({ ...prev, mpesaRef: err }));
                    }}
                    placeholder="e.g. QHX7K3LM2P" maxLength={12} spellCheck={false} />
                  {fieldErrors.mpesaRef && (
                    <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: "#f87171", marginTop: 4 }}>⚠ {fieldErrors.mpesaRef}</div>
                  )}
                </div>
              )}

              {/* ── Customer section ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                {/* Saved customers button */}
                {savedCustomers.length > 0 && (
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={() => setShowCustDropdown(v => !v)}
                      style={{ width: "100%", padding: "10px 14px", background: showCustDropdown ? "rgba(6,182,212,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${showCustDropdown ? "rgba(6,182,212,0.4)" : theme.border.default}`, borderRadius: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 10, color: theme.text.primary, transition: "all 0.15s" }}>
                      <span style={{ fontSize: 16 }}>👤</span>
                      <span style={{ flex: 1, textAlign: "left", fontFamily: theme.font.mono, fontSize: 12, color: theme.text.secondary }}>
                        Pick from saved customers
                      </span>
                      <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>{savedCustomers.length} saved · {showCustDropdown ? "▲" : "▼"}</span>
                    </button>

                    {showCustDropdown && (
                      <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 60, background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14, boxShadow: "0 12px 32px rgba(0,0,0,0.5)", overflow: "hidden" }}>
                        {/* Search within saved */}
                        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${theme.border.default}` }}>
                          <div style={{ position: "relative" }}>
                            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, opacity: 0.4 }}>🔍</span>
                            <input
                              className="ki"
                              type="text"
                              value={customerQuery}
                              onChange={e => setCustomerQuery(e.target.value)}
                              placeholder="Filter by name or phone…"
                              style={{ paddingLeft: 30, paddingRight: 70, paddingTop: 8, paddingBottom: 8, fontSize: 12 }}
                              autoFocus
                            />
                            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, pointerEvents: "none" }}>
                              {customerQuery.trim() ? `${filteredCustomers.length} of ${savedCustomers.length}` : `${savedCustomers.length}`}
                            </span>
                          </div>
                        </div>
                        <div style={{ maxHeight: 240, overflowY: "auto" }}>
                          {filteredCustomers.length === 0 ? (
                            <div style={{ padding: "16px", fontSize: 12, fontFamily: theme.font.mono, color: theme.text.muted, textAlign: "center" }}>
                              No customers match "{customerQuery}"
                            </div>
                          ) : (
                            filteredCustomers.map((c, i) => (
                              <button key={c.id ?? c.phone}
                                onClick={() => {
                                  setCustomerName(c.name);
                                  setCustomerPhone(c.phone);
                                  touchUsage(c.phone);
                                  setCustomerQuery("");
                                  setShowCustDropdown(false);
                                }}
                                style={{ width: "100%", padding: "11px 16px", background: "transparent", border: "none", borderBottom: i < filteredCustomers.length - 1 ? `1px solid ${theme.border.default}` : "none", cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 12 }}>
                                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: theme.font.display, fontWeight: 700, fontSize: 15, color: theme.accent.cyan, flexShrink: 0 }}>
                                  {c.name.charAt(0).toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                                  <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>{c.phone}</div>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Customer Name */}
                <div>
                  <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>
                    Customer Name {payMethod === "credit"
                      ? <span style={{ color: theme.accent.red }}>*</span>
                      : <span style={{ color: theme.text.muted, textTransform: "none", letterSpacing: 0 }}>(optional)</span>}
                  </label>
                  <input className="ki" type="text" value={customerName}
                    onChange={e => {
                      setCustomerName(sanitizeText(e.target.value, 60));
                      if (fieldErrors.customerName) setFieldErrors(prev => ({ ...prev, customerName: "" }));
                    }}
                    onBlur={() => {
                      const err = validateField("customerName", customerName);
                      if (err) setFieldErrors(prev => ({ ...prev, customerName: err }));
                    }}
                    placeholder="e.g. John Kamau" maxLength={60} />
                  {fieldErrors.customerName && (
                    <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: "#f87171", marginTop: 4 }}>⚠ {fieldErrors.customerName}</div>
                  )}
                </div>

                {/* Customer Phone — always visible */}
                <div>
                  <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>
                    Customer Phone {payMethod === "credit"
                      ? <span style={{ color: theme.accent.red }}>*</span>
                      : <span style={{ color: theme.text.muted, textTransform: "none", letterSpacing: 0 }}>(optional)</span>}
                  </label>
                  <input className="ki" type="tel" value={customerPhone}
                    onChange={e => {
                      setCustomerPhone(sanitizePhone(e.target.value));
                      if (fieldErrors.customerPhone) setFieldErrors(prev => ({ ...prev, customerPhone: "" }));
                    }}
                    onBlur={() => {
                      const err = validateField("customerPhone", customerPhone);
                      if (err) setFieldErrors(prev => ({ ...prev, customerPhone: err }));
                    }}
                    placeholder="07XXXXXXXXX or 254XXXXXXXXX" maxLength={13} />
                  {fieldErrors.customerPhone && (
                    <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: "#f87171", marginTop: 4 }}>⚠ {fieldErrors.customerPhone}</div>
                  )}
                </div>
              </div>

              {error && <div style={{ color: theme.accent.red, fontSize: 12, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 12px" }}>⚠ {error}</div>}

              <button className="abtn" onClick={handleCheckoutNext}
                style={{ background: `linear-gradient(135deg,${theme.accent.cyan},#0891b2)`, color: "#fff" }}>
                Next — Authorise Sale →
              </button>
            </div>
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
                  <div key={item.allocation.product_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 13, color: theme.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8 }}>
                      {item.quantity}× {item.allocation.product.name}
                    </div>
                    <div style={{ fontFamily: theme.font.mono, fontSize: 13, color: theme.text.primary, flexShrink: 0 }}>{fmt(item.sellPrice * item.quantity)}</div>
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
              {/* Method toggle */}
              <div style={{ display: "flex", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: 4, gap: 4 }}>
                {([{ key: "badge", label: "📛 Scan Badge" }, { key: "pin", label: "🔑 Enter PIN" }] as const).map(({ key, label }) => (
                  <button key={key} onClick={() => { setVerifyMethod(key); setPinError(""); setBadgeError(""); setPin(""); }}
                    style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: theme.font.mono, fontSize: isMobile ? 12 : 13, fontWeight: verifyMethod === key ? 600 : 400, background: verifyMethod === key ? "rgba(6,182,212,0.15)" : "transparent", color: verifyMethod === key ? theme.accent.cyan : theme.text.muted }}>
                    {label}
                  </button>
                ))}
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
                <div key={item.allocation.product_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: theme.text.secondary }}>{item.quantity}× {item.allocation.product.name}</span>
                  <span style={{ fontFamily: theme.font.mono, fontSize: 12, color: theme.text.primary }}>{fmt(item.sellPrice * item.quantity)}</span>
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

      {/* ══════════════════ FULL-SCREEN PIN MODAL ══════════════════ */}
      {step === "verify" && verifyMethod === "pin" && selectedAgent && (
        <div style={{ position: "fixed", inset: 0, zIndex: 110, background: "rgba(0,0,0,0.92)", backdropFilter: "blur(10px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px" }}>
          {processing ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
              <div style={{ position: "relative", width: 80, height: 80 }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "3px solid rgba(6,182,212,0.15)" }} />
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "3px solid transparent", borderTopColor: theme.accent.cyan, animation: "spin 0.75s linear infinite" }} />
                <div style={{ position: "absolute", inset: 10, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "rgba(6,182,212,0.45)", animation: "spin 1.2s linear infinite reverse" }} />
              </div>
              <div style={{ fontFamily: theme.font.mono, fontSize: 14, color: theme.text.muted }}>
                {payMethod === "credit" ? "Recording credit sale..." : `Processing ${cart.length} item${cart.length !== 1 ? "s" : ""}...`}
              </div>
              <div style={{ width: 260, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 99, background: `linear-gradient(90deg,${theme.accent.cyan},#0891b2)`, animation: "progress-bar 1.4s ease-in-out infinite" }} />
              </div>
            </div>
          ) : (
            <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Back button + agent identity */}
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <button onClick={() => { setSelectedAgent(null); setPin(""); setPinError(""); }}
                  style={{ width: 40, height: 40, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: theme.text.muted, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  ←
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(6,182,212,0.18)", border: "1px solid rgba(6,182,212,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: theme.font.display, fontWeight: 700, fontSize: 20, color: theme.accent.cyan, flexShrink: 0 }}>
                    {selectedAgent.avatar || selectedAgent.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 17, color: theme.text.primary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedAgent.name}</div>
                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>Enter 4-digit PIN to authorise</div>
                  </div>
                </div>
              </div>

              {/* Lockout banner */}
              {pinIsLocked && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "12px 16px" }}>
                  <span style={{ fontSize: 20 }}>🔒</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#ef4444", fontFamily: theme.font.mono }}>Too many wrong PINs</div>
                    <div style={{ fontSize: 12, color: "#f87171", marginTop: 2, fontFamily: theme.font.mono }}>Try again in {pinCountdown}s</div>
                  </div>
                </div>
              )}

              {/* Attempt warning */}
              {!pinIsLocked && pinFails >= 3 && (
                <div style={{ fontSize: 12, fontFamily: theme.font.mono, color: "#fbbf24", background: "rgba(234,179,8,0.07)", border: "1px solid rgba(234,179,8,0.2)", borderRadius: 10, padding: "9px 14px", textAlign: "center" }}>
                  ⚠ {PIN_MAX_FAILS - pinFails} attempt{PIN_MAX_FAILS - pinFails !== 1 ? "s" : ""} left before lockout
                </div>
              )}

              {/* PIN dots */}
              <div className={pinShake ? "shake" : ""} style={{ display: "flex", gap: 14, justifyContent: "center", opacity: pinIsLocked ? 0.35 : 1 }}>
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className={`pin-digit ${i < pin.length ? "filled" : ""}`}>
                    {i < pin.length ? "●" : ""}
                  </div>
                ))}
              </div>

              {/* PIN error */}
              {pinError && !pinIsLocked && (
                <div style={{ color: theme.accent.red, fontSize: 12, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 14px", textAlign: "center" }}>
                  ⚠ {pinError}
                </div>
              )}

              {/* Numpad */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map(k => (
                  <button key={k} disabled={!k || pinIsLocked}
                    onClick={() => {
                      if (pinIsLocked) return;
                      if (k === "⌫") { setPin(p => p.slice(0, -1)); setPinError(""); setError(""); }
                      else if (k) {
                        setError("");
                        // Use functional update to always read the latest pin value —
                        // avoids stale closure when digits are tapped quickly.
                        setPin(prev => {
                          if (prev.length >= 4) return prev; // guard (shouldn't happen)
                          const newPin = prev + k;
                          if (newPin.length === 4 && selectedAgent) {
                            const storedPin = selectedAgent.pin != null ? String(selectedAgent.pin) : null;
                            if (!storedPin) {
                              // PIN not configured in DB — show helpful message
                              setPinError("This agent has no PIN set. Ask your owner to configure one.");
                              setPinShake(true);
                              setTimeout(() => setPinShake(false), 400);
                              return ""; // clear immediately
                            }
                            if (newPin !== storedPin) {
                              const next = pinFails + 1;
                              setPinFails(next);
                              if (next >= PIN_MAX_FAILS) {
                                const until = Date.now() + PIN_LOCK_MS;
                                startPinLock(until);
                              }
                              setPinError("Incorrect PIN. Try again.");
                              setPinShake(true);
                              // Clear pin IMMEDIATELY so the next digit starts fresh;
                              // only delay the shake dismissal (visual only).
                              setTimeout(() => setPinShake(false), 400);
                              return ""; // ← reset right away, not in a 400ms timeout
                            } else {
                              setPinError("");
                              setPinFails(0); setPinCountdown(0);
                              handleSubmitSale(selectedAgent);
                              return "";
                            }
                          }
                          return newPin;
                        });
                        setPinError(""); // clear any prior error as user types
                      }
                    }}
                    style={{ height: 66, border: `1px solid ${k ? "rgba(255,255,255,0.12)" : "transparent"}`, borderRadius: 14, background: k ? "rgba(255,255,255,0.05)" : "transparent", color: k === "⌫" ? theme.accent.red : theme.text.primary, fontFamily: theme.font.mono, fontSize: k === "⌫" ? 22 : 26, fontWeight: 600, cursor: (k && !pinIsLocked) ? "pointer" : "default", opacity: pinIsLocked ? 0.35 : 1, transition: "background 0.12s" }}>
                    {k}
                  </button>
                ))}
              </div>

              {/* Order total reminder */}
              <div style={{ textAlign: "center", fontFamily: theme.font.mono, fontSize: 12, color: theme.text.muted }}>
                Total: <span style={{ color: theme.accent.gold, fontWeight: 700, fontSize: 16 }}>{fmt(grandTotal)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ ADD-TO-CART OVERLAY ══════════════════ */}
      {addingProduct && (
        <div
          style={{ position: "fixed", inset: 0, background: theme.bg.overlay, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px" }}
          onClick={e => { if (e.target === e.currentTarget) { setAddingProduct(null); setError(""); } }}>
          <div className="overlay-sheet" style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 20, padding: "24px 20px 28px", width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Product info */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>📦</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{addingProduct.product.name}</div>
                <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                  {addingProduct.product.sku} · {fmt(addingProduct.product.price)} · {addingProduct.remaining} left
                </div>
              </div>
              {cart.find(i => i.allocation.product_id === addingProduct.product_id) && (
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.accent.cyan, background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 8, padding: "3px 8px", flexShrink: 0 }}>
                  In cart
                </div>
              )}
            </div>

            {/* Quantity */}
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Quantity</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {[1, 2, 3, 5, 10].map(q => (
                  <button key={q} onClick={() => setAddQty(q.toString())}
                    style={{ width: 44, height: 44, border: `1px solid ${addQty === q.toString() ? "rgba(6,182,212,0.5)" : theme.border.default}`, borderRadius: 10, cursor: "pointer", background: addQty === q.toString() ? "rgba(6,182,212,0.15)" : "transparent", color: addQty === q.toString() ? theme.accent.cyan : theme.text.muted, fontFamily: theme.font.mono, fontSize: 15, fontWeight: 600 }}>
                    {q}
                  </button>
                ))}
                <input className="ki" type="number" value={addQty} onChange={e => setAddQty(e.target.value)}
                  style={{ width: 70, textAlign: "center" }} min="1" max={addingProduct.remaining} />
              </div>
            </div>

            {/* Sell Price */}
            {(() => {
              const canEdit = commissionConfig.enabled && commissionConfig.rate > 0;
              const sp      = Number(addSellPrice) || addingProduct.product.price;
              const qty     = Math.max(1, parseInt(addQty) || 1);
              const markup  = canEdit ? Math.max(0, sp - addingProduct.product.price) : 0;
              return (
                <div>
                  <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>
                    Sell Price
                    {!canEdit && (
                      <span style={{ color: theme.text.muted, fontSize: 9, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>fixed</span>
                    )}
                  </label>
                  {canEdit ? (
                    <>
                      <input className="ki" type="number"
                        value={addSellPrice}
                        onChange={e => { setAddSellPrice(sanitizeAmount(e.target.value)); setError(""); }}
                        min={addingProduct.product.price}
                        step="1"
                      />
                      {markup > 0 && (
                        <div style={{ fontSize: 11, fontFamily: theme.font.mono, marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#34d399" }}>Markup: {fmt(markup * qty)}</span>
                          <span style={{ color: payMethod === "credit" ? "rgba(248,113,113,0.5)" : theme.accent.cyan }}>
                            {payMethod === "credit"
                              ? "No commission (Pay Later)"
                              : `Commission: ${fmt(Math.round(markup * qty * commissionConfig.rate / 100))}`}
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{
                      padding: "12px 14px", background: "rgba(255,255,255,0.03)",
                      border: `1px solid ${theme.border.default}`, borderRadius: 12,
                      fontFamily: theme.font.mono, fontSize: 15, fontWeight: 600,
                      color: theme.text.primary,
                    }}>
                      {fmt(addingProduct.product.price)}
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
              <button onClick={() => { setAddingProduct(null); setError(""); }}
                style={{ flex: 1, padding: "14px", border: `1px solid ${theme.border.default}`, borderRadius: 13, background: "transparent", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 14, cursor: "pointer" }}>
                Cancel
              </button>
              <button className="abtn" onClick={handleAddToCart}
                style={{ flex: 2, background: `linear-gradient(135deg,${theme.accent.cyan},#0891b2)`, color: "#fff", fontSize: 15 }}>
                {cart.find(i => i.allocation.product_id === addingProduct.product_id) ? "Update Cart" : "Add to Cart"} →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
