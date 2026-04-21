import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import QrScanner from "../components/QrScanner";
import { supabase } from "../lib/supabase";

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
  const navigate  = useNavigate();
  const width     = useWindowWidth();
  const isMobile  = width < 640;

  // ── flow state ────────────────────────────────────────────────────────
  const [step,         setStep]         = useState<Step>("scan");
  const [verifyMethod, setVerifyMethod] = useState<VerifyMethod>("pin");

  // scan
  const [mode,         setMode]         = useState<"camera" | "manual">("camera");
  const [cameraActive, setCameraActive] = useState(true);
  const [badgeActive,  setBadgeActive]  = useState(false);
  const [manualSku,    setManualSku]    = useState("");
  const [myProducts,   setMyProducts]   = useState<LocalAlloc[]>([]);

  // cart
  const [cart,          setCart]          = useState<CartItem[]>([]);
  const [addingProduct, setAddingProduct] = useState<LocalAlloc | null>(null);
  const [addQty,        setAddQty]        = useState("1");
  const [addSellPrice,  setAddSellPrice]  = useState("");

  // checkout
  const [customerName,    setCustomerName]    = useState("");
  const [customerPhone,   setCustomerPhone]   = useState("");
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

  // misc
  const [processing,   setProcessing]   = useState(false);
  const [error,        setError]        = useState("");
  const [scanFeedback, setScanFeedback] = useState("");
  const [savedBatchRef, setSavedBatchRef] = useState("");
  const [isOnline,     setIsOnline]     = useState(navigator.onLine);
  const [commissionConfig, setCommissionConfig] = useState<{ enabled: boolean; rate: number }>({ enabled: false, rate: 0 });

  // ── online/offline detection ──────────────────────────────────────────
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ── camera sync ───────────────────────────────────────────────────────
  useEffect(() => {
    setCameraActive(mode === "camera" && step === "scan" && !addingProduct);
  }, [mode, step, addingProduct]);

  useEffect(() => {
    setBadgeActive(step === "verify" && verifyMethod === "badge");
  }, [step, verifyMethod]);

  // ── fetch agents + stock ──────────────────────────────────────────────
  useEffect(() => {
    if (!shop) return;
    (async () => {
      const [agentsRes, allocsRes, commRes] = await Promise.all([
        supabase.from("shop_agents")
          .select("id, pin, active, agent_id, agent_name, agent_code, agent_avatar")
          .eq("shop_id", shop.id).eq("active", true),
        supabase.from("shop_allocations")
          .select("id, allocated, remaining, product_id, product_name, product_sku, product_price, product_unit")
          .eq("shop_id", shop.id),
        supabase.rpc("get_shop_commission", { p_owner_id: shop.owner_id }),
      ]);
      setCommissionConfig((commRes.data as any)?.[0] ?? { enabled: false, rate: 0 });

      setShopAgents((agentsRes.data || []).map((r: any) => ({
        id: r.id, pin: r.pin, active: r.active, agent_id: r.agent_id,
        name: r.agent_name ?? "Agent", agent_code: r.agent_code ?? "", avatar: r.agent_avatar ?? "",
      })));

      const productIds = (allocsRes.data || []).map((a: any) => a.product_id).filter(Boolean);
      let productsMap: Record<string, any> = {};
      if (productIds.length > 0) {
        const { data: prodsData } = await supabase
          .from("products").select("id, name, sku, price, unit").in("id", productIds);
        for (const p of prodsData || []) productsMap[p.id] = p;
      }

      setMyProducts(
        (allocsRes.data || [])
          .filter((a: any) => a.product_id && (a.remaining ?? 0) > 0)
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
          })
      );
    })();
  }, [shop]);

  // ── product lookup ────────────────────────────────────────────────────
  const fetchAllocationBySku = useCallback(async (sku: string): Promise<LocalAlloc | null> => {
    if (!shop) return null;
    const inMem = myProducts.find(a => a.product.sku.toUpperCase() === sku.toUpperCase());
    if (inMem) return inMem;

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
    const existing = cart.find(i => i.allocation.product_id === alloc.product_id);
    setAddQty(existing ? String(existing.quantity) : "1");
    setAddSellPrice(existing ? String(existing.sellPrice) : String(alloc.product.price));
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

  const handleCheckoutNext = () => {
    if (cart.length === 0) { setError("Add at least one product to the cart."); return; }
    if (payMethod === "credit") {
      if (!customerName.trim()) { setError("Customer name is required for credit sales."); return; }
      if (!customerPhone.trim()) { setError("Customer phone is required for credit sales."); return; }
    }
    if (payMethod === "split") {
      const c = Number(cashAmount) || 0, m = Number(mpesaAmount) || 0;
      if (!cashAmount || !mpesaAmount) { setError("Enter both Cash and M-Pesa amounts."); return; }
      if (Math.abs(c + m - grandTotal) > 1) { setError(`Cash + M-Pesa must equal ${fmt(grandTotal)}.`); return; }
    }
    setError("");
    setStep("verify");
  };

  // ── submit sale ───────────────────────────────────────────────────────
  const handleSubmitSale = async (verifiedAgent: LocalAgent) => {
    if (cart.length === 0) return;
    if (!navigator.onLine) {
      setError("You are offline. Please check your connection and try again.");
      setProcessing(false);
      return;
    }
    setProcessing(true); setError("");

    // Deduct stock for every item regardless of payment method
    for (const item of cart) {
      const { error: stockErr } = await supabase.rpc("deduct_shop_stock", {
        p_shop_allocation_id: item.allocation.id,
        p_quantity: item.quantity,
      });
      if (stockErr) {
        setProcessing(false);
        setError(stockErr.message.includes("Insufficient")
          ? `Not enough stock for ${item.allocation.product.name}.`
          : `Failed to deduct stock for ${item.allocation.product.name}.`);
        return;
      }
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

      if (creditErr) { setProcessing(false); setError("Failed to record credit sale. Try again."); return; }

      // Record the initial payment as a history entry if one was made
      if (initPaid > 0 && creditData?.id) {
        await supabase.from("shop_credit_payments").insert({
          credit_sale_id: creditData.id,
          shop_id:        shop?.id,
          owner_id:       shop?.owner_id,
          amount:         initPaid,
          payment_method: initialPayMethod,
          mpesa_ref:      null,
        });
      }

      setSavedBatchRef((creditData?.id ?? "").slice(0, 8).toUpperCase());
      setSelectedAgent(verifiedAgent);
      setProcessing(false);
      setStep("success");
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
      const commEarned  = parseFloat((markup * item.quantity * commRate / 100).toFixed(2));
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

    const { data, error: txErr } = await supabase.from("shop_transactions").insert(txRows).select();
    if (txErr) { setProcessing(false); setError("Transaction failed. Try again."); return; }

    const firstId = (data?.[0]?.id ?? "").slice(0, 8).toUpperCase();
    setSavedBatchRef(firstId);
    setSelectedAgent(verifiedAgent);
    setProcessing(false);
    setStep("success");
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
    setStep("scan"); setMode("camera"); setManualSku("");
    setCart([]); setAddingProduct(null); setAddQty("1"); setAddSellPrice("");
    setSelectedAgent(null); setPin(""); setPinError(""); setBadgeError("");
    setCustomerName(""); setCustomerPhone(""); setInitialPayment(""); setInitialPayMethod("cash"); setPayMethod("cash");
    setCashAmount(""); setMpesaAmount(""); setMpesaRef("");
    setError(""); setScanFeedback(""); setProcessing(false);
    setVerifyMethod("pin");
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
          background: "#dc2626",
          color: "#fff",
          padding: "10px 16px",
          display: "flex", alignItems: "center", gap: 10,
          fontFamily: "monospace", fontSize: 13, fontWeight: 600,
          boxShadow: "0 2px 12px rgba(220,38,38,0.4)",
        }}>
          <span style={{ fontSize: 16 }}>⚡</span>
          No internet connection — sales cannot be processed until you reconnect.
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
        position: "sticky", top: 0, background: theme.bg.base, zIndex: 40,
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
                {step === "success"  ? "Transaction saved successfully"                                               : ""}
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

      <div style={{ padding: isMobile ? "14px 14px 90px" : "24px 40px 90px", maxWidth: 680, margin: "0 auto" }}>

        {/* ══════════════════ STEP 1: SCAN ══════════════════ */}
        {step === "scan" && (
          <div className="section" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: 4, gap: 4 }}>
              {(["camera", "manual"] as const).map(m => (
                <button key={m} onClick={() => { setMode(m); setError(""); setAddingProduct(null); }}
                  style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: theme.font.mono, fontSize: 13, fontWeight: mode === m ? 600 : 400, background: mode === m ? "rgba(6,182,212,0.15)" : "transparent", color: mode === m ? theme.accent.cyan : theme.text.muted }}>
                  {m === "camera" ? "📷 Camera" : "📦 Products"}
                </button>
              ))}
            </div>

            {mode === "camera" && (
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
                    <input className="ki" value={manualSku} onChange={e => { setManualSku(e.target.value.toUpperCase()); setError(""); }}
                      placeholder="e.g. SAM-EAR-A10" style={{ flex: 1 }}
                      onKeyDown={e => e.key === "Enter" && handleManualLookup()} />
                    <button onClick={handleManualLookup}
                      style={{ background: `linear-gradient(135deg,${theme.accent.cyan},#0891b2)`, border: "none", borderRadius: 12, padding: "0 16px", color: "#fff", fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
                      Look Up
                    </button>
                  </div>
                </div>
                {error && <div style={{ color: theme.accent.red, fontSize: 12, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 12px" }}>⚠ {error}</div>}

                {myProducts.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "36px 20px", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14 }}>
                    <div style={{ fontSize: 34, opacity: 0.2, marginBottom: 10 }}>📦</div>
                    <div style={{ color: theme.text.muted, fontSize: 13, fontFamily: theme.font.mono }}>No stock available</div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
                      Available ({myProducts.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {myProducts.map(alloc => {
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
                )}
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
          <div className="section" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
            </div>

            {/* Add more */}
            <button onClick={() => { setStep("scan"); setError(""); }}
              style={{ background: "transparent", border: "1px dashed rgba(6,182,212,0.3)", borderRadius: 12, padding: "12px 16px", color: theme.accent.cyan, fontFamily: theme.font.mono, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              + Add more products
            </button>

            {/* Customer name — required for credit, optional otherwise */}
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>
                Customer Name {payMethod === "credit"
                  ? <span style={{ color: theme.accent.red }}>*</span>
                  : <span style={{ color: theme.text.muted, textTransform: "none", letterSpacing: 0 }}>(optional)</span>}
              </label>
              <input className="ki" type="text" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="e.g. John Kamau" />
            </div>

            {/* Customer phone */}
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>
                Customer Phone {payMethod === "credit"
                  ? <span style={{ color: theme.accent.red }}>*</span>
                  : <span style={{ color: theme.text.muted, textTransform: "none", letterSpacing: 0 }}>(optional)</span>}
              </label>
              <input className="ki" type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="07XX XXX XXX" />
            </div>

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
                </div>
                <div>
                  <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>
                    Initial Payment <span style={{ color: theme.text.muted, textTransform: "none", letterSpacing: 0 }}>(optional — 0 by default)</span>
                  </label>
                  <input className="ki" type="number" value={initialPayment}
                    onChange={e => {
                      const val = Number(e.target.value) || 0;
                      setInitialPayment(val > grandTotal ? String(grandTotal) : e.target.value);
                    }}
                    placeholder={`e.g. 500 of ${fmt(grandTotal)}`} />
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
                      onChange={e => { setCashAmount(e.target.value); setMpesaAmount(String(Math.max(0, grandTotal - (Number(e.target.value) || 0)))); }}
                      placeholder="0" />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.accent.cyan, display: "block", marginBottom: 5, textTransform: "uppercase" }}>📱 M-Pesa</label>
                    <input className="ki" type="number" value={mpesaAmount}
                      onChange={e => { setMpesaAmount(e.target.value); setCashAmount(String(Math.max(0, grandTotal - (Number(e.target.value) || 0)))); }}
                      placeholder="0" />
                  </div>
                </div>
              </div>
            )}

            {(payMethod === "mpesa" || payMethod === "split") && (
              <div>
                <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>M-Pesa Ref (optional)</label>
                <input className="ki" value={mpesaRef} onChange={e => setMpesaRef(e.target.value.toUpperCase())} placeholder="e.g. QHX7K3LM2P" />
              </div>
            )}

            {error && <div style={{ color: theme.accent.red, fontSize: 12, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 12px" }}>⚠ {error}</div>}

            <button className="abtn" onClick={handleCheckoutNext}
              style={{ background: `linear-gradient(135deg,${theme.accent.cyan},#0891b2)`, color: "#fff" }}>
              Next — Authorise Sale →
            </button>
          </div>
        )}

        {/* ══════════════════ STEP 3: VERIFY ══════════════════ */}
        {step === "verify" && (
          <div className="section" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Cart summary */}
            <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              {cart.map(item => (
                <div key={item.allocation.product_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, color: theme.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8 }}>
                    {item.quantity}× {item.allocation.product.name}
                  </div>
                  <div style={{ fontFamily: theme.font.mono, fontSize: 13, color: theme.text.primary, flexShrink: 0 }}>{fmt(item.allocation.product.price * item.quantity)}</div>
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
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 12, textAlign: "center" }}>
                      PIN for {selectedAgent.name}
                    </label>
                    <div className={pinShake ? "shake" : ""} style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 16 }}>
                      {[0, 1, 2, 3].map(i => (
                        <div key={i} className={`pin-digit ${i < pin.length ? "filled" : ""}`}>
                          {i < pin.length ? "●" : ""}
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 9, maxWidth: isMobile ? "100%" : 300, margin: "0 auto", width: "100%" }}>
                      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map(k => (
                        <button key={k} disabled={!k || processing}
                          onClick={() => {
                            if (k === "⌫") { setPin(p => p.slice(0, -1)); setPinError(""); }
                            else if (k && pin.length < 4) {
                              const newPin = pin + k;
                              setPin(newPin);
                              if (newPin.length === 4 && selectedAgent) {
                                if (newPin !== selectedAgent.pin) {
                                  setPinError("Incorrect PIN. Try again.");
                                  setPinShake(true);
                                  setTimeout(() => { setPinShake(false); setPin(""); }, 400);
                                } else {
                                  setPinError("");
                                  handleSubmitSale(selectedAgent);
                                }
                              }
                            }
                          }}
                          style={{ height: isMobile ? 54 : 60, border: `1px solid ${k ? "rgba(255,255,255,0.1)" : "transparent"}`, borderRadius: 12, background: k ? "rgba(255,255,255,0.04)" : "transparent", color: k === "⌫" ? theme.accent.red : theme.text.primary, fontFamily: theme.font.mono, fontSize: k === "⌫" ? 20 : 22, fontWeight: 600, cursor: k ? "pointer" : "default", transition: "background 0.1s" }}>
                          {k}
                        </button>
                      ))}
                    </div>
                    {pinError && (
                      <div style={{ color: theme.accent.red, fontSize: 12, fontFamily: theme.font.mono, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, padding: "10px 14px", marginTop: 12, textAlign: "center" }}>
                        ⚠ {pinError}
                      </div>
                    )}
                    {processing && (
                      <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 16, background: "rgba(255,255,255,0.04)", borderRadius: 14, color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 14 }}>
                        <span style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                        {payMethod === "credit" ? "Recording credit sale..." : `Processing ${cart.length} item${cart.length !== 1 ? "s" : ""}...`}
                      </div>
                    )}
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
        )}

        {/* ══════════════════ STEP 4: SUCCESS ══════════════════ */}
        {step === "success" && (
          <div className="section" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, paddingTop: 16, textAlign: "center" }}>
            <div className="success-icon" style={{ width: 86, height: 86, borderRadius: "50%", background: payMethod === "credit" ? "rgba(248,113,113,0.15)" : "rgba(52,211,153,0.15)", border: `2px solid ${payMethod === "credit" ? "#f87171" : "#34d399"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 38 }}>
              {payMethod === "credit" ? "📝" : "✓"}
            </div>
            <div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 22 : 26 }}>
                {payMethod === "credit" ? "Credit Sale Recorded!" : "Sale Recorded!"}
              </div>
              <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono, marginTop: 4 }}>
                {payMethod === "credit"
                  ? (() => { const ip = Math.min(Math.max(0, Number(initialPayment) || 0), grandTotal); return ip > 0 ? `${fmt(ip)} paid upfront · ${fmt(grandTotal - ip)} remaining` : `Stock deducted · ${fmt(grandTotal)} balance due`; })()
                  : `${cart.length} item${cart.length !== 1 ? "s" : ""} synced to owner dashboard`}
              </div>
            </div>
            <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 18, padding: "20px 22px", width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Ref row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottom: `1px solid ${theme.border.default}` }}>
                <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {payMethod === "credit" ? "Credit Ref" : "Receipt Ref"}
                </span>
                <span style={{ fontFamily: theme.font.mono, fontWeight: 700, fontSize: 13, color: payMethod === "credit" ? theme.accent.red : theme.accent.cyan }}>
                  {payMethod === "credit" ? "CR-" : "TXN-"}{savedBatchRef}
                </span>
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
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>
                Sell Price
                <span style={{ color: theme.text.muted, fontSize: 9, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>min {fmt(addingProduct.product.price)}</span>
              </label>
              <input className="ki" type="number"
                value={addSellPrice}
                onChange={e => { setAddSellPrice(e.target.value); setError(""); }}
                min={addingProduct.product.price}
                step="1"
              />
              {Number(addSellPrice) > addingProduct.product.price && (
                <div style={{ fontSize: 11, fontFamily: theme.font.mono, marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#34d399" }}>Markup: {fmt((Number(addSellPrice) - addingProduct.product.price) * (Math.max(1, parseInt(addQty) || 1)))}</span>
                  {commissionConfig.enabled && (
                    <span style={{ color: theme.accent.cyan }}>
                      Commission: {fmt(parseFloat(((Number(addSellPrice) - addingProduct.product.price) * (Math.max(1, parseInt(addQty) || 1)) * commissionConfig.rate / 100).toFixed(2)))}
                    </span>
                  )}
                </div>
              )}
            </div>

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
