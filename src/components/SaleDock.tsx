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
        position: "fixed",
        bottom: `calc(env(safe-area-inset-bottom, 0px) + ${bottomOffset}px)`,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9000,

        // Float with gutters so the left/right borders are always visible.
        // calc(100% - 24px) guarantees a 12px gap on the narrowest phones;
        // maxWidth 480 stops it ballooning on tablets and desktop.
        width: "calc(100% - 24px)",
        maxWidth: 480,

        // Opaque enough to read the price against anything scrolling behind.
        background: isDark
          ? "rgba(13, 17, 23, 0.88)"
          : "rgba(255, 255, 255, 0.94)",
        backdropFilter: "blur(16px) saturate(1.1)",
        WebkitBackdropFilter: "blur(16px) saturate(1.1)",

        // Rounded corners — it's a floating card now, not a flush bar
        borderRadius: 14,
        border: `1px solid ${isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)"}`,
        boxShadow: isDark
          ? "0 12px 32px rgba(0,0,0,0.55)"
          : "0 12px 32px rgba(15,23,42,0.14)",

        padding: "6px",
        display: "flex",
        alignItems: "center",
        gap: 6,
        boxSizing: "border-box",
      }}
    >
      {/* Tappable expand area */}
      <button
        onClick={onExpand}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "transparent",
          border: "none",
          padding: "10px 10px",
          borderRadius: 10,
          cursor: "pointer",
          color: theme.text.primary,
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 16, flexShrink: 0 }}>🛒</span>

        {/* Price line — split so the total always gets room, even when
            the item count is long ("12 items"). */}
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span style={{
            fontFamily: theme.font.mono,
            fontSize: 10,
            color: theme.text.muted,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
          }}>
            {count} item{count !== 1 ? "s" : ""}
          </span>
          <span style={{
            fontFamily: theme.font.display,
            fontWeight: 800,
            fontSize: 15,
            color: theme.accent.gold,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {fmt(total)}
          </span>
        </span>

        <span style={{
          fontSize: 11,
          color: theme.text.muted,
          flexShrink: 0,
        }}>⌃</span>
      </button>

      {/* Sell button — narrower, tighter, with a subtle glow */}
      <button
        onClick={onCharge}
        disabled={disabled}
        style={{
          flexShrink: 0,
          padding: "10px 18px",
          borderRadius: 10,
          border: "none",
          background: disabled
            ? (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)")
            : `linear-gradient(135deg, ${theme.accent.cyan}, #0891b2)`,
          color: disabled ? theme.text.muted : "#fff",
          fontFamily: theme.font.display,
          fontWeight: 800,
          fontSize: 14,
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          whiteSpace: "nowrap",
          boxShadow: disabled ? "none" : "0 4px 14px rgba(6,182,212,0.35)",
        }}
      >
        Sell <span style={{ fontSize: 14 }}>→</span>
      </button>
    </div>
  );
}