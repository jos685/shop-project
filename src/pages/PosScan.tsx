import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useShopAuth } from "../context/ShopAuthContext";
import { useTheme } from "../context/ThemeContext";
import QrScanner from "../components/QrScanner";
import { supabase } from "../lib/supabase";

type Step         = "scan" | "details" | "verify" | "success";
type PayMethod    = "cash" | "mpesa" | "split";
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

const STEPS: Step[] = ["scan", "details", "verify", "success"];
const STEP_LABELS   = { scan: "Product", details: "Sale Details", verify: "Authorise", success: "Done" };

export default function PosScan() {
  const { shop }   = useShopAuth();
  const { theme }  = useTheme();
  const navigate   = useNavigate();
  const width      = useWindowWidth();
  const isMobile   = width < 640;

  // ── flow state ─────────────────────────────────────────────────────
  const [step,          setStep]          = useState<Step>("scan");
  const [verifyMethod,  setVerifyMethod]  = useState<VerifyMethod>("pin");

  // product
  const [mode,          setMode]          = useState<"camera" | "manual">("camera");
  const [cameraActive,  setCameraActive]  = useState(true);
  const [badgeActive,   setBadgeActive]   = useState(false);
  const [manualSku,     setManualSku]     = useState("");
  const [allocation,    setAllocation]    = useState<LocalAlloc | null>(null);
  const [myProducts,    setMyProducts]    = useState<LocalAlloc[]>([]);

  // sale details
  const [quantity,      setQuantity]      = useState("1");
  const [customerPhone, setCustomerPhone] = useState("");
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
  const [processing,    setProcessing]    = useState(false);
  const [error,         setError]         = useState("");
  const [scanFeedback,  setScanFeedback]  = useState("");
  const [savedTxId,     setSavedTxId]     = useState("");

  // ── camera sync ────────────────────────────────────────────────────
  useEffect(() => {
    setCameraActive(mode === "camera" && step === "scan");
  }, [mode, step]);

  useEffect(() => {
    setBadgeActive(step === "verify" && verifyMethod === "badge");
  }, [step, verifyMethod]);

  // ── fetch agents + stock ───────────────────────────────────────────
  useEffect(() => {
    if (!shop) return;
    (async () => {
      const [agentsRes, allocsRes, txRes] = await Promise.all([
        supabase.from("shop_agents")
          .select("id, pin, active, agent_id, agent_name, agent_code, agent_avatar")
          .eq("shop_id", shop.id).eq("active", true),
        supabase.from("shop_allocations")
          .select("id, allocated, remaining, product_id, product_name, product_sku, product_price, product_unit")
          .eq("shop_id", shop.id),
        supabase.from("shop_transactions")
          .select("product_id, quantity").eq("shop_id", shop.id),
      ]);

      setShopAgents((agentsRes.data || []).map((r: any) => ({
        id: r.id, pin: r.pin, active: r.active, agent_id: r.agent_id,
        name: r.agent_name ?? "Agent", agent_code: r.agent_code ?? "", avatar: r.agent_avatar ?? "",
      })));

      const soldMap: Record<string, number> = {};
      for (const t of (txRes.data || [])) soldMap[t.product_id] = (soldMap[t.product_id] || 0) + (Number(t.quantity) || 1);

      setMyProducts(
        (allocsRes.data || [])
          .filter((a: any) => a.product_name)
          .map((a: any) => ({
            id: a.id, allocated: a.allocated,
            remaining: Math.max(0, a.allocated - (soldMap[a.product_id] || 0)),
            product_id: a.product_id,
            product: { id: a.product_id, name: a.product_name, sku: a.product_sku ?? "", price: Number(a.product_price ?? 0), unit: a.product_unit ?? "" },
          }))
          .filter((a: LocalAlloc) => a.remaining > 0)
      );
    })();
  }, [shop]);

  // ── product lookup ────────────────────────────────────────────────
  const fetchAllocationBySku = useCallback(async (sku: string): Promise<LocalAlloc | null> => {
    if (!shop) return null;
    const inMem = myProducts.find(a => a.product.sku.toUpperCase() === sku.toUpperCase());
    if (inMem) return inMem;

    const [allocRes, txRes] = await Promise.all([
      supabase.from("shop_allocations")
        .select("id, allocated, remaining, product_id, product_name, product_sku, product_price, product_unit")
        .eq("shop_id", shop.id).eq("product_sku", sku.trim().toUpperCase()).single(),
      supabase.from("shop_transactions")
        .select("quantity").eq("shop_id", shop.id)
        .eq("product_id", (await supabase.from("shop_allocations")
          .select("product_id").eq("shop_id", shop.id).eq("product_sku", sku.trim().toUpperCase()).single()
        ).data?.product_id ?? ""),
    ]);

    if (!allocRes.data?.product_name) return null;
    const sold = (txRes.data || []).reduce((s: number, t: any) => s + (Number(t.quantity) || 1), 0);
    return {
      id: allocRes.data.id, allocated: allocRes.data.allocated,
      remaining: Math.max(0, allocRes.data.allocated - sold),
      product_id: allocRes.data.product_id,
      product: {
        id: allocRes.data.product_id, name: allocRes.data.product_name,
        sku: allocRes.data.product_sku ?? "", price: Number(allocRes.data.product_price ?? 0),
        unit: allocRes.data.product_unit ?? "",
      },
    };
  }, [shop, myProducts]);

  const handleProductFound = async (alloc: LocalAlloc) => {
    if (!alloc || alloc.remaining <= 0) { setError(`No stock available for ${alloc?.product?.name ?? "this product"}.`); return; }
    setCameraActive(false);
    setAllocation(alloc);
    setError("");
    setStep("details");
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
    await handleProductFound(alloc);
  };

  const handleManualLookup = async () => {
    if (!manualSku.trim()) { setError("Enter a SKU."); return; }
    const alloc = await fetchAllocationBySku(manualSku.trim());
    if (!alloc) { setError(`"${manualSku}" not found in this shop's stock.`); return; }
    await handleProductFound(alloc);
  };

  // ── details step validation + next ───────────────────────────────
  const handleDetailsNext = () => {
    const qty   = parseInt(quantity) || 1;
    const total = (allocation?.product?.price || 0) * qty;
    if (allocation && qty > allocation.remaining) { setError(`Only ${allocation.remaining} units available.`); return; }
    if (payMethod === "split") {
      const c = Number(cashAmount) || 0, m = Number(mpesaAmount) || 0;
      if (!cashAmount || !mpesaAmount) { setError("Enter both Cash and M-Pesa amounts."); return; }
      if (Math.abs(c + m - total) > 1) { setError(`Cash + M-Pesa must equal ${fmt(total)}.`); return; }
    }
    setError("");
    setStep("verify");
  };

  // ── submit sale (called after verification) ───────────────────────
  const handleSubmitSale = async (verifiedAgent: LocalAgent) => {
    const product = allocation?.product;
    const qty     = parseInt(quantity) || 1;
    const total   = (product?.price || 0) * qty;
    const cash    = payMethod === "cash"  ? total : payMethod === "mpesa" ? 0 : Number(cashAmount)  || 0;
    const mpesa   = payMethod === "mpesa" ? total : payMethod === "cash"  ? 0 : Number(mpesaAmount) || 0;

    setProcessing(true); setError("");

    const { error: stockErr } = await supabase.rpc("deduct_shop_stock", {
      p_shop_allocation_id: allocation!.id,
      p_quantity: qty,
    });
    if (stockErr) {
      setProcessing(false);
      setError(stockErr.message.includes("Insufficient") ? "Not enough stock." : "Failed to deduct stock.");
      return;
    }

    const { data, error: txErr } = await supabase.from("shop_transactions").insert({
      shop_id: shop?.id, owner_id: shop?.owner_id,
      seller_agent_id: verifiedAgent.agent_id,
      product_id: product?.id, quantity: qty, amount: total,
      customer_phone: customerPhone.trim(), payment_method: payMethod,
      cash_amount: cash, mpesa_amount: mpesa,
      mpesa_ref: (payMethod === "mpesa" || payMethod === "split") ? mpesaRef.trim() || null : null,
      status: "ok",
    }).select().single();

    if (txErr) { setProcessing(false); setError("Transaction failed. Try again."); return; }
    setSavedTxId(data.id.slice(0, 8).toUpperCase());
    setSelectedAgent(verifiedAgent);
    setProcessing(false);
    setStep("success");
  };

  // ── PIN verify ────────────────────────────────────────────────────
  const handlePinVerify = () => {
    if (!selectedAgent) { setPinError("Select an agent first."); return; }
    if (pin.length !== 4) { setPinError("Enter your 4-digit PIN."); return; }
    if (pin !== selectedAgent.pin) {
      setPinError("Incorrect PIN. Try again.");
      setPinShake(true); setPin("");
      setTimeout(() => setPinShake(false), 400);
      return;
    }
    setPinError("");
    handleSubmitSale(selectedAgent);
  };

  // ── Badge QR verify ───────────────────────────────────────────────
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
    setStep("scan"); setMode("camera"); setManualSku(""); setAllocation(null);
    setSelectedAgent(null); setPin(""); setPinError(""); setBadgeError("");
    setQuantity("1"); setCustomerPhone(""); setPayMethod("cash");
    setCashAmount(""); setMpesaAmount(""); setMpesaRef("");
    setError(""); setScanFeedback(""); setProcessing(false);
    setVerifyMethod("pin");
  };

  const goBack = () => {
    setError("");
    if (step === "details") { setStep("scan"); setCameraActive(mode === "camera"); }
    if (step === "verify")  { setStep("details"); setBadgeActive(false); }
  };

  const product     = allocation?.product ?? null;
  const totalAmount = (product?.price || 0) * (parseInt(quantity) || 1);

  return (
    <div style={{ minHeight: "100vh", background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp     { from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin       { to{transform:rotate(360deg)} }
        @keyframes successPop { 0%{transform:scale(0.5);opacity:0}70%{transform:scale(1.1)}100%{transform:scale(1);opacity:1} }
        @keyframes shake      { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }
        .section       { animation: fadeUp 0.3s ease both; }
        .success-icon  { animation: successPop 0.5s ease forwards; }
        .shake         { animation: shake 0.35s ease; }
        .ki { background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:13px 14px;color:#f9fafb;font-size:15px;font-family:'DM Mono',monospace;width:100%;box-sizing:border-box; }
        .ki:focus { outline:none;border-color:rgba(6,182,212,0.5); }
        .ki::placeholder { color:#374151; }
        .abtn { border:none;cursor:pointer;font-family:'Syne',sans-serif;font-weight:800;font-size:16px;border-radius:14px;padding:16px;width:100%;transition:opacity 0.15s,transform 0.1s; }
        .abtn:active { transform:scale(0.98); }
        .abtn:disabled { opacity:0.45;cursor:not-allowed; }
        .pin-digit { width:${isMobile ? "46px" : "52px"};height:${isMobile ? "58px" : "64px"};border:2px solid rgba(255,255,255,0.1);border-radius:12px;display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;font-size:26px;font-weight:700;transition:all 0.15s; }
        .pin-digit.filled { border-color:rgba(6,182,212,0.5);background:rgba(6,182,212,0.08); }
        .back-btn:hover { background:rgba(255,255,255,0.08) !important; }
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
                {step === "scan"    ? "Scan QR code or pick a product"          : ""}
                {step === "details" ? `${product?.name} · ${fmt(product?.price ?? 0)} each` : ""}
                {step === "verify"  ? "Verify identity to complete the sale"    : ""}
                {step === "success" ? "Transaction saved successfully"          : ""}
              </div>
            </div>
          </div>
          <button onClick={step === "scan" ? () => navigate("/pos") : handleReset}
            style={{ background: "none", border: `1px solid ${theme.border.default}`, borderRadius: 9, padding: "7px 13px", color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, cursor: "pointer", whiteSpace: "nowrap" }}>
            {step === "scan" ? "← Back" : "✕ Cancel"}
          </button>
        </div>

        {/* Step progress */}
        {step !== "success" && (
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {["scan", "details", "verify"].map((s, i) => {
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
                    {STEP_LABELS[s as Step]}
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
            {/* Mode toggle */}
            <div style={{ display: "flex", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: 4, gap: 4 }}>
              {(["camera", "manual"] as const).map(m => (
                <button key={m} onClick={() => { setMode(m); setError(""); }}
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
                        const sc  = alloc.remaining <= 3 ? "#f87171" : alloc.remaining <= 10 ? "#fbbf24" : "#34d399";
                        const pct = alloc.allocated > 0 ? Math.round((alloc.remaining / alloc.allocated) * 100) : 0;
                        return (
                          <button key={alloc.id} onClick={() => handleProductFound(alloc)}
                            style={{ padding: "13px 14px", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 13, background: "linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, textAlign: "left", transition: "border-color 0.15s" }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(6,182,212,0.3)")}
                            onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}>
                            <div style={{ width: 40, height: 40, borderRadius: 9, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>📦</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: theme.text.primary, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{alloc.product.name}</div>
                              <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 5 }}>{alloc.product.sku} · {fmt(alloc.product.price)}</div>
                              <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 3, height: 3 }}>
                                <div style={{ width: `${pct}%`, height: "100%", borderRadius: 3, background: sc }} />
                              </div>
                            </div>
                            <div style={{ background: `${sc}18`, border: `1px solid ${sc}40`, borderRadius: 10, padding: "6px 10px", flexShrink: 0, textAlign: "center", minWidth: 46 }}>
                              <div style={{ fontSize: 17, fontFamily: theme.font.mono, fontWeight: 800, color: sc, lineHeight: 1 }}>{alloc.remaining}</div>
                              <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: sc, opacity: 0.8, marginTop: 2 }}>{alloc.product.unit}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ STEP 2: DETAILS ══════════════════ */}
        {step === "details" && product && (
          <div className="section" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Product card */}
            <div style={{ background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, background: "rgba(6,182,212,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📦</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{product.name}</div>
                <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>{product.sku} · {fmt(product.price)} each</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted }}>In stock</div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 18, color: (allocation?.remaining || 0) <= 3 ? theme.accent.red : "#34d399" }}>{allocation?.remaining}</div>
              </div>
            </div>

            {/* Quantity */}
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Quantity</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {[1,2,3,5,10].map(q => (
                  <button key={q} onClick={() => setQuantity(q.toString())}
                    style={{ width: 44, height: 44, border: `1px solid ${quantity === q.toString() ? "rgba(6,182,212,0.5)" : theme.border.default}`, borderRadius: 10, cursor: "pointer", background: quantity === q.toString() ? "rgba(6,182,212,0.15)" : "transparent", color: quantity === q.toString() ? theme.accent.cyan : theme.text.muted, fontFamily: theme.font.mono, fontSize: 15, fontWeight: 600 }}>
                    {q}
                  </button>
                ))}
                <input className="ki" type="number" value={quantity} onChange={e => setQuantity(e.target.value)} style={{ width: 70, textAlign: "center" }} />
              </div>
            </div>

            {/* Total */}
            <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: "13px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase" }}>Unit Price</div>
                <div style={{ fontFamily: theme.font.mono, fontWeight: 600, color: theme.accent.gold, fontSize: 15, marginTop: 2 }}>{fmt(product.price)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 9, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase" }}>Total</div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 22 : 26, color: theme.accent.gold }}>{fmt(totalAmount)}</div>
              </div>
            </div>

            {/* Customer phone */}
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 6 }}>Customer Phone <span style={{ color: theme.text.muted, textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
              <input className="ki" type="tel" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="07XX XXX XXX — leave blank to skip" />
            </div>

            {/* Payment method */}
            <div>
              <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 8 }}>Payment Method</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {([{key:"cash",icon:"💵",label:"Cash",col:"#34d399"},{key:"mpesa",icon:"📱",label:"M-Pesa",col:theme.accent.cyan},{key:"split",icon:"⚡",label:"Split",col:theme.accent.gold}] as const).map(({ key, icon, label, col }) => (
                  <button key={key} onClick={() => { setPayMethod(key); setCashAmount(""); setMpesaAmount(""); setMpesaRef(""); }}
                    style={{ padding: "12px 8px", border: `1px solid ${payMethod === key ? col + "80" : theme.border.default}`, borderRadius: 12, background: payMethod === key ? col + "18" : "transparent", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                    <span style={{ fontSize: 20 }}>{icon}</span>
                    <span style={{ fontSize: 11, fontFamily: theme.font.mono, fontWeight: 600, color: payMethod === key ? col : theme.text.muted }}>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {payMethod === "split" && (
              <div style={{ background: "rgba(234,179,8,0.05)", border: "1px solid rgba(234,179,8,0.2)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.accent.gold }}>⚡ Split — Total: {fmt(totalAmount)}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 10, fontFamily: theme.font.mono, color: "#34d399", display: "block", marginBottom: 5, textTransform: "uppercase" }}>💵 Cash</label>
                    <input className="ki" type="number" value={cashAmount}
                      onChange={e => { setCashAmount(e.target.value); setMpesaAmount(String(Math.max(0, totalAmount - (Number(e.target.value) || 0)))); }}
                      placeholder="0" />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.accent.cyan, display: "block", marginBottom: 5, textTransform: "uppercase" }}>📱 M-Pesa</label>
                    <input className="ki" type="number" value={mpesaAmount}
                      onChange={e => { setMpesaAmount(e.target.value); setCashAmount(String(Math.max(0, totalAmount - (Number(e.target.value) || 0)))); }}
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

            <button className="abtn" onClick={handleDetailsNext}
              style={{ background: `linear-gradient(135deg,${theme.accent.cyan},#0891b2)`, color: "#fff" }}>
              Next — Authorise Sale →
            </button>
          </div>
        )}

        {/* ══════════════════ STEP 3: VERIFY ══════════════════ */}
        {step === "verify" && product && (
          <div className="section" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Sale summary */}
            <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{product.name}</div>
                  <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                    {parseInt(quantity)||1}× · {payMethod === "cash" ? "💵 Cash" : payMethod === "mpesa" ? "📱 M-Pesa" : "⚡ Split"} · {customerPhone}
                  </div>
                </div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 20, color: theme.accent.gold }}>{fmt(totalAmount)}</div>
              </div>
            </div>

            {/* Method toggle */}
            <div style={{ display: "flex", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 12, padding: 4, gap: 4 }}>
              {([
                { key: "badge", label: "📛 Scan Badge" },
                { key: "pin",   label: "🔑 Enter PIN"  },
              ] as const).map(({ key, label }) => (
                <button key={key} onClick={() => { setVerifyMethod(key); setPinError(""); setBadgeError(""); setPin(""); }}
                  style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: theme.font.mono, fontSize: isMobile ? 12 : 13, fontWeight: verifyMethod === key ? 600 : 400, background: verifyMethod === key ? "rgba(6,182,212,0.15)" : "transparent", color: verifyMethod === key ? theme.accent.cyan : theme.text.muted }}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── PIN method ── */}
            {verifyMethod === "pin" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Agent selector */}
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

                {/* PIN pad */}
                {selectedAgent && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    <label style={{ color: theme.text.secondary, fontSize: 10, fontFamily: theme.font.mono, textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 12, textAlign: "center" }}>
                      PIN for {selectedAgent.name}
                    </label>
                    <div className={pinShake ? "shake" : ""} style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 16 }}>
                      {[0,1,2,3].map(i => (
                        <div key={i} className={`pin-digit ${i < pin.length ? "filled" : ""}`}>
                          {i < pin.length ? "●" : ""}
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 9, maxWidth: isMobile ? "100%" : 300, margin: "0 auto", width: "100%" }}>
                      {["1","2","3","4","5","6","7","8","9","","0","⌫"].map(k => (
                        <button key={k} disabled={!k}
                          onClick={() => {
                            if (k === "⌫") { setPin(p => p.slice(0,-1)); setPinError(""); }
                            else if (k && pin.length < 4) setPin(p => p + k);
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
                    <button className="abtn" onClick={handlePinVerify} disabled={pin.length !== 4 || processing}
                      style={{ marginTop: 14, background: pin.length === 4 && !processing ? `linear-gradient(135deg,${theme.accent.cyan},#0891b2)` : "rgba(255,255,255,0.05)", color: pin.length === 4 && !processing ? "#fff" : theme.text.muted, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                      {processing ? <><span style={{ width:16,height:16,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"#fff",borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite" }} />Processing...</> : "✓ Confirm Sale"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Badge scan method ── */}
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
                    <span style={{ width:16,height:16,border:"2px solid rgba(6,182,212,0.3)",borderTopColor:theme.accent.cyan,borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite" }} />
                    Processing sale...
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ STEP 4: SUCCESS ══════════════════ */}
        {step === "success" && product && (
          <div className="section" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, paddingTop: 16, textAlign: "center" }}>
            <div className="success-icon" style={{ width: 86, height: 86, borderRadius: "50%", background: "rgba(52,211,153,0.15)", border: "2px solid #34d399", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 38 }}>✓</div>
            <div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 22 : 26 }}>Sale Recorded!</div>
              <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono, marginTop: 4 }}>Synced to owner dashboard</div>
            </div>
            <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 18, padding: "20px 22px", width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { label: "Transaction", value: `TXN-${savedTxId}` },
                { label: "Product",     value: product.name },
                { label: "Seller",      value: selectedAgent?.name ?? "—" },
                { label: "Quantity",    value: `${parseInt(quantity)||1} ${product.unit}` },
                { label: "Payment",     value: payMethod === "cash" ? "💵 Cash" : payMethod === "mpesa" ? "📱 M-Pesa" : "⚡ Split" },
                { label: "Customer",    value: customerPhone },
                { label: "Total",       value: fmt(totalAmount), highlight: true },
              ].map(({ label, value, highlight }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
                  <span style={{ fontSize: highlight ? 20 : 13, fontFamily: highlight ? theme.font.display : theme.font.mono, fontWeight: highlight ? 800 : 500, color: highlight ? theme.accent.gold : theme.text.primary }}>{value}</span>
                </div>
              ))}
            </div>
            <button className="abtn" onClick={handleReset}
              style={{ background: `linear-gradient(135deg,${theme.accent.cyan},#0891b2)`, color: "#fff", maxWidth: 320 }}>
              + New Sale
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
