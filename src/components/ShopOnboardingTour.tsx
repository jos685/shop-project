import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const C = "DM Mono, monospace";
const S = "DM Sans, sans-serif";

const NAV_H   = 64;  // BottomNav height in px
const STEP_MS = 8000;
const PAD     = 6;

// ─── Preview panels ───────────────────────────────────────────────────────────

function PreviewDashboard({ shopName }: { shopName: string }) {
  const first = shopName.split(" ")[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 10, padding: "10px 12px" }}>
        <div style={{ fontFamily: C, fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>GOOD MORNING</div>
        <div style={{ fontFamily: S, fontWeight: 800, fontSize: 14, color: "#f9fafb" }}>{first} 🏪</div>
        <div style={{ fontFamily: C, fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>Here's how the shop is doing today</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {[
          { label: "Today's Revenue", value: "KSh 8,400",  color: "#34d399", icon: "💰" },
          { label: "Transactions",    value: "24 sales",   color: "#06b6d4", icon: "🧾" },
          { label: "M-Pesa",          value: "KSh 5,100",  color: "#a78bfa", icon: "📱" },
          { label: "Cash",            value: "KSh 3,300",  color: "#fbbf24", icon: "💵" },
        ].map(s => (
          <div key={s.label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "8px 9px" }}>
            <div style={{ fontSize: 13 }}>{s.icon}</div>
            <div style={{ fontFamily: S, fontWeight: 700, fontSize: 12, color: s.color, marginTop: 3 }}>{s.value}</div>
            <div style={{ fontFamily: C, fontSize: 8, color: "rgba(255,255,255,0.28)", marginTop: 1 }}>{s.label}</div>
          </div>
        ))}
      </div>
      {/* Hourly mini-chart */}
      <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "7px 10px" }}>
        <div style={{ fontFamily: C, fontSize: 8, color: "rgba(255,255,255,0.3)", marginBottom: 5 }}>SALES BY HOUR</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 24 }}>
          {[20, 45, 35, 70, 55, 80, 60, 90, 40, 65].map((h, i) => (
            <div key={i} style={{ flex: 1, background: `rgba(6,182,212,${0.2 + h / 150})`, borderRadius: "2px 2px 0 0", height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewScan() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {/* Viewfinder */}
      <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(6,182,212,0.25)", borderRadius: 10, padding: "14px", textAlign: "center" }}>
        <div style={{ width: 80, height: 80, margin: "0 auto 8px", position: "relative" }}>
          {[
            { top: 0, left: 0, borderTop: "3px solid #06b6d4", borderLeft: "3px solid #06b6d4" },
            { top: 0, right: 0, borderTop: "3px solid #06b6d4", borderRight: "3px solid #06b6d4" },
            { bottom: 0, left: 0, borderBottom: "3px solid #06b6d4", borderLeft: "3px solid #06b6d4" },
            { bottom: 0, right: 0, borderBottom: "3px solid #06b6d4", borderRight: "3px solid #06b6d4" },
          ].map((s, i) => <div key={i} style={{ position: "absolute", width: 14, height: 14, borderRadius: 2, ...s }} />)}
          <div style={{ position: "absolute", inset: 10, display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 2 }}>
            {Array.from({ length: 25 }).map((_, i) => (
              <div key={i} style={{ borderRadius: 1, background: [0,1,4,5,6,10,12,14,18,19,20,23,24].includes(i) ? "rgba(255,255,255,0.6)" : "transparent" }} />
            ))}
          </div>
        </div>
        <div style={{ fontFamily: C, fontSize: 9, color: "rgba(255,255,255,0.4)" }}>Scan product QR code to sell</div>
      </div>
      {/* Payment methods */}
      <div style={{ fontFamily: C, fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Payment methods supported</div>
      <div style={{ display: "flex", gap: 6 }}>
        {[
          { label: "Cash",      color: "#fbbf24", icon: "💵" },
          { label: "M-Pesa",   color: "#34d399", icon: "📱" },
          { label: "Split",    color: "#a78bfa", icon: "⚡" },
        ].map(m => (
          <div key={m.label} style={{ flex: 1, background: `${m.color}0f`, border: `1px solid ${m.color}28`, borderRadius: 8, padding: "7px 4px", textAlign: "center" }}>
            <div style={{ fontSize: 14, marginBottom: 3 }}>{m.icon}</div>
            <div style={{ fontFamily: C, fontSize: 8, color: m.color }}>{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewTransactions() {
  const rows = [
    { product: "Mineral Water", qty: 6,  amount: "KSh 300", method: "cash",  time: "09:14 AM" },
    { product: "Soda 330ml",    qty: 4,  amount: "KSh 320", method: "mpesa", time: "09:38 AM" },
    { product: "Energy Drink",  qty: 2,  amount: "KSh 240", method: "split", time: "10:02 AM" },
    { product: "Mineral Water", qty: 12, amount: "KSh 600", method: "cash",  time: "10:45 AM" },
  ];
  const methodColor: Record<string, string> = { cash: "#fbbf24", mpesa: "#34d399", split: "#a78bfa" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontFamily: S, fontWeight: 700, fontSize: 10, color: "#34d399" }}>KSh 1,460 total · 4 sales</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 7, padding: "7px 9px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: S, fontWeight: 600, fontSize: 10, color: "#f9fafb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.product}</div>
            <div style={{ fontFamily: C, fontSize: 8, color: "rgba(255,255,255,0.3)" }}>qty {r.qty} · {r.time}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <span style={{ fontFamily: S, fontWeight: 700, fontSize: 11, color: "#34d399" }}>{r.amount}</span>
            <span style={{ fontFamily: C, fontSize: 8, color: methodColor[r.method], background: `${methodColor[r.method]}18`, borderRadius: 5, padding: "2px 6px" }}>{r.method}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PreviewShopInfo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ fontFamily: C, fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Stock allocated to this shop</div>
      {[
        { name: "Mineral Water 500ml", remaining: 142, allocated: 200, color: "#34d399" },
        { name: "Soda 330ml",          remaining: 38,  allocated: 150, color: "#fbbf24" },
        { name: "Energy Drink 250ml",  remaining: 8,   allocated: 80,  color: "#f87171" },
      ].map(p => {
        const pct = Math.round((p.remaining / p.allocated) * 100);
        return (
          <div key={p.name} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontFamily: S, fontWeight: 600, fontSize: 10, color: "#f9fafb" }}>{p.name}</span>
              <span style={{ fontFamily: S, fontWeight: 700, fontSize: 11, color: p.color }}>{p.remaining} left</span>
            </div>
            <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 99 }}>
              <div style={{ height: 4, width: `${pct}%`, background: p.color, borderRadius: 99 }} />
            </div>
            {pct <= 15 && <div style={{ fontFamily: C, fontSize: 8, color: "#f87171", marginTop: 3 }}>⚠ Low — owner will be notified</div>}
          </div>
        );
      })}
      {/* Assigned agents */}
      <div style={{ fontFamily: C, fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 2 }}>Agents assigned to this shop</div>
      <div style={{ display: "flex", gap: 6 }}>
        {["JM", "AW"].map(av => (
          <div key={av} style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: S, fontWeight: 700, fontSize: 11, color: "#fff" }}>{av}</div>
        ))}
        <div style={{ fontFamily: C, fontSize: 9, color: "rgba(255,255,255,0.35)", alignSelf: "center" }}>2 agents can sell here</div>
      </div>
    </div>
  );
}

function PreviewHub() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ fontFamily: C, fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Send requests to the owner</div>
      {[
        { icon: "📦", title: "Stock Request",   desc: "Ask the owner to allocate more products", color: "#a78bfa" },
        { icon: "💬", title: "Send Message",     desc: "Communicate directly with your owner",    color: "#38bdf8" },
        { icon: "⚠",  title: "Report an Issue", desc: "Flag a problem or a transaction error",   color: "#f87171" },
      ].map(r => (
        <div key={r.title} style={{ display: "flex", alignItems: "center", gap: 9, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 10px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: `${r.color}15`, border: `1px solid ${r.color}25`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{r.icon}</div>
          <div>
            <div style={{ fontFamily: S, fontWeight: 600, fontSize: 11, color: "#f9fafb" }}>{r.title}</div>
            <div style={{ fontFamily: C, fontSize: 8, color: "rgba(255,255,255,0.35)" }}>{r.desc}</div>
          </div>
        </div>
      ))}
      <div style={{ background: "rgba(6,182,212,0.07)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 8, padding: "7px 10px", fontFamily: C, fontSize: 9, color: "rgba(255,255,255,0.4)" }}>
        Owner replies appear here — check for approvals
      </div>
    </div>
  );
}

// ─── Steps ────────────────────────────────────────────────────────────────────

type StepKind = "welcome" | "nav" | "complete";

interface Step {
  kind: StepKind;
  tourKey: string | null;
  path: string | null;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  Preview: (props: { shopName: string }) => React.ReactElement;
}

const STEPS: Step[] = [
  {
    kind: "welcome", tourKey: null, path: null,
    title: "Welcome to QASHUP Shop POS",
    subtitle: "Your shop's point of sale",
    description: "Everything you need to sell, track stock, and stay in sync with your owner — right here.",
    color: "#06b6d4",
    Preview: ({ shopName }) => (
      <div style={{ textAlign: "center", padding: "10px 0" }}>
        <div style={{ width: 60, height: 60, borderRadius: 16, background: "linear-gradient(135deg,#06b6d4,#0284c7)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px", boxShadow: "0 8px 20px rgba(6,182,212,0.35)", fontFamily: S, fontWeight: 800, fontSize: 26, color: "#fff" }}>🏪</div>
        <div style={{ fontFamily: S, fontWeight: 700, fontSize: 13, color: "#f9fafb", marginBottom: 10 }}>{shopName} — let's get started!</div>
        <div style={{ fontFamily: C, fontSize: 9, color: "rgba(255,255,255,0.35)", lineHeight: 1.9 }}>
          <span style={{ color: "#34d399" }}>✓</span> Scan & sell any product instantly<br />
          <span style={{ color: "#34d399" }}>✓</span> Accept cash, M-Pesa, or split<br />
          <span style={{ color: "#34d399" }}>✓</span> Works offline — syncs when back online<br />
          <span style={{ color: "#34d399" }}>✓</span> Stock tracked in real time
        </div>
      </div>
    ),
  },
  {
    kind: "nav", tourKey: "pos-home", path: "/pos",
    title: "Dashboard",
    subtitle: "Your shop at a glance",
    description: "See today's revenue, number of sales, M-Pesa vs cash breakdown, and an hourly chart — all updating in real time.",
    color: "#06b6d4",
    Preview: ({ shopName }) => <PreviewDashboard shopName={shopName} />,
  },
  {
    kind: "nav", tourKey: "pos-scan", path: "/pos/scan",
    title: "Scan & Sell",
    subtitle: "Tap, scan, done",
    description: "Point the camera at a product QR code. Choose the quantity and payment method — cash, M-Pesa, or a split of both. The sale is recorded immediately, even offline.",
    color: "#a78bfa",
    Preview: () => <PreviewScan />,
  },
  {
    kind: "nav", tourKey: "pos-txns", path: "/pos/transactions",
    title: "Transactions",
    subtitle: "Every sale this shop made",
    description: "A full log of all sales — product, quantity, amount, payment method, and the agent who made the sale. Filter by date or method.",
    color: "#38bdf8",
    Preview: () => <PreviewTransactions />,
  },
  {
    kind: "nav", tourKey: "pos-info", path: "/pos/info",
    title: "Shop Info",
    subtitle: "Stock & assigned agents",
    description: "See exactly how many units are left for each product allocated to this shop, and which agents are allowed to sell here.",
    color: "#34d399",
    Preview: () => <PreviewShopInfo />,
  },
  {
    kind: "nav", tourKey: "pos-hub", path: "/pos/requests",
    title: "Hub",
    subtitle: "Talk to your owner",
    description: "Request more stock, report an issue, or send a message. Your owner sees it on the dashboard and can reply directly.",
    color: "#f87171",
    Preview: () => <PreviewHub />,
  },
  {
    kind: "complete", tourKey: null, path: null,
    title: "", subtitle: "You're ready to sell!",
    description: "", color: "#34d399",
    Preview: () => <></>,
  },
];

// ─── Confetti (stable outside component) ─────────────────────────────────────

const CONFETTI = Array.from({ length: 48 }, (_, i) => ({
  id: i,
  x: Math.random() * 100,
  size: 5 + Math.random() * 7,
  delay: Math.random() * 1.1,
  dur: 1.3 + Math.random() * 1.1,
  rotate: Math.random() * 360,
  dx: (Math.random() - 0.5) * 55,
  color: ["#06b6d4","#a78bfa","#34d399","#fbbf24","#f87171","#38bdf8","#e879f9","#f59e0b"][i % 8],
  shape: i % 3 === 0 ? "circle" : "rect",
}));

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  shopId: string;
  shopName: string;
  onDone: () => void;
}

export default function ShopOnboardingTour({ shopId, shopName, onDone }: Props) {
  const navigate = useNavigate();
  const [step,          setStep]          = useState(0);
  const [rect,          setRect]          = useState<DOMRect | null>(null);
  const [visible,       setVisible]       = useState(false);
  const [showConfetti,  setShowConfetti]  = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current    = STEPS[step];
  const isWelcome  = current.kind === "welcome";
  const isComplete = current.kind === "complete";
  const isCentered = isWelcome || isComplete;

  const markDone = () => {
    localStorage.setItem(`pos_tour_shown_${shopId}`, "1");
    navigate("/pos");
    onDone();
  };

  const goTo = (target: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (target >= STEPS.length) { markDone(); return; }
    setStep(target);
  };

  // Navigate to the step's page and locate the bottom nav element
  useEffect(() => {
    setVisible(false);
    setRect(null);
    if (current.path) navigate(current.path);

    const locate = () => {
      if (!current.tourKey) { setVisible(true); return; }
      const el = document.querySelector(`[data-tour="${current.tourKey}"]`);
      if (el) setRect(el.getBoundingClientRect());
      setVisible(true);
    };
    const t = setTimeout(locate, 320);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Auto-advance
  useEffect(() => {
    if (!visible || isComplete) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => goTo(step + 1), STEP_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, step]);

  // Confetti on complete
  useEffect(() => {
    if (!visible || !isComplete) return;
    setShowConfetti(true);
    const t = setTimeout(() => setShowConfetti(false), 3400);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isComplete]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Spotlight coords
  const sX = rect ? rect.left   - PAD : -9999;
  const sY = rect ? rect.top    - PAD : -9999;
  const sW = rect ? rect.width  + PAD * 2 : 0;
  const sH = rect ? rect.height + PAD * 2 : 0;

  // Card position — always bottom sheet above nav
  const cardStyle: React.CSSProperties = isCentered
    ? { top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(370px, 92vw)" }
    : { bottom: NAV_H + 10, left: 12, right: 12 };

  const navSteps = STEPS.length - 2;
  const navIndex = step - 1;
  const { Preview } = current;

  return (
    <>
      <style>{`
        @keyframes spos-in     { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:none} }
        @keyframes spos-center { from{opacity:0;transform:translate(-50%,-50%) scale(0.94)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
        @keyframes spos-pop    { from{opacity:0;transform:translate(-50%,-50%) scale(0.9)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
        @keyframes spos-ring   { 0%{box-shadow:0 0 0 0 var(--rc)55} 70%{box-shadow:0 0 0 7px transparent} 100%{box-shadow:0 0 0 0 transparent} }
        @keyframes spos-bg     { from{opacity:0} to{opacity:1} }
        @keyframes spos-bar    { from{width:0%} to{width:100%} }
        @keyframes spos-conf   { 0%{transform:translateY(0) translateX(0) rotate(0deg);opacity:1} 100%{transform:translateY(-85vh) translateX(var(--cdx)) rotate(var(--cr));opacity:0} }
      `}</style>

      {/* Confetti */}
      {showConfetti && CONFETTI.map(p => (
        <div key={p.id} style={{
          position: "fixed", bottom: -8, left: `${p.x}vw`,
          width: p.shape === "circle" ? p.size : p.size * 0.6, height: p.size,
          borderRadius: p.shape === "circle" ? "50%" : 2,
          background: p.color, zIndex: 9500, pointerEvents: "none", opacity: 0,
          ["--cdx" as any]: `${p.dx}vw`, ["--cr" as any]: `${p.rotate}deg`,
          animation: `spos-conf ${p.dur}s ease-out ${p.delay}s forwards`,
        }} />
      ))}

      {/* Overlay */}
      <div style={{ position: "fixed", inset: 0, zIndex: 9000, pointerEvents: "none", animation: "spos-bg 0.25s ease" }}>
        {rect && !isCentered ? (
          <>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: sY, background: "rgba(5,7,14,0.86)" }} />
            <div style={{ position: "absolute", top: sY + sH, left: 0, right: 0, bottom: 0, background: "rgba(5,7,14,0.86)" }} />
            <div style={{ position: "absolute", top: sY, left: 0, width: sX, height: sH, background: "rgba(5,7,14,0.86)" }} />
            <div style={{ position: "absolute", top: sY, left: sX + sW, right: 0, height: sH, background: "rgba(5,7,14,0.86)" }} />
          </>
        ) : (
          <div style={{ position: "absolute", inset: 0, background: "rgba(5,7,14,0.86)" }} />
        )}
        {rect && !isCentered && (
          <div style={{
            position: "absolute",
            top: sY - 2, left: sX - 2, width: sW + 4, height: sH + 4,
            borderRadius: 12,
            border: `2px solid ${current.color}`,
            ["--rc" as any]: current.color,
            boxShadow: `0 0 0 3px ${current.color}20, 0 0 16px ${current.color}50`,
            animation: "spos-ring 1.8s ease infinite",
          }} />
        )}
      </div>

      {/* Card */}
      {visible && (
        <div style={{
          position: "fixed",
          ...cardStyle,
          zIndex: 9200,
          background: "linear-gradient(160deg,#13182a,#0c1020)",
          border: `1px solid ${current.color}30`,
          borderRadius: isCentered ? 22 : 20,
          overflow: "hidden",
          boxShadow: `0 -4px 32px rgba(0,0,0,0.65), 0 0 0 1px ${current.color}18`,
          animation: isCentered
            ? (isComplete ? "spos-pop 0.4s cubic-bezier(0.16,1,0.3,1)" : "spos-center 0.3s cubic-bezier(0.16,1,0.3,1)")
            : "spos-in 0.28s cubic-bezier(0.16,1,0.3,1)",
          pointerEvents: "auto",
          maxHeight: isCentered ? "85vh" : `calc(100vh - ${NAV_H + 20}px - env(safe-area-inset-top))`,
          overflowY: "auto",
        }}>

          {/* Accent stripe */}
          <div style={{ height: 3, background: `linear-gradient(90deg,${current.color},${current.color}44,transparent)` }} />

          {/* Timer bar */}
          {!isComplete && (
            <div style={{ height: 2, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
              <div key={step} style={{ height: "100%", background: `${current.color}55`, animation: `spos-bar ${STEP_MS}ms linear forwards` }} />
            </div>
          )}

          <div style={{ padding: "16px 18px 20px" }}>

            {/* Complete header */}
            {isComplete ? (
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 36, marginBottom: 8, lineHeight: 1 }}>🎉</div>
                <div style={{ fontFamily: C, fontSize: 9, color: "#34d399", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>You're all set</div>
                <div style={{ fontFamily: S, fontWeight: 800, fontSize: 18, color: "#f9fafb", lineHeight: 1.3, marginBottom: 8 }}>
                  Welcome,{" "}
                  <span style={{ background: "linear-gradient(135deg,#06b6d4,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                    {shopName}!
                  </span>
                </div>
                <div style={{ fontFamily: C, fontSize: 10, color: "rgba(255,255,255,0.45)", lineHeight: 1.75 }}>
                  The shop is ready. Scan your first product and make your first sale.
                </div>
              </div>
            ) : (
              /* Normal step header */
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <div style={{ fontFamily: C, fontSize: 9, color: current.color, letterSpacing: "0.09em", textTransform: "uppercase", marginBottom: 3 }}>
                    {isWelcome ? "Quick tour" : `Step ${navIndex} of ${navSteps}`}
                  </div>
                  <div style={{ fontFamily: S, fontWeight: 800, fontSize: 16, color: "#f9fafb", lineHeight: 1.2 }}>{current.title}</div>
                  <div style={{ fontFamily: C, fontSize: 9, color: current.color, marginTop: 2, opacity: 0.8 }}>{current.subtitle}</div>
                </div>
                <button
                  onClick={markDone}
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 8, width: 28, height: 28, cursor: "pointer", color: "rgba(255,255,255,0.38)", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, WebkitTapHighlightColor: "transparent" }}
                  title="Skip tour"
                >×</button>
              </div>
            )}

            {/* Description */}
            {!isComplete && (
              <div style={{ fontFamily: C, fontSize: 10, color: "rgba(255,255,255,0.48)", lineHeight: 1.72, marginBottom: 12 }}>
                {current.description}
              </div>
            )}

            {/* Preview panel */}
            {!isComplete ? (
              <div style={{ background: "rgba(0,0,0,0.28)", border: `1px solid ${current.color}15`, borderRadius: 12, padding: "11px 12px 10px", marginBottom: 14 }}>
                <div style={{ fontFamily: C, fontSize: 8, color: `${current.color}88`, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Preview</div>
                <Preview shopName={shopName} />
              </div>
            ) : (
              /* Complete: quick-start checklist + support */
              <div style={{ background: "rgba(0,0,0,0.25)", border: `1px solid ${current.color}15`, borderRadius: 12, padding: "12px", marginBottom: 14 }}>
                <div style={{ fontFamily: C, fontSize: 8, color: `${current.color}88`, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>First steps</div>
                {[
                  { icon: "📷", text: "Tap Scan & Sell → scan a product QR code" },
                  { icon: "📦", text: "Check Shop Info to see your stock levels" },
                  { icon: "📋", text: "Use Hub to request more stock from the owner" },
                ].map(s => (
                  <div key={s.icon} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8 }}>
                    <span style={{ fontSize: 15 }}>{s.icon}</span>
                    <span style={{ fontFamily: C, fontSize: 10, color: "rgba(255,255,255,0.5)" }}>{s.text}</span>
                  </div>
                ))}
                <div style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: 8, padding: "8px 10px", marginTop: 6 }}>
                  <div style={{ fontFamily: S, fontWeight: 600, fontSize: 11, color: "#f9fafb", marginBottom: 4 }}>Need help?</div>
                  <div style={{ fontFamily: C, fontSize: 9, color: "rgba(255,255,255,0.4)", lineHeight: 1.65 }}>
                    WhatsApp: <span style={{ color: "#06b6d4" }}>+254 783 069 010</span><br />
                    Email: <span style={{ color: "#06b6d4" }}>epicsoftwaredesigners@gmail.com</span>
                  </div>
                </div>
              </div>
            )}

            {/* Step dots */}
            <div style={{ display: "flex", justifyContent: "center", gap: 4, marginBottom: 12 }}>
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  onClick={() => i !== step && goTo(i)}
                  style={{
                    width: i === step ? 16 : 5, height: 5, borderRadius: 99,
                    background: i === step ? current.color : i < step ? `${current.color}50` : "rgba(255,255,255,0.1)",
                    transition: "width 0.22s ease, background 0.22s ease",
                    cursor: i !== step ? "pointer" : "default",
                    WebkitTapHighlightColor: "transparent",
                  }}
                />
              ))}
            </div>

            {/* Buttons */}
            <div style={{ display: "flex", gap: 8 }}>
              {step > 0 && !isComplete && (
                <button
                  onClick={() => goTo(step - 1)}
                  style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: "13px 0", color: "rgba(255,255,255,0.55)", fontFamily: S, fontWeight: 600, fontSize: 14, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                  ← Back
                </button>
              )}
              <button
                onClick={() => isComplete ? markDone() : goTo(step + 1)}
                style={{
                  flex: (step > 0 && !isComplete) ? 2 : 1,
                  background: isComplete
                    ? "linear-gradient(135deg,#34d399,#10b981)"
                    : `linear-gradient(135deg,${current.color},${current.color}bb)`,
                  border: "none", borderRadius: 12, padding: "14px 0",
                  color: "#fff", fontFamily: S, fontWeight: 700, fontSize: 15,
                  cursor: "pointer",
                  boxShadow: isComplete ? "0 4px 18px rgba(52,211,153,0.38)" : `0 4px 14px ${current.color}35`,
                  WebkitTapHighlightColor: "transparent",
                }}>
                {isComplete ? "Start Selling →" : step === 0 ? "Show Me →" : step < STEPS.length - 2 ? "Next →" : "Finish Tour"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
