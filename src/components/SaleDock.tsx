const fmt = (n: number) => `KSh ${n.toLocaleString()}`;

export default function SaleDock({
  count, total, onExpand, onCharge, disabled, theme, bottomOffset = 64,
}: {
  count: number;
  total: number;
  onExpand: () => void;
  onCharge: () => void;
  disabled: boolean;
  theme: any;
  bottomOffset?: number;
}) {
  const isDark = theme.isDark;

  return (
    <div
    style={{
      position: "fixed", left: 0, right: 0,
      bottom: `calc(env(safe-area-inset-bottom, 0px) + ${bottomOffset}px)`,
      zIndex: 9000,

      background: isDark ? "rgba(13, 17, 23, 0.28)" : "rgba(255, 255, 255, 0.30)",
         backdropFilter: "blur(4px) saturate(1.05)",
      WebkitBackdropFilter: "blur(6px) saturate(1.1)",

      borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"}`,
      boxShadow: isDark
        ? "0 -8px 24px rgba(0,0,0,0.35)"
        : "0 -8px 24px rgba(0,0,0,0.08)",
      padding: "8px 10px",
      display: "flex", alignItems: "center", gap: 8,
      maxWidth: 720,
      marginLeft: "auto", marginRight: "auto",
      width: "100%",
    }}
    >
      <button
        onClick={onExpand}
        style={{
          flex: 1, minWidth: 0,
          display: "flex", alignItems: "center", gap: 8,
          background: "transparent", border: "none",
          padding: "10px 10px", borderRadius: 10, cursor: "pointer",
          color: theme.text.primary, textAlign: "left",
        }}
      >
        <span style={{ fontSize: 18, flexShrink: 0 }}>🛒</span>
        <span style={{
          fontFamily: theme.font.mono, fontSize: 13, fontWeight: 600,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
        }}>
          {count} item{count !== 1 ? "s" : ""} · {fmt(total)}
        </span>
        <span style={{ fontSize: 11, color: theme.text.muted, marginLeft: "auto", flexShrink: 0 }}>⌃</span>
      </button>

      <button
        onClick={onCharge}
        disabled={disabled}
        style={{
          flexShrink: 0, padding: "12px 16px",
          borderRadius: 12, border: "none",
          background: disabled
            ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)")
            : `linear-gradient(135deg, ${theme.accent.cyan}, #0891b2)`,
          color: disabled ? theme.text.muted : "#fff",
          fontFamily: theme.font.display, fontWeight: 800, fontSize: 14,
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
        }}
      >
        Sell <span style={{ fontSize: 15 }}>→</span>
      </button>
    </div>
  );
}