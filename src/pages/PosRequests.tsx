// pages/PosRequests.tsx
// Shop can send stock requests, damage reports, demand reports and messages to owner

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "../context/ThemeContext";
import { useShopAuth } from "../context/ShopAuthContext";
import { supabase } from "../lib/supabase";

type RequestType = "stock_request" | "damage_report" | "demand_report" | "message";
type RequestStatus = "pending" | "approved" | "rejected";

interface ShopRequest {
  id: string;
  type: RequestType;
  product_id: string | null;
  product_name: string | null;
  quantity: number | null;
  message: string;
  status: RequestStatus;
  owner_reply: string | null;
  created_at: string;
  updated_at: string;
}

interface StockProduct {
  id: string;
  name: string;
  sku: string;
}

const REQUEST_TYPES: { value: RequestType; label: string; icon: string; desc: string; color: string }[] = [
  { value: "stock_request", label: "Stock Request",   icon: "📦", desc: "Request more stock of a product",         color: "#06b6d4" },
  { value: "damage_report", label: "Damage / Loss",   icon: "⚠️", desc: "Report damaged or lost product",          color: "#f87171" },
  { value: "demand_report", label: "Customer Demand", icon: "📣", desc: "Customers asking for a product you lack", color: "#a78bfa" },
  { value: "message",       label: "General Message", icon: "💬", desc: "Send a message or note to your owner",    color: "#34d399" },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

function statusBadge(status: RequestStatus) {
  const map = {
    pending:  { label: "Pending",  bg: "rgba(234,179,8,0.12)",   border: "rgba(234,179,8,0.3)",   color: "#fbbf24" },
    approved: { label: "Approved", bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.3)",  color: "#34d399" },
    rejected: { label: "Rejected", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)", color: "#f87171" },
  };
  const s = map[status];
  return (
    <span style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color, borderRadius: 6, padding: "2px 8px", fontSize: 10, fontFamily: "DM Mono, monospace", fontWeight: 500 }}>
      {s.label}
    </span>
  );
}

export default function PosRequests() {
  const { theme } = useTheme();
  const { shop } = useShopAuth();

  const [requests, setRequests]     = useState<ShopRequest[]>([]);
  const [products, setProducts]     = useState<StockProduct[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [type, setType]             = useState<RequestType>("stock_request");
  const [productId, setProductId]   = useState("");
  const [quantity, setQuantity]     = useState("");
  const [message, setMessage]       = useState("");
  const [formError, setFormError]   = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const needsProduct = type === "stock_request" || type === "damage_report" || type === "demand_report";
  const needsQty     = type === "stock_request" || type === "damage_report";

  const fetchData = useCallback(async () => {
    if (!shop) return;
    const [reqRes, allocRes] = await Promise.all([
      supabase
        .from("shop_requests")
        .select("*")
        .eq("shop_id", shop.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("shop_allocations")
        .select("product_id, product_name, product_sku")
        .eq("shop_id", shop.id),
    ]);

    setRequests((reqRes.data || []) as ShopRequest[]);

    // Build unique product list from shop allocations
    const seen = new Set<string>();
    const prods: StockProduct[] = [];
    for (const a of (allocRes.data || []) as any[]) {
      if (a.product_id && a.product_name && !seen.has(a.product_id)) {
        seen.add(a.product_id);
        prods.push({ id: a.product_id, name: a.product_name, sku: a.product_sku ?? "" });
      }
    }
    setProducts(prods);
    setLoading(false);
  }, [shop]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Realtime — owner replies show up instantly
  useEffect(() => {
    if (!shop) return;
    const ch = supabase.channel("shop-requests-live")
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "shop_requests",
        filter: `shop_id=eq.${shop.id}`,
      }, () => fetchData())
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "shop_requests",
        filter: `shop_id=eq.${shop.id}`,
      }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, fetchData]);

  const resetForm = () => {
    setType("stock_request"); setProductId(""); setQuantity("");
    setMessage(""); setFormError(""); setSuccessMsg("");
  };

  const handleSubmit = async () => {
    setFormError("");
    if (needsProduct && !productId) { setFormError("Please select a product."); return; }
    if (needsQty && (!quantity || parseInt(quantity) < 1)) { setFormError("Please enter a valid quantity."); return; }
    if (!message.trim()) { setFormError("Please add a message."); return; }
    if (!shop?.owner_id) { setFormError("Owner not found. Contact support."); return; }

    setSubmitting(true);

    const selectedProduct = products.find(p => p.id === productId);

    const { error } = await supabase.from("shop_requests").insert({
      owner_id:     shop.owner_id,
      shop_id:      shop.id,
      type,
      product_id:   needsProduct && productId && productId !== "__other__" ? productId : null,
      product_name: needsProduct && selectedProduct ? selectedProduct.name : needsProduct && productId === "__other__" ? "Other" : null,
      quantity:     needsQty && quantity ? parseInt(quantity) : null,
      message:      message.trim(),
      status:       "pending",
    });

    if (error) {
      setFormError(`Failed to send: ${error.message}`);
      setSubmitting(false);
      return;
    }

    setSuccessMsg("Request sent to your owner ✓");
    setSubmitting(false);
    resetForm();
    setTimeout(() => { setShowForm(false); setSuccessMsg(""); fetchData(); }, 1500);
  };

  const pendingCount = requests.filter(r => r.status === "pending").length;

  return (
    <div style={{ minHeight: "100vh", background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        .req-card { transition: background 0.15s; }
        .req-card:hover { background: rgba(255,255,255,0.03) !important; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ borderBottom: `1px solid ${theme.border.default}`, padding: "16px 16px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 16 }}>
          <div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em" }}>Requests</div>
            <div style={{ color: theme.text.muted, fontSize: 11, fontFamily: theme.font.mono, marginTop: 2 }}>
              {shop?.name} · {pendingCount > 0 ? `${pendingCount} awaiting response` : "Send requests to your owner"}
            </div>
          </div>
          <button
            onClick={() => { setShowForm(true); resetForm(); }}
            style={{ background: "linear-gradient(135deg,#06b6d4,#0891b2)", border: "none", borderRadius: 12, padding: "10px 18px", color: "#fff", fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            + New
          </button>
        </div>
      </div>

      {/* ── New Request Form (bottom sheet) ── */}
      {showForm && (
        <div
          style={{ position: "fixed", inset: 0, background: theme.bg.overlay, backdropFilter: "blur(6px)", zIndex: 100, display: "flex", alignItems: "flex-end" }}
          onClick={() => { setShowForm(false); resetForm(); }}>
          <div
            style={{ width: "100%", background: theme.bg.modal, borderRadius: "20px 20px 0 0", padding: "24px 20px 40px", animation: "slideUp 0.25s ease", maxHeight: "90vh", overflowY: "auto" }}
            onClick={e => e.stopPropagation()}>

            {/* Handle */}
            <div style={{ width: 36, height: 4, borderRadius: 2, background: theme.border.default, margin: "0 auto 20px" }} />

            <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 18, marginBottom: 20 }}>New Request</div>

            {/* Request type selector */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
              {REQUEST_TYPES.map(rt => (
                <div
                  key={rt.value}
                  onClick={() => { setType(rt.value); setProductId(""); setQuantity(""); }}
                  style={{ padding: "12px", borderRadius: 12, border: `1px solid ${type === rt.value ? rt.color : "rgba(255,255,255,0.08)"}`, background: type === rt.value ? `${rt.color}14` : "rgba(255,255,255,0.02)", cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{rt.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: type === rt.value ? rt.color : theme.text.primary }}>{rt.label}</div>
                  <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2, lineHeight: 1.4 }}>{rt.desc}</div>
                </div>
              ))}
            </div>

            {/* Product selector */}
            {needsProduct && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Product</div>
                <select
                  value={productId}
                  onChange={e => setProductId(e.target.value)}
                  style={{ width: "100%", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 10, padding: "12px 14px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none" } as React.CSSProperties}>
                  <option value="" style={{ background: theme.bg.card, color: theme.text.muted }}>Select a product...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id} style={{ background: theme.bg.card, color: theme.text.primary }}>{p.name}{p.sku ? ` (${p.sku})` : ""}</option>
                  ))}
                  {type === "demand_report" && (
                    <option value="__other__" style={{ background: theme.bg.card, color: theme.text.primary }}>Other (not in my stock)</option>
                  )}
                </select>
              </div>
            )}

            {/* Quantity */}
            {needsQty && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {type === "damage_report" ? "Units Damaged / Lost" : "Quantity Requested"}
                </div>
                <input
                  type="number" min="1" value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  placeholder="Enter quantity..."
                  style={{ width: "100%", background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 10, padding: "12px 14px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
              </div>
            )}

            {/* Message */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {type === "message" ? "Your Message" : "Additional Details"}
              </div>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={3}
                placeholder={
                  type === "stock_request" ? "e.g. Running very low, customers asking daily..." :
                  type === "damage_report" ? "e.g. Dropped during delivery, packaging broken..." :
                  type === "demand_report" ? "e.g. At least 10 customers asked for this today..." :
                  "Type your message here..."
                }
                style={{ width: "100%", background: theme.bg.input, border: `1px solid ${theme.border.default}`, borderRadius: 10, padding: "12px 14px", color: theme.text.primary, fontFamily: theme.font.mono, fontSize: 13, outline: "none", resize: "none", boxSizing: "border-box", lineHeight: 1.6 }} />
            </div>

            {formError && (
              <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 10, padding: "10px 14px", color: "#f87171", fontFamily: theme.font.mono, fontSize: 12, marginBottom: 16 }}>
                ⚠ {formError}
              </div>
            )}
            {successMsg && (
              <div style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 10, padding: "10px 14px", color: "#34d399", fontFamily: theme.font.mono, fontSize: 12, marginBottom: 16 }}>
                ✓ {successMsg}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { setShowForm(false); resetForm(); }}
                disabled={submitting}
                style={{ flex: 1, background: "none", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 14, color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{ flex: 2, background: submitting ? "rgba(6,182,212,0.3)" : "linear-gradient(135deg,#06b6d4,#0891b2)", border: "none", borderRadius: 12, padding: 14, color: "#fff", fontFamily: theme.font.display, fontWeight: 700, fontSize: 15, cursor: submitting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                {submitting
                  ? <><span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} /> Sending...</>
                  : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Request History ── */}
      <div style={{ padding: "16px 16px 100px", display: "flex", flexDirection: "column", gap: 10 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: theme.text.muted, fontFamily: theme.font.mono, fontSize: 13 }}>
            <div style={{ width: 24, height: 24, border: "2px solid rgba(6,182,212,0.2)", borderTopColor: "#06b6d4", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
            Loading requests...
          </div>
        ) : requests.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 16px", color: theme.text.muted }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>📋</div>
            <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 16, marginBottom: 6 }}>No requests yet</div>
            <div style={{ fontFamily: theme.font.mono, fontSize: 12, lineHeight: 1.7 }}>
              Use the button above to send stock requests,<br />report damage, or message your owner.
            </div>
          </div>
        ) : requests.map(req => {
          const rt = REQUEST_TYPES.find(r => r.value === req.type)!;
          const isExpanded = expandedId === req.id;
          const hasReply   = !!req.owner_reply;

          return (
            <div
              key={req.id}
              className="req-card"
              onClick={() => setExpandedId(isExpanded ? null : req.id)}
              style={{
                background: theme.bg.card,
                border: `1px solid ${req.status === "approved" ? "rgba(52,211,153,0.2)" : req.status === "rejected" ? "rgba(248,113,113,0.2)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 14, padding: "14px 16px", cursor: "pointer",
              }}>

              {/* Header row */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: `${rt.color}14`, border: `1px solid ${rt.color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                  {rt.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: rt.color }}>{rt.label}</div>
                    {statusBadge(req.status)}
                  </div>
                  {req.product_name && (
                    <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 3 }}>
                      📦 {req.product_name}
                      {req.quantity != null && <span style={{ color: theme.text.secondary }}> · {req.quantity} units</span>}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: theme.text.secondary, lineHeight: 1.5, overflow: isExpanded ? "visible" : "hidden", textOverflow: "ellipsis", whiteSpace: isExpanded ? "normal" : "nowrap" }}>
                    {req.message}
                  </div>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  {hasReply ? (
                    <div style={{ background: req.status === "approved" ? "rgba(52,211,153,0.06)" : "rgba(248,113,113,0.06)", border: `1px solid ${req.status === "approved" ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)"}`, borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Owner's Reply</div>
                      <div style={{ fontSize: 13, lineHeight: 1.6, color: theme.text.primary }}>{req.owner_reply}</div>
                    </div>
                  ) : req.status === "pending" ? (
                    <div style={{ fontSize: 12, fontFamily: theme.font.mono, color: theme.text.muted, fontStyle: "italic", marginBottom: 10 }}>
                      ⏳ Waiting for owner to respond...
                    </div>
                  ) : null}
                  <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>
                    Sent {timeAgo(req.created_at)}
                    {req.updated_at !== req.created_at && ` · Updated ${timeAgo(req.updated_at)}`}
                  </div>
                </div>
              )}

              {/* Reply hint when collapsed */}
              {!isExpanded && hasReply && (
                <div style={{ marginTop: 8, fontSize: 10, fontFamily: theme.font.mono, color: req.status === "approved" ? "#34d399" : "#f87171" }}>
                  💬 Owner replied — tap to read
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
