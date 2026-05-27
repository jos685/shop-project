import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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

// 6 AM – 8 PM
const HOURS = Array.from({ length: 15 }, (_, i) => i + 6);
const hourLabel = (h: number) =>
  h === 12 ? "12PM" : h < 12 ? `${h}AM` : `${h - 12}PM`;

interface HourData { hour: number; label: string; count: number; revenue: number; }
interface StockRow { name: string; remaining: number; allocated: number; }
interface RecentTx { id: string; amount: number; product_name: string; payment_method: string; created_at: string; }

// Smooth bezier path through points
function smoothPath(xs: number[], ys: number[]): string {
  if (!xs.length) return "";
  if (xs.length === 1) return `M ${xs[0]},${ys[0]}`;
  let d = `M ${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 1; i < xs.length; i++) {
    const mx = ((xs[i - 1] + xs[i]) / 2).toFixed(1);
    d += ` C ${mx},${ys[i - 1].toFixed(1)} ${mx},${ys[i].toFixed(1)} ${xs[i].toFixed(1)},${ys[i].toFixed(1)}`;
  }
  return d;
}

function HourlyChart({ data, theme }: { data: HourData[]; theme: any }) {
  if (!data.length) return null;
  const W = 600, H = 180;
  const pl = 34, pr = 12, pt = 12, pb = 30;
  const iW = W - pl - pr, iH = H - pt - pb;
  const bot = pt + iH;
  const maxCount = Math.max(...data.map(d => d.count), 4);
  const xs = data.map((_, i) => pl + (i / (data.length - 1)) * iW);
  const ys = data.map(d => pt + (1 - d.count / maxCount) * iH);
  const line = smoothPath(xs, ys);
  const area = `${line} L ${xs[xs.length - 1].toFixed(1)},${bot} L ${xs[0].toFixed(1)},${bot} Z`;
  const nowH = new Date().getHours();
  const yTicks = [0, Math.round(maxCount / 2), maxCount];
  const xEvery = data.map((d, i) => ({ i, h: d.hour })).filter(({ h }) => h % 2 === 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      <defs>
        <linearGradient id="hcGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={theme.accent.cyan} stopOpacity="0.38" />
          <stop offset="100%" stopColor={theme.accent.cyan} stopOpacity="0.01" />
        </linearGradient>
        <clipPath id="hcClip"><rect x={pl} y={pt - 4} width={iW} height={iH + 8} /></clipPath>
      </defs>
      {yTicks.map(v => {
        const y = (pt + (1 - v / maxCount) * iH).toFixed(1);
        return (
          <g key={v}>
            <line x1={pl} y1={y} x2={W - pr} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={pl - 6} y={Number(y) + 4} textAnchor="end" fontSize="10"
              fill="rgba(255,255,255,0.28)" fontFamily="DM Mono, monospace">{v}</text>
          </g>
        );
      })}
      <g clipPath="url(#hcClip)">
        <path d={area} fill="url(#hcGrad)" />
        <path d={line} fill="none" stroke={theme.accent.cyan} strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round" />
      </g>
      {data.map((d, i) => (
        <circle key={i} cx={xs[i].toFixed(1)} cy={ys[i].toFixed(1)}
          r={d.hour === nowH ? 5.5 : 3.5}
          fill={d.count > 0 ? theme.accent.cyan : (theme.bg?.base ?? "#0d1117")}
          stroke={theme.accent.cyan} strokeWidth="2" />
      ))}
      {xEvery.map(({ i, h }) => (
        <text key={i} x={xs[i].toFixed(1)} y={H - 5} textAnchor="middle" fontSize="10"
          fill={h === nowH ? theme.accent.cyan : "rgba(255,255,255,0.28)"}
          fontFamily="DM Mono, monospace" fontWeight={h === nowH ? "700" : "400"}>
          {data[i].label}
        </text>
      ))}
    </svg>
  );
}

export default function PosDashboard() {
  const { shop } = useShopAuth();
  const { theme } = useTheme();
  const { pendingCount } = useNetwork();
  const navigate         = useNavigate();
  const width            = useWindowWidth();
  const isMobile         = width < 640;
  const isTwoCol         = width >= 960;

  const [loading,     setLoading]     = useState(true);

  const [hourlyData,  setHourlyData]  = useState<HourData[]>([]);
  const [stockRows,   setStockRows]   = useState<StockRow[]>([]);
  const [recentTxs,   setRecentTxs]   = useState<RecentTx[]>([]);

  const [todayCount,  setTodayCount]  = useState(0);
  const [todayRev,    setTodayRev]    = useState(0);
  const [cashRev,     setCashRev]     = useState(0);
  const [mpesaRev,    setMpesaRev]    = useState(0);
  const [stockCount,  setStockCount]  = useState(0);
  const [lowCount,    setLowCount]    = useState(0);
  const [returnsAmt,  setReturnsAmt]  = useState(0);
  const [pendingReqs, setPendingReqs] = useState(0);
  const [queuedCount, setQueuedCount] = useState(0);
  const [queuedTotal, setQueuedTotal] = useState(0);


  const fetchAll = useCallback(async () => {
    if (!shop) return;
    if (!navigator.onLine) {
      // Load stock from the same cache PosScan writes
      try {
        const raw = localStorage.getItem(`pos_cache_${shop.id}`);
        if (raw) {
          const { products } = JSON.parse(raw);
          if (products?.length) {
            const low = products.filter((a: any) => a.allocated > 0 && a.remaining / a.allocated < 0.2);
            setStockCount(products.length);
            setLowCount(low.length);
            setStockRows(
              [...products]
                .sort((a: any, b: any) => (a.remaining / Math.max(a.allocated, 1)) - (b.remaining / Math.max(b.allocated, 1)))
                .slice(0, 7)
                .map((a: any) => ({ name: a.product?.name || "—", remaining: a.remaining, allocated: a.allocated }))
            );
          }
        }
      } catch {}
      setLoading(false);
      return;
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [txRes, allocRes, reqRes] = await Promise.all([
      supabase.from("shop_transactions")
        .select("id, amount, product_id, payment_method, cash_amount, mpesa_amount, created_at")
        .eq("shop_id", shop.id)
        .gte("created_at", today.toISOString())
        .order("created_at", { ascending: false }),
      supabase.from("shop_allocations")
        .select("product_id, remaining, allocated")
        .eq("shop_id", shop.id),
      supabase.from("shop_requests")
        .select("id")
        .eq("shop_id", shop.id)
        .eq("status", "pending"),
    ]);

    const txData  = txRes.data   || [];
    const allocs  = allocRes.data || [];

    // Today totals (gross)
    const totalRev  = txData.reduce((s: number, t: any) => s + t.amount, 0);
    const cashTotal = txData.reduce((s: number, t: any) =>
      s + (t.cash_amount  ?? (t.payment_method === "cash"  ? t.amount : 0)), 0);
    const mpesaTotal = txData.reduce((s: number, t: any) =>
      s + (t.mpesa_amount ?? (t.payment_method === "mpesa" ? t.amount : 0)), 0);
    setTodayCount(txData.length);

    // Fetch today's returns and deduct from revenue
    const txIds = txData.map((t: any) => t.id);
    let returnsTotal = 0, cashReturns = 0, mpesaReturns = 0;
    if (txIds.length > 0) {
      const { data: returnsData } = await supabase
        .from("transaction_returns")
        .select("original_transaction_id, amount_refunded")
        .in("original_transaction_id", txIds);
      for (const r of returnsData ?? []) {
        const orig = txData.find((t: any) => t.id === r.original_transaction_id);
        // Cap deduction at what was actually received — credit sales (amount=0) deduct nothing
        const effectiveRefund = orig ? Math.min(r.amount_refunded, orig.amount) : 0;
        returnsTotal += effectiveRefund;
        if (orig && effectiveRefund > 0) {
          if (orig.payment_method === "cash") {
            cashReturns += effectiveRefund;
          } else if (orig.payment_method === "mpesa") {
            mpesaReturns += effectiveRefund;
          } else if (orig.payment_method === "split" && orig.amount > 0) {
            cashReturns  += effectiveRefund * (orig.cash_amount  ?? 0) / orig.amount;
            mpesaReturns += effectiveRefund * (orig.mpesa_amount ?? 0) / orig.amount;
          }
        }
      }
    }
    setReturnsAmt(returnsTotal);
    setTodayRev(totalRev - returnsTotal);
    setCashRev(cashTotal  - cashReturns);
    setMpesaRev(mpesaTotal - mpesaReturns);

    // Hourly (6AM–8PM)
    setHourlyData(HOURS.map(h => {
      const hTxs = txData.filter((t: any) => new Date(t.created_at).getHours() === h);
      return { hour: h, label: hourLabel(h), count: hTxs.length, revenue: hTxs.reduce((s: number, t: any) => s + t.amount, 0) };
    }));

    // Stock
    const lowAllocs = allocs.filter((a: any) => a.allocated > 0 && a.remaining / a.allocated < 0.2);
    setStockCount(allocs.length);
    setLowCount(lowAllocs.length);

    // Stock rows with names
    if (allocs.length > 0) {
      const pIds = allocs.map((a: any) => a.product_id).filter(Boolean);
      const { data: prodsData } = await supabase.from("products").select("id, name").in("id", pIds);
      const pm: Record<string, string> = {};
      for (const p of prodsData || []) pm[p.id] = p.name;
      setStockRows(
        [...allocs]
          .sort((a: any, b: any) => (a.remaining / Math.max(a.allocated, 1)) - (b.remaining / Math.max(b.allocated, 1)))
          .slice(0, 7)
          .map((a: any) => ({ name: pm[a.product_id] || "—", remaining: a.remaining, allocated: a.allocated }))
      );
    }


    // Requests
    setPendingReqs((reqRes.data || []).length);

    // Recent txs (top 8 today)
    const recentRaw = txData.slice(0, 8);
    const pIds2 = [...new Set(recentRaw.map((t: any) => t.product_id).filter(Boolean))] as string[];
    const pm2: Record<string, string> = {};
    if (pIds2.length > 0) {
      const { data: pd2 } = await supabase.from("products").select("id, name").in("id", pIds2);
      for (const p of pd2 || []) pm2[p.id] = p.name;
    }
    setRecentTxs(recentRaw.map((t: any) => ({
      id: t.id, amount: t.amount,
      product_name:   pm2[t.product_id] || "—",
      payment_method: t.payment_method,
      created_at:     t.created_at,
    })));

    setLoading(false);
  }, [shop]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const q = getQueue();
    setQueuedCount(q.length);
    setQueuedTotal(q.reduce((s, sale) => s + sale.grandTotal, 0));
  }, [pendingCount]);

  const payIcon  = (m: string) => m === "cash" ? "💵" : m === "mpesa" ? "📱" : m === "split" ? "⚡" : "📝";
  const timeAgo  = (iso: string) => {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  };

  const topCards = [
    { key: "sales",    icon: "🧾", label: "SALES",    col: "#fbbf24",
      value: String(todayCount),
      sub: fmt(todayRev) + " net today",
      onClick: () => navigate("/pos/transactions") },
    { key: "stock",    icon: "📦", label: "STOCK",    col: "#34d399",
      value: String(stockCount),
      sub: lowCount > 0 ? `${lowCount} low stock` : "All healthy",
      onClick: () => navigate("/pos/info", { state: { tab: "stock" } }) },
    { key: "requests", icon: "📋", label: "REQUESTS", col: theme.accent.cyan,
      value: String(pendingReqs),
      sub: pendingReqs > 0 ? "Needs reply" : "No pending",
      onClick: () => navigate("/pos/requests") },
    { key: "alerts",   icon: lowCount > 0 ? "⚠️" : "✅", label: "ALERTS", col: lowCount > 0 ? "#fbbf24" : "#34d399",
      value: String(lowCount),
      sub: lowCount > 0 ? "Low stock" : "Stock OK",
      onClick: () => navigate("/pos/info", { state: { tab: "stock" } }) },
    ...(queuedCount > 0
      ? [{ key: "queued", icon: "⏳", label: "QUEUED", col: "#fbbf24",
          value: String(queuedCount),
          sub: fmt(queuedTotal) + " pending",
          onClick: () => navigate("/pos/transactions") }]
      : []),
  ];

  const spin = <div style={{ width: 20, height: 20, border: "2px solid rgba(255,255,255,0.1)", borderTopColor: theme.accent.cyan, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />;

  return (
    <div style={{ minHeight: "100vh", background: theme.bg.base, color: theme.text.primary, fontFamily: theme.font.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        @keyframes fadeUp  { from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes slideIn { from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)} }
        .section    { animation: fadeUp 0.32s ease both; }
        .action-btn { transition: transform 0.12s, opacity 0.15s; }
        .action-btn:active { transform: scale(0.97); }
        .top-card   { transition: transform 0.12s, opacity 0.12s; cursor: pointer; text-align: left; }
        .top-card:active { transform: scale(0.95); opacity: 0.8; }
        .tx-row     { transition: background 0.1s; }
        .tx-row:hover { background: rgba(255,255,255,0.02) !important; }
        ::-webkit-scrollbar { display: none; }
      `}</style>

      <div style={{ padding: isMobile ? "16px 14px 110px" : "22px 28px 110px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Auth banner removed — all writes use SECURITY DEFINER RPCs and work without a session */}

        {/* ── Offline notice ── */}
        {!navigator.onLine && (
          <div style={{ background: "rgba(146,64,14,0.15)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>⚡</span>
            <div>
              <div style={{ fontFamily: theme.font.display, fontWeight: 700, fontSize: 13, color: "#fbbf24" }}>Offline Mode</div>
              <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                Live sales figures are unavailable. {queuedCount > 0 ? `${queuedCount} queued sale${queuedCount !== 1 ? "s" : ""} (${fmt(queuedTotal)}) will sync when connection returns.` : "Sales you make now will be queued."}
              </div>
            </div>
          </div>
        )}

        {/* ── Scan & Sell hero ── */}
        <div className="section" style={{ animationDelay: "0.04s" }}>
          <button className="action-btn" onClick={() => navigate("/pos/scan")}
            style={{ width: "100%", minHeight: isMobile ? "34vh" : 210, background: "linear-gradient(145deg,rgba(6,182,212,0.18),rgba(6,182,212,0.06))", border: "1px solid rgba(6,182,212,0.32)", borderRadius: 22, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, boxShadow: "0 6px 32px rgba(6,182,212,0.12),inset 0 1px 0 rgba(255,255,255,0.05)", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-60%)", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle,rgba(6,182,212,0.15) 0%,transparent 70%)", pointerEvents: "none" }} />
            <span style={{ fontSize: isMobile ? 56 : 64, lineHeight: 1, position: "relative" }}>📷</span>
            <div style={{ textAlign: "center", position: "relative" }}>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 24 : 30, color: theme.accent.cyan, letterSpacing: "-0.02em" }}>Scan & Sell</div>
              <div style={{ color: theme.text.muted, fontSize: 12, fontFamily: theme.font.mono, marginTop: 4 }}>Tap to start a new transaction</div>
            </div>
          </button>
        </div>

        {/* ── Metric cards — responsive grid ── */}
        <div className="section" style={{ animationDelay: "0.08s" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile
              ? "repeat(2, 1fr)"
              : `repeat(${topCards.length}, 1fr)`,
            gap: 10,
          }}>
            {topCards.map(c => (
              <button key={c.key} className="top-card" onClick={c.onClick}
                style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14, padding: "13px 14px 11px", display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: `${c.col}1a`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>{c.icon}</div>
                  <span style={{ fontSize: 9, fontFamily: theme.font.mono, color: c.col, letterSpacing: "0.12em" }}>{c.label}</span>
                </div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: isMobile ? 26 : 30, color: c.col, lineHeight: 1, minHeight: 32 }}>
                  {loading ? <span style={{ opacity: 0.25, fontSize: 20 }}>—</span> : c.value}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                  <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "85%" }}>{loading ? "" : c.sub}</div>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.18)", flexShrink: 0 }}>→</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Chart + Stock two-column ── */}
        <div className="section" style={{ animationDelay: "0.13s", display: "grid", gridTemplateColumns: isTwoCol ? "1.85fr 1fr" : "1fr", gap: 14 }}>

          {/* Sales activity chart */}
          <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 18, padding: "18px 18px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 15 }}>Sales Activity</div>
                <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>Today's hourly breakdown</div>
              </div>
              <button onClick={() => navigate("/pos/transactions")}
                style={{ background: "none", border: "none", color: theme.accent.cyan, fontFamily: theme.font.mono, fontSize: 11, cursor: "pointer", padding: 0, flexShrink: 0 }}>
                View all →
              </button>
            </div>
            {loading
              ? <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center" }}>{spin}</div>
              : hourlyData.every(d => d.count === 0)
                ? <div style={{ height: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12, fontFamily: theme.font.mono, color: theme.text.muted }}>
                    <span style={{ fontSize: 28, opacity: 0.3 }}>📊</span>No sales recorded today yet
                  </div>
                : <HourlyChart data={hourlyData} theme={theme} />
            }
          </div>

          {/* My Stock */}
          <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 18, padding: "18px 18px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 15 }}>My Stock</div>
              <button onClick={() => navigate("/pos/info", { state: { tab: "stock" } })}
                style={{ background: "none", border: "none", color: theme.accent.cyan, fontFamily: theme.font.mono, fontSize: 11, cursor: "pointer", padding: 0 }}>
                View all →
              </button>
            </div>
            {loading
              ? <div style={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>{spin}</div>
              : stockRows.length === 0
                ? <div style={{ textAlign: "center", padding: "32px 0", fontSize: 12, fontFamily: theme.font.mono, color: theme.text.muted }}>No stock allocated</div>
                : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {stockRows.map((r, i) => {
                      const pct = r.allocated > 0 ? r.remaining / r.allocated : 0;
                      const col = pct < 0.1 ? "#ef4444" : pct < 0.3 ? "#fbbf24" : "#34d399";
                      return (
                        <div key={i}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                            <span style={{ fontSize: 12, fontFamily: theme.font.mono, color: theme.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "65%" }}>{r.name}</span>
                            <span style={{ fontSize: 12, fontFamily: theme.font.mono, fontWeight: 700, color: col, flexShrink: 0 }}>{r.remaining} left</span>
                          </div>
                          <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.07)" }}>
                            <div style={{ height: "100%", width: `${Math.max(pct * 100, 2)}%`, background: col, borderRadius: 3, transition: "width 0.5s ease" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
            }
          </div>
        </div>

        {/* ── Payment split (unique shop section, only when there are sales) ── */}
        {!loading && todayRev > 0 && (() => {
          const otherRev = Math.max(0, todayRev - cashRev - mpesaRev);
          const rows = [
            { label: "Cash",   icon: "💵", amount: cashRev,   col: "#34d399" },
            { label: "M-Pesa", icon: "📱", amount: mpesaRev,  col: theme.accent.cyan },
            { label: "Other",  icon: "📝", amount: otherRev,  col: "#8b5cf6" },
          ].filter(r => r.amount > 0);
          return (
            <div className="section" style={{ animationDelay: "0.18s", background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 18, padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
                <div>
                  <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 15 }}>Payment Split</div>
                  <div style={{ fontSize: 11, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 2 }}>
                    {fmt(todayRev)} net · {todayCount} sale{todayCount !== 1 ? "s" : ""} today
                    {returnsAmt > 0 && <span style={{ color: "#f87171", marginLeft: 6 }}>↩ -{fmt(returnsAmt)} returned</span>}
                  </div>
                </div>
                <button onClick={() => navigate("/pos/info", { state: { tab: "expenses" } })}
                  style={{ background: "none", border: "none", color: theme.accent.cyan, fontFamily: theme.font.mono, fontSize: 11, cursor: "pointer", padding: 0 }}>
                  Expenses →
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {rows.map(r => {
                  const pct = (r.amount / todayRev) * 100;
                  return (
                    <div key={r.label}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: theme.font.mono, marginBottom: 5 }}>
                        <span style={{ color: theme.text.secondary }}>{r.icon} {r.label}</span>
                        <span style={{ color: r.col, fontWeight: 600 }}>{pct.toFixed(0)}% · {fmt(r.amount)}</span>
                      </div>
                      <div style={{ height: 7, borderRadius: 4, background: "rgba(255,255,255,0.06)" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: r.col, borderRadius: 4, transition: "width 0.6s ease" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── Recent transactions ── */}
        <div className="section" style={{ animationDelay: "0.22s" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>Recent Transactions</div>
            <button onClick={() => navigate("/pos/transactions")}
              style={{ background: "none", border: "none", color: theme.accent.cyan, fontFamily: theme.font.mono, fontSize: 10, cursor: "pointer", padding: 0 }}>
              View all →
            </button>
          </div>
          {loading
            ? <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>{spin}</div>
            : (recentTxs.length === 0 && queuedCount === 0)
              ? (
                <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 14, padding: "26px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 26, opacity: 0.3, marginBottom: 8 }}>🧾</div>
                  <div style={{ fontSize: 12, fontFamily: theme.font.mono, color: theme.text.muted }}>No transactions today yet</div>
                </div>
              )
              : (
                <div style={{ background: theme.bg.card, border: `1px solid ${theme.border.default}`, borderRadius: 16, overflow: "hidden" }}>
                  {/* Queued entries at the top */}
                  {getQueue().slice(0, 4).map((q, i) => {
                    const label  = q.cart.length === 1 ? q.cart[0].productName : `${q.cart[0].productName} +${q.cart.length - 1} more`;
                    const isLast = i === Math.min(3, queuedCount - 1) && recentTxs.length === 0;
                    return (
                      <div key={q.id} className="tx-row" onClick={() => navigate("/pos/transactions")}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: isLast ? "none" : `1px solid ${theme.border.default}`, cursor: "pointer" }}>
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
                          ⏳
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                            <span style={{ fontSize: 9, fontFamily: theme.font.mono, fontWeight: 700, color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 20, padding: "1px 6px" }}>QUEUED</span>
                            <span style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted }}>{q.verifiedAgent.name} · {timeAgo(new Date(q.queuedAt).toISOString())}</span>
                          </div>
                        </div>
                        <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 14, color: "#fbbf24", flexShrink: 0 }}>{fmt(q.grandTotal)}</div>
                      </div>
                    );
                  })}
                  {/* Live synced entries */}
                  {recentTxs.map((tx, i) => (
                    <div key={tx.id} className="tx-row"
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderBottom: i < recentTxs.length - 1 ? `1px solid ${theme.border.default}` : "none" }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
                        {payIcon(tx.payment_method)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tx.product_name}</div>
                        <div style={{ fontSize: 10, fontFamily: theme.font.mono, color: theme.text.muted, marginTop: 1 }}>
                          {tx.payment_method === "cash" ? "Cash" : tx.payment_method === "mpesa" ? "M-Pesa" : tx.payment_method === "split" ? "Split" : "Credit"} · {timeAgo(tx.created_at)}
                        </div>
                      </div>
                      <div style={{ fontFamily: theme.font.display, fontWeight: 800, fontSize: 14, color: "#34d399", flexShrink: 0 }}>{fmt(tx.amount)}</div>
                    </div>
                  ))}
                </div>
              )
          }
        </div>

      </div>

    </div>
  );
}
