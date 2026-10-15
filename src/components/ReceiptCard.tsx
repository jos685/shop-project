import { useState } from "react";
import type { ReceiptData } from "../lib/receipt";
import type { BusinessInfo } from "../lib/useBusinessInfo";

const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

export default function ReceiptCard({
  data,
  biz,
  theme,
  isMobile,
  compact = false,   // used inside the WhatsApp modal preview
}: {
  data: ReceiptData;
  biz: BusinessInfo;
  theme: any;
  isMobile: boolean;
  compact?: boolean;
}) {
  const [logoBroken, setLogoBroken] = useState(false);
  const showLogo = !!biz.logoUrl && !logoBroken && !/\.svg(\?|$)/i.test(biz.logoUrl);

  // ── Surface treatment: give the card a "lifted paper" look that reads
  //    clearly against the page in both dark and light mode. Print/PDF
  //    output is unaffected — this only styles the on-screen card.
  const isDark = (() => {
    const base = (theme?.bg?.base ?? "#0a0a0a").replace("#", "");
    if (base.length !== 6) return true;
    const r = parseInt(base.slice(0, 2), 16);
    const g = parseInt(base.slice(2, 4), 16);
    const b = parseInt(base.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum < 0.5;
  })();

  const surface    = isDark ? "#1c1f24" : "#ffffff";
  const shadow     = isDark
    ? "0 10px 30px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)"
    : "0 6px 20px rgba(15,23,42,0.10), 0 1px 3px rgba(15,23,42,0.06)";
  const borderCol  = isDark ? "rgba(255,255,255,0.09)" : "rgba(15,23,42,0.08)";
  const cPrimary   = isDark ? theme.text.primary : "#0f172a";
  const cMuted     = isDark ? theme.text.muted   : "#64748b";

  const pad = compact
    ? (isMobile ? "14px 12px" : "16px 14px")
    : (isMobile ? "18px 14px" : "22px 22px");

  const totalSize = isMobile ? 22 : 26;

  return (
    <div
      style={{
        position: "relative",
        background: surface,
        border: `1px solid ${borderCol}`,
        borderRadius: 18,
        padding: pad,
        paddingTop: `calc(${pad.split(" ")[0]} + 6px)`,
        width: "100%",
        maxWidth: 420,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        color: cPrimary,
        boxSizing: "border-box",
        overflow: "hidden",
        boxShadow: shadow,
      }}
    >
      {/* Top accent stripe — the "receipt header" cue */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0,
          height: 3,
          background: `linear-gradient(90deg, transparent 0%, ${theme.accent.cyan} 50%, transparent 100%)`,
          opacity: isDark ? 0.85 : 0.65,
        }}
      />

      {/* ── Header: logo + business name + phone ── */}
      <div style={{ textAlign: "center" }}>
        {showLogo && (
          <img
            src={biz.logoUrl!}
            alt=""
            onError={() => setLogoBroken(true)}
            style={{
              maxHeight: compact ? 44 : 56,
              maxWidth: "70%",
              objectFit: "contain",
              display: "block",
              margin: "0 auto 8px",
            }}
          />
        )}
        {biz.businessName && (
          <div
            style={{
              fontFamily: theme.font.display,
              fontWeight: 800,
              fontSize: isMobile ? 15 : 17,
              lineHeight: 1.2,
              wordBreak: "break-word",
              color: cPrimary,
            }}
          >
            {biz.businessName}
          </div>
        )}
        {biz.phone && (
          <div
            style={{
              fontFamily: theme.font.mono,
              fontSize: 11,
              color: cMuted,
              marginTop: 3,
              wordBreak: "break-word",
            }}
          >
            {biz.phone}
          </div>
        )}
      </div>

      <Divider color={borderCol} />

      {/* ── Meta rows ── */}
      <MetaRow theme={theme} label="Receipt"   value={data.ref}           valueColor={theme.accent.cyan} mutedColor={cMuted} primaryColor={cPrimary} />
      <MetaRow theme={theme} label="Date"      value={data.timestamp}     mutedColor={cMuted} primaryColor={cPrimary} />
      <MetaRow theme={theme} label="Served by" value={data.sellerName}    mutedColor={cMuted} primaryColor={cPrimary} />

      <Divider color={borderCol} />

      {/* ── Items ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {data.items.map((it, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 10,
              minWidth: 0,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: cPrimary,
                }}
                title={it.name}
              >
                {it.qty}× {it.name}
              </div>
              {it.unlisted && (
                <div
                  style={{
                    fontSize: 9,
                    fontFamily: theme.font.mono,
                    color: "#c084fc",
                    marginTop: 1,
                  }}
                >
                  unlisted
                </div>
              )}
            </div>
            <div
              style={{
                fontFamily: theme.font.mono,
                fontSize: 12.5,
                fontWeight: 700,
                color: cPrimary,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {ksh(it.total)}
            </div>
          </div>
        ))}
      </div>

      <Divider color={borderCol} />

      {/* ── Total ── */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontFamily: theme.font.mono,
            color: cMuted,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Total
        </span>
        <span
          style={{
            fontFamily: theme.font.display,
            fontWeight: 800,
            fontSize: totalSize,
            color: theme.accent.gold,
            lineHeight: 1,
          }}
        >
          {ksh(data.total)}
        </span>
      </div>

      {/* ── Credit banner ── */}
      {data.isCredit && (
        <div
          style={{
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.35)",
            borderRadius: 10,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontFamily: theme.font.mono,
              color: "#f87171",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 800,
            }}
          >
            Credit Sale
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 11.5, fontFamily: theme.font.mono, color: cMuted }}>
              Paid upfront
            </span>
            <span
              style={{
                fontSize: 12.5,
                fontFamily: theme.font.mono,
                fontWeight: 700,
                color: "#34d399",
              }}
            >
              {ksh(data.amountPaid)}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 11.5, fontFamily: theme.font.mono, color: cMuted }}>
              Balance owed
            </span>
            <span
              style={{
                fontSize: 13,
                fontFamily: theme.font.mono,
                fontWeight: 800,
                color: data.balanceOwed <= 0 ? "#34d399" : "#f87171",
              }}
            >
              {data.balanceOwed <= 0 ? "Paid ✓" : ksh(data.balanceOwed)}
            </span>
          </div>
        </div>
      )}

      <Divider color={borderCol} />

      {/* ── Payment meta ── */}
      <MetaRow theme={theme} label="Payment"     value={data.paymentMethod} mutedColor={cMuted} primaryColor={cPrimary} />
      {data.mpesaRef      && <MetaRow theme={theme} label="M-Pesa ref" value={data.mpesaRef}      mutedColor={cMuted} primaryColor={cPrimary} />}
      {data.customerName  && <MetaRow theme={theme} label="Customer"   value={data.customerName}  mutedColor={cMuted} primaryColor={cPrimary} />}
      {data.customerPhone && <MetaRow theme={theme} label="Phone"      value={data.customerPhone} mutedColor={cMuted} primaryColor={cPrimary} />}
      {data.isQueued      && <MetaRow theme={theme} label="Status"     value="Pending sync"       valueColor="#fbbf24" mutedColor={cMuted} primaryColor={cPrimary} />}

      <Divider color={borderCol} />

      {/* ── Footer ── */}
      <div
        style={{
          textAlign: "center",
          fontFamily: theme.font.mono,
          fontSize: 11,
          color: cMuted,
          lineHeight: 1.5,
        }}
      >
        Thank you for shopping at
        <br />
        <span style={{ color: cPrimary, fontWeight: 700 }}>
          {biz.businessName || "us"}
        </span>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────
function Divider({ color }: { color: string }) {
  return (
    <div
      style={{
        height: 1,
        background: color,
        margin: "2px 0",
      }}
    />
  );
}

function MetaRow({
  theme,
  label,
  value,
  valueColor,
  mutedColor,
  primaryColor,
}: {
  theme: any;
  label: string;
  value: string;
  valueColor?: string;
  mutedColor: string;
  primaryColor: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 10,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontFamily: theme.font.mono,
          color: mutedColor,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontFamily: theme.font.mono,
          fontWeight: 600,
          color: valueColor || primaryColor,
          textAlign: "right",
          wordBreak: "break-word",
          minWidth: 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}